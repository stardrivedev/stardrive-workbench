#!/usr/bin/env node
/**
 * The Stardrive API (v1) — see ../../docs/api-design.md for the design.
 *
 * Run:  node server.mjs [--port 4650]
 * Env:  PORT, STARDRIVE_VAR_DIR (runtime state; default ./var),
 *       STARDRIVE_ENGINE (dry|real; default dry — real is pending),
 *       RATE_LIMIT_PER_MIN (per key; default 120)
 *
 * Mint keys with: node scripts/make-key.mjs --name "beta" --scopes mappings,templates,sites
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer, json, fail, readBody, matchRoute } from './lib/http.mjs';
import { VarStore, assertSafeSlug } from './lib/store.mjs';
import { createAuth } from './lib/auth.mjs';
import { loadCatalog, createImportedStore, validateManifest, validateBundle, summarize } from './lib/templates.mjs';
import { createJobRunner } from './lib/jobs.mjs';
import { relayChat } from './lib/chat-proxy.mjs';
import { createStaticServer } from './lib/static.mjs';
import { createConnections, PROVIDERS } from './lib/connections.mjs';
import { runMapping, validateMapping } from '../../packages/field-mapping/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT) || 4650;
const VAR_DIR = process.env.STARDRIVE_VAR_DIR || path.join(HERE, 'var');
const ENGINE = process.env.STARDRIVE_ENGINE || 'dry';

const store = new VarStore(VAR_DIR);
const auth = createAuth(store, { rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN) || 120 });
const catalog = loadCatalog(); // throws at boot if the bundle is bad
const imported = createImportedStore(store);
const jobs = createJobRunner(store, { engine: ENGINE });
const connections = createConnections(store, VAR_DIR);
// Two static roots: the public marketing site at /, the licensee console at /workbench/.
const site = createStaticServer(path.join(HERE, '..', '..', 'app', 'site'));
const workbench = createStaticServer(path.join(HERE, '..', '..', 'app', 'workbench'));

/** Bundled first (shared, not overridable), then the CALLER's own imports. */
function getTemplate(account, name) {
  return catalog.get(String(name)) || imported.get(account, String(name));
}

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

function assertUuid(id, what = 'id') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    throw httpError(400, 'bad_id', `${what} must be a UUID.`);
  }
  return id;
}

function loadSite(id, account) {
  const site = store.readJson(`sites/${assertUuid(id, 'site id')}.json`);
  if (!site || (site.account && site.account !== account)) {
    throw httpError(404, 'not_found', `Site ${id} not found.`);
  }
  return site;
}

function resolveMappingBody(body, key) {
  if (body?.mapping && body?.mappingId) {
    throw httpError(400, 'bad_request', 'Send either mapping (inline) or mappingId (stored), not both.');
  }
  if (body?.mappingId) {
    const rec = store.readJson(`mappings/${key.account}/${assertSafeSlug(body.mappingId, 'mappingId')}.json`);
    if (!rec) throw httpError(404, 'not_found', `Mapping "${body.mappingId}" not found.`);
    return rec.mapping;
  }
  if (body?.mapping) {
    const v = validateMapping(body.mapping);
    if (!v.ok) throw httpError(422, 'invalid_mapping', `Mapping invalid: ${v.errors.join(' | ')}`);
    return body.mapping;
  }
  throw httpError(400, 'bad_request', 'A mapping or mappingId is required.');
}

// ── Routes ───────────────────────────────────────────────────────────────
// scope: 'public' (no key), 'any' (any valid key), or a named key scope.

const ROUTES = [
  {
    method: 'GET', pattern: '/v1/health', scope: 'public',
    handler: () => ({ status: 200, body: { ok: true, service: 'stardrive-api', version: VERSION, engine: ENGINE } }),
  },
  {
    method: 'GET', pattern: '/v1', scope: 'public',
    handler: () => ({
      status: 200,
      body: {
        service: 'stardrive-api',
        version: VERSION,
        engine: ENGINE,
        documentation: 'docs/api-design.md in the stardrive-workbench repository',
        endpoints: ROUTES.map((r) => `${r.method} ${r.pattern}${r.scope === 'public' ? '' : ` (scope: ${r.scope})`}`),
      },
    }),
  },

  // Mappings — the M1 engine as a service.
  {
    method: 'POST', pattern: '/v1/mappings/validate', scope: 'mappings', meter: 'mappings.validate',
    handler: ({ body }) => {
      if (body == null) throw httpError(400, 'bad_request', 'Body must be a mapping document.');
      return { status: 200, body: validateMapping(body) };
    },
  },
  {
    method: 'POST', pattern: '/v1/intake/parse', scope: 'mappings', meter: 'intake.parse',
    handler: ({ body, key }) => {
      const mapping = resolveMappingBody(body, key);
      if (body.answers == null || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
        throw httpError(400, 'bad_request', 'answers must be an object of { questionKey: answer }.');
      }
      const result = runMapping(mapping, body.answers);
      return { status: 200, body: result };
    },
  },
  {
    method: 'PUT', pattern: '/v1/mappings/:id', scope: 'mappings',
    handler: ({ params, body, key }) => {
      const id = assertSafeSlug(params.id, 'mapping id');
      if (body == null) throw httpError(400, 'bad_request', 'Body must be a mapping document.');
      const v = validateMapping(body);
      if (!v.ok) return { status: 422, body: { error: { code: 'invalid_mapping', message: 'Mapping rejected.' }, errors: v.errors } };
      const rel = `mappings/${key.account}/${id}.json`;
      const existing = store.readJson(rel);
      const rec = {
        id,
        name: body.name ?? id,
        version: body.version ?? null,
        account: key.account,
        mapping: body,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.writeJson(rel, rec);
      return { status: existing ? 200 : 201, body: { id, name: rec.name, version: rec.version, updatedAt: rec.updatedAt } };
    },
  },
  {
    method: 'GET', pattern: '/v1/mappings', scope: 'mappings',
    handler: ({ key }) => ({
      status: 200,
      body: {
        mappings: store.listIds(`mappings/${key.account}`).map((id) => {
          const r = store.readJson(`mappings/${key.account}/${id}.json`);
          return { id: r.id, name: r.name, version: r.version, updatedAt: r.updatedAt };
        }),
      },
    }),
  },
  {
    method: 'GET', pattern: '/v1/mappings/:id', scope: 'mappings',
    handler: ({ params, key }) => {
      const rec = store.readJson(`mappings/${key.account}/${assertSafeSlug(params.id, 'mapping id')}.json`);
      if (!rec) throw httpError(404, 'not_found', `Mapping "${params.id}" not found.`);
      return { status: 200, body: rec };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/mappings/:id', scope: 'mappings',
    handler: ({ params, key }) => {
      const ok = store.deleteJson(`mappings/${key.account}/${assertSafeSlug(params.id, 'mapping id')}.json`);
      if (!ok) throw httpError(404, 'not_found', `Mapping "${params.id}" not found.`);
      return { status: 200, body: { deleted: params.id } };
    },
  },

  // Templates.
  {
    method: 'GET', pattern: '/v1/templates', scope: 'templates',
    handler: ({ key }) => ({
      status: 200,
      body: { templates: [...catalog.values(), ...imported.list(key.account)].map(summarize) },
    }),
  },
  {
    method: 'GET', pattern: '/v1/templates/:name', scope: 'templates',
    handler: ({ params, key }) => {
      const entry = getTemplate(key.account, params.name);
      if (!entry) throw httpError(404, 'not_found', `Template "${params.name}" not found.`);
      return {
        status: 200,
        body: {
          source: entry.source,
          manifest: entry.manifest,
          ...(entry.record ? { importedAt: entry.record.importedAt, warnings: entry.record.warnings } : {}),
        },
      };
    },
  },
  {
    method: 'POST', pattern: '/v1/templates/validate', scope: 'templates', meter: 'templates.validate',
    handler: ({ body }) => {
      if (body?.manifest == null) throw httpError(400, 'bad_request', 'Body must be { manifest }.');
      return { status: 200, body: validateManifest(body.manifest) };
    },
  },
  {
    // Import a template BUNDLE: { manifest, files: [{ path, content | contentBase64 }] }.
    // The same template-kit gate Deneb4's no-code upload uses: manifest schema,
    // path safety, required site files, token lint. Errors reject (422);
    // warnings import and are kept on the record.
    method: 'POST', pattern: '/v1/templates', scope: 'templates', meter: 'templates.import', bodyLimit: 40_000_000,
    handler: ({ body, key }) => {
      const v = validateBundle(body);
      if (!v.ok) {
        return { status: 422, body: { error: { code: 'invalid_bundle', message: 'Template bundle rejected.' }, errors: v.errors, warnings: v.warnings } };
      }
      if (catalog.has(body.manifest.name)) {
        throw httpError(409, 'name_conflict', `"${body.manifest.name}" is a first-party catalog name — imported templates cannot shadow the bundled catalog.`);
      }
      const { name, existed } = imported.put(key.account, body, v.warnings);
      return { status: existed ? 200 : 201, body: { name, source: 'imported', warnings: v.warnings } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/templates/:name', scope: 'templates',
    handler: ({ params, key }) => {
      if (catalog.has(params.name)) {
        throw httpError(403, 'forbidden', 'The bundled first-party catalog cannot be deleted through the API.');
      }
      if (!imported.remove(key.account, params.name)) throw httpError(404, 'not_found', `Imported template "${params.name}" not found.`);
      return { status: 200, body: { deleted: params.name } };
    },
  },

  // Sites + jobs.
  {
    method: 'POST', pattern: '/v1/sites', scope: 'sites', meter: 'sites.assemble',
    handler: ({ body, key }) => {
      if (body == null) throw httpError(400, 'bad_request', 'Body required.');
      const entry = getTemplate(key.account, body.templateId || '');
      if (!entry) throw httpError(422, 'unknown_template', `templateId must name a known template (got ${JSON.stringify(body.templateId)}).`);
      if (entry.manifest.kind !== 'site') {
        throw httpError(422, 'not_a_base_template', `"${body.templateId}" is a ${entry.manifest.kind} module — assembly starts from a kind:"site" template; add modules via config.modules.`);
      }
      if (body.config && body.answers) {
        throw httpError(400, 'bad_request', 'Send either config (explicit) or mappingId+answers (parse-and-assemble), not both.');
      }
      let config = body.config;
      let parse = null;
      if (body.answers) {
        const mapping = resolveMappingBody(body, key);
        const result = runMapping(mapping, body.answers);
        config = result.config;
        parse = { contact: result.contact, flags: result.flags, notes: result.notes, unmapped: result.unmapped, mapReport: result.mapReport };
      }
      if (config == null || typeof config !== 'object' || Array.isArray(config)) {
        throw httpError(400, 'bad_request', 'config must be an object (or provide mappingId+answers).');
      }
      if (typeof config.siteName !== 'string' || !config.siteName.trim()) {
        throw httpError(422, 'incomplete_config', 'config.siteName is required — the engine refuses to assemble a nameless site.');
      }
      const site = {
        id: crypto.randomUUID(),
        account: key.account,
        templateId: body.templateId,
        config,
        parse,
        configHistory: [],
        jobs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const job = jobs.enqueue('assemble', site.id, key.account);
      site.jobs.push(job.id);
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 202, body: { siteId: site.id, jobId: job.id, status: job.status } };
    },
  },
  {
    method: 'GET', pattern: '/v1/sites', scope: 'sites',
    handler: ({ key }) => ({
      status: 200,
      body: {
        sites: store.listIds('sites')
          .map((id) => store.readJson(`sites/${id}.json`))
          .filter((s) => s && s.account === key.account)
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .map((s) => {
            const last = s.jobs.length ? jobs.get(s.jobs[s.jobs.length - 1]) : null;
            return {
              id: s.id,
              siteName: s.config?.siteName ?? '(unnamed)',
              templateId: s.templateId,
              updatedAt: s.updatedAt,
              lastJobStatus: last?.status ?? null,
            };
          }),
      },
    }),
  },
  {
    method: 'GET', pattern: '/v1/sites/:id', scope: 'sites',
    handler: ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      const jobSummaries = site.jobs
        .map((id) => jobs.get(id))
        .filter(Boolean)
        .map((j) => ({ id: j.id, kind: j.kind, status: j.status, createdAt: j.createdAt, finishedAt: j.finishedAt }));
      return { status: 200, body: { ...site, jobs: jobSummaries } };
    },
  },
  {
    method: 'GET', pattern: '/v1/jobs/:id', scope: 'sites',
    handler: ({ params, key }) => {
      const job = jobs.get(assertUuid(params.id, 'job id'));
      if (!job || (job.account && job.account !== key.account)) {
        throw httpError(404, 'not_found', `Job ${params.id} not found.`);
      }
      return { status: 200, body: job };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/change', scope: 'sites', meter: 'sites.change',
    handler: ({ params, body, key }) => {
      const site = loadSite(params.id, key.account);
      if (body?.config == null || typeof body.config !== 'object' || Array.isArray(body.config) || !Object.keys(body.config).length) {
        throw httpError(400, 'bad_request', 'Body must be { config: { …changed slots } }.');
      }
      site.configHistory.push({ config: site.config, replacedAt: new Date().toISOString() });
      site.config = { ...site.config, ...body.config };
      if (typeof site.config.siteName !== 'string' || !site.config.siteName.trim()) {
        throw httpError(422, 'incomplete_config', 'The change would leave config.siteName empty.');
      }
      const job = jobs.enqueue('assemble', site.id, key.account);
      site.jobs.push(job.id);
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 202, body: { siteId: site.id, jobId: job.id, status: job.status } };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/deploy', scope: 'deploy',
    handler: ({ params, key }) => {
      loadSite(params.id, key.account);
      const conns = connections.get(key.account);
      const ready = PROVIDERS.filter((p) => conns[p].connected);
      throw httpError(501, 'not_implemented',
        `Deploy lands with the assembly engine (staged rollout). It will use YOUR connections (${ready.length ? `connected: ${ready.join(', ')}` : 'none connected yet — see PUT /v1/connections/{provider}'}), deploy only the assembled site, and never ship any part of the engine.`);
    },
  },
  {
    method: 'GET', pattern: '/v1/sites/:id/export', scope: 'sites',
    handler: ({ params, key }) => {
      loadSite(params.id, key.account);
      throw httpError(501, 'not_implemented',
        'Export lands with the assembly engine. Exports contain the assembled site repo only — a standalone Next.js project with zero Stardrive runtime dependency; the engine itself is never included.');
    },
  },

  // Connections — the customer's OWN hosting credentials (BYO keys).
  // Tokens are encrypted at rest and NEVER returned by any route; reads are
  // masked (connected + last4). They exist so deploys go to hosting the
  // customer owns — and they only ever receive assembled site output, never
  // the engine.
  {
    method: 'GET', pattern: '/v1/connections', scope: 'deploy',
    handler: ({ key }) => ({ status: 200, body: { connections: connections.get(key.account) } }),
  },
  {
    method: 'PUT', pattern: '/v1/connections/:provider', scope: 'deploy', bodyLimit: 10_000,
    handler: ({ params, body, key }) => {
      const provider = String(params.provider);
      if (!PROVIDERS.includes(provider)) {
        throw httpError(422, 'unknown_provider', `provider must be one of: ${PROVIDERS.join(', ')} — the supported set is deliberate so a deploy can never leave you with a broken site.`);
      }
      const token = String(body?.token ?? '');
      if (token.length < 8 || token.length > 500 || /\s/.test(token)) {
        throw httpError(400, 'bad_request', 'token is required (8–500 chars, no whitespace).');
      }
      const owner = body?.owner != null ? String(body.owner) : undefined;
      if (provider === 'github' && owner !== undefined && !/^[a-zA-Z0-9-]{1,80}$/.test(owner)) {
        throw httpError(400, 'bad_request', 'owner must be a GitHub username/org slug.');
      }
      return { status: 200, body: { connections: connections.set(key.account, provider, token, { owner }) } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/connections/:provider', scope: 'deploy',
    handler: ({ params, key }) => {
      if (!connections.remove(key.account, String(params.provider))) {
        throw httpError(404, 'not_found', `No ${params.provider} connection on this account.`);
      }
      return { status: 200, body: { deleted: params.provider } };
    },
  },

  // Account.
  {
    method: 'GET', pattern: '/v1/usage', scope: 'any',
    handler: ({ key }) => ({ status: 200, body: { keyId: key.id, account: key.account, name: key.name, ...auth.usageFor(key.id) } }),
  },

  // Workbench utilities (not part of the metered v1 product surface).
  {
    // BYO-key chat relay for the Template Studio: the caller's OWN provider
    // key rides inside the request and is never stored or logged. Requires a
    // valid Stardrive key so this is never an open proxy.
    method: 'POST', pattern: '/workbench/chat', scope: 'any', meter: 'workbench.chat', bodyLimit: 2_000_000,
    handler: async ({ body }) => ({ status: 200, body: await relayChat(body) }),
  },

  // The marketing site's request-access form. Public by design (a prospect
  // has no key yet), so it gets its own per-IP throttle and strict caps.
  {
    method: 'POST', pattern: '/site/request-access', scope: 'public', bodyLimit: 20_000,
    handler: ({ body, req }) => {
      const ip = String(req.socket?.remoteAddress || 'unknown');
      if (!leadThrottle(ip)) throw httpError(429, 'rate_limited', 'Too many requests from this address — try again in an hour.');
      const name = String(body?.name ?? '').trim();
      const email = String(body?.email ?? '').trim();
      const company = String(body?.company ?? '').trim();
      const message = String(body?.message ?? '').trim();
      if (!name || name.length > 200) throw httpError(400, 'bad_request', 'name is required (max 200 chars).');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
        throw httpError(400, 'bad_request', 'A valid email is required.');
      }
      if (company.length > 300 || message.length > 4000) {
        throw httpError(400, 'bad_request', 'company max 300 chars; message max 4000 chars.');
      }
      const lead = { id: crypto.randomUUID(), name, email, company, message, at: new Date().toISOString() };
      store.writeJson(`leads/${lead.id}.json`, lead);
      return { status: 201, body: { ok: true, message: 'Request received — we reply to every one.' } };
    },
  },
];

// Per-IP sliding-hour throttle for the public lead form (5/hour).
const LEAD_WINDOW_MS = 3_600_000;
const leadHits = new Map();
function leadThrottle(ip) {
  const now = Date.now();
  const hits = (leadHits.get(ip) || []).filter((t) => now - t < LEAD_WINDOW_MS);
  if (hits.length >= 5) return false;
  hits.push(now);
  leadHits.set(ip, hits);
  if (leadHits.size > 10_000) leadHits.clear(); // memory guard; resets throttles, acceptable
  return true;
}

// ── Server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = matchRoute(ROUTES, req.method, url.pathname);
  if (!match) {
    // Everything that isn't an API route is static (no auth — the pages are
    // public; every API call the console makes needs a key). The marketing
    // site owns /, the licensee console owns /workbench/.
    if (req.method === 'GET' && url.pathname === '/workbench') {
      res.writeHead(302, { Location: '/workbench/' });
      return res.end();
    }
    if (url.pathname.startsWith('/workbench/')) {
      if (workbench(req, res, url.pathname.slice('/workbench'.length))) return;
    } else if (site(req, res, url.pathname)) {
      return;
    }
    return fail(res, 404, 'not_found', `No ${req.method} ${url.pathname}. GET /v1 lists the API surface; the site lives at /, the Workbench at /workbench/.`);
  }

  const { route, params } = match;
  let key = null;
  if (route.scope !== 'public') {
    key = auth.verify(req);
    if (!key) return fail(res, 401, 'unauthenticated', 'A valid API key is required: Authorization: Bearer sk_live_…');
    const rate = auth.rateCheck(key.id);
    if (!rate.ok) return fail(res, 429, 'rate_limited', 'Rate limit exceeded for this key.', { 'Retry-After': String(rate.retryAfter) });
    if (route.scope !== 'any' && !auth.hasScope(key, route.scope)) {
      return fail(res, 403, 'forbidden', `This key lacks the "${route.scope}" scope.`);
    }
  }

  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req, route.bodyLimit) : undefined;
  const out = await route.handler({ params, body, key, req });
  if (key) {
    auth.meter(key.id, 'requests');
    if (route.meter && out.status < 400) auth.meter(key.id, route.meter);
  }
  return json(res, out.status, out.body);
});

server.listen(PORT, () => {
  console.log(`[stardrive-api] v${VERSION} listening on http://localhost:${PORT} (engine: ${ENGINE}, var: ${VAR_DIR})`);
});
