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
import { loadCatalog, createImportedStore, validateManifest, validateBundle, autofixTemplateFiles, autofixManifest, summarize } from './lib/templates.mjs';
import { createJobRunner } from './lib/jobs.mjs';
import { relayChat, studioConfig, copyModel } from './lib/chat-proxy.mjs';
import { modulesForFeatures } from './lib/studio-bundle.mjs';
import { createStaticServer } from './lib/static.mjs';
import { createConnections, PROVIDERS } from './lib/connections.mjs';
import { createAssets, MAX_ASSET_BYTES } from './lib/assets.mjs';
import { createLivePreview } from './lib/live-preview.mjs';
import { requirementsFor, clientRequirementsFor, readiness, validateFacts, GROUP_LABELS } from './lib/content.mjs';
import { generateCopy } from './lib/copy-gen.mjs';
import { tarGzDir, tarGzDirs } from './lib/archive.mjs';
import { pushToGitHub } from './lib/deploy.mjs';
import { deployToVercel, projectName } from './lib/deploy-vercel.mjs';
import { deployToNetlify, attachNetlifyDomain } from './lib/deploy-netlify.mjs';
import { normalizeDomain, dnsPlanFor, attachVercel, checkVercel, siteUrlEnv, SITE_URL_ENV } from './lib/domains.mjs';
import { createEmail } from './lib/email.mjs';
import { createSiteEnv, specFor, deployEnv, renderEnvFile, missingFrom, SUPPLIED } from './lib/site-env.mjs';
import { renderHandoffHtml, guideFor, notesFor } from './lib/handoff.mjs';
import { deployGuide } from './lib/guide.mjs';
import { createOps } from './lib/ops.mjs';
import { createIntakeLinks, MAX_SAVES } from './lib/intake-links.mjs';
import { createBatches } from './lib/batches.mjs';
import { runMapping, validateMapping } from '../../packages/field-mapping/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const portAsked = portArg >= 0 ? args[portArg + 1] : process.env.PORT;
// Port 0 means "any free port, the OS picks". A plain `|| 4650` would treat
// that as unset and quietly bind the default instead, so it is spelled out.
// The tests rely on it: nothing they run can collide with anything else.
const PORT = portAsked !== undefined && portAsked !== '' && Number.isFinite(Number(portAsked))
  ? Number(portAsked)
  : 4650;
const VAR_DIR = process.env.STARDRIVE_VAR_DIR || path.join(HERE, 'var');
const ENGINE = process.env.STARDRIVE_ENGINE || 'dry';
const ENGINE_DIR = path.join(HERE, '..', '..', 'vendor', 'd4'); // vendored d4 assembler + modules

const SECURE_COOKIES = process.env.STARDRIVE_SECURE_COOKIES === '1' || process.env.NODE_ENV === 'production';
// Accounts one address may create per hour. Signup is the unauthenticated
// front door to spending the operator's model budget, so it is rationed.
const SIGNUP_PER_HOUR = Number(process.env.SIGNUP_LIMIT_PER_HOUR) || 5;

const store = new VarStore(VAR_DIR);
const auth = createAuth(store, { rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN) || 120 });
const accounts = createAccounts(store);
const billing = createBilling(accounts, store);
const catalog = loadCatalog(); // throws at boot if the bundle is bad
const imported = createImportedStore(store);
const assets = createAssets(store);
const intakeLinks = createIntakeLinks(store); // the client's own copy of the form

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
// Per-site settings a built site needs on its host: the generated admin
// password, and the keys only the licensee has. Encrypted under the same
// secret as hosting tokens.
const siteEnv = createSiteEnv(store, VAR_DIR);
const email = createEmail();
// Operator telemetry: recent errors, request counters, and a once-a-minute
// watchdog that emails when the disk, the queue, or the error rate goes bad.
// Dormant without an email provider + STARDRIVE_ALERT_TO; readable either way.
const ops = createOps(store, { email, sample: () => jobs.stats() });
const livePreview = createLivePreview(); // per-site `next start` on localhost

// Batch Building (Agency tier): overnight bulk builds via the provider Batch
// API. Reconcile on boot (open batches resume across restarts — the provider
// batch keeps running server-side regardless) and once a minute after.
const batches = createBatches(store, {
  runner: jobs, imported, catalog, accounts, email, assets,
  authMeter: (keyId, name, n) => auth.meter(keyId, name, n),
  // Validating a reused template at submit time, and publishing a whole batch
  // in one go, both need surfaces that live out here.
  resolveTemplate: (account, name) => getTemplate(account, name),
  publishSite: (account, siteId) => publishSiteToVercel(account, siteId),
});
setTimeout(() => batches.reconcile().catch(() => {}), 3_000).unref?.();
setInterval(() => batches.reconcile().catch(() => {}), 60_000).unref?.();

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
// The API server hosts the licensee Console at /workbench/. The public
// marketing site is a separate deployment (built with Stardrive itself), so we
// no longer bundle a marketing "face" here.
const workbench = createStaticServer(path.join(HERE, '..', '..', 'app', 'workbench'));
// The client's intake form. A separate, much smaller page: the person filling
// it in is a bakery owner, not a licensee, and should never see a console.
const intakeApp = createStaticServer(path.join(HERE, '..', '..', 'app', 'intake'));

/** Bundled first (shared, not overridable), then the CALLER's own imports. */
function getTemplate(account, name) {
  return catalog.get(String(name)) || imported.get(account, String(name));
}

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const fsReadFile = (abs) => fs.readFileSync(abs);

/** A filename-safe slug for exports and repo names. */
const slugify = (s) => String(s || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';

/** Where a template's preview image lives. Sits beside the template record;
 *  store.listIds() only reads .json, so a sibling .png is invisible to it. */
function thumbnailPath(account, name) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(name))) return null;
  return store.path('templates', account, `${name}.png`);
}

/** Remove a site and everything that belongs to it. */
function purgeSite(site) {
  livePreview.stop(site.id);
  fs.rmSync(store.path('workspaces', site.id), { recursive: true, force: true });
  fs.rmSync(store.path('workspaces', `${site.id}.stage`), { recursive: true, force: true });
  fs.rmSync(store.path('assets', site.id), { recursive: true, force: true });
  for (const jid of site.jobs || []) { try { store.deleteJson(`jobs/${jid}.json`); } catch { /* best effort */ } }
  try { store.deleteJson(`connections/site-${site.id}.json`); } catch { /* may not exist */ }
  store.deleteJson(`sites/${site.id}.json`);
}

/** Drop this account's old Studio design demos. Each one carries a whole
 *  assembled workspace, so keeping every experiment forever is real disk. */
function reapPreviewSites(account) {
  for (const id of store.listIds('sites')) {
    const s = store.readJson(`sites/${id}.json`);
    if (s && s.preview && s.account === account) purgeSite(s);
  }
}

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

/** Enqueue an assemble job for a site. */
function enqueueAssemble(siteId, accountId) {
  return jobs.enqueue('assemble', siteId, accountId);
}

/** Readiness for a site given its facts and modules (text answers only). */
function siteReadiness(site) {
  const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
  return readiness(site.content || {}, modules);
}

/**
 * The one gate in front of anything that spends the operator's model budget:
 * generating a template, writing a site's copy, or submitting a batch. It
 * checks BOTH that the address was confirmed and that the plan has quota
 * left, so a new spend path cannot accidentally skip one of the two. Call it
 * instead of billing.checkStudioQuota directly.
 */
function gateModelSpend(account, usage = null) {
  if (account?.emailVerified === false) {
    throw httpError(403, 'email_unverified',
      'Confirm your email address to switch on AI generation. We sent you a link when you signed up; the Workbench can send it again.');
  }
  billing.checkStudioQuota(account, usage ?? billing.usageSummary(account, listKeys, auth.usageFor, store));
}

/**
 * A batch-built site whose AI design nobody has looked at yet must not reach
 * a client. The gate lives here, at the deploy actuators, not only in the
 * Batch screen: otherwise the operator opens the site in Sites, publishes,
 * and the review was theatre.
 */
function assertReviewed(site) {
  if (site.review?.state === 'pending') {
    throw httpError(409, 'review_pending',
      'This design came out of a batch and has not been reviewed yet. Open Batch Building, look it over, and approve it, then publish.');
  }
}

/**
 * Everything one built site needs in its host's environment.
 *
 * One function so the values pushed to a host and the values handed to a
 * licensee for a host we cannot write to are the same by construction. Two
 * code paths here would drift, and the failure would be a site that works on
 * Vercel and quietly does not work anywhere else.
 *
 * The database is vendor-neutral: whatever libSQL endpoint the licensee
 * connected, per-site target first, then their account default.
 */
/* ── Client intake links ──────────────────────────────────────────────── */

/** The client's uploads live in their own asset bucket until adopted, so a
 *  half-filled form never puts pictures on a site nobody has approved. */
const intakeAssetId = (linkId) => `intake-${linkId}`;

/** Which pictures to ask the client for. Deliberately not the full slot list
 *  the licensee sees: page-by-page hero backgrounds are a design decision, not
 *  something to put to a bakery. Logo and general photos are theirs to give. */
function clientPhotoSlots(record) {
  const site = store.readJson(`sites/${record.siteId}.json`, null);
  const entry = site ? getTemplate(record.account, site.templateId) : null;
  const all = assets.slotsFor(entry?.manifest, record.modules);
  return all.filter((s) => s.id === 'logo' || s.id === 'gallery' || s.id === 'hero');
}

/** Whose form this is, in the client's words. Falls back to nothing rather
 *  than leaking an email address to an unauthenticated visitor. */
function studioNameFor(accountId) {
  const account = accounts.getAccount(accountId);
  return String(account?.company || '').trim() || null;
}

/**
 * Resolve a public intake token, or refuse in a way that tells the client
 * something useful without telling a stranger anything at all.
 *
 * Throttled per address on every call: the token is the only credential out
 * here. Reads get a larger allowance than writes because a client filling in a
 * long form legitimately loads it several times.
 */
/**
 * Save what the client typed. Shared by PATCH (the form's own debounced save)
 * and POST (the sendBeacon on tab close, which cannot use any other verb).
 */
function saveClientFacts({ params, body, req }) {
  const record = openIntake(params.token, req, { write: true });
  if (!body || typeof body !== 'object' || !body.facts || typeof body.facts !== 'object' || Array.isArray(body.facts)) {
    throw httpError(400, 'bad_request', 'Send { facts: { ...fieldId: value } }.');
  }
  // Only the fields this site actually asks for. Anything else is either a
  // stale form or somebody poking, and neither belongs in a client's site.
  const allowed = new Set(requirementsFor(record.modules).map((f) => f.id));
  const facts = {};
  for (const [id, value] of Object.entries(body.facts)) {
    if (allowed.has(id)) facts[id] = value;
  }
  const merged = { ...(record.facts || {}), ...facts };
  const v = validateFacts(merged, record.modules);
  if (!v.ok) throw httpError(422, 'invalid_facts', v.errors.join(' '));
  intakeLinks.saveFacts(record, facts);
  return { status: 200, body: { saved: true, readiness: readiness(record.facts || {}, record.modules) } };
}

function openIntake(token, req, { write }) {
  const limit = write ? 120 : 240;
  if (!ipThrottle(write ? 'intake-write' : 'intake-read', clientIp(req), limit)) {
    throw httpError(429, 'rate_limited', 'Too many requests from this address — try again in a little while.');
  }
  const record = intakeLinks.find(String(token || ''));
  if (!record) {
    throw httpError(404, 'not_found', 'This link is not valid any more. Ask whoever sent it for a new one.');
  }
  if (write) {
    if (record.status === 'adopted') {
      throw httpError(409, 'already_adopted', 'Your designer has already picked these answers up. Send them any changes directly.');
    }
    if ((record.saves || 0) >= MAX_SAVES) {
      throw httpError(429, 'too_many_saves', 'This form has been saved a great many times. Ask whoever sent it for a fresh link.');
    }
  }
  return record;
}

/**
 * Everything this site needs on its host, base template included.
 *
 * The base template declares env of its own, and it was being left out: the
 * spec was built from `config.modules` alone. On a site with the CMS but no
 * booking module that meant RESEND_API_KEY and CONTACT_TO_EMAIL were never
 * asked for, so the settings panel reported nothing outstanding and the
 * client's contact form quietly filed enquiries in a table instead of emailing
 * them. Booking happened to redeclare the same two variables, which is why it
 * looked fine wherever bookings were switched on.
 */
function specForSite(account, site) {
  const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
  return specFor(
    [site.templateId, ...modules].filter(Boolean),
    (name) => getTemplate(account, name)?.manifest,
  );
}

function siteEnvFor(account, site) {
  const dbSite = connections.getSiteTarget(site.id, 'turso');
  const dbAcct = connections.get(account).turso;
  const dbToken = dbSite?.connected
    ? connections.revealSiteToken(site.id, 'turso')
    : (dbAcct.connected ? connections.reveal(account, 'turso') : null);
  return deployEnv({
    supplied: siteEnv.values(site.id),
    // The CMS fails closed without this, so a site published without one
    // arrives with its admin unusable: the one thing the client was promised
    // they could do themselves.
    adminPassword: siteEnv.adminPassword(site.id),
    databaseUrl: dbSite?.url || dbAcct.url,
    databaseToken: dbToken,
    siteUrl: siteUrlEnv(site.domain?.name)[SITE_URL_ENV],
  });
}

/**
 * Publish one assembled site to Vercel: token resolution, the review gate,
 * the connected database, the canonical-URL variable, and the custom domain.
 * Shared by the per-site route and Batch Building's publish-everything run so
 * a bulk publish is exactly the same operation, N times.
 */
async function publishSiteToVercel(account, siteId, { token: explicitToken = null, teamId = null, name = null } = {}) {
  const s = loadSite(siteId, account);
  assertReviewed(s);
  const dir = store.path('workspaces', s.id);
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw httpError(409, 'not_assembled', 'Build the site before publishing.');
  }
  const acct = connections.get(account).vercel;
  const token = explicitToken
    || connections.revealSiteToken(s.id, 'vercel')
    || (acct.connected ? connections.reveal(account, 'vercel') : null);
  if (!token) {
    throw httpError(422, 'no_target', 'Add a Vercel token to publish: either right here for this site, or once in Hosting as your default so every site reuses it. Get one at vercel.com/account/tokens.');
  }

  const env = siteEnvFor(account, s);

  const project = projectName(name || s.config.siteName);
  const result = await deployToVercel({ token, teamId, name: name || s.config.siteName, dir, env: Object.keys(env).length ? env : null });

  // Attach the custom domain to the project just deployed to. A failure here
  // never fails the publish: the site IS live on its Vercel URL, and the
  // domain is a separate, retryable step.
  let domain = null;
  if (s.domain?.name) {
    const fresh = loadSite(siteId, account);
    try {
      await attachVercel({ token, teamId, project, domain: fresh.domain.name });
      if (fresh.domain.addWww) {
        try { await attachVercel({ token, teamId, project, domain: `www.${fresh.domain.name}` }); } catch { /* www is best effort */ }
      }
      const state = await checkVercel({ token, teamId, project, domain: fresh.domain.name });
      fresh.domain = { ...fresh.domain, attachedTo: 'vercel', project, state: state.state, message: state.message, records: state.records, checkedAt: new Date().toISOString() };
      domain = { name: fresh.domain.name, state: state.state, message: state.message, records: state.records };
    } catch (e) {
      fresh.domain = { ...fresh.domain, attachedTo: 'vercel', project, state: 'error', message: e.message, checkedAt: new Date().toISOString() };
      domain = { name: fresh.domain.name, state: 'error', message: e.message, records: [] };
    }
    store.writeJson(`sites/${fresh.id}.json`, fresh);
  }

  const dbNote = result.envWired ? 'Database connected and wired in automatically. ' : '';
  return {
    deployed: true, target: 'vercel', ...result, domain,
    note: dbNote + (result.readyState === 'READY'
      ? 'Your site is live on Vercel.'
      : 'Uploaded to Vercel and building now. The URL goes live the moment the build finishes (usually a minute or two).'),
  };
}

/**
 * A site's domain, plus what the operator has to DO about it. `manageable`
 * says whether Stardrive holds a token for this site's host: when it does,
 * the DNS rows are the host's own answer and the state was really checked;
 * when it doesn't, the rows are the SHAPE to fill in with values the host
 * supplies, and we say so rather than inventing an IP.
 */
function domainView(site, account) {
  if (!site.domain?.name) return { domain: null, siteUrlEnv: SITE_URL_ENV };
  const hasVercel = Boolean(
    connections.getSiteTarget(site.id, 'vercel')?.connected || connections.get(account).vercel.connected
  );
  return {
    domain: {
      name: site.domain.name,
      addWww: site.domain.addWww !== false,
      attachedTo: site.domain.attachedTo ?? null,
      state: site.domain.state ?? 'pending',
      message: site.domain.message ?? '',
      checkedAt: site.domain.checkedAt ?? null,
    },
    manageable: hasVercel,
    records: dnsPlanFor({
      name: site.domain.name,
      addWww: site.domain.addWww !== false,
      hostRecords: site.domain.records,
    }),
    siteUrlEnv: SITE_URL_ENV,
    siteUrlValue: `https://${site.domain.name}`,
  };
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

/**
 * The operator's own door. Deliberately NOT an API-key scope: keys belong to
 * licensees, and no licensee should ever read the queue, the disk, or another
 * tenant's error paths. Compared in constant time so the token cannot be
 * guessed a byte at a time.
 */
function requireOpsToken(req) {
  const want = process.env.STARDRIVE_OPS_TOKEN || '';
  if (!want) {
    throw httpError(501, 'ops_unconfigured',
      'Operator telemetry is off. Set STARDRIVE_OPS_TOKEN, then read GET /v1/ops with Authorization: Bearer <token>.');
  }
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw httpError(401, 'unauthenticated', 'A valid operator token is required.');
  }
}

// ── Routes ───────────────────────────────────────────────────────────────
// scope: 'public' (no key), 'any' (any valid key), or a named key scope.

const ROUTES = [
  {
    method: 'GET', pattern: '/v1/health', scope: 'public',
    handler: () => {
      const s = studioConfig();
      const b = jobs.stats();
      return {
        status: 200,
        body: {
          // `ok` means "the process is answering", and nothing more. The image
          // HEALTHCHECK reads it, so letting a full disk flip it false would
          // restart-loop the container over a condition a restart cannot fix.
          // `degraded` is the honest signal; GET /v1/ops says why.
          ok: true, service: 'stardrive-api', version: VERSION, engine: ENGINE,
          qa: ENGINE === 'real' ? (process.env.STARDRIVE_QA === 'full' ? 'full' : 'structural') : 'dry',
          studio: { enabled: s.configured, model: s.configured ? s.model : null, copyModel: s.configured ? copyModel() : null },
          degraded: ops.degraded(),
          // Build load, so a backed-up queue is visible from outside instead
          // of only showing up as customers wondering why nothing finished.
          // Coarse on purpose: this endpoint is public, and free disk is the
          // operator's business, not the internet's.
          builds: { concurrency: b.concurrency, active: b.active, queued: b.queued, accountsWaiting: b.accountsWaiting },
        },
      };
    },
  },

  // Operator telemetry. Not an API-key scope: a licensee key must never read
  // this, and the operator has no account. It is DORMANT until
  // STARDRIVE_OPS_TOKEN is set, and says so rather than pretending.
  {
    method: 'GET', pattern: '/v1/ops', scope: 'public',
    handler: ({ req }) => {
      requireOpsToken(req);
      return { status: 200, body: ops.snapshot() };
    },
  },
  {
    // Alerting nobody has ever seen work is not alerting. One button proves
    // the whole path: provider key, sender identity, recipient.
    method: 'POST', pattern: '/v1/ops/test-alert', scope: 'public',
    handler: async ({ req }) => {
      requireOpsToken(req);
      const result = await ops.testAlert();
      return { status: 200, body: { ...result, configured: ops.configured() } };
    },
  },
  {
    // Run the watchdog on demand, so an operator can see what it currently
    // makes of the deployment without waiting out the sample interval.
    method: 'POST', pattern: '/v1/ops/check', scope: 'public',
    handler: async ({ req }) => {
      requireOpsToken(req);
      return { status: 200, body: { checked: await ops.checkNow(), alerts: ops.activeAlerts() } };
    },
  },
  {
    // Going live, explained where the licensee is working. Served from the
    // same definitions the deploy path uses, so it cannot drift from what the
    // product actually does. `any` rather than public: it names our hosts and
    // our defaults, and it is for customers, not passers-by.
    method: 'GET', pattern: '/v1/guide/deploy', scope: 'any',
    handler: () => ({ status: 200, body: deployGuide() }),
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
    handler: ({ body, req, url }) => {
      // Signing up is free and unauthenticated, and every generation spends
      // the operator's real model budget, so the front door gets both a
      // per-address throttle and (when we can actually send mail) a confirmed
      // address before any of that budget can be touched.
      const ip = clientIp(req);
      if (throttleExceeded('signup', ip, SIGNUP_PER_HOUR)) {
        throw httpError(429, 'rate_limited', 'Too many accounts created from this address — try again in an hour.');
      }
      const { account, verifyToken } = accounts.signup(body || {}, { requireVerification: email.configured() });
      throttleRecord('signup', ip); // charged only for an account that got created
      const { record, secret } = mintKey(store, { name: 'Default key', scopes: SCOPES, account: account.id });
      const token = accounts.createSession(account.id);
      // Fire-and-forget; both are no-ops until email is configured.
      if (verifyToken) email.verify(account, `${url.origin}/auth/verify?token=${verifyToken}`);
      else email.welcome(account);
      return { status: 201, cookies: [sessionCookie(token)], body: { account, apiKey: { ...record, secret } } };
    },
  },
  {
    // The link from the confirmation email. A browser lands here, so it
    // redirects into the Console rather than answering JSON at a person.
    method: 'GET', pattern: '/auth/verify', scope: 'public',
    handler: ({ url }) => {
      const ok = accounts.verifyEmail(url.searchParams.get('token'));
      return { redirect: `/workbench/#/home?verified=${ok ? '1' : '0'}` };
    },
  },
  {
    method: 'POST', pattern: '/auth/resend-verification', scope: 'session',
    handler: ({ account, req, url }) => {
      if (!ipThrottle('verify-resend', clientIp(req), 5)) {
        throw httpError(429, 'rate_limited', 'Too many emails requested — try again in an hour.');
      }
      const reissued = accounts.reissueVerification(account.id);
      if (!reissued) return { status: 200, body: { sent: false, alreadyVerified: true } };
      email.verify(reissued.account, `${url.origin}/auth/verify?token=${reissued.verifyToken}`);
      return { status: 200, body: { sent: true, to: reissued.account.email } };
    },
  },
  {
    /**
     * Ask for a reset link.
     *
     * Always answers the same, whether or not the address has an account.
     * Anything else turns this into a way to test which addresses are
     * registered, and it is a public endpoint by necessity: the person using
     * it cannot log in.
     */
    method: 'POST', pattern: '/auth/forgot-password', scope: 'public', bodyLimit: 4_000,
    handler: ({ body, req, url }) => {
      const same = {
        status: 200,
        body: {
          sent: true,
          message: 'If that address has a Stardrive account, a reset link is on its way. It expires in an hour.',
        },
      };
      if (!ipThrottle('forgot', clientIp(req), 5)) {
        throw httpError(429, 'rate_limited', 'Too many reset requests from this address — try again in an hour.');
      }

      // Decided by the DEPLOYMENT, before any lookup. Checking this after
      // finding the account would make the two answers differ for a known
      // address and a stranger, which is the exact leak this endpoint is
      // shaped to avoid.
      if (!email.configured()) {
        console.error('[stardrive-api] a password reset was requested but no email provider is configured');
        return {
          status: 200,
          body: {
            sent: false,
            message: 'Password reset by email is not switched on for this deployment. Contact whoever runs it and they can reset it for you.',
          },
        };
      }

      const requested = accounts.requestPasswordReset(body?.email);
      if (requested) {
        email.passwordReset(requested.account, `${url.origin}/workbench/#/reset?token=${requested.token}`);
      }
      return same; // identical whether or not that address has an account
    },
  },
  {
    // Complete the reset. The token is the whole authorisation, so it is
    // checked here and nothing else about the caller matters.
    method: 'POST', pattern: '/auth/reset-password', scope: 'public', bodyLimit: 4_000,
    handler: ({ body, req }) => {
      if (!ipThrottle('reset', clientIp(req), 10)) {
        throw httpError(429, 'rate_limited', 'Too many attempts from this address — try again in an hour.');
      }
      const account = accounts.resetPassword(body?.token, body?.password);
      if (!account) {
        throw httpError(400, 'bad_token', 'That reset link is not valid any more. It may have been used already, or it may have expired. Ask for a new one.');
      }
      // Signed straight in: they have just proved control of the inbox, and
      // making them retype the password they set five seconds ago is friction
      // for no security.
      const token = accounts.createSession(account.id);
      return { status: 200, cookies: [sessionCookie(token)], body: { account } };
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
    // Everything Stardrive holds about this account, in one file. The privacy
    // policy promises it, and an account that cannot leave is not really the
    // licensee's own. Secrets are deliberately NOT included: key secrets are
    // stored only as hashes and hosting tokens only encrypted, so exporting
    // them is impossible by design and would be wrong anyway.
    method: 'GET', pattern: '/v1/account/export', scope: 'session',
    handler: ({ account }) => {
      const mine = (dir) => store.listIds(dir).map((id) => store.readJson(`${dir}/${id}.json`)).filter((r) => r && r.account === account.id);
      const sites = mine('sites');
      return {
        status: 200,
        body: {
          exportedAt: new Date().toISOString(),
          account: accounts.getAccount(account.id),
          apiKeys: listKeys(store, account.id), // metadata only; secrets are unrecoverable
          hosting: connections.get(account.id), // masked: which providers, last4, when
          templates: imported.list(account.id).map((t) => ({ name: t.manifest.name, importedAt: t.record.importedAt, manifest: t.manifest })),
          sites: sites.map((s) => ({
            id: s.id, templateId: s.templateId, config: s.config, content: s.content,
            copy: s.copy, domain: s.domain ?? null, createdAt: s.createdAt, updatedAt: s.updatedAt,
          })),
          batches: batches.list(account.id),
          drafts: { batch: batches.draftView(account.id).rows, studio: store.readJson(`studio/draft/${account.id}.json`) },
          note: 'Your built sites are downloadable individually as standalone projects: GET /v1/sites/{id}/export.',
        },
      };
    },
  },
  {
    // Close the account and remove everything belonging to it. The password is
    // required because a session alone should not be able to destroy a
    // business's whole library.
    method: 'DELETE', pattern: '/v1/account', scope: 'session', bodyLimit: 10_000,
    handler: ({ account, body }) => {
      const full = accounts.getAccount(account.id);
      if (!accounts.login({ email: full.email, password: String(body?.password ?? '') })) {
        throw httpError(403, 'bad_credentials', 'Enter your password to close the account.');
      }
      if (String(body?.confirm ?? '').trim().toLowerCase() !== full.email.toLowerCase()) {
        throw httpError(400, 'confirm_required', 'Type the account email to confirm. This deletes every template, site, and key you own, and cannot be undone.');
      }
      const removed = accounts.purge(account.id, { purgeSite });
      return { status: 200, cookies: [clearCookie()], body: { deleted: true, ...removed } };
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
    handler: ({ params, key, url }) => {
      const entry = getTemplate(key.account, params.name);
      if (!entry) throw httpError(404, 'not_found', `Template "${params.name}" not found.`);
      // ?include=files returns the stored bundle, which is what lets a
      // template be reopened in the Studio and refined instead of being
      // frozen the moment it is imported. Own templates only: the bundled
      // catalog is shared, first-party, and not the licensee's to edit.
      let files;
      if (url?.searchParams.get('include') === 'files') {
        if (!entry.record) {
          throw httpError(403, 'not_editable', `"${params.name}" is a first-party catalog template, so its files are not editable. Build a site from it, or design your own in the Studio.`);
        }
        files = entry.record.bundle.files;
      }
      return {
        status: 200,
        body: {
          source: entry.source,
          manifest: entry.manifest,
          ...(files ? { files } : {}),
          ...(entry.record ? { importedAt: entry.record.importedAt, warnings: entry.record.warnings } : {}),
        },
      };
    },
  },
  {
    // The design's own screenshot, so a library of generated templates is
    // recognisable instead of a list of slugs. Captured during assembly by
    // the full QA tier; absent (404) when that tier is off.
    method: 'GET', pattern: '/v1/templates/:name/thumbnail', scope: 'templates',
    handler: ({ params, key }) => {
      const abs = thumbnailPath(key.account, params.name);
      if (!abs || !fs.existsSync(abs)) {
        throw httpError(404, 'no_thumbnail', 'No preview image for this template yet. Previews are captured by the full QA tier (STARDRIVE_QA=full) when a site is built from it.');
      }
      return { raw: true, status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }, buffer: fsReadFile(abs) };
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
      // Auto-repair the deterministic, mechanical mistakes an LLM generator
      // makes so a good generation isn't bounced: normalize the manifest
      // metadata, and repair the source files (contrast tokens, client/server
      // component boundaries). Genuinely broken bundles still reject honestly.
      let bundle = body;
      let autofixes = [];
      if (body && typeof body === 'object') {
        const mf = autofixManifest(body.manifest);
        const repaired = Array.isArray(body.files) ? autofixTemplateFiles(body.files) : { files: body.files, fixes: [] };
        bundle = { ...body, manifest: mf.manifest, files: repaired.files };
        autofixes = [...mf.fixes.map((f) => `manifest: ${f}`), ...repaired.fixes];
      }
      const v = validateBundle(bundle);
      if (!v.ok) {
        return { status: 422, body: { error: { code: 'invalid_bundle', message: 'Template bundle rejected.' }, errors: v.errors, warnings: [...autofixes, ...v.warnings] } };
      }
      if (catalog.has(bundle.manifest.name)) {
        throw httpError(409, 'name_conflict', `"${bundle.manifest.name}" is a first-party catalog name — imported templates cannot shadow the bundled catalog.`);
      }
      const warnings = [...autofixes, ...v.warnings];
      const { name, existed } = imported.put(key.account, bundle, warnings);
      return { status: existed ? 200 : 201, body: { name, source: 'imported', warnings } };
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
      // A Studio design demo is a throwaway: flagged so it stays out of the
      // client roster, and superseding the last one so previews (each with a
      // full workspace) cannot pile up.
      const isPreview = body.preview === true;
      if (isPreview) reapPreviewSites(key.account);
      const site = {
        id: crypto.randomUUID(),
        account: key.account,
        templateId: body.templateId,
        config,
        parse,
        content: {}, // the customer's factual intake (see lib/content.mjs)
        copy: null,  // the finished copy pack the AI writes from those facts
        ...(isPreview ? { preview: true } : {}),
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
      const job = enqueueAssemble(site.id, key.account);
      site.jobs.push(job.id);
      store.writeJson(`sites/${site.id}.json`, site);
      return { status: 202, body: { siteId: site.id, jobId: job.id, status: job.status } };
    },
  },
  {
    method: 'GET', pattern: '/v1/sites', scope: 'sites',
    handler: ({ key, url }) => ({
      status: 200,
      body: {
        sites: store.listIds('sites')
          .map((id) => store.readJson(`sites/${id}.json`))
          // The Sites list is the licensee's CLIENT roster. Throwaway Studio
          // design demos are real sites technically, but they do not belong
          // in it; ?include=previews opts back in.
          .filter((s) => s && s.account === key.account
            && (!s.preview || url?.searchParams.get('include') === 'previews'))
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .map((s) => {
            const last = s.jobs.length ? jobs.get(s.jobs[s.jobs.length - 1]) : null;
            // How far along each site is, so the console can say where a job
            // stands without a request per site. Only the supplied bag is read
            // here: the spec knows which variables are the client's to give, so
            // no hosting token has to be decrypted to count what is missing.
            const spec = specForSite(key.account, s);
            return {
              id: s.id,
              siteName: s.config?.siteName ?? '(unnamed)',
              templateId: s.templateId,
              updatedAt: s.updatedAt,
              lastJobStatus: last?.status ?? null,
              built: s.jobs.some((id) => jobs.get(id)?.status === 'done'),
              settingsOutstanding: missingFrom(spec, siteEnv.values(s.id)).length,
              publishedUrl: s.deploy?.url ?? null,
              domain: s.domain?.name ?? null,
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
      const job = enqueueAssemble(site.id, key.account);
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
      return { status: 200, body: { slots: assets.slotsFor(entry?.manifest, site.config.modules), assets: assets.state(site.id) } };
    },
  },
  {
    method: 'POST', pattern: '/v1/sites/:id/assets/:slot', scope: 'sites', meter: 'assets.upload', bodyLimit: 16_000_000,
    handler: ({ params, body, key }) => {
      const site = loadSite(params.id, key.account);
      const entry = getTemplate(key.account, site.templateId);
      const slotDef = assets.slotsFor(entry?.manifest, site.config.modules).find((s) => s.id === String(params.slot));
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
    // The intake SCHEMA for a hypothetical site: which questions a build with
    // these features would have to answer. Same source of truth the per-site
    // intake uses, so Batch Building can ask exactly what Sites asks before
    // any site exists. ?features=blog,careers (Studio ids) or ?modules=d4-…
    method: 'GET', pattern: '/v1/content/fields', scope: 'sites',
    handler: ({ url }) => {
      const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
      const features = csv(url.searchParams.get('features'));
      const modules = csv(url.searchParams.get('modules'));
      const resolved = modules.length ? modules : modulesForFeatures(features);
      return { status: 200, body: { groups: GROUP_LABELS, modules: resolved, fields: requirementsFor(resolved) } };
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
      gateModelSpend(account);
      const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
      const result = await generateCopy({ siteName: site.config.siteName, facts: site.content || {}, modules });
      site.copy = result.pack;
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      if (result.tokens) { try { auth.meter(key.id, 'studio.tokens', result.tokens); } catch { /* metering best-effort */ } }
      return { status: 200, body: { copy: result.pack, source: result.source } };
    },
  },
  // ── Client intake links ────────────────────────────────────────────────
  // The licensee mints a link, the CLIENT fills in their own facts and uploads
  // their own photos, the licensee adopts the result onto the site. See
  // lib/intake-links.mjs for why the token is stored only as a hash.
  {
    method: 'POST', pattern: '/v1/sites/:id/intake-link', scope: 'sites', bodyLimit: 4_000,
    handler: ({ params, body, key, url }) => {
      const site = loadSite(params.id, key.account);
      // One live link per site: minting a second revokes the first, so an old
      // email cannot still be filled in after the client has been re-sent it.
      for (const old of intakeLinks.listFor(key.account, { siteId: site.id })) {
        if (old.status === 'open') intakeLinks.revoke(old);
      }
      const { record, token } = intakeLinks.create({
        account: key.account,
        siteId: site.id,
        siteName: site.config?.siteName || 'your website',
        modules: Array.isArray(site.config?.modules) ? site.config.modules : [],
        note: body?.note,
        ttlDays: Number(body?.ttlDays) || undefined,
      });
      return {
        status: 201,
        body: {
          link: intakeLinks.summary(record),
          // The only time the token exists outside the URL. Not recoverable.
          url: `${url.origin}/intake/${token}`,
          note: 'Send this to your client. It is shown once: mint a new one if it is lost, which revokes this.',
        },
      };
    },
  },
  {
    method: 'GET', pattern: '/v1/intake-links', scope: 'sites',
    handler: ({ key, url }) => ({
      status: 200,
      body: {
        links: intakeLinks
          .listFor(key.account, { siteId: url.searchParams.get('site') || null })
          .map((r) => intakeLinks.summary(r)),
      },
    }),
  },
  {
    // What the client typed, for the licensee to read before adopting it.
    method: 'GET', pattern: '/v1/intake-links/:id', scope: 'sites',
    handler: ({ params, key }) => {
      const record = intakeLinks.get(String(params.id));
      if (!record || record.account !== key.account) throw httpError(404, 'not_found', 'No such intake link.');
      return {
        status: 200,
        body: {
          link: intakeLinks.summary(record),
          groups: GROUP_LABELS,
          fields: requirementsFor(record.modules),
          facts: record.facts || {},
          photos: assets.state(intakeAssetId(record.id)),
        },
      };
    },
  },
  {
    // Merge the client's answers (and photos) onto the site.
    method: 'POST', pattern: '/v1/intake-links/:id/adopt', scope: 'sites', meter: 'sites.change',
    handler: ({ params, key }) => {
      const record = intakeLinks.get(String(params.id));
      if (!record || record.account !== key.account) throw httpError(404, 'not_found', 'No such intake link.');
      const site = loadSite(record.siteId, key.account);
      const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
      // The licensee's own answers win: they may have corrected something the
      // client got wrong, and adopting must not silently undo that.
      const merged = { ...(record.facts || {}), ...(site.content || {}) };
      const v = validateFacts(merged, modules);
      if (!v.ok) throw httpError(422, 'invalid_facts', v.errors.join(' '));
      site.content = merged;
      site.copy = null; // facts changed — any written copy is stale
      site.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${site.id}.json`, site);
      const photos = assets.adopt(intakeAssetId(record.id), site.id);
      intakeLinks.markAdopted(record);
      return { status: 200, body: { adopted: true, photos, readiness: siteReadiness(site) } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/intake-links/:id', scope: 'sites',
    handler: ({ params, key }) => {
      const record = intakeLinks.get(String(params.id));
      if (!record || record.account !== key.account) throw httpError(404, 'not_found', 'No such intake link.');
      intakeLinks.revoke(record);
      assets.discard(intakeAssetId(record.id));
      return { status: 200, body: { revoked: record.id } };
    },
  },

  // ── The client's side (no account, no key) ─────────────────────────────
  // Every one of these is throttled per address: out here the token is the
  // only credential, and there is no key to rate-limit on.
  {
    method: 'GET', pattern: '/v1/public/intake/:token', scope: 'public',
    handler: ({ params, req }) => {
      const record = openIntake(params.token, req, { write: false });
      return {
        status: 200,
        body: {
          siteName: record.siteName,
          studio: studioNameFor(record.account),
          note: record.note,
          groups: GROUP_LABELS,
          // Worded for the client, not the licensee: see clientRequirementsFor.
          fields: clientRequirementsFor(record.modules),
          facts: record.facts || {},
          photoSlots: clientPhotoSlots(record),
          photos: assets.state(intakeAssetId(record.id)),
          submitted: record.status === 'submitted',
          // Adopted means the designer has the answers and every save from
          // here would be refused. Say so, rather than handing the client a
          // form that rejects everything they type into it.
          closed: record.status === 'adopted',
          readiness: readiness(record.facts || {}, record.modules),
        },
      };
    },
  },
  {
    // POST is the same save as PATCH, and exists for one reason: navigator
    // .sendBeacon can only POST, and it is what carries the last few seconds
    // of a client's typing when they close the tab mid-sentence.
    method: 'POST', pattern: '/v1/public/intake/:token', scope: 'public', bodyLimit: 200_000,
    handler: (ctx) => saveClientFacts(ctx),
  },
  {
    method: 'PATCH', pattern: '/v1/public/intake/:token', scope: 'public', bodyLimit: 200_000,
    handler: (ctx) => saveClientFacts(ctx),
  },
  {
    // The client's own pictures, so the form can show what they have uploaded.
    // Scoped to their link: the token is the only way in, and it reaches
    // nothing but its own bucket.
    method: 'GET', pattern: '/v1/public/intake/:token/photos/:slot/:assetId', scope: 'public',
    handler: ({ params, req }) => {
      const record = openIntake(params.token, req, { write: false });
      const hit = assets.find(intakeAssetId(record.id), String(params.slot), assertUuid(params.assetId, 'photo id'));
      if (!hit) throw httpError(404, 'not_found', 'That picture is not here.');
      return { raw: true, status: 200, headers: { 'Content-Type': hit.meta.type, 'Cache-Control': 'no-cache' }, buffer: fsReadFile(hit.abs) };
    },
  },
  {
    method: 'POST', pattern: '/v1/public/intake/:token/photos/:slot', scope: 'public', bodyLimit: 16_000_000,
    handler: ({ params, body, req }) => {
      const record = openIntake(params.token, req, { write: true });
      const slotDef = clientPhotoSlots(record).find((s) => s.id === String(params.slot));
      if (!slotDef) throw httpError(422, 'unknown_slot', 'That is not a picture this site asks for.');
      if (typeof body?.filename !== 'string' || !body.filename.trim() || typeof body?.contentBase64 !== 'string') {
        throw httpError(400, 'bad_request', 'Body must be { filename, contentBase64 }.');
      }
      const buffer = Buffer.from(body.contentBase64, 'base64');
      if (buffer.length > MAX_ASSET_BYTES) throw httpError(422, 'too_large', `Files must be at most ${Math.round(MAX_ASSET_BYTES / 1e6)} MB.`);
      const meta = assets.add(intakeAssetId(record.id), slotDef, body.filename.trim(), buffer);
      return { status: 201, body: { slot: slotDef.id, asset: { id: meta.id, filename: meta.filename } } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/public/intake/:token/photos/:slot/:assetId', scope: 'public',
    handler: ({ params, req }) => {
      const record = openIntake(params.token, req, { write: true });
      const removed = assets.remove(intakeAssetId(record.id), String(params.slot), assertUuid(params.assetId, 'photo id'));
      if (!removed) throw httpError(404, 'not_found', 'That picture is not here.');
      return { status: 200, body: { deleted: params.assetId } };
    },
  },
  {
    method: 'POST', pattern: '/v1/public/intake/:token/submit', scope: 'public', bodyLimit: 1_000,
    handler: ({ params, req }) => {
      const record = openIntake(params.token, req, { write: true });
      const state = readiness(record.facts || {}, record.modules);
      if (!state.ready) {
        throw httpError(422, 'incomplete', `A few answers are still needed: ${state.missing.map((m) => m.label).join(', ')}.`);
      }
      intakeLinks.markSubmitted(record);
      email.intakeSubmitted?.(accounts.getAccount(record.account), record);
      return { status: 200, body: { submitted: true } };
    },
  },
  {
    // Re-open a submitted form: a client who spots a typo should not have to
    // ask their designer to unlock anything.
    method: 'POST', pattern: '/v1/public/intake/:token/reopen', scope: 'public', bodyLimit: 1_000,
    handler: ({ params, req }) => {
      const record = openIntake(params.token, req, { write: false });
      if (record.status === 'adopted') {
        throw httpError(409, 'already_adopted', 'Your designer has already picked these answers up. Send them any changes directly.');
      }
      record.status = 'open';
      record.submittedAt = null;
      store.writeJson(`intake-links/${record.id}.json`, record);
      return { status: 200, body: { reopened: true } };
    },
  },
  {
    // Re-run assembly with the current config + latest assets. GATED: a site
    // that has not answered its required content cannot build (pass force:true
    // to bypass for headless/programmatic callers).
    method: 'POST', pattern: '/v1/sites/:id/assemble', scope: 'sites', meter: 'sites.assemble',
    handler: async ({ params, body, key }) => {
      const site = loadSite(params.id, key.account);
      const ready = siteReadiness(site);
      if (!ready.ready && body?.force !== true) {
        throw httpError(422, 'content_incomplete',
          `This site is not ready to ship — answer the required questions first (missing: ${ready.missing.map((m) => m.label).join(', ')}). The build is deliberately gated so nothing goes out half-finished.`);
      }
      // Auto-write the copy from the answers if the operator skipped the
      // preview step, so a build is never thin just because they didn't press
      // "Write the copy". Same quota gate as the Studio.
      if (ready.ready && !site.copy) {
        const account = accounts.getAccount(key.account) || { id: key.account, plan: 'beta' };
        gateModelSpend(account);
        const modules = Array.isArray(site.config?.modules) ? site.config.modules : [];
        const result = await generateCopy({ siteName: site.config.siteName, facts: site.content || {}, modules });
        site.copy = result.pack;
        if (result.tokens) { try { auth.meter(key.id, 'studio.tokens', result.tokens); } catch { /* best-effort */ } }
      }
      const job = enqueueAssemble(site.id, key.account);
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
      assertReviewed(s);
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
      // Stardrive has no credentials for wherever this repo gets hosted, so
      // it hands over the one variable the site itself needs rather than
      // pretending to configure a host it cannot see.
      const domainNote = s.domain?.name
        ? ` This site has the domain ${s.domain.name}: point it at your host's DNS targets and set ${SITE_URL_ENV}=https://${s.domain.name} there, or robots.txt and sitemap.xml will keep advertising the wrong address.`
        : '';
      return {
        status: 200,
        body: { deployed: true, target: 'github', ...result,
          ...(s.domain?.name ? { domain: { name: s.domain.name, env: { [SITE_URL_ENV]: `https://${s.domain.name}` } } } : {}),
          note: 'Pushed the site to GitHub. Link the repo to Vercel (or your host) and it builds on every push.' + domainNote },
      };
    },
  },
  {
    // The site's saved deploy targets (masked) for BOTH providers, plus the
    // account defaults — so an agency that hosts every client on its own
    // Vercel/GitHub sets those once and never re-enters them per site.
    method: 'GET', pattern: '/v1/sites/:id/deploy-target', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const conns = connections.get(key.account);
      const gh = conns.github; const vc = conns.vercel;
      return {
        status: 200,
        body: {
          // Back-compat: `site`/`accountDefault` remain the GitHub view.
          site: connections.getSiteTarget(s.id, 'github'),
          accountDefault: gh.connected ? { owner: gh.owner, last4: gh.last4 } : null,
          github: {
            site: connections.getSiteTarget(s.id, 'github'),
            accountDefault: gh.connected ? { owner: gh.owner, last4: gh.last4 } : null,
          },
          vercel: {
            site: connections.getSiteTarget(s.id, 'vercel'),
            accountDefault: vc.connected ? { last4: vc.last4 } : null,
          },
        },
      };
    },
  },

  // ── Site settings (environment) ────────────────────────────────────────
  {
    // What this site needs on its host, split by who is responsible. Values
    // are never returned: only whether each one is set.
    method: 'GET', pattern: '/v1/sites/:id/env', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const spec = specForSite(key.account, s);
      const stored = siteEnv.values(s.id);
      return {
        status: 200,
        body: {
          spec,
          set: siteEnv.masked(s.id),
          // What still needs an answer before the site works properly once
          // live. Named plainly, with the consequence attached.
          missing: missingFrom(spec, stored),
        },
      };
    },
  },
  {
    // Store the keys only the licensee has. Send { RESEND_API_KEY: "..." };
    // an empty string clears one.
    method: 'PUT', pattern: '/v1/sites/:id/env', scope: 'deploy', bodyLimit: 20_000,
    handler: ({ params, body, key }) => {
      const s = loadSite(params.id, key.account);
      const values = body?.values && typeof body.values === 'object' ? body.values : body;
      if (!values || typeof values !== 'object') {
        throw httpError(400, 'bad_request', 'Send an object of variable names to values.');
      }
      const allowed = new Set(Object.keys(SUPPLIED));
      const saved = [];
      for (const [name, value] of Object.entries(values)) {
        // Only the licensee-supplied names. Letting arbitrary names through
        // would let a caller overwrite ADMIN_PASSWORD or the database URL.
        if (!allowed.has(name)) continue;
        siteEnv.setVar(s.id, name, value);
        saved.push(name);
      }
      if (!saved.length) throw httpError(400, 'bad_request', `Nothing to save. Settable: ${[...allowed].join(', ')}.`);
      return { status: 200, body: { saved, set: siteEnv.masked(s.id) } };
    },
  },
  {
    // The whole environment as a .env file, for a host Stardrive cannot write
    // to directly. This DOES contain live secrets, which is why it is a
    // deliberate, scoped download rather than part of any listing.
    method: 'GET', pattern: '/v1/sites/:id/env/file', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const env = siteEnvFor(key.account, s);
      const body = renderEnvFile(env, s.config?.siteName || s.name || 'this site');
      return {
        status: 200,
        raw: true,
        buffer: Buffer.from(body, 'utf-8'),
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${slugify(s.config?.siteName || 'site')}.env"`,
        },
      };
    },
  },
  {
    // The client handoff: a printable page with the sign-in details, what
    // this particular client can edit, and the honest gaps. Written for the
    // person who paid for the site, not for a developer.
    method: 'GET', pattern: '/v1/sites/:id/handoff', scope: 'deploy',
    handler: ({ params, key, url }) => {
      const s = loadSite(params.id, key.account);
      const modules = Array.isArray(s.config?.modules) ? s.config.modules : [];
      const env = siteEnvFor(key.account, s);
      const spec = specForSite(key.account, s);

      // The live address, in the order it becomes true: a custom domain, then
      // wherever it was last published, then nothing worth promising.
      const live = s.domain?.name
        ? `https://${s.domain.name}`
        : (s.deploy?.url ? (s.deploy.url.startsWith('http') ? s.deploy.url : `https://${s.deploy.url}`) : null);

      const account = accounts.getAccount(key.account);
      const html = renderHandoffHtml({
        siteName: s.config?.siteName || s.name || 'Your website',
        siteUrl: live || '(not published yet)',
        adminUrl: live ? `${live}/admin` : '(available once the site is published)',
        password: env.ADMIN_PASSWORD,
        guide: guideFor(modules),
        notes: notesFor({
          modules,
          missingEnv: missingFrom(spec, env),
          domain: s.domain?.name || null,
          hasEmail: Boolean(env.RESEND_API_KEY && env.CONTACT_TO_EMAIL),
        }),
        preparedBy: account?.company || null,
        supportEmail: account?.email || null,
      });

      // ?download=1 saves it; otherwise it opens in the tab for a read-through
      // before the licensee sends it on.
      const download = url?.searchParams?.get('download') === '1';
      return {
        status: 200,
        raw: true,
        buffer: Buffer.from(html, 'utf-8'),
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...(download
            ? { 'Content-Disposition': `attachment; filename="${slugify(s.config?.siteName || 'site')}-handoff.html"` }
            : {}),
        },
      };
    },
  },
  {
    // A new admin password, for handover or after a leak. Returned once.
    method: 'POST', pattern: '/v1/sites/:id/env/rotate-admin', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const password = siteEnv.rotateAdminPassword(s.id);
      return {
        status: 200,
        body: {
          password,
          note: 'Publish again to put this live. Until you do, the old password still works on the deployed site.',
        },
      };
    },
  },
  {
    // The site's connected database (masked): a libSQL-compatible endpoint
    // (Turso is the recommended hosted provider, but any libsql://, https://,
    // or self-hosted endpoint works — this is vendor-neutral, not Turso-only).
    method: 'GET', pattern: '/v1/sites/:id/database', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      const acct = connections.get(key.account).turso;
      return {
        status: 200,
        body: {
          site: connections.getSiteTarget(s.id, 'turso'),
          accountDefault: acct.connected ? { url: acct.url || null, last4: acct.last4 } : null,
        },
      };
    },
  },
  {
    // Save this site's database connection (or, via /v1/connections/turso,
    // the account-wide default). Publishing to Vercel wires it in
    // automatically as project env vars, no manual copying required.
    method: 'POST', pattern: '/v1/sites/:id/database', scope: 'deploy', bodyLimit: 4_000,
    handler: ({ params, body, key }) => {
      const s = loadSite(params.id, key.account);
      const url = String(body?.url || '').trim();
      if (!url || !/^(libsql:|https:|file:)/.test(url)) {
        throw httpError(400, 'bad_request', 'url is required and must start with libsql://, https://, or file: (any libSQL-compatible endpoint).');
      }
      const authToken = String(body?.authToken ?? '').trim();
      if (authToken.length > 2000 || /\s/.test(authToken)) {
        throw httpError(400, 'bad_request', 'authToken must not contain whitespace (max 2000 chars).');
      }
      connections.setSiteTarget(s.id, { provider: 'turso', token: authToken, url });
      return { status: 200, body: { site: connections.getSiteTarget(s.id, 'turso') } };
    },
  },
  {
    // One-click publish to Vercel: upload the assembled site and get a live URL.
    // Resolution mirrors GitHub deploy: this request's token > this site's saved
    // Vercel token > the account default. Sending token with save:true stores it
    // (encrypted) as this site's target.
    method: 'POST', pattern: '/v1/sites/:id/deploy/vercel', scope: 'deploy', meter: 'sites.deploy',
    handler: async ({ params, body, key }) => {
      const s = loadSite(params.id, key.account);
      if (body?.save) connections.setSiteTarget(s.id, { provider: 'vercel', token: body?.token?.trim() || undefined });
      const result = await publishSiteToVercel(key.account, s.id, {
        token: typeof body?.token === 'string' && body.token.trim() ? body.token.trim() : null,
        teamId: typeof body?.teamId === 'string' && body.teamId.trim() ? body.teamId.trim() : null,
        name: body?.name,
      });
      return { status: 200, body: result };
    },
  },
  {
    // Publish to Netlify. Same site, same environment, different host: the
    // point of the product is that the licensee picks, not us.
    method: 'POST', pattern: '/v1/sites/:id/deploy/netlify', scope: 'deploy', meter: 'sites.deploy',
    handler: async ({ params, body, key }) => {
      const s = loadSite(params.id, key.account);
      assertReviewed(s);
      const dir = store.path('workspaces', s.id);
      if (!fs.existsSync(path.join(dir, 'package.json'))) {
        throw httpError(409, 'not_assembled', 'Build the site before publishing.');
      }
      const explicit = typeof body?.token === 'string' && body.token.trim() ? body.token.trim() : null;
      if (body?.save && explicit) connections.setSiteTarget(s.id, { provider: 'netlify', token: explicit });
      const acct = connections.get(key.account).netlify;
      const token = explicit
        || connections.revealSiteToken(s.id, 'netlify')
        || (acct.connected ? connections.reveal(key.account, 'netlify') : null);
      if (!token) {
        throw httpError(422, 'no_target', 'Add a Netlify personal access token to publish there: either right here for this site, or once in Hosting as your default. Get one at app.netlify.com/user/applications.');
      }

      const result = await deployToNetlify({
        token,
        name: body?.name || s.config?.siteName || s.name,
        dir,
        accountSlug: typeof body?.accountSlug === 'string' && body.accountSlug.trim() ? body.accountSlug.trim() : null,
        env: siteEnvFor(key.account, s),
      });

      if (s.domain?.name) {
        // Best effort, exactly as on Vercel: the site IS live, and the domain
        // is a separate retryable step rather than a reason to fail a publish.
        try { await attachNetlifyDomain({ token, siteId: result.siteId, domain: s.domain.name }); } catch { /* reported by the domain view */ }
      }

      const fresh = loadSite(params.id, key.account);
      fresh.deploy = { provider: 'netlify', url: result.url, at: new Date().toISOString() };
      store.writeJson(`sites/${fresh.id}.json`, fresh);
      return { status: 200, body: result };
    },
  },
  // ── Custom domain ───────────────────────────────────────────────────────
  // Recorded on the SITE as host-agnostic data. Where Stardrive holds a token
  // for the host (Vercel today) it attaches and verifies for real; everywhere
  // else it records the domain and shows what to set, without pretending to
  // have checked a host it cannot see.
  {
    method: 'GET', pattern: '/v1/sites/:id/domain', scope: 'sites',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      return { status: 200, body: domainView(s, key.account) };
    },
  },
  {
    method: 'PUT', pattern: '/v1/sites/:id/domain', scope: 'deploy', bodyLimit: 4_000,
    handler: ({ params, body, key }) => {
      const s = loadSite(params.id, key.account);
      const { name, addWww } = normalizeDomain(body?.name, { addWww: body?.addWww !== false });
      s.domain = {
        name, addWww,
        attachedTo: s.domain?.name === name ? s.domain.attachedTo ?? null : null,
        project: s.domain?.name === name ? s.domain.project ?? null : null,
        state: 'pending',
        message: 'Saved. Publish this site to attach it, or add the DNS records below at your registrar.',
        records: [],
        checkedAt: null,
      };
      s.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${s.id}.json`, s);
      return { status: 200, body: domainView(s, key.account) };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/sites/:id/domain', scope: 'deploy',
    handler: ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      // Stardrive forgets the domain; it never touches the registrar, and on
      // a host we hold a token for the operator detaches there if they want.
      delete s.domain;
      s.updatedAt = new Date().toISOString();
      store.writeJson(`sites/${s.id}.json`, s);
      return { status: 200, body: { removed: true, note: 'Stardrive no longer tracks a domain for this site. Any DNS records you added are still at your registrar.' } };
    },
  },
  {
    // Re-check. DNS is never instant, so this is explicitly re-runnable and
    // only ever reports what the host actually told us.
    method: 'POST', pattern: '/v1/sites/:id/domain/verify', scope: 'deploy',
    handler: async ({ params, key }) => {
      const s = loadSite(params.id, key.account);
      if (!s.domain?.name) throw httpError(409, 'no_domain', 'Set a domain for this site first.');
      const acct = connections.get(key.account).vercel;
      const token = connections.revealSiteToken(s.id, 'vercel') || (acct.connected ? connections.reveal(key.account, 'vercel') : null);
      if (!token) {
        throw httpError(422, 'no_target', 'Stardrive can only check a domain on a host it has a token for. This site has no Vercel token, so add the records your host gave you and check there.');
      }
      const project = s.domain.project || projectName(s.config.siteName);
      const state = await checkVercel({ token, project, domain: s.domain.name });
      s.domain = { ...s.domain, attachedTo: 'vercel', project, state: state.state, message: state.message, records: state.records, checkedAt: new Date().toISOString() };
      store.writeJson(`sites/${s.id}.json`, s);
      return { status: 200, body: domainView(s, key.account) };
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
    // Permanently delete a site: its record, workspace, uploaded assets, jobs,
    // saved deploy target, and any running preview. The caller confirms in the UI.
    method: 'DELETE', pattern: '/v1/sites/:id', scope: 'sites',
    handler: ({ params, key }) => {
      const site = loadSite(params.id, key.account);
      purgeSite(site);
      return { status: 200, body: { deleted: site.id } };
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
      const slug = slugify(s.config.siteName);
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
      const isDatabase = provider === 'turso'; // a generic libSQL connection; Turso is the recommended, not the only, provider
      const token = String(body?.token ?? '');
      if (token.length > 500 || /\s/.test(token)) {
        throw httpError(400, 'bad_request', 'token must not contain whitespace (max 500 chars).');
      }
      // Every other provider needs a real token; a database endpoint may need
      // none (self-hosted with no auth), so only its URL is required.
      if (!isDatabase && token.length < 8) {
        throw httpError(400, 'bad_request', 'token is required (8–500 chars, no whitespace).');
      }
      const owner = body?.owner != null ? String(body.owner) : undefined;
      if (provider === 'github' && owner !== undefined && !/^[a-zA-Z0-9-]{1,80}$/.test(owner)) {
        throw httpError(400, 'bad_request', 'owner must be a GitHub username/org slug.');
      }
      const url = body?.url != null ? String(body.url) : undefined;
      if (isDatabase && (!url || !/^(libsql:|https:|file:)/.test(url))) {
        throw httpError(400, 'bad_request', 'url is required for the database connection and must start with libsql://, https://, or file: (any libSQL-compatible endpoint, not just Turso).');
      }
      return { status: 200, body: { connections: connections.set(key.account, provider, token, { owner, url }) } };
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
      gateModelSpend(account, usage);
      const result = await relayChat({ system: body?.system, messages: body?.messages });
      auth.meter(key.id, 'studio.generations');
      if (result.tokens) auth.meter(key.id, 'studio.tokens', result.tokens);
      return { status: 200, body: result };
    },
  },

  // ── Studio draft ────────────────────────────────────────────────────────
  // A generated template plus its refine conversation is real work. It used
  // to live only in the tab, so a reload lost it. Saved per account, like the
  // batch build list.
  {
    method: 'GET', pattern: '/v1/studio/draft', scope: 'templates',
    handler: ({ key }) => ({ status: 200, body: store.readJson(`studio/draft/${key.account}.json`, { brief: {}, features: null, messages: [], previewSiteId: null, updatedAt: null }) }),
  },
  {
    // The caller compacts before sending (later FILE blocks supersede earlier
    // ones, so the whole history is never needed); this caps what lands on
    // disk so a long session cannot grow the var dir without bound.
    method: 'PUT', pattern: '/v1/studio/draft', scope: 'templates', bodyLimit: 4_000_000,
    handler: ({ body, key }) => {
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const draft = {
        brief: body?.brief && typeof body.brief === 'object' && !Array.isArray(body.brief) ? body.brief : {},
        features: Array.isArray(body?.features) ? body.features : null,
        messages: messages
          .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
          .map((m) => ({ role: m.role, content: m.content })),
        previewSiteId: typeof body?.previewSiteId === 'string' ? body.previewSiteId : null,
        updatedAt: new Date().toISOString(),
      };
      const bytes = Buffer.byteLength(JSON.stringify(draft));
      if (bytes > 3_500_000) {
        throw httpError(413, 'draft_too_large', 'This design is too large to save. Import it to your templates to keep it.');
      }
      store.writeJson(`studio/draft/${key.account}.json`, draft);
      return { status: 200, body: { saved: true, bytes, updatedAt: draft.updatedAt } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/studio/draft', scope: 'templates',
    handler: ({ key }) => ({ status: 200, body: { cleared: store.deleteJson(`studio/draft/${key.account}.json`) } }),
  },

  // ── Batch Building (Agency tier) ────────────────────────────────────────
  // Queue many builds, run them in one go on the provider Batch API (~half
  // the token cost, async up to 24h), come back to finished sites. Failed
  // builds are isolated and recoverable (generate-now / requeue).
  {
    method: 'POST', pattern: '/v1/batches', scope: 'sites', meter: 'batches.submit', bodyLimit: 2_000_000,
    handler: async ({ body, key }) => {
      const account = accounts.getAccount(key.account) || { id: key.account, plan: 'beta' };
      if (!billing.planAllows(account, 'batch')) {
        throw httpError(403, 'plan_required', 'Batch Building is an Agency-plan feature — upgrade to queue overnight builds.');
      }
      gateModelSpend(account);
      try {
        // No `builds` in the body means "submit my saved draft" (what the
        // Workbench does); an explicit list keeps the API usable headlessly.
        const batch = body?.builds
          ? await batches.submit(key.account, key.id, body.builds)
          : await batches.submitDraft(key.account, key.id);
        return { status: 202, body: { batchId: batch.id, status: batch.status, count: batch.builds.length } };
      } catch (e) {
        // Per-build problems come back as a list so every incomplete row can
        // be flagged at once instead of one error at a time.
        if (e.code !== 'builds_incomplete') throw e;
        return { status: 422, body: { error: { code: e.code, message: e.message }, builds: e.builds } };
      }
    },
  },
  {
    method: 'GET', pattern: '/v1/batches', scope: 'sites',
    handler: ({ key }) => ({ status: 200, body: { batches: batches.list(key.account), backlog: batches.backlogList(key.account) } }),
  },
  // The draft build list: the stack of sites being prepared, saved as it is
  // typed so a 20-site batch can be filled in across sessions and machines.
  {
    method: 'GET', pattern: '/v1/batches/draft', scope: 'sites',
    handler: ({ key }) => ({ status: 200, body: batches.draftView(key.account) }),
  },
  {
    method: 'PUT', pattern: '/v1/batches/draft', scope: 'sites', bodyLimit: 2_000_000,
    handler: ({ body, key }) => ({ status: 200, body: batches.saveDraft(key.account, body?.rows) }),
  },
  {
    method: 'DELETE', pattern: '/v1/batches/draft', scope: 'sites',
    handler: ({ key }) => {
      batches.saveDraft(key.account, []); // also drops each row's staged photos
      return { status: 200, body: { cleared: true } };
    },
  },
  // Photos for a build that has no site yet: staged against the draft row and
  // adopted onto the real site the moment the batch creates it.
  {
    method: 'GET', pattern: '/v1/batches/draft/rows/:rowId/assets', scope: 'sites',
    handler: ({ params, key }) => {
      const row = batches.draftRowById(key.account, assertUuid(params.rowId, 'row id'));
      return { status: 200, body: { slots: assets.slotsFor(null, modulesForFeatures(row.features)), assets: assets.state(row.rowId) } };
    },
  },
  {
    method: 'POST', pattern: '/v1/batches/draft/rows/:rowId/assets/:slot', scope: 'sites', meter: 'assets.upload', bodyLimit: 16_000_000,
    handler: ({ params, body, key }) => {
      const row = batches.draftRowById(key.account, assertUuid(params.rowId, 'row id'));
      const slotDef = assets.slotsFor(null, modulesForFeatures(row.features)).find((s) => s.id === String(params.slot));
      if (!slotDef) throw httpError(422, 'unknown_slot', `No compartment "${params.slot}" on this build.`);
      if (typeof body?.filename !== 'string' || !body.filename.trim() || typeof body?.contentBase64 !== 'string') {
        throw httpError(400, 'bad_request', 'Body must be { filename, contentBase64 }.');
      }
      const buffer = Buffer.from(body.contentBase64, 'base64');
      if (buffer.length > MAX_ASSET_BYTES) throw httpError(422, 'too_large', `Files must be at most ${Math.round(MAX_ASSET_BYTES / 1e6)} MB.`);
      return { status: 201, body: { slot: slotDef.id, asset: assets.add(row.rowId, slotDef, body.filename.trim(), buffer) } };
    },
  },
  {
    method: 'DELETE', pattern: '/v1/batches/draft/rows/:rowId/assets/:slot/:assetId', scope: 'sites',
    handler: ({ params, key }) => {
      const row = batches.draftRowById(key.account, assertUuid(params.rowId, 'row id'));
      if (!assets.remove(row.rowId, String(params.slot), assertUuid(params.assetId, 'asset id'))) {
        throw httpError(404, 'not_found', 'Asset not found.');
      }
      return { status: 200, body: { deleted: params.assetId, slot: params.slot } };
    },
  },
  {
    method: 'GET', pattern: '/v1/batches/:id', scope: 'sites',
    handler: ({ params, key }) => ({ status: 200, body: batches.detail(key.account, assertUuid(params.id, 'batch id')) }),
  },
  {
    method: 'POST', pattern: '/v1/batches/:id/builds/:cid/requeue', scope: 'sites',
    handler: ({ params, key }) => ({ status: 200, body: batches.requeue(key.account, assertUuid(params.id, 'batch id'), String(params.cid)) }),
  },
  // Design review: a batch invents designs nobody has seen, so each one is
  // held back from publishing until the operator says yes.
  {
    method: 'POST', pattern: '/v1/batches/:id/builds/:cid/approve', scope: 'sites',
    handler: ({ params, key }) => ({ status: 200, body: batches.approve(key.account, assertUuid(params.id, 'batch id'), String(params.cid)) }),
  },
  {
    method: 'POST', pattern: '/v1/batches/:id/builds/:cid/discard', scope: 'sites',
    handler: ({ params, key }) => ({ status: 200, body: batches.discard(key.account, assertUuid(params.id, 'batch id'), String(params.cid)) }),
  },
  {
    method: 'POST', pattern: '/v1/batches/:id/approve-all', scope: 'sites',
    handler: ({ params, key }) => ({ status: 200, body: batches.approveAll(key.account, assertUuid(params.id, 'batch id')) }),
  },
  {
    // Publish every approved site in one go. Runs detached; progress shows on
    // the batch (publishRun) which the Workbench already polls.
    method: 'POST', pattern: '/v1/batches/:id/publish', scope: 'deploy', meter: 'sites.deploy',
    handler: ({ params, key }) => ({ status: 202, body: batches.publishAll(key.account, assertUuid(params.id, 'batch id')) }),
  },
  {
    // Every built site in the batch as one archive, a directory per site.
    method: 'GET', pattern: '/v1/batches/:id/export', scope: 'sites',
    handler: ({ params, key }) => {
      const sites = batches.exportable(key.account, assertUuid(params.id, 'batch id'));
      const entries = sites
        .map((s) => ({ dir: store.path('workspaces', s.siteId), name: slugify(s.siteName) }))
        .filter((e) => fs.existsSync(path.join(e.dir, 'package.json')));
      if (!entries.length) {
        throw httpError(409, 'not_assembled', 'No assembled sites in this batch yet. Sites are only exportable once the real engine has built them.');
      }
      return {
        raw: true, status: 200, buffer: tarGzDirs(entries),
        headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="batch-${params.id.slice(0, 8)}.tar.gz"` },
      };
    },
  },
  {
    method: 'POST', pattern: '/v1/batches/:id/builds/:cid/generate-now', scope: 'sites',
    handler: ({ params, key }) => {
      const account = accounts.getAccount(key.account) || { id: key.account, plan: 'beta' };
      // Live regeneration spends interactive tokens; same quota gate as the Studio.
      gateModelSpend(account);
      return { status: 202, body: batches.generateNow(key.account, assertUuid(params.id, 'batch id'), String(params.cid)) };
    },
  },

  // The marketing site's request-access form. Public by design (a prospect
  // has no key yet), so it gets its own per-IP throttle and strict caps.
  {
    method: 'POST', pattern: '/site/request-access', scope: 'public', bodyLimit: 20_000,
    handler: ({ body, req }) => {
      if (!ipThrottle('leads', clientIp(req), 5)) throw httpError(429, 'rate_limited', 'Too many requests from this address — try again in an hour.');
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

/**
 * Per-IP sliding-window throttle for the unauthenticated front door. There is
 * no API key to rate-limit on out here, so the address is all we have.
 * `bucket` keeps each endpoint's history separate, so lead spam and signup
 * spam cannot exhaust each other's allowance.
 */
const THROTTLE_WINDOW_MS = 3_600_000;
const throttleBuckets = new Map();

function throttleHits(bucket, ip) {
  let hits = throttleBuckets.get(bucket);
  if (!hits) { hits = new Map(); throttleBuckets.set(bucket, hits); }
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < THROTTLE_WINDOW_MS);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.clear(); // memory guard; resets throttles, acceptable
  return { hits, recent };
}

/** Is this address already over its allowance for `bucket`? */
const throttleExceeded = (bucket, ip, limit) => throttleHits(bucket, ip).recent.length >= limit;

/** Record one use. Deliberately separate from the check, so a caller can
 *  charge the allowance only for what actually happened: signup rations
 *  ACCOUNTS CREATED, not attempts, or a typo'd password would count against
 *  a legitimate person while costing us nothing. */
function throttleRecord(bucket, ip) {
  const { hits, recent } = throttleHits(bucket, ip);
  recent.push(Date.now());
  hits.set(ip, recent);
}

/** Check and record in one go, for endpoints where the attempt IS the cost. */
function ipThrottle(bucket, ip, limit) {
  if (throttleExceeded(bucket, ip, limit)) return false;
  throttleRecord(bucket, ip);
  return true;
}
const clientIp = (req) => String(req.socket?.remoteAddress || 'unknown');

// ── Server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = matchRoute(ROUTES, req.method, url.pathname);
  if (!match) {
    // Non-API requests: the Console lives at /workbench/. The marketing site is
    // hosted separately, so the root and anything else redirects into it.
    if (url.pathname.startsWith('/workbench/')) {
      if (workbench(req, res, url.pathname.slice('/workbench'.length))) return;
      return fail(res, 404, 'not_found', `No ${req.method} ${url.pathname}.`);
    }
    // /intake/<token> — one page, whatever the token. The token stays in the
    // URL for the page's own script to read; it is never a file path.
    if (url.pathname.startsWith('/intake/')) {
      const rest = url.pathname.slice('/intake'.length);
      // Assets (app.js, styles.css) are served by name; anything else is a
      // token and gets the page itself.
      const asset = /\.(js|css|svg|png|ico)$/.test(rest) ? rest : '/index.html';
      // A client's answers must never turn up in a search engine.
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (intakeApp(req, res, asset)) return;
      return fail(res, 404, 'not_found', `No ${req.method} ${url.pathname}.`);
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/workbench')) {
      res.writeHead(302, { Location: '/workbench/' });
      return res.end();
    }
    return fail(res, 404, 'not_found', `No ${req.method} ${url.pathname}. GET /v1 lists the API surface; the Console is at /workbench/.`);
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
  // DELETE included: closing an account carries a password and a typed
  // confirmation, and a destructive verb is exactly where that belongs.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (route.rawBody) rawBody = await readRawBody(req, route.bodyLimit);
    else body = await readBody(req, route.bodyLimit);
  }
  const out = await route.handler({ params, body, rawBody, key, account, req, url });
  if (key) {
    auth.meter(key.id, 'requests');
    if (route.meter && out.status < 400) auth.meter(key.id, route.meter);
  }
  if (out.cookies) res.setHeader('Set-Cookie', out.cookies);
  // A handler a PERSON lands on (an emailed link) answers with a redirect
  // into the Console, not JSON at a human being.
  if (out.redirect) {
    res.writeHead(out.status || 302, { Location: out.redirect });
    return res.end();
  }
  if (out.raw) {
    res.writeHead(out.status, { ...out.headers, 'Content-Length': out.buffer.length });
    return res.end(out.buffer);
  }
  return json(res, out.status, out.body);
}, { onFinish: ops.noteResponse, onError: ops.noteError });

server.listen(PORT, () => {
  ops.start(); // boot count (crash-loop detection) + the watchdog interval
  // Report what we actually bound, not what was asked for: with --port 0 they
  // differ, and this line is how a caller learns which port to talk to.
  const bound = server.address()?.port ?? PORT;
  console.log(`[stardrive-api] v${VERSION} listening on http://localhost:${bound} (engine: ${ENGINE}, var: ${VAR_DIR})`);
});

/**
 * A crash used to be a silent restart: the container came back and nobody
 * knew. Record it, try to get one email out, and then still die, because a
 * process that has thrown past every handler cannot be trusted to keep
 * serving. The timeout is there so a slow mail provider cannot hold a broken
 * process open.
 */
const dieAfterAlerting = (kind, err) => {
  console.error(`[stardrive-api] ${kind}`, err);
  const done = () => { try { livePreview.stopAll(); } finally { process.exit(1); } };
  const guard = setTimeout(done, 3_000);
  guard.unref?.();
  ops.noteFatal(kind, err).catch(() => {}).finally(() => { clearTimeout(guard); done(); });
};
process.on('uncaughtException', (err) => dieAfterAlerting('uncaughtException', err));
process.on('unhandledRejection', (err) => dieAfterAlerting('unhandledRejection', err));

// Don't leave orphaned `next start` preview servers behind on shutdown, and
// record that this exit was deliberate so the next process does not read an
// orderly restart as a crash.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try { ops.noteCleanExit(); livePreview.stopAll(); } finally { process.exit(0); }
  });
}
process.on('exit', () => livePreview.stopAll());
