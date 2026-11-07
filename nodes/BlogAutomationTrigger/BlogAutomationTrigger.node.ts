import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';
import { baApiRequest } from '../shared/transport';

const MAX_PAGES = 10;
const QUERY: Record<string, { path: string; status?: string }> = {
	articleReady: { path: '/articles', status: 'review,approved' },
	articlePublished: { path: '/articles', status: 'published' },
	articleFailed: { path: '/articles', status: 'failed' },
	newIdea: { path: '/ideas', status: 'new' },
};

/**
 * Polling trigger (no webhook needed): GET /articles?status=…&updatedSince=<newest change seen> (or /ideas), newest first, cursor pages.
 * Items with the boundary timestamp that were already emitted are skipped (ids kept in static data).
 * For real-time events use the "Blog Automation Webhook Trigger" node (registers a webhook automatically).
 */
export class BlogAutomationTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Blog Automation Trigger',
		name: 'blogAutomationTrigger',
		icon: { light: 'file:../../icons/blogautomation.svg', dark: 'file:../../icons/blogautomation.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when articles are ready, published or failed, or new ideas arrive (polling)',
		defaults: { name: 'Blog Automation Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'blogAutomationApi', required: true }],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{ name: 'Article Failed', value: 'articleFailed', description: 'Publishing an article failed' },
					{ name: 'Article Published', value: 'articlePublished', description: 'An article went live' },
					{ name: 'Article Ready', value: 'articleReady', description: 'An article is waiting for review or is approved' },
					{ name: 'New Idea', value: 'newIdea', description: 'A new idea is on the idea board' },
				],
				default: 'articleReady',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		const q = QUERY[event] || QUERY.articleReady;
		const state = this.getWorkflowStaticData('node');
		const base: IDataObject = q.status ? { status: q.status } : {};

		if (this.getMode() === 'manual') {
			const res = await baApiRequest.call(this, 'GET', q.path, { ...base, limit: 1 });
			const rows = (res.data as IDataObject[]) || [];
			return rows.length ? [this.helpers.returnJsonArray(rows)] : null;
		}
		if (state.since === undefined) {
			// first activation: start from now
			state.since = new Date().toISOString();
			state.seen = [];
			return null;
		}
		const since = String(state.since);
		const seen = new Set((state.seen as string[]) || []);
		const list: IDataObject[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < MAX_PAGES; page++) {
			const res = await baApiRequest.call(this, 'GET', q.path, { ...base, updatedSince: since, limit: 100, ...(cursor ? { cursor } : {}) });
			list.push(...((res.data as IDataObject[]) || []));
			if (!res.hasMore || !res.nextCursor) break;
			cursor = String(res.nextCursor);
		}
		const key = (r: IDataObject) => `${r.id}@${r.updated}`;
		const rows = list.filter((r) => !seen.has(key(r))).sort((a, b) => String(a.updated).localeCompare(String(b.updated)));
		const newest = list.reduce((m, r) => (String(r.updated) > m ? String(r.updated) : m), since);
		state.since = newest;
		state.seen = list.filter((r) => String(r.updated) === newest).map(key);
		return rows.length ? [this.helpers.returnJsonArray(rows)] : null;
	}
}
