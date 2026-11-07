import {
	NodeConnectionTypes,
	NodeOperationError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeExecutionData,
	type INodePropertyOptions,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { apiError, baApiRequest, baApiRequestAll, compact } from '../shared/transport';
import { articleProperties } from './ArticleDescription';
import { ideaProperties } from './IdeaDescription';

/** "Write with AI" with Wait for Completion: poll GET /jobs/{id} every intervalMs, give up after timeoutMs (tests shorten both). */
export const JOB_POLL = { intervalMs: 5000, timeoutMs: 15 * 60 * 1000 };

const id = (v: unknown) => encodeURIComponent(String(v).trim());
const num = (v: unknown) => (v === '' || v === undefined || v === null ? undefined : Number(v));

export class BlogAutomation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Blog Automation',
		name: 'blogAutomation',
		icon: { light: 'file:../../icons/blogautomation.svg', dark: 'file:../../icons/blogautomation.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Write blog articles with AI, manage ideas, schedule and publish with Blog Automation',
		defaults: { name: 'Blog Automation' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'blogAutomationApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Article', value: 'article' },
					{ name: 'Idea', value: 'idea' },
					{ name: 'Job', value: 'job' },
					{ name: 'Site', value: 'site' },
					{ name: 'Template', value: 'template' },
				],
				default: 'article',
			},
			...articleProperties,
			...ideaProperties,
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['job'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get an AI writing job', description: 'State of "Write with AI" started without waiting; the article when it is done' }],
				default: 'get',
			},
			{ displayName: 'Job ID', name: 'jobId', type: 'string', required: true, default: '', displayOptions: { show: { resource: ['job'], operation: ['get'] } } },
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['site'] } },
				options: [{ name: 'Get Many', value: 'getAll', action: 'Get many sites', description: 'List your websites with connection status' }],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['template'] } },
				options: [{ name: 'Get Many', value: 'getAll', action: 'Get many templates', description: 'Built-in and own article templates' }],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [{ name: 'Get Token Balance', value: 'getTokens', action: 'Get the token balance', description: 'Balance, open lots with expiry and the price of each AI action' }],
				default: 'getTokens',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: { show: { resource: ['article', 'idea', 'site'], operation: ['getAll'] } },
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: { show: { resource: ['article', 'idea', 'site'], operation: ['getAll'], returnAll: [false] } },
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
			},
		],
	};

	methods = {
		loadOptions: {
			async getSites(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const rows = await baApiRequestAll.call(this, '/sites', {}, 500);
				return rows.map((s) => ({ name: `${s.name} (${s.url})`, value: Number(s.id) }));
			},
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const res = await baApiRequest.call(this, 'GET', '/templates');
				return ((res.data as IDataObject[]) || []).map((t) => ({ name: String(t.name), value: String(t.id) }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const max = () => (this.getNodeParameter('returnAll', i) ? Infinity : (this.getNodeParameter('limit', i) as number));
				let result: IDataObject | IDataObject[];

				if (resource === 'article') {
					const articleId = () => id(this.getNodeParameter('articleId', i));
					const articleBody = (fields: IDataObject) => compact(fields, ['categories', 'tags', 'keywords'], ['siteId']);
					if (operation === 'get') result = await baApiRequest.call(this, 'GET', `/articles/${articleId()}`);
					else if (operation === 'getStatus') result = await baApiRequest.call(this, 'GET', `/articles/${articleId()}/status`);
					else if (operation === 'getAll') {
						const f = this.getNodeParameter('filters', i, {}) as IDataObject;
						const qs: IDataObject = {};
						if (Array.isArray(f.status) && f.status.length) qs.status = (f.status as string[]).join(',');
						if (f.siteId) qs.siteId = f.siteId;
						if (f.q) qs.q = f.q;
						if (f.updatedSince) qs.updatedSince = new Date(String(f.updatedSince)).toISOString();
						if (f.includeContent) qs.include = 'content';
						result = await baApiRequestAll.call(this, '/articles', qs, max());
					} else if (operation === 'create') {
						const body = articleBody(this.getNodeParameter('additionalFields', i, {}) as IDataObject);
						body.title = this.getNodeParameter('title', i);
						body.status = this.getNodeParameter('status', i, 'draft');
						result = await baApiRequest.call(this, 'POST', '/articles', {}, body);
					} else if (operation === 'update') {
						const body = articleBody(this.getNodeParameter('updateFields', i, {}) as IDataObject);
						if (!Object.keys(body).length) throw new NodeOperationError(this.getNode(), 'Add at least one field to update', { itemIndex: i });
						result = await baApiRequest.call(this, 'PATCH', `/articles/${articleId()}`, {}, body);
					} else if (operation === 'generate') {
						const body = compact(this.getNodeParameter('options', i, {}) as IDataObject, [], ['siteId']);
						if (!body.ideaId) delete body.ideaId;
						const topic = String(this.getNodeParameter('topic', i, '') || '').trim();
						if (topic) body.topic = topic;
						if (!body.topic && !body.keyword && !body.ideaId) throw new NodeOperationError(this.getNode(), 'Give a topic, a keyword or an idea ID', { itemIndex: i });
						const wait = this.getNodeParameter('waitForCompletion', i, true) as boolean;
						body.async = true;
						// 402 (not enough tokens) is answered at once, before the job starts
						const started = await baApiRequest.call(this, 'POST', '/articles/generate', {}, body);
						const job = (started.job as IDataObject) || started;
						if (!wait) result = job;
						else result = await waitForJob.call(this, job, i);
					} else if (operation === 'publish') {
						const siteId = num(this.getNodeParameter('siteId', i, ''));
						result = await baApiRequest.call(this, 'POST', `/articles/${articleId()}/publish`, {}, siteId ? { siteId } : {});
					} else if (operation === 'addToCalendar') {
						const when = this.getNodeParameter('when', i, 'next') as string;
						const siteId = num(this.getNodeParameter('siteId', i, ''));
						const at = when === 'next' ? 'next' : new Date(String(this.getNodeParameter('at', i))).toISOString();
						result = await baApiRequest.call(this, 'POST', `/articles/${articleId()}/schedule`, {}, { at, ...(siteId ? { siteId } : {}) });
					} else if (operation === 'unschedule') result = await baApiRequest.call(this, 'POST', `/articles/${articleId()}/unschedule`, {}, {});
					else throw new NodeOperationError(this.getNode(), `Unknown operation ${operation}`, { itemIndex: i });
				} else if (resource === 'idea') {
					const ideaId = () => id(this.getNodeParameter('ideaId', i));
					if (operation === 'get') result = await baApiRequest.call(this, 'GET', `/ideas/${ideaId()}`);
					else if (operation === 'getAll') {
						const qs = compact(this.getNodeParameter('filters', i, {}) as IDataObject);
						if (qs.updatedSince) qs.updatedSince = new Date(String(qs.updatedSince)).toISOString();
						result = await baApiRequestAll.call(this, '/ideas', qs, max());
					} else if (operation === 'create') {
						const body = compact(this.getNodeParameter('additionalFields', i, {}) as IDataObject, [], ['siteId', 'priority']);
						body.title = this.getNodeParameter('title', i);
						result = await baApiRequest.call(this, 'POST', '/ideas', {}, body);
					} else if (operation === 'update') {
						const body = compact(this.getNodeParameter('updateFields', i, {}) as IDataObject, [], ['siteId', 'priority']);
						if (!Object.keys(body).length) throw new NodeOperationError(this.getNode(), 'Add at least one field to update', { itemIndex: i });
						result = await baApiRequest.call(this, 'PATCH', `/ideas/${ideaId()}`, {}, body);
					} else if (operation === 'delete') result = await baApiRequest.call(this, 'DELETE', `/ideas/${ideaId()}`);
					else {
						const body = compact(this.getNodeParameter('options', i, {}) as IDataObject, [], ['siteId', 'count']);
						body.keyword = this.getNodeParameter('keyword', i);
						const res = await baApiRequest.call(this, 'POST', '/ideas/generate', {}, body);
						result = (res.data as IDataObject[]) || [];
					}
				} else if (resource === 'job') {
					result = await baApiRequest.call(this, 'GET', `/jobs/${id(this.getNodeParameter('jobId', i))}`);
				} else if (resource === 'site') {
					result = await baApiRequestAll.call(this, '/sites', {}, max());
				} else if (resource === 'template') {
					result = ((await baApiRequest.call(this, 'GET', '/templates')).data as IDataObject[]) || [];
				} else {
					result = await baApiRequest.call(this, 'GET', '/tokens');
				}

				const rows = Array.isArray(result) ? result : [result];
				out.push(...rows.map((json) => ({ json, pairedItem: { item: i } })));
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error.message, { itemIndex: i, description: error.description ?? undefined });
				}
				throw apiError(this.getNode(), error, i);
			}
		}
		return [out];
	}
}

/** Polls GET /jobs/{id} until done / failed; returns the finished article (+ job id, tokens, imageError). */
async function waitForJob(this: IExecuteFunctions, job: IDataObject, i: number): Promise<IDataObject> {
	const started = Date.now();
	let j = job;
	for (;;) {
		if (j.status === 'done') {
			const article = (j.article as IDataObject) || (await baApiRequest.call(this, 'GET', `/articles/${id(j.articleId)}`));
			return { ...article, jobId: j.id, tokens: j.tokens ?? null };
		}
		if (j.status === 'failed') {
			const e = (j.error as IDataObject) || {};
			throw new NodeOperationError(this.getNode(), `Blog Automation could not write the article: ${e.message || e.error || 'unknown error'}`, {
				itemIndex: i,
				description: `Job ${j.id}`,
			});
		}
		if (Date.now() - started > JOB_POLL.timeoutMs) {
			throw new NodeOperationError(this.getNode(), `The article is still being written (job ${j.id}). Get it later with Job → Get or the trigger event "Article Ready".`, { itemIndex: i });
		}
		await sleep(JOB_POLL.intervalMs);
		j = await baApiRequest.call(this, 'GET', `/jobs/${id(j.id)}`);
	}
}
