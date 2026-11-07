// Unit tests against the built nodes (dist/) with a fake n8n context – no n8n instance, no network.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { BlogAutomation, JOB_POLL } = require('../dist/nodes/BlogAutomation/BlogAutomation.node.js');
const { BlogAutomationTrigger } = require('../dist/nodes/BlogAutomationTrigger/BlogAutomationTrigger.node.js');
const { BlogAutomationWebhookTrigger, verifySignature, EVENTS } = require('../dist/nodes/BlogAutomationWebhookTrigger/BlogAutomationWebhookTrigger.node.js');
const { BlogAutomationApi } = require('../dist/credentials/BlogAutomationApi.credentials.js');

const BASE = 'https://app.blog-automation.com/api/v1/ext';
JOB_POLL.intervalMs = 5;

function ctx({ params = {}, items = [{ json: {} }], responder, mode = 'trigger', staticData = {}, continueOnFail = false }) {
	const calls = [];
	return {
		calls,
		staticData,
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => ({ apiKey: 'ba_live_TEST', baseUrl: BASE }),
		getNode: () => ({ name: 'Blog Automation', type: 'test', typeVersion: 1, parameters: {} }),
		getMode: () => mode,
		getWorkflowStaticData: () => staticData,
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async (cred, opts) => {
				assert.strictEqual(cred, 'blogAutomationApi');
				calls.push(opts);
				return responder(opts);
			},
			returnJsonArray: (rows) => rows.map((json) => ({ json })),
		},
	};
}
const httpError = (status, body) => Object.assign(new Error(`HTTP ${status}`), { httpCode: String(status), response: { status, data: body } });
const run = (params, responder, extra = {}) => { const c = ctx({ params, responder, ...extra }); return new BlogAutomation().execute.call(c).then(([out]) => ({ out, calls: c.calls })); };

test('credential: Bearer header, /me test, default base URL', () => {
	const c = new BlogAutomationApi();
	assert.strictEqual(c.name, 'blogAutomationApi');
	assert.strictEqual(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.strictEqual(c.test.request.url, '/me');
	assert.strictEqual(c.properties.find((p) => p.name === 'baseUrl').default, BASE);
});

test('article write with AI: async job, waits for completion and returns the article', async () => {
	let polls = 0;
	const { out, calls } = await run(
		{ resource: 'article', operation: 'generate', topic: 'Spring garden', waitForCompletion: true, options: { length: 'long', siteId: '3', withImage: true, ideaId: 0, tone: '' } },
		(o) => {
			if (o.method === 'POST') return { job: { id: 77, status: 'running', articleId: null, article: null } };
			polls++;
			return polls < 2 ? { id: 77, status: 'running' } : { id: 77, status: 'done', articleId: 9, article: { id: 9, title: 'Spring garden', content: '<p>x</p>' }, tokens: { used: 80, balance: 920 } };
		},
	);
	assert.strictEqual(calls[0].url, `${BASE}/articles/generate`);
	assert.deepStrictEqual(calls[0].body, { length: 'long', siteId: 3, withImage: true, topic: 'Spring garden', async: true });
	assert.strictEqual(calls[1].url, `${BASE}/jobs/77`);
	assert.strictEqual(calls.length, 3);
	assert.deepStrictEqual(out[0].json, { id: 9, title: 'Spring garden', content: '<p>x</p>', jobId: 77, tokens: { used: 80, balance: 920 } });
});

test('article write with AI: without waiting returns the job; failed job and missing topic are errors', async () => {
	const { out } = await run({ resource: 'article', operation: 'generate', topic: 'X', waitForCompletion: false, options: {} }, () => ({ job: { id: 5, status: 'running' } }));
	assert.deepStrictEqual(out[0].json, { id: 5, status: 'running' });
	await assert.rejects(
		run({ resource: 'article', operation: 'generate', topic: 'X', options: {} }, (o) => (o.method === 'POST' ? { job: { id: 6, status: 'running' } } : { id: 6, status: 'failed', error: { error: 'ai_failed', message: 'Model timeout' } })),
		/could not write the article: Model timeout/,
	);
	await assert.rejects(run({ resource: 'article', operation: 'generate', topic: '', options: {} }, () => ({})), /topic, a keyword or an idea ID/);
	// job get
	const j = await run({ resource: 'job', operation: 'get', jobId: '6' }, () => ({ id: 6, status: 'done' }));
	assert.strictEqual(j.calls[0].url, `${BASE}/jobs/6`);
});

test('402 tokens and 403 plan_required become readable errors; continueOnFail keeps going', async () => {
	await assert.rejects(
		run({ resource: 'article', operation: 'generate', topic: 'X', options: {} }, () => { throw httpError(402, { error: 'tokens', needed: 80, balance: 10, message: 'Not enough tokens.' }); }),
		/Not enough tokens in Blog Automation \(needed 80, balance 10\)/,
	);
	await assert.rejects(
		run({ resource: 'account', operation: 'getTokens' }, () => { throw httpError(403, { error: 'plan_required', message: 'The API is not included in your plan.' }); }),
		/Starter and Pro/,
	);
	const { out } = await run({ resource: 'account', operation: 'getTokens' }, () => { throw httpError(500, { error: 'error' }); }, { continueOnFail: true });
	assert.ok(out[0].json.error);
});

test('article getAll: cursor pagination, filters, limit', async () => {
	const rows = Array.from({ length: 230 }, (_, i) => ({ id: 230 - i }));
	const responder = (o) => {
		const start = o.qs.cursor ? Number(Buffer.from(o.qs.cursor, 'base64url').toString()) : 0;
		const data = rows.slice(start, start + o.qs.limit);
		const next = start + data.length;
		return { data, hasMore: next < rows.length, nextCursor: next < rows.length ? Buffer.from(String(next)).toString('base64url') : null };
	};
	let r = await run({ resource: 'article', operation: 'getAll', returnAll: true, filters: { status: ['published', 'failed'], siteId: 2, includeContent: true, q: '' } }, responder);
	assert.strictEqual(r.out.length, 230);
	assert.strictEqual(r.calls.length, 3);
	assert.strictEqual(r.calls[0].qs.status, 'published,failed');
	assert.strictEqual(r.calls[0].qs.include, 'content');
	assert.strictEqual(r.calls[0].qs.limit, 100);
	assert.ok(!('q' in r.calls[0].qs));
	r = await run({ resource: 'article', operation: 'getAll', returnAll: false, limit: 30, filters: {} }, responder);
	assert.strictEqual(r.out.length, 30);
	assert.strictEqual(r.calls.length, 1);
	assert.strictEqual(r.calls[0].qs.limit, 30);
});

test('article create / update / publish / add to calendar / unschedule / status', async () => {
	let r = await run({ resource: 'article', operation: 'create', title: 'Hello', status: 'review', additionalFields: { tags: 'a, b', siteId: '4', content: '<p>x</p>', slug: '' } }, (o) => ({ id: 1, ...o.body }));
	assert.deepStrictEqual(r.calls[0].body, { tags: ['a', 'b'], siteId: 4, content: '<p>x</p>', title: 'Hello', status: 'review' });
	await assert.rejects(run({ resource: 'article', operation: 'update', articleId: '1', updateFields: {} }, () => ({})), /at least one field/);
	r = await run({ resource: 'article', operation: 'update', articleId: '1', updateFields: { status: 'approved' } }, (o) => o.body);
	assert.strictEqual(r.calls[0].method, 'PATCH');
	assert.strictEqual(r.calls[0].url, `${BASE}/articles/1`);
	r = await run({ resource: 'article', operation: 'publish', articleId: '1', siteId: '' }, () => ({ article: { id: 1 } }));
	assert.deepStrictEqual([r.calls[0].method, r.calls[0].url, r.calls[0].body], ['POST', `${BASE}/articles/1/publish`, {}]);
	r = await run({ resource: 'article', operation: 'addToCalendar', articleId: '1', when: 'next', siteId: 2 }, () => ({ article: { id: 1, status: 'scheduled' } }));
	assert.deepStrictEqual([r.calls[0].url, r.calls[0].body], [`${BASE}/articles/1/schedule`, { at: 'next', siteId: 2 }]);
	r = await run({ resource: 'article', operation: 'addToCalendar', articleId: '1', when: 'at', at: '2026-12-01T09:30:00+01:00', siteId: '' }, () => ({}));
	assert.deepStrictEqual(r.calls[0].body, { at: '2026-12-01T08:30:00.000Z' });
	r = await run({ resource: 'article', operation: 'unschedule', articleId: '1' }, () => ({ id: 1, status: 'approved' }));
	assert.strictEqual(r.calls[0].url, `${BASE}/articles/1/unschedule`);
	r = await run({ resource: 'article', operation: 'getStatus', articleId: '1' }, () => ({ id: 1, status: 'published' }));
	assert.strictEqual(r.calls[0].url, `${BASE}/articles/1/status`);
});

test('ideas: create, update, delete, find with AI, get many', async () => {
	let r = await run({ resource: 'idea', operation: 'create', title: 'Ten mistakes', additionalFields: { priority: 1, keyword: 'blog' } }, (o) => ({ id: 3, ...o.body }));
	assert.deepStrictEqual(r.calls[0].body, { priority: 1, keyword: 'blog', title: 'Ten mistakes' });
	r = await run({ resource: 'idea', operation: 'update', ideaId: '3', updateFields: { status: 'planned' } }, (o) => o.body);
	assert.strictEqual(r.calls[0].method, 'PATCH');
	r = await run({ resource: 'idea', operation: 'delete', ideaId: '3' }, () => ({ id: 3, deleted: true }));
	assert.strictEqual(r.calls[0].method, 'DELETE');
	r = await run({ resource: 'idea', operation: 'generate', keyword: 'home office', options: { count: 3 } }, () => ({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], tokens: { used: 2 } }));
	assert.deepStrictEqual(r.calls[0].body, { count: 3, keyword: 'home office' });
	assert.strictEqual(r.out.length, 3);
	r = await run({ resource: 'idea', operation: 'getAll', returnAll: false, limit: 5, filters: { status: 'new' } }, () => ({ data: [{ id: 1 }], hasMore: false }));
	assert.strictEqual(r.calls[0].qs.status, 'new');
});

test('sites, templates, token balance and load options', async () => {
	let r = await run({ resource: 'site', operation: 'getAll', returnAll: true }, () => ({ data: [{ id: 1, name: 'Blog', url: 'https://b.example' }], hasMore: false }));
	assert.strictEqual(r.calls[0].url, `${BASE}/sites`);
	r = await run({ resource: 'template', operation: 'getAll' }, () => ({ data: [{ id: 'b:howto', name: 'How-to' }] }));
	assert.strictEqual(r.out[0].json.id, 'b:howto');
	r = await run({ resource: 'account', operation: 'getTokens' }, () => ({ balance: 920 }));
	assert.strictEqual(r.calls[0].url, `${BASE}/tokens`);
	const node = new BlogAutomation();
	const sites = await node.methods.loadOptions.getSites.call(ctx({ responder: () => ({ data: [{ id: 1, name: 'Blog', url: 'https://b.example' }], hasMore: false }) }));
	assert.deepStrictEqual(sites, [{ name: 'Blog (https://b.example)', value: 1 }]);
	const tpl = await node.methods.loadOptions.getTemplates.call(ctx({ responder: () => ({ data: [{ id: 'b:howto', name: 'How-to' }] }) }));
	assert.deepStrictEqual(tpl, [{ name: 'How-to', value: 'b:howto' }]);
});

test('polling trigger: baseline, then only new changes; boundary deduplicated', async () => {
	const trig = new BlogAutomationTrigger();
	const staticData = {};
	assert.strictEqual(await trig.poll.call(ctx({ params: { event: 'articlePublished' }, responder: () => ({ data: [] }), staticData })), null);
	const t0 = staticData.since;
	const later = new Date(Date.parse(t0) + 60000).toISOString();
	const responder = (o) => {
		assert.strictEqual(o.qs.status, 'published');
		assert.strictEqual(o.url, `${BASE}/articles`);
		return { data: [{ id: 2, updated: later }, { id: 1, updated: t0 }], hasMore: false };
	};
	let c = ctx({ params: { event: 'articlePublished' }, responder, staticData });
	const out = await trig.poll.call(c);
	assert.strictEqual(c.calls[0].qs.updatedSince, t0);
	assert.deepStrictEqual(out[0].map((r) => r.json.id), [1, 2]);
	assert.strictEqual(staticData.since, later);
	c = ctx({ params: { event: 'articlePublished' }, responder: () => ({ data: [{ id: 2, updated: later }] }), staticData });
	assert.strictEqual(await trig.poll.call(c), null);
	// manual test fetch returns the newest item
	const m = await trig.poll.call(ctx({ params: { event: 'newIdea' }, mode: 'manual', responder: (o) => { assert.strictEqual(o.url, `${BASE}/ideas`); return { data: [{ id: 9 }] }; } }));
	assert.strictEqual(m[0][0].json.id, 9);
});

test('webhook signature check (X-BA-Signature)', () => {
	const body = JSON.stringify({ id: 'evt_1', event: 'article.published', data: { id: 1 } });
	const t = Math.floor(Date.now() / 1000);
	const sig = crypto.createHmac('sha256', 'whsec').update(`${t}.${body}`).digest('hex');
	assert.ok(verifySignature('whsec', `t=${t},sha256=${sig}`, body));
	assert.ok(!verifySignature('other', `t=${t},sha256=${sig}`, body));
	assert.ok(!verifySignature('whsec', `t=${t - 600},sha256=${sig}`, body));
	assert.ok(!verifySignature('whsec', `t=${t},sha256=${sig}`, body + ' '));
	assert.ok(!verifySignature('whsec', '', body));
	assert.deepStrictEqual(EVENTS.map((e) => e.value).sort(), ['article.created', 'article.failed', 'article.published', 'article.ready', 'article.status_changed', 'automation.run_failed', 'tokens.low']);
});

function hookCtx({ responder, staticData = {}, params = { events: ['article.ready'] } }) {
	const calls = [];
	return {
		calls,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc/blogautomation',
		getNodeParameter: (n, f) => (n in params ? params[n] : f),
		getWorkflow: () => ({ name: 'Share new posts' }),
		getNode: () => ({ name: 'BA Webhook', type: 'test', typeVersion: 1, parameters: {} }),
		getCredentials: async () => ({ apiKey: 'ba_live_TEST', baseUrl: BASE }),
		helpers: { httpRequestWithAuthentication: async (_c, o) => { calls.push(o); return responder(o); } },
	};
}

test('webhook lifecycle: create stores id + secret, checkExists via GET /webhooks/{id}, delete (404 = gone)', async () => {
	const m = new BlogAutomationWebhookTrigger().webhookMethods.default;
	const staticData = {};
	let c = hookCtx({ staticData, responder: (o) => ({ id: 42, secret: 'whsec_1', ...o.body }) });
	assert.strictEqual(await m.create.call(c), true);
	assert.deepStrictEqual([c.calls[0].method, c.calls[0].url], ['POST', `${BASE}/webhooks`]);
	assert.deepStrictEqual(c.calls[0].body, { url: 'https://n8n.example.com/webhook/abc/blogautomation', events: ['article.ready'], name: 'n8n – Share new posts' });
	assert.deepStrictEqual(staticData, { webhookId: 42, secret: 'whsec_1' });

	c = hookCtx({ staticData, responder: () => ({ id: 42, url: 'https://n8n.example.com/webhook/abc/blogautomation', events: ['article.ready'], active: true }) });
	assert.strictEqual(await m.checkExists.call(c), true);
	assert.strictEqual(c.calls[0].url, `${BASE}/webhooks/42`);
	// changed events → re-create
	c = hookCtx({ staticData: { ...staticData }, params: { events: ['article.published'] }, responder: () => ({ id: 42, url: 'https://n8n.example.com/webhook/abc/blogautomation', events: ['article.ready'], active: true }) });
	assert.strictEqual(await m.checkExists.call(c), false);
	const gone = { ...staticData };
	c = hookCtx({ staticData: gone, responder: () => { throw httpError(404, { error: 'not_found' }); } });
	assert.strictEqual(await m.checkExists.call(c), false);
	assert.deepStrictEqual(gone, {});

	c = hookCtx({ staticData, responder: () => { throw httpError(404, { error: 'not_found' }); } });
	assert.strictEqual(await m.delete.call(c), true);
	assert.deepStrictEqual([c.calls[0].method, c.calls[0].url], ['DELETE', `${BASE}/webhooks/42`]);
	assert.deepStrictEqual(staticData, {});
	c = hookCtx({ staticData: { webhookId: 1 }, responder: () => { throw httpError(500, { error: 'error' }); } });
	await assert.rejects(m.delete.call(c));
});

test('webhook trigger checks the signature with the stored secret and filters events', async () => {
	const node = new BlogAutomationWebhookTrigger();
	const body = { id: 'evt_1', event: 'article.ready', data: { id: 3 } };
	const raw = JSON.stringify(body);
	const t = Math.floor(Date.now() / 1000);
	const good = `t=${t},sha256=${crypto.createHmac('sha256', 's3cret').update(`${t}.${raw}`).digest('hex')}`;
	let status = 0;
	const make = (events, header, secret = 's3cret') => ({
		getRequestObject: () => ({ headers: { 'x-ba-signature': header }, rawBody: Buffer.from(raw) }),
		getResponseObject: () => ({ status: (s) => { status = s; return { json: () => {} }; } }),
		getWorkflowStaticData: () => ({ webhookId: 1, secret }),
		getNodeParameter: (n, f) => (n === 'events' ? events : f),
		getBodyData: () => body,
		helpers: { returnJsonArray: (rows) => rows.map((json) => ({ json })) },
	});
	const ok = await node.webhook.call(make(['article.ready'], good));
	assert.strictEqual(ok.workflowData[0][0].json.data.id, 3);
	const bad = await node.webhook.call(make(['article.ready'], 't=1,sha256=00'));
	assert.ok(bad.noWebhookResponse);
	assert.strictEqual(status, 401);
	const ignored = await node.webhook.call(make(['article.published'], good));
	assert.ok(!ignored.workflowData);
});

test('errors already wrapped by n8n (NodeApiError with the body in context.data) get the readable message too', async () => {
	const { NodeApiError } = require('n8n-workflow');
	const node = { name: 'Blog Automation', type: 'test', typeVersion: 1, parameters: {} };
	const axiosLike = Object.assign(new Error('Request failed with status code 402'), { response: { status: 402, data: { error: 'tokens', needed: 65, balance: 3 } } });
	await assert.rejects(
		run({ resource: 'article', operation: 'generate', topic: 'X', options: {} }, () => { throw new NodeApiError(node, axiosLike); }),
		/needed 65, balance 3/,
	);
});
