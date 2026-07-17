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
import { loadCatalog, validateManifest, summarize } from './lib/templates.mjs';
import { createJobRunner } from './lib/jobs.mjs';
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
const jobs = createJobRunner(store, { engine: ENGINE });

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

function assertUuid(id, what = 'id') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
    throw httpError(400, 'bad_id', `${what} must be a UUID.`);
  }
  return id;
}

function loadSite(id) {
  const site = store.readJson(`sites/${assertUuid(id, 'site id')}.json`);
  if (!site) throw httpError(404, 'not_found', `Site ${id} not found.`);
  return site;
}

function resolveMappingBody(body, key) {
  if (body?.mapping && body?.mappingId) {
    throw httpError(400, 'bad_request', 'Send either mapping (inline) or mappingId (stored), not both.');
  }
  if (body?.mappingId) {
    const rec = store.readJson(`mappings/${assertSafeSlug(body.mappingId, 'mappingId')}.json`);
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
    handler: ({ params, body }) => {
      const id = assertSafeSlug(params.id, 'mapping id');
      if (body == null) throw httpError(400, 'bad_request', 'Body must be a mapping document.');
      const v = validateMapping(body);
      if (!v.ok) return { status: 422, body: { error: { code: 'invalid_mapping', message: 'Mapping rejected.' }, errors: v.errors } };
      const existing = store.readJson(`mappings/${id}.json`);
      const rec = {
        id,
        name: body.name ?? id,
        version: body.version ?? null,
        mapping: body,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.writeJson(`mappings/${id}.json`, rec);
      return { status: existing ? 200 : 201, body: { id, name: rec.name, version: rec.version, updatedAt: rec.updatedAt } };
    },
  },
  {
    method: 'GET', pattern: '/v1/mappings', scope: 'mappings',
    handler: () => ({
      status: 200,
      body: {
        mappings: store.listIds('mappings').map((id) => {
          const r = store.readJson(`mappings/${id}.json`);
          return { id: r.id, name: r.name, version: r.version, updatedAt: r.updatedAt };
        }),
      },
    }),
  },
  {
    method: 'GET', pattern: '/v1/mappings/:id', scope: 'mappings',
    handler: ({ params }) => {
      const rec = store.readJson(`mappings/${assertSafeSlug(params.id, 'mapping id')}.json`);
      if (!rec) throw httpError(404, 'not_found', `Mapping "${params.id}" not found.`);
      return { status: 200, body: rec };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/mappings/:id', scope: 'mappings',
    handler: ({ params }) => {
      const ok = store.deleteJson(`mappings/${assertSafeSlug(params.id, 'mapping id')}.json`);
      if (!ok) throw httpError(404, 'not_found', `Mapping "${params.id}" not found.`);
      return { status: 200, body: { deleted: params.id } };
    },
  },

  // Templates.
  {
    method: 'GET', pattern: '/v1/templates', scope: 'templates',
    handler: () => ({ status: 200, body: { templates: [...catalog.values()].map(summarize) } }),
  },
  {
    method: 'GET', pattern: '/v1/templates/:name', scope: 'templates',
    handler: ({ params }) => {
      const entry = catalog.get(params.name);
      if (!entry) throw httpError(404, 'not_found', `Template "${params.name}" not found.`);
      return { status: 200, body: { source: entry.source, manifest: entry.manifest } };
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
    method: 'POST', pattern: '/v1/templates', scope: 'templates',
    handler: () => {
      throw httpError(501, 'not_implemented',
        'Template import (git URL / tarball) is not implemented yet — validate manifests with POST /v1/templates/validate meanwhile. See docs/api-design.md.');
    },
  },

  // Sites + jobs.
  {
    method: 'POST', pattern: '/v1/sites', scope: 'sites', meter: 'sites.assemble',
    handler: ({ body, key }) => {
      if (body == null) throw httpError(400, 'bad_request', 'Body required.');
      const entry = catalog.get(String(body.templateId || ''));
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
        templateId: body.templateId,
        config,
        parse,
        configHistory: [],
        jobs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const job = jobs.enqueue('assemble', site.id);
      site.jobs.push(job.id);
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 202, body: { siteId: site.id, jobId: job.id, status: job.status } };
    },
  },
  {
    method: 'GET', pattern: '/v1/sites/:id', scope: 'sites',
    handler: ({ params }) => {
      const site = loadSite(params.id);
      const jobSummaries = site.jobs
        .map((id) => jobs.get(id))
        .filter(Boolean)
        .map((j) => ({ id: j.id, kind: j.kind, status: j.status, createdAt: j.createdAt, finishedAt: j.finishedAt }));
      return { status: 200, body: { ...site, jobs: jobSummaries } };
    },
  },
  {
    method: 'GET', pattern: '/v1/jobs/:id', scope: 'sites',
    handler: ({ params }) => {
      const job = jobs.get(assertUuid(params.id, 'job id'));
      if (!job) throw httpError(404, 'not_found', `Job ${params.id} not found.`);
      return { status: 200, body: job };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/change', scope: 'sites', meter: 'sites.change',
    handler: ({ params, body }) => {
      const site = loadSite(params.id);
      if (body?.config == null || typeof body.config !== 'object' || Array.isArray(body.config) || !Object.keys(body.config).length) {
        throw httpError(400, 'bad_request', 'Body must be { config: { …changed slots } }.');
      }
      site.configHistory.push({ config: site.config, replacedAt: new Date().toISOString() });
      site.config = { ...site.config, ...body.config };
      if (typeof site.config.siteName !== 'string' || !site.config.siteName.trim()) {
        throw httpError(422, 'incomplete_config', 'The change would leave config.siteName empty.');
      }
      const job = jobs.enqueue('assemble', site.id);
      site.jobs.push(job.id);
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 202, body: { siteId: site.id, jobId: job.id, status: job.status } };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/deploy', scope: 'deploy',
    handler: ({ params }) => {
      loadSite(params.id);
      throw httpError(501, 'not_implemented',
        'Deploy (licensee Vercel/Turso/GitHub credentials) is not implemented yet — it lands with the real engine. See docs/api-design.md.');
    },
  },
  {
    method: 'GET', pattern: '/v1/sites/:id/export', scope: 'sites',
    handler: ({ params }) => {
      loadSite(params.id);
      throw httpError(501, 'not_implemented',
        'Export requires the real assembly engine (dry workspaces contain only a marker). See docs/api-design.md.');
    },
  },

  // Account.
  {
    method: 'GET', pattern: '/v1/usage', scope: 'any',
    handler: ({ key }) => ({ status: 200, body: { keyId: key.id, name: key.name, ...auth.usageFor(key.id) } }),
  },
];

// ── Server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = matchRoute(ROUTES, req.method, url.pathname);
  if (!match) return fail(res, 404, 'not_found', `No ${req.method} ${url.pathname}. GET /v1 lists the surface.`);

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

  const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : undefined;
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
