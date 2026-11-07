import { createHmac, timingSafeEqual } from 'crypto';
import {
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import { apiError, baApiRequest, statusOf } from '../shared/transport';

/**
 * REST hook: on activation the node registers its URL with POST /api/v1/ext/webhooks (scope webhooks:write) and keeps id + secret
 * in the workflow's static data; on deactivation DELETE /webhooks/:id (404 = already gone). Every request is checked against
 * X-BA-Signature: t=<unix>,sha256=<hex HMAC-SHA256(secret, "<t>.<raw body>")>, max. 5 minutes old.
 */
export function verifySignature(secret: string, header: string, rawBody: string, now = Date.now(), toleranceSec = 300): boolean {
	const parts = Object.fromEntries(
		String(header || '')
			.split(',')
			.map((p) => p.trim().split('='))
			.filter((p) => p.length === 2),
	) as Record<string, string>;
	const t = Number(parts.t);
	if (!/^[0-9a-f]{64}$/.test(parts.sha256 || '') || !Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
	const a = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest();
	const b = Buffer.from(parts.sha256, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

export const EVENTS = [
	{ name: 'Article Created', value: 'article.created', description: 'An article was created (app, AI, automation or API)' },
	{ name: 'Article Failed', value: 'article.failed', description: 'Publishing failed after all retries (data.lastError)' },
	{ name: 'Article Published', value: 'article.published', description: 'An article is live on the website (data.wpUrl)' },
	{ name: 'Article Ready', value: 'article.ready', description: 'The AI finished writing an article, or it moved to review / approved' },
	{ name: 'Article Status Changed', value: 'article.status_changed', description: 'Any status change (data.previousStatus)' },
	{ name: 'Automation Run Failed', value: 'automation.run_failed', description: 'An automation run failed or was skipped (data.message)' },
	{ name: 'Tokens Low', value: 'tokens.low', description: 'Tokens are running low (data.balance), at most every 6 hours' },
];

export class BlogAutomationWebhookTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Blog Automation Webhook Trigger',
		name: 'blogAutomationWebhookTrigger',
		icon: { light: 'file:../../icons/blogautomation.svg', dark: 'file:../../icons/blogautomation.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow on Blog Automation events in real time (registers a webhook automatically)',
		defaults: { name: 'Blog Automation Webhook' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'blogAutomationApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'blogautomation' }],
		properties: [
			{
				displayName:
					'The API key needs the scope webhooks:write plus the read scope of the events (article.* → articles:read, automation.run_failed → automations:read, tokens.low → account:read).',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: EVENTS,
				default: ['article.ready'],
				description: 'The events that start the workflow',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node');
				if (!state.webhookId) return false;
				try {
					const h = await baApiRequest.call(this, 'GET', `/webhooks/${encodeURIComponent(String(state.webhookId))}`);
					const events = this.getNodeParameter('events', []) as string[];
					const same = h.url === this.getNodeWebhookUrl('default') && h.active !== false &&
						[...events].sort().join(',') === [...((h.events as string[]) || [])].sort().join(',');
					if (same) return true;
				} catch (error) {
					if (statusOf(error) !== 404) throw apiError(this.getNode(), error);
				}
				delete state.webhookId;
				delete state.secret;
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node');
				const body: IDataObject = {
					url: this.getNodeWebhookUrl('default'),
					events: this.getNodeParameter('events', []) as string[],
					name: `n8n – ${this.getWorkflow().name || 'workflow'}`.slice(0, 80),
				};
				let res: IDataObject;
				try {
					res = await baApiRequest.call(this, 'POST', '/webhooks', {}, body);
				} catch (error) {
					throw apiError(this.getNode(), error);
				}
				if (!res.id) return false;
				state.webhookId = res.id;
				state.secret = res.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node');
				if (state.webhookId) {
					try {
						await baApiRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(String(state.webhookId))}`);
					} catch (error) {
						if (statusOf(error) !== 404) throw apiError(this.getNode(), error);   // 404 = already gone
					}
				}
				delete state.webhookId;
				delete state.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const state = this.getWorkflowStaticData('node');
		const secret = String(state.secret || '');
		const events = this.getNodeParameter('events', []) as string[];
		const body = this.getBodyData() as IDataObject;

		if (secret) {
			const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
			const rawBody = raw ? raw.toString('utf8') : JSON.stringify(body);
			if (!verifySignature(secret, String(req.headers['x-ba-signature'] || ''), rawBody)) {
				const res = this.getResponseObject();
				res.status(401).json({ error: 'invalid_signature' });
				return { noWebhookResponse: true };
			}
		}
		const event = String(body.event || req.headers['x-ba-event'] || '');
		if (events.length && !events.includes(event)) return { webhookResponse: { ok: true, ignored: event } };

		return { workflowData: [this.helpers.returnJsonArray([body])] };
	}
}
