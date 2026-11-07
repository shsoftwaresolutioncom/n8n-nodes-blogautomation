# n8n-nodes-blogautomation

n8n community nodes for [Blog Automation](https://blog-automation.com/?utm_source=n8n&utm_medium=integration&utm_campaign=n8n-plugin) –
AI blog writing, an idea board, an editorial calendar and auto-publishing to WordPress, Shopify, Ghost and 30+ more platforms. Write articles with AI,
manage ideas, schedule and publish, and start workflows when articles are ready, published or failed.

[Installation](#installation) · [Credentials](#credentials) · [Nodes and operations](#nodes-and-operations) · [Compatibility](#compatibility) · [Development](#development)

## Installation

In n8n: **Settings → Community Nodes → Install** and enter `n8n-nodes-blogautomation`
([n8n docs](https://docs.n8n.io/integrations/community-nodes/installation/)). Self-hosted with npm: `npm install n8n-nodes-blogautomation` in `~/.n8n/nodes`.

## Credentials

**Blog Automation API**
- **API Key** – create it in Blog Automation under **Entwickler / API** (starts with `ba_live_`, shown once). Give it the scopes the workflow
  needs: `articles:read`, `articles:write`, `articles:publish`, `ai:generate` (uses tokens), `ideas:read`, `ideas:write`, `templates:read`,
  `sites:read`, `account:read`, and `webhooks:write` for the webhook trigger.
- **Base URL** – leave the default `https://app.blog-automation.com/api/v1/ext`.

The credential test calls `GET /me`. **The API is part of the Starter and Pro plans** (Free accounts get `403 plan_required`).
AI actions use tokens of the account like in the app; with too few tokens the node fails with "Not enough tokens (needed …, balance …)".

## Nodes and operations

### Blog Automation
| Resource | Operations |
|---|---|
| Article | **Write with AI** (topic / keyword / idea, template, language, length, tone, audience, notes, outline, site, with image; *Wait for Completion* polls the job every 5 s for up to 15 min and returns the article, off = returns the job), Create (own text, draft or review), Get, Get Many (status, site, title search, updated since, with content; Return All with cursor paging), Get Status, Update (only the fields you add; status draft / review / approved), **Publish** (now), **Add to Calendar** (next free slot or a time), Unschedule |
| Idea | Create, Get, Get Many, Update, Delete, Find with AI (keyword, count) |
| Job | Get (state of a "Write with AI" job started without waiting) |
| Site | Get Many (websites with connection status) |
| Template | Get Many (built-in and own templates) |
| Account | Get Token Balance |

Site and template fields are dropdowns loaded from your account. The node can be used as an AI agent tool.

### Blog Automation Trigger (polling)
Events: **Article Ready** (review / approved), **Article Published**, **Article Failed**, **New Idea** – `GET /articles?status=…&updatedSince=<last change>`
(or `/ideas`), cursor pages, items at the boundary are deduplicated. On activation it starts from now; "Fetch test event" returns the latest item.

### Blog Automation Webhook Trigger (real time)
Activating the workflow registers the node's URL in Blog Automation (`POST /api/v1/ext/webhooks`, shown in the app as "über API") and stores
the webhook id and signing secret in the workflow; deactivating removes it again (`DELETE /webhooks/:id`, 404 = already gone). `checkExists`
reads `GET /webhooks/:id` and re-registers when the URL or the events changed. Every request is checked against
`X-BA-Signature` (`t=<unix>,sha256=HMAC-SHA256(secret, "<t>.<raw body>")`, max. 5 minutes old) – invalid ones get 401.
Events: `article.ready`, `article.published`, `article.failed`, `article.created`, `article.status_changed`, `automation.run_failed`, `tokens.low`.
The key needs `webhooks:write` plus the read scope of the events (`article.*` → `articles:read`, `automation.run_failed` → `automations:read`,
`tokens.low` → `account:read`). Revoking the key in the app switches its webhooks off.

## Compatibility

Built with `@n8n/node-cli` 0.53 and `n8n-workflow` 2.x (n8n 1.x and 2.x, nodes API version 1). No runtime dependencies.
Needs the app version with REST hooks (`/webhooks`), `at: "next"` and async writing (`/jobs/:id`).

## Privacy

Data goes only to the Blog Automation API you configure (servers in Germany). Privacy policy:
[EN](https://blog-automation.com/en/privacy/) · [DE](https://blog-automation.com/datenschutz/). The nodes do not track anything.

## Development

```bash
npm install --ignore-scripts   # isolated-vm (from n8n-workflow) needs Node 24 to compile; not needed for build/lint
npm run build                  # n8n-node build → dist/
npm run lint                   # n8n-node lint (community node rules) – must be clean
npm test                       # build + node:test unit tests with a fake n8n context (no network)
npm run dev                    # local n8n with the nodes loaded (needs Node 24 for n8n itself)
```

## License

[MIT](LICENSE.md)

## Releasing (maintainers)
1. Bump `version` in `package.json` (+ lock) and add the entry to `CHANGELOG.md` in a PR to `main`.
2. After merge, push a tag equal to the version (e.g. `git tag 0.1.1 && git push origin 0.1.1`).
3. `.github/workflows/publish.yml` lints, tests, builds and publishes to npm **with provenance** via npm trusted publishing (OIDC, no token).
4. Check with `npx @n8n/scan-community-package n8n-nodes-blogautomation`, then submit / update in the n8n Creator Portal.
