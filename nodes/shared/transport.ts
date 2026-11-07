import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHookFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type INode,
	type IPollFunctions,
	type JsonObject,
} from 'n8n-workflow';

export const CREDENTIAL = 'blogAutomationApi';
export const DEFAULT_BASE = 'https://app.blog-automation.com/api/v1/ext';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions | IHookFunctions;

/** One request against the Customer API (/api/v1/ext). Auth header comes from the credential. */
export async function baApiRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	path: string,
	qs: IDataObject = {},
	body: IDataObject | undefined = undefined,
): Promise<IDataObject> {
	const credentials = await this.getCredentials(CREDENTIAL);
	const base = String(credentials.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
	const options: IHttpRequestOptions = {
		method,
		url: `${base}${path}`,
		qs,
		json: true,
		headers: { Accept: 'application/json', 'Accept-Language': 'en' },
	};
	if (body !== undefined) options.body = body;
	return (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, options)) as IDataObject;
}

/** Reads every page of a cursor list ({ data, hasMore, nextCursor }, limit 1–100) up to `max` rows. */
export async function baApiRequestAll(
	this: Ctx,
	path: string,
	qs: IDataObject = {},
	max = Infinity,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let cursor: string | undefined;
	for (;;) {
		const limit = Math.min(100, max - out.length);
		const res = await baApiRequest.call(this, 'GET', path, { ...qs, limit, ...(cursor ? { cursor } : {}) });
		const rows = (res.data as IDataObject[]) || [];
		out.push(...rows.slice(0, limit));
		if (!res.hasMore || !res.nextCursor || out.length >= max || !rows.length) break;
		cursor = String(res.nextCursor);
	}
	return out;
}

/** HTTP status of an error thrown by n8n's request helper. */
export function statusOf(error: unknown): number {
	const e = error as JsonObject & { response?: { status?: number } };
	return Number(e.httpCode ?? e.statusCode ?? e.response?.status ?? 0);
}

/** The API's error body { error, message, needed, balance, … } from an error of n8n's request helper (if any). */
export function bodyOf(error: unknown): IDataObject {
	const e = error as {
		response?: { body?: unknown; data?: unknown };
		cause?: { response?: { body?: unknown; data?: unknown } };
		context?: { data?: unknown };
	};
	for (const b of [e.context?.data, e.response?.data, e.response?.body, e.cause?.response?.data, e.cause?.response?.body]) {
		if (b && typeof b === 'object') return b as IDataObject;
		if (typeof b === 'string') {
			try {
				return JSON.parse(b) as IDataObject;
			} catch {
				/* not JSON */
			}
		}
	}
	return {};
}

/** Readable NodeApiError for the API's error codes (402 tokens, 403 plan_required / insufficient_scope …). */
export function apiError(node: INode, error: unknown, itemIndex?: number): NodeApiError {
	const b = bodyOf(error);
	const code = String(b.error || '');
	let message = typeof b.message === 'string' ? b.message : undefined;
	if (code === 'tokens') {
		message = `Not enough tokens in Blog Automation (needed ${b.needed ?? '?'}, balance ${b.balance ?? '?'}). Top up tokens in the app under "Tokens".`;
	} else if (code === 'plan_required') {
		message = `${message || 'The API is not included in your plan.'} The API is available in the Starter and Pro plans.`;
	} else if (code === 'insufficient_scope' && Array.isArray(b.missing)) {
		message = `${message || 'Scope missing.'} Add the scope ${(b.missing as string[]).join(', ')} to the API key in "Entwickler / API".`;
	}
	// n8n's request helper already throws a NodeApiError (body in context.data); re-wrapping returns that same object
	if (error instanceof NodeApiError) {
		if (message) error.message = message;
		return error;
	}
	return new NodeApiError(node, error as JsonObject, {
		...(itemIndex !== undefined ? { itemIndex } : {}),
		...(message ? { message } : {}),
	});
}

/** Only filled fields, typed for the API (lists from comma strings, numbers). */
export function compact(fields: IDataObject, lists: string[] = [], numbers: string[] = []): IDataObject {
	const body: IDataObject = {};
	for (const [key, v] of Object.entries(fields)) {
		if (v === undefined || v === null || v === '') continue;
		if (lists.includes(key)) {
			const list: string[] = Array.isArray(v) ? v.map(String) : String(v).split(',');
			body[key] = list.map((t) => t.trim()).filter(Boolean);
		} else if (numbers.includes(key)) body[key] = Number(v);
		else body[key] = v;
	}
	return body;
}
