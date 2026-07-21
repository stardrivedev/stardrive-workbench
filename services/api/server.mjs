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
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer, json, fail, readBody, readRawBody, matchRoute } from './lib/http.mjs';
import { VarStore, assertSafeSlug } from './lib/store.mjs';
import { createAuth, SCOPES } from './lib/auth.mjs';
import { mintKey, listKeys, rotateKey, revokeKey } from './lib/keys.mjs';
import { createAccounts } from './lib/accounts.mjs';
import { createBilling } from './lib/billing.mjs';
import { loadCatalog, createImportedStore, validateManifest, validateBundle, summarize } from './lib/templates.mjs';
import { createJobRunner } from './lib/jobs.mjs';
import { relayChat, studioConfig, copyModel } from './lib/chat-proxy.mjs';
import { createStaticServer } from './lib/static.mjs';
import { createConnections, PROVIDERS } from './lib/connections.mjs';
import { createAssets, MAX_ASSET_BYTES } from './lib/assets.mjs';
import { createLivePreview } from './lib/live-preview.mjs';
import { requirementsFor, readiness, validateFacts, GROUP_LABELS } from './lib/content.mjs';
import { generateCopy } from './lib/copy-gen.mjs';
import { tarGzDir } from './lib/archive.mjs';
import { pushToGitHub } from './lib/deploy.mjs';
import { createEmail } from './lib/email.mjs';
import { runMapping, validateMapping } from '../../packages/field-mapping/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.PORT) || 4650;
const VAR_DIR = process.env.STARDRIVE_VAR_DIR || path.join(HERE, 'var');
const ENGINE = process.env.STARDRIVE_ENGINE || 'dry';
const ENGINE_DIR = path.join(HERE, '..', '..', 'vendor', 'd4'); // vendored d4 assembler + modules

const SECURE_COOKIES = process.env.STARDRIVE_SECURE_COOKIES === '1' || process.env.NODE_ENV === 'production';

const store = new VarStore(VAR_DIR);
const auth = createAuth(store, { rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN) || 120 });
const accounts = createAccounts(store);
const billing = createBilling(accounts);
const catalog = loadCatalog(); // throws at boot if the bundle is bad
const imported = createImportedStore(store);
const assets = createAssets(store);

/** For the real engine: resolve a template to { source, manifest, bundle? }. */
function resolveTemplateForJob(account, name) {
  const c = catalog.get(String(name));
  if (c) return { source: 'bundled', manifest: c.manifest };
  const imp = imported.get(account, String(name));
  if (imp) return { source: 'imported', manifest: imp.manifest, bundle: imp.record.bundle };
  return null;
}

const jobs = createJobRunner(store, { engine: ENGINE, assets, engineDir: ENGINE_DIR, resolveTemplate: resolveTemplateForJob });
const connections = createConnections(store, VAR_DIR);
const email = createEmail();
const livePreview = createLivePreview(); // per-site `next start` on localhost

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const sessionCookie = (token) =>
  `sd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${SECURE_COOKIES ? '; Secure' : ''}`;
const clearCookie = () =>
  `sd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIES ? '; Secure' : ''}`;
// Two static roots: the public marketing site at /, the licensee console at /workbench/.
const site = createStaticServer(path.join(HERE, '..', '..', 'app', 'site'));
const workbench = createStaticServer(path.join(HERE, '..', '..', 'app', 'workbench'));

/** Bundled first (shared, not overridable), then the CALLER's own imports. */
function getTemplate(account, name) {
  return catalog.get(String(name)) || imported.get(account, String(name));
}

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const fsReadFile = (abs) => fs.readFileSync(abs);

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

/** Compartment ids that currently hold at least one upload (for readiness). */
function filledAssetSlots(siteId) {
  const state = assets.state(siteId) || {};
  return Object.keys(state).filter((slot) => (state[slot] || []).length > 0);
}

/** Readiness for a site given its facts, modules, and uploaded assets. */
function siteReadiness(site) {
  const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
  return readiness(site.content || {}, modules, { assetSlots: filledAssetSlots(site.id) });
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
    handler: () => {
      const s = studioConfig();
      return {
        status: 200,
        body: {
          ok: true, service: 'stardrive-api', version: VERSION, engine: ENGINE,
          qa: ENGINE === 'real' ? (process.env.STARDRIVE_QA === 'full' ? 'full' : 'structural') : 'dry',
          studio: { enabled: s.configured, model: s.configured ? s.model : null, copyModel: s.configured ? copyModel() : null },
        },
      };
    },
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

  // Auth — the human front door (browser session; the API key stays the
  // machine license). Signup mints the account's first full-scope key.
  {
    method: 'POST', pattern: '/auth/signup', scope: 'public', bodyLimit: 20_000,
    handler: ({ body }) => {
      const account = accounts.signup(body || {});
      const { record, secret } = mintKey(store, { name: 'Default key', scopes: SCOPES, account: account.id });
      const token = accounts.createSession(account.id);
      email.welcome(account); // fire-and-forget; no-op until email is configured
      return { status: 201, cookies: [sessionCookie(token)], body: { account, apiKey: { ...record, secret } } };
    },
  },
  {
    method: 'POST', pattern: '/auth/login', scope: 'public', bodyLimit: 20_000,
    handler: ({ body }) => {
      const account = accounts.login(body || {});
      if (!account) throw httpError(401, 'bad_credentials', 'Email or password is incorrect.');
      const token = accounts.createSession(account.id);
      return { status: 200, cookies: [sessionCookie(token)], body: { account } };
    },
  },
  {
    method: 'POST', pattern: '/auth/logout', scope: 'public',
    handler: ({ req }) => {
      accounts.destroySession(parseCookies(req).sd_session);
      return { status: 200, cookies: [clearCookie()], body: { ok: true } };
    },
  },
  {
    method: 'GET', pattern: '/auth/me', scope: 'session',
    handler: ({ account }) => ({ status: 200, body: { account } }),
  },

  // Self-service API keys (session-authed — these are account management).
  {
    method: 'GET', pattern: '/v1/keys', scope: 'session',
    handler: ({ account }) => ({ status: 200, body: { keys: listKeys(store, account.id) } }),
  },
  {
    method: 'POST', pattern: '/v1/keys', scope: 'session', bodyLimit: 10_000,
    handler: ({ account, body }) => {
      const { record, secret } = mintKey(store, { name: body?.name || 'key', scopes: body?.scopes, account: account.id });
      return { status: 201, body: { ...record, secret } };
    },
  },
  {
    method: 'POST', pattern: '/v1/keys/:id/rotate', scope: 'session',
    handler: ({ account, params }) => {
      const out = rotateKey(store, params.id, account.id);
      if (!out) throw httpError(404, 'not_found', 'No such active key on this account.');
      return { status: 200, body: { ...out.record, secret: out.secret } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/keys/:id', scope: 'session',
    handler: ({ account, params }) => {
      if (!revokeKey(store, params.id, account.id)) throw httpError(404, 'not_found', 'No such key on this account.');
      return { status: 200, body: { revoked: params.id } };
    },
  },

  // Billing — plan + a Stripe-ready checkout seam, dormant until configured.
  {
    method: 'GET', pattern: '/v1/billing', scope: 'session',
    handler: ({ account }) => {
      const usage = billing.usageSummary(account, listKeys, auth.usageFor, store);
      return { status: 200, body: billing.summary(account, usage) };
    },
  },
  {
    method: 'POST', pattern: '/v1/billing/checkout', scope: 'session', bodyLimit: 10_000,
    handler: async ({ account, body }) => ({ status: 200, body: await billing.createCheckout(account, body || {}) }),
  },
  {
    // Stripe subscription webhook (signature-verified). Flips the account's
    // plan on subscribe, reverts on cancel. Public + raw-body (the signature
    // is computed over the exact bytes). Dormant 501 until configured.
    method: 'POST', pattern: '/webhooks/stripe', scope: 'public', rawBody: true, bodyLimit: 1_000_000,
    handler: ({ rawBody, req }) => ({ status: 200, body: billing.handleWebhook(rawBody, req.headers['stripe-signature']) }),
  },
  {
    // Opt in/out of extra usage: keep generating past the included tokens,
    // billed to the card on file at the plan's overage rate.
    method: 'POST', pattern: '/v1/billing/overage', scope: 'session', bodyLimit: 10_000,
    handler: ({ account, body }) => {
      const updated = accounts.setOverage(account.id, Boolean(body?.enabled));
      return {
        status: 200,
        body: {
          overageEnabled: updated.overageEnabled,
          active: updated.overageEnabled && billing.configured(),
          note: billing.configured()
            ? (updated.overageEnabled ? 'Extra usage is on — overage bills to your card on file.' : 'Extra usage is off — generation stops at your included tokens.')
            : 'Saved. Extra-usage billing activates once a card is on file (Stripe checkout).',
        },
      };
    },
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
        content: {}, // the customer's factual intake (see lib/content.mjs)
        copy: null,  // the finished copy pack the AI writes from those facts
        configHistory: [],
        jobs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // assemble:false creates the site WITHOUT building, so the customer can
      // upload assets first and the very first build (and preview) includes
      // their photos. POST /v1/sites/{id}/assemble builds when they're ready.
      if (body.assemble === false) {
        store.writeJson(`sites/${site.id}.json`, site);
        return { status: 201, body: { siteId: site.id, status: 'created' } };
      }
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
  // Asset compartments: named slots per site, so uploads land in the right
  // place on the assembled site without the customer thinking about paths.
  {
    method: 'GET', pattern: '/v1/sites/:id/assets', scope: 'sites',
    handler: ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      const entry = getTemplate(key.account, site.templateId);
      return { status: 200, body: { slots: assets.slotsFor(entry?.manifest), assets: assets.state(site.id) } };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/assets/:slot', scope: 'sites', meter: 'assets.upload', bodyLimit: 16_000_000,
    handler: ({ params, body, key }) => {
      const site = loadSite(params.id, key.account);
      const entry = getTemplate(key.account, site.templateId);
      const slotDef = assets.slotsFor(entry?.manifest).find((s) => s.id === String(params.slot));
      if (!slotDef) throw httpError(422, 'unknown_slot', `No compartment "${params.slot}" on this site — GET /v1/sites/${site.id}/assets lists them.`);
      if (typeof body?.filename !== 'string' || !body.filename.trim() || typeof body?.contentBase64 !== 'string') {
        throw httpError(400, 'bad_request', 'Body must be { filename, contentBase64 }.');
      }
      const buffer = Buffer.from(body.contentBase64, 'base64');
      if (buffer.length > MAX_ASSET_BYTES) throw httpError(422, 'too_large', `Files must be at most ${Math.round(MAX_ASSET_BYTES / 1e6)} MB.`);
      const meta = assets.add(site.id, slotDef, body.filename.trim(), buffer);
      return {
        status: 201,
        body: {
          slot: slotDef.id,
          asset: meta,
          note: `Slotted for ${meta.target} — picked up at the next assembly (POST /v1/sites/${site.id}/assemble).`,
        },
      };
    },
  },
  {
    method: 'GET', pattern: '/v1/sites/:id/assets/:slot/:assetId', scope: 'sites',
    handler: ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      const hit = assets.find(site.id, String(params.slot), assertUuid(params.assetId, 'asset id'));
      if (!hit) throw httpError(404, 'not_found', 'Asset not found.');
      return { raw: true, status: 200, headers: { 'Content-Type': hit.meta.type, 'Cache-Control': 'no-cache' }, buffer: fsReadFile(hit.abs) };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/sites/:id/assets/:slot/:assetId', scope: 'sites',
    handler: ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      if (!assets.remove(site.id, String(params.slot), assertUuid(params.assetId, 'asset id'))) {
        throw httpError(404, 'not_found', 'Asset not found.');
      }
      return { status: 200, body: { deleted: params.assetId, slot: params.slot } };
    },
  },
  {
    // The intake: the exact fields this site must/should answer (gated by its
    // chosen feature pages), the current answers, and how ready it is to ship.
    method: 'GET', pattern: '/v1/sites/:id/content', scope: 'sites',
    handler: ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
      return {
        status: 200,
        body: {
          groups: GROUP_LABELS,
          fields: requirementsFor(modules),
          facts: site.content || {},
          copy: site.copy || null,
          readiness: siteReadiness(site),
        },
      };
    },
  },
  {
    // Save the factual answers (merged). The AI writes the copy from these.
    method: 'PATCH', pattern: '/v1/sites/:id/content', scope: 'sites', meter: 'sites.change',
    handler: ({ params, body, key }) => {
      const site = loadSite(params.id, key.account);
      if (!body || typeof body !== 'object' || Array.isArray(body.facts) || typeof body.facts !== 'object') {
        throw httpError(400, 'bad_request', 'Send { facts: { ...fieldId: value } }.');
      }
      const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
      const merged = { ...(site.content || {}), ...body.facts };
      const v = validateFacts(merged, modules);
      if (!v.ok) throw httpError(422, 'invalid_facts', v.errors.join(' '));
      site.content = merged;
      site.copy = null; // facts changed — the written copy is now stale
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 200, body: { saved: true, readiness: siteReadiness(site) } };
    },
  },
  {
    // Write the finished copy from the facts (AI when configured, else a
    // deterministic real-sentence fallback). Stored on the site for the build.
    method: 'POST', pattern: '/v1/sites/:id/content/generate', scope: 'sites', meter: 'studio.generations',
    handler: async ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      const ready = siteReadiness(site);
      if (!ready.ready) {
        throw httpError(422, 'content_incomplete', `Answer the required questions first — still missing: ${ready.missing.map((m) => m.label).join(', ')}.`);
      }
      // Same token-quota gate as the Studio, before spending any model budget.
      const account = accounts.getAccount(key.account) || { id: key.account, plan: 'beta' };
      billing.checkStudioQuota(account, billing.usageSummary(account, listKeys, auth.usageFor, store));
      const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
      const result = await generateCopy({ siteName: site.config.siteName, facts: site.content || {}, modules });
      site.copy = result.pack;
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      if (result.tokens) { try { auth.meter(key.id, 'studio.tokens', result.tokens); } catch { /* metering best-effort */ } }
      return { status: 200, body: { copy: result.pack, source: result.source } };
    },
  },
  {
    // Re-run assembly with the current config + latest assets. GATED: a site
    // that has not answered its required content cannot build (pass force:true
    // to bypass for headless/programmatic callers).
    method: 'POST', pattern: '/v1/sites/:id/assemble', scope: 'sites', meter: 'sites.assemble',
    handler: ({ params, body, key }) => {
      const site = loadSite(params.id, key.account);
      const ready = siteReadiness(site);
      if (!ready.ready && body?.force !== true) {
        throw httpError(422, 'content_incomplete',
          `This site is not ready to ship — answer the required questions first (missing: ${ready.missing.map((m) => m.label).join(', ')}). The build is deliberately gated so nothing goes out half-finished.`);
      }
      const job = jobs.enqueue('assemble', site.id, key.account);
      site.jobs.push(job.id);
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 202, body: { siteId: site.id, jobId: job.id, status: job.status } };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/deploy', scope: 'deploy', meter: 'sites.deploy',
    handler: async ({ params, body, key }) => {
      const s = loadSite(params.id, key.account);
      const dir = store.path('workspaces', s.id);
      if (!fs.existsSync(path.join(dir, 'package.json'))) {
        throw httpError(409, 'not_assembled', 'Build the site before deploying.');
      }
      // Per-client targets: each site can ship to its OWN GitHub account.
      // Resolution: this request's fields > this site's saved target > the
      // account default from Connections. Sending token/owner/repo with
      // save:true stores them (encrypted) as this site's target.
      const siteTarget = connections.getSiteTarget(s.id);
      const acct = connections.get(key.account).github;
      const owner = String(body?.owner || siteTarget?.owner || acct.owner || '').trim();
      const token = (typeof body?.token === 'string' && body.token.trim())
        || connections.revealSiteToken(s.id)
        || (acct.connected ? connections.reveal(key.account, 'github') : null);
      if (!token || !owner) {
        throw httpError(422, 'no_target', 'Tell us where to deploy: a GitHub owner and token — either right here for this site, or once in Hosting as your default. Each site can go to a different account.');
      }
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(owner)) throw httpError(400, 'bad_request', 'owner must be a GitHub username/org slug.');
      const repo = String(body?.repo || siteTarget?.repo || s.config.siteName || 'site').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'site';
      if (body?.save) connections.setSiteTarget(s.id, { token: body?.token?.trim() || undefined, owner, repo });
      const result = await pushToGitHub({ token, owner, repo, dir, message: `Stardrive: ${s.config.siteName}` });
      return {
        status: 200,
        body: { deployed: true, target: 'github', ...result,
          note: 'Pushed the site to GitHub. Link the repo to Vercel (or your host) and it builds on every push.' },
      };
    },
  },
  {
    // The site's saved deploy target (masked) — for prefilling the form.
    method: 'GET', pattern: '/v1/sites/:id/deploy-target', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const acct = connections.get(key.account).github;
      return { status: 200, body: { site: connections.getSiteTarget(s.id), accountDefault: acct.connected ? { owner: acct.owner, last4: acct.last4 } : null } };
    },
  },
  {
    // The visual preview screenshot captured by the full QA tier.
    method: 'GET', pattern: '/v1/sites/:id/preview', scope: 'sites',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const abs = store.path('workspaces', s.id, '.stardrive-preview.png');
      if (!fs.existsSync(abs)) {
        throw httpError(404, 'no_preview', 'No preview yet — previews are captured by the full QA tier (STARDRIVE_QA=full) during assembly.');
      }
      return { raw: true, status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }, buffer: fsReadFile(abs) };
    },
  },
  {
    // Start (or reuse) a clickable live preview: `next start` on a localhost
    // port, so the operator can navigate the REAL assembled site. Local-only.
    method: 'POST', pattern: '/v1/sites/:id/preview/live', scope: 'sites',
    handler: async ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const info = await livePreview.start(s.id, store.path('workspaces', s.id));
      return { status: 200, body: { status: 'running', ...info } };
    },
  },
  {
    // Is a live preview running for this site? (returns null url if not).
    method: 'GET', pattern: '/v1/sites/:id/preview/live', scope: 'sites',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const info = livePreview.status(s.id);
      return { status: 200, body: info ? { status: 'running', ...info } : { status: 'stopped' } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/sites/:id/preview/live', scope: 'sites',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      return { status: 200, body: { status: livePreview.stop(s.id) ? 'stopped' : 'stopped' } };
    },
  },
  {
    method: 'GET', pattern: '/v1/sites/:id/export', scope: 'sites',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const dir = store.path('workspaces', s.id);
      if (!fs.existsSync(path.join(dir, 'package.json'))) {
        throw httpError(409, 'not_assembled',
          'This site has not been assembled by the real engine yet. Assemble it (with STARDRIVE_ENGINE=real) and try again.');
      }
      const slug = String(s.config.siteName || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
      // The assembled site repo ONLY — a standalone Next.js project, zero
      // Stardrive runtime dependency; the engine itself is never included.
      const buffer = tarGzDir(dir, slug);
      return {
        raw: true, status: 200, buffer,
        headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${slug}.tar.gz"` },
      };
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
    // Template Studio relay. The model runs on the OPERATOR's server-side key
    // (never sent to the browser, never in the request); the customer only
    // sends { system, messages }. Requires a valid Stardrive key so it is
    // never an open proxy, and meters generations + tokens to the account so
    // this included feature can be priced.
    method: 'POST', pattern: '/workbench/chat', scope: 'any', bodyLimit: 2_000_000,
    handler: async ({ body, key }) => {
      // Gate on the account's token quota before spending model budget.
      const account = accounts.getAccount(key.account) || { id: key.account, plan: 'beta' };
      const usage = billing.usageSummary(account, listKeys, auth.usageFor, store);
      billing.checkStudioQuota(account, usage);
      const result = await relayChat({ system: body?.system, messages: body?.messages });
      auth.meter(key.id, 'studio.generations');
      if (result.tokens) auth.meter(key.id, 'studio.tokens', result.tokens);
      return { status: 200, body: result };
    },
  },

  // The marketing site's request-access form. Public by design (a prospect
  // has no key yet), so it gets its own per-IP throttle and strict caps.
  {
    method: 'POST', pattern: '/site/request-access', scope: 'public', bodyLimit: 20_000,
    handler: ({ body, req }) => {
      const ip = String(req.socket?.remoteAddress || 'unknown');
      if (!leadThrottle(ip)) throw httpError(429, 'rate_limited', 'Too many requests from this address — try again in an hour.');
      const name = String(body?.name ?? '').trim();
      const emailAddr = String(body?.email ?? '').trim();
      const company = String(body?.company ?? '').trim();
      const message = String(body?.message ?? '').trim();
      if (!name || name.length > 200) throw httpError(400, 'bad_request', 'name is required (max 200 chars).');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr) || emailAddr.length > 320) {
        throw httpError(400, 'bad_request', 'A valid email is required.');
      }
      if (company.length > 300 || message.length > 4000) {
        throw httpError(400, 'bad_request', 'company max 300 chars; message max 4000 chars.');
      }
      const lead = { id: crypto.randomUUID(), name, email: emailAddr, company, message, at: new Date().toISOString() };
      store.writeJson(`leads/${lead.id}.json`, lead);
      email.leadNotify(lead); // fire-and-forget; no-op until email is configured
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
  let account = null;
  if (route.scope === 'session') {
    // Browser session (the console's account-management surface).
    account = accounts.verifySession(parseCookies(req).sd_session);
    if (!account) return fail(res, 401, 'unauthenticated', 'Log in to continue.');
  } else if (route.scope !== 'public') {
    key = auth.verify(req);
    if (!key) return fail(res, 401, 'unauthenticated', 'A valid API key is required: Authorization: Bearer sk_live_…');
    const rate = auth.rateCheck(key.id);
    if (!rate.ok) return fail(res, 429, 'rate_limited', 'Rate limit exceeded for this key.', { 'Retry-After': String(rate.retryAfter) });
    if (route.scope !== 'any' && !auth.hasScope(key, route.scope)) {
      return fail(res, 403, 'forbidden', `This key lacks the "${route.scope}" scope.`);
    }
  }

  let body;
  let rawBody;
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (route.rawBody) rawBody = await readRawBody(req, route.bodyLimit);
    else body = await readBody(req, route.bodyLimit);
  }
  const out = await route.handler({ params, body, rawBody, key, account, req });
  if (key) {
    auth.meter(key.id, 'requests');
    if (route.meter && out.status < 400) auth.meter(key.id, route.meter);
  }
  if (out.cookies) res.setHeader('Set-Cookie', out.cookies);
  if (out.raw) {
    res.writeHead(out.status, { ...out.headers, 'Content-Length': out.buffer.length });
    return res.end(out.buffer);
  }
  return json(res, out.status, out.body);
});

server.listen(PORT, () => {
  console.log(`[stardrive-api] v${VERSION} listening on http://localhost:${PORT} (engine: ${ENGINE}, var: ${VAR_DIR})`);
});

// Don't leave orphaned `next start` preview servers behind on shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { livePreview.stopAll(); } finally { process.exit(0); } });
}
process.on('exit', () => livePreview.stopAll());
