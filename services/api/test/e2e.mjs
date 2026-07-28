#!/usr/bin/env node
/**
 * Stardrive API end-to-end suite: spawns the real server on a spare port
 * with a throwaway var dir, mints real keys, and exercises every v1
 * endpoint over actual HTTP — auth (401/403), scopes, the mapping engine
 * endpoints, stored-mapping CRUD, template catalog + manifest validation,
 * the full dry site/job lifecycle incl. the change loop, usage metering,
 * the honest 501s, and (on a second low-limit server) rate limiting.
 *
 * Run: node test/e2e.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(API_DIR, '..', '..');
const PORT_A = 4651;
const PORT_B = 4652;
const BASE = `http://localhost:${PORT_A}`;

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-api-e2e-'));
const children = [];
let failures = 0;

const check = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok    ${name}`))
    .catch((err) => {
      failures++;
      console.error(`  FAIL  ${name}`);
      console.error(String(err.message).split('\n').map((l) => `        ${l}`).join('\n'));
    });

function mintKey(name, scopes) {
  const out = execFileSync(process.execPath, [
    path.join(API_DIR, 'scripts', 'make-key.mjs'),
    '--name', name, '--scopes', scopes, '--var-dir', varDir,
  ], { encoding: 'utf-8' });
  const secret = out.trim().split('\n').pop().trim();
  assert.match(secret, /^sk_live_[0-9a-f]{48}$/, 'minted key shape');
  return secret;
}

function startServer(port, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.mjs', '--port', String(port)], {
      cwd: API_DIR,
      env: { ...process.env, STARDRIVE_VAR_DIR: varDir, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Server on :${port} never became ready. Output:\n${buf}`)), 15000);
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('listening')) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('exit', (code) => reject(new Error(`Server on :${port} exited early (${code}). Output:\n${buf}`)));
  });
}

const call = (m, p, o) => callBase(m, p, o);
async function callBase(method, pathname, { key, body, base = BASE } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

async function waitForJob(key, jobId, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const { status, body } = await call('GET', `/v1/jobs/${jobId}`, { key });
    assert.strictEqual(status, 200);
    if (body.status === 'done' || body.status === 'failed') return body;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${jobId} still ${body.status} after ${timeoutMs}ms.`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ── Setup ────────────────────────────────────────────────────────────────
const fullKey = mintKey('e2e full', 'mappings,templates,sites,deploy');
const mappingsOnlyKey = mintKey('e2e mappings-only', 'mappings');
const otherAccountKey = mintKey('e2e other licensee', 'mappings,templates,sites,deploy');
await startServer(PORT_A);

const coffeeMapping = JSON.parse(
  fs.readFileSync(path.join(REPO, 'packages', 'field-mapping', 'examples', 'coffee-cart.json'), 'utf-8')
);
const coffeeAnswers = {
  'C1. Business name': 'Cart & Crema',
  C2: 'Espresso anywhere.',
  C3: 'bad-email',
  C4: 'Weddings and corporate events',
  C5: 'Yes',
  C6: 'Lavender latte, Cortado, Cold brew, Chai',
  C7: 'https://instagram.com/cartcrema',
  C9: 'Sam Bean',
  'C10. Best contact': 'sam@cartcrema.example',
};
// How many modules the shared catalog ships. Read from disk rather than
// hardcoded: the engine gains modules over time, and a test that has to be
// edited every time one lands is a test that gets edited without being read.
const BUNDLED = fs.readdirSync(path.join(API_DIR, 'data', 'catalog')).filter((f) => f.endsWith('.json')).length;

const goodManifest = JSON.parse(fs.readFileSync(path.join(API_DIR, 'data', 'catalog', 'd4-catalog.json'), 'utf-8'));

// ── Public + auth ────────────────────────────────────────────────────────
console.log('public + auth:');
await check('GET /v1/health is public and reports the engine + QA tier', async () => {
  const { status, body } = await call('GET', '/v1/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.engine, 'dry');
  assert.strictEqual(body.qa, 'dry');
});
await check('GET /v1 lists the surface', async () => {
  const { status, body } = await call('GET', '/v1');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.endpoints.some((e) => e.includes('POST /v1/intake/parse')), true);
});
await check('missing key → 401; garbage key → 401', async () => {
  assert.strictEqual((await call('GET', '/v1/templates')).status, 401);
  assert.strictEqual((await call('GET', '/v1/templates', { key: 'sk_live_' + '0'.repeat(48) })).status, 401);
});
await check('out-of-scope key → 403', async () => {
  const { status, body } = await call('GET', '/v1/templates', { key: mappingsOnlyKey });
  assert.strictEqual(status, 403);
  assert.strictEqual(body.error.code, 'forbidden');
});
await check('unknown route → 404', async () => {
  assert.strictEqual((await call('GET', '/v1/nope', { key: fullKey })).status, 404);
});

// ── Accounts, sessions, self-service keys, billing ───────────────────────
console.log('accounts + sessions:');
const cookieCall = (m, p, o) => cookieCallBase(m, p, o);
const cookieCallBase = async (method, pathname, { cookie, body, base = BASE } = {}) => {
  const res = await fetch(base + pathname, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const token = setCookie ? /sd_session=([^;]*)/.exec(setCookie)?.[1] : null;
  return { status: res.status, token, setCookie, body: await res.json().catch(() => ({})) };
};
let sessionCookie = null;
let sessionKeySecret = null;
await check('signup creates an account, sets a session cookie, and returns a first full-scope key', async () => {
  const email = `ada+${Date.now()}@example.com`;
  const res = await cookieCall('POST', '/auth/signup', { body: { email, password: 'correcthorse', company: 'Ada Web Co' } });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.account.email, email);
  assert.strictEqual(res.body.account.plan, 'beta');
  assert.match(res.body.apiKey.secret, /^sk_live_[0-9a-f]{48}$/);
  assert.deepStrictEqual(res.body.apiKey.scopes, ['mappings', 'templates', 'sites', 'deploy']);
  assert.strictEqual(/HttpOnly/i.test(res.setCookie) && /SameSite=Lax/i.test(res.setCookie), true);
  sessionCookie = `sd_session=${res.token}`;
  sessionKeySecret = res.body.apiKey.secret;
});
await check('the signup key actually works against the product API (account-scoped)', async () => {
  const t = await call('GET', '/v1/templates', { key: sessionKeySecret });
  assert.strictEqual(t.status, 200);
  assert.strictEqual(t.body.templates.length, BUNDLED); // the shared catalog, freshly its own account
});
await check('duplicate email → 409; weak password → 400; bad login → 401', async () => {
  const email = `dupe+${Date.now()}@example.com`;
  assert.strictEqual((await cookieCall('POST', '/auth/signup', { body: { email, password: 'longenough' } })).status, 201);
  assert.strictEqual((await cookieCall('POST', '/auth/signup', { body: { email, password: 'longenough' } })).status, 409);
  assert.strictEqual((await cookieCall('POST', '/auth/signup', { body: { email: `x${Date.now()}@e.com`, password: 'short' } })).status, 400);
  assert.strictEqual((await cookieCall('POST', '/auth/login', { body: { email, password: 'wrongpass' } })).status, 401);
});
await check('GET /auth/me requires a session; works with the cookie', async () => {
  assert.strictEqual((await cookieCall('GET', '/auth/me')).status, 401);
  const me = await cookieCall('GET', '/auth/me', { cookie: sessionCookie });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.account.company, 'Ada Web Co');
});
await check('login opens a fresh session; logout invalidates it', async () => {
  const email = `log+${Date.now()}@example.com`;
  await cookieCall('POST', '/auth/signup', { body: { email, password: 'password123' } });
  const login = await cookieCall('POST', '/auth/login', { body: { email, password: 'password123' } });
  assert.strictEqual(login.status, 200);
  const c = `sd_session=${login.token}`;
  assert.strictEqual((await cookieCall('GET', '/auth/me', { cookie: c })).status, 200);
  const out = await cookieCall('POST', '/auth/logout', { cookie: c });
  assert.strictEqual(out.status, 200);
  assert.strictEqual((await cookieCall('GET', '/auth/me', { cookie: login.token ? c : '' })).status, 401);
});
console.log('self-service keys + billing:');
await check('keys: list, mint (secret shown once), rotate, revoke — all session-scoped', async () => {
  assert.strictEqual((await cookieCall('GET', '/v1/keys')).status, 401); // no session
  const list0 = await cookieCall('GET', '/v1/keys', { cookie: sessionCookie });
  assert.strictEqual(list0.body.keys.length, 1); // the signup key
  const mint = await cookieCall('POST', '/v1/keys', { cookie: sessionCookie, body: { name: 'CI key', scopes: ['mappings', 'templates'] } });
  assert.strictEqual(mint.status, 201);
  assert.match(mint.body.secret, /^sk_live_/);
  assert.deepStrictEqual(mint.body.scopes, ['mappings', 'templates']);
  const rotated = await cookieCall('POST', `/v1/keys/${mint.body.id}/rotate`, { cookie: sessionCookie });
  assert.strictEqual(rotated.status, 200);
  assert.notStrictEqual(rotated.body.secret, mint.body.secret); // new secret
  const old = await call('GET', '/v1/templates', { key: mint.body.secret });
  assert.strictEqual(old.status, 401, 'rotated-away secret no longer authenticates');
  const del = await cookieCall('DELETE', `/v1/keys/${mint.body.id}`, { cookie: sessionCookie });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await call('GET', '/v1/templates', { key: rotated.body.secret })).status, 401, 'revoked key rejected');
});
await check('billing: plan + token quota + a tier catalog with per-token discounts up the tiers', async () => {
  const b = await cookieCall('GET', '/v1/billing', { cookie: sessionCookie });
  assert.strictEqual(b.status, 200);
  assert.strictEqual(b.body.plan, 'beta');
  assert.strictEqual(b.body.checkoutConfigured, false);
  // Quota shape.
  assert.strictEqual(b.body.quota.includedTokens > 0, true);
  assert.strictEqual(b.body.quota.usedTokens, 0);
  assert.strictEqual(b.body.quota.over, false);
  // Public catalog: paid tiers get cheaper per token AND cheaper overage as they go up.
  const paid = b.body.plans.filter((p) => p.priceUsd > 0);
  assert.strictEqual(paid.length >= 3, true);
  for (let i = 1; i < paid.length; i++) {
    assert.strictEqual(paid[i].effectivePer1kUsd < paid[i - 1].effectivePer1kUsd, true, 'included rate descends up the tiers');
    assert.strictEqual(paid[i].overagePer1kUsd < paid[i - 1].overagePer1kUsd, true, 'overage rate descends up the tiers');
    // Overage always priced above the included effective rate (keep-working pays).
    assert.strictEqual(paid[i].overagePer1kUsd > paid[i].effectivePer1kUsd, true, 'overage above included effective');
  }
});
await check('billing webhook: dormant 501 without a secret; with one, a signed checkout.completed flips the plan', async () => {
  // Dormant on the default server (no STRIPE_WEBHOOK_SECRET).
  assert.strictEqual((await call('POST', '/webhooks/stripe', { body: {} })).status, 501);
  // A dedicated server WITH the secret proves the signature check + plan flip.
  const PORT_W = 4655;
  const secret = 'whsec_e2e_test_secret';
  await startServer(PORT_W, { STRIPE_WEBHOOK_SECRET: secret });
  const wbase = `http://localhost:${PORT_W}`;
  // A fresh account to flip.
  const sres = await cookieCall('POST', '/auth/signup', { body: { email: `flip+${Date.now()}@example.com`, password: 'password123' } });
  const acct = sres.body.account.id;
  const wcookie = `sd_session=${sres.token}`;
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: acct, metadata: { account: acct, plan: 'studio' } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const good = await fetch(`${wbase}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body: payload });
  assert.strictEqual(good.status, 200);
  assert.strictEqual((await good.json()).action.includes('studio'), true);
  // The account is now on the Studio plan.
  const me = await cookieCall('GET', '/auth/me', { cookie: wcookie, base: wbase });
  assert.strictEqual(me.body.account.plan, 'studio');
  // A bad signature is rejected.
  const bad = await fetch(`${wbase}/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': `t=${t},v1=deadbeef` }, body: payload });
  assert.strictEqual(bad.status, 400);
});
await check('billing: extra-usage toggle persists; checkout is an honest 501 until Stripe is configured', async () => {
  const on = await cookieCall('POST', '/v1/billing/overage', { cookie: sessionCookie, body: { enabled: true } });
  assert.strictEqual(on.status, 200);
  assert.strictEqual(on.body.overageEnabled, true);
  assert.strictEqual(on.body.active, false, 'not actually charging until Stripe/card');
  const me = await cookieCall('GET', '/auth/me', { cookie: sessionCookie });
  assert.strictEqual(me.body.account.overageEnabled, true);
  await cookieCall('POST', '/v1/billing/overage', { cookie: sessionCookie, body: { enabled: false } });
  const co = await cookieCall('POST', '/v1/billing/checkout', { cookie: sessionCookie, body: { plan: 'studio' } });
  assert.strictEqual(co.status, 501);
  assert.strictEqual(co.body.error.code, 'billing_unconfigured');
  // A non-purchasable plan is rejected clearly (once configured it would 422; dormant it 501s first — both honest).
  assert.strictEqual((await cookieCall('POST', '/v1/billing/checkout', { cookie: sessionCookie, body: { plan: 'free' } })).status, 501);
});

// ── Mappings ─────────────────────────────────────────────────────────────
console.log('mappings:');
await check('validate: good mapping ok, garbage rejected with reasons', async () => {
  const good = await call('POST', '/v1/mappings/validate', { key: fullKey, body: coffeeMapping });
  assert.deepStrictEqual(good.body, { ok: true, errors: [] });
  const bad = await call('POST', '/v1/mappings/validate', { key: fullKey, body: { format: 'nope' } });
  assert.strictEqual(bad.body.ok, false);
  assert.strictEqual(bad.body.errors.length >= 1, true);
});
await check('parse: inline mapping runs the engine', async () => {
  const { status, body } = await call('POST', '/v1/intake/parse', {
    key: mappingsOnlyKey,
    body: { mapping: coffeeMapping, answers: coffeeAnswers },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.config.siteName, 'Cart & Crema');
  assert.strictEqual(body.config.contactEmail, 'sam@cartcrema.example'); // fallback scan rescued it
  assert.strictEqual(body.config.pairing, 'quiet-luxury');
  assert.deepStrictEqual(body.config.modules, ['cms-core', 'menu']);
  assert.strictEqual(body.contact.name, 'Sam Bean');
});
await check('parse: invalid inline mapping → 422; missing answers → 400', async () => {
  const bad = await call('POST', '/v1/intake/parse', { key: fullKey, body: { mapping: { format: 'nope' }, answers: {} } });
  assert.strictEqual(bad.status, 422);
  const noAnswers = await call('POST', '/v1/intake/parse', { key: fullKey, body: { mapping: coffeeMapping } });
  assert.strictEqual(noAnswers.status, 400);
});
await check('stored mappings: PUT 201 → re-PUT 200 → list → get → parse by id → delete → 404', async () => {
  const put = await call('PUT', '/v1/mappings/coffee-cart', { key: fullKey, body: coffeeMapping });
  assert.strictEqual(put.status, 201);
  const rePut = await call('PUT', '/v1/mappings/coffee-cart', { key: fullKey, body: coffeeMapping });
  assert.strictEqual(rePut.status, 200);
  const list = await call('GET', '/v1/mappings', { key: fullKey });
  assert.strictEqual(list.body.mappings.some((m) => m.id === 'coffee-cart'), true);
  const got = await call('GET', '/v1/mappings/coffee-cart', { key: fullKey });
  assert.strictEqual(got.body.mapping.name, 'example-coffee-cart');
  const parsed = await call('POST', '/v1/intake/parse', { key: fullKey, body: { mappingId: 'coffee-cart', answers: coffeeAnswers } });
  assert.strictEqual(parsed.body.config.siteName, 'Cart & Crema');
  const del = await call('DELETE', '/v1/mappings/coffee-cart', { key: fullKey });
  assert.strictEqual(del.status, 200);
  const gone = await call('POST', '/v1/intake/parse', { key: fullKey, body: { mappingId: 'coffee-cart', answers: coffeeAnswers } });
  assert.strictEqual(gone.status, 404);
});
await check('PUT rejects an invalid mapping with every error', async () => {
  const { status, body } = await call('PUT', '/v1/mappings/broken', {
    key: fullKey,
    body: { format: 'stardrive-field-mapping/v1', fields: [{ source: { code: 'Q1', hint: '(' } }] },
  });
  assert.strictEqual(status, 422);
  assert.strictEqual(body.errors.length >= 2, true);
});
await check('path-hostile mapping id → 400', async () => {
  const { status } = await call('GET', '/v1/mappings/..%2F..%2Fkeys', { key: fullKey });
  assert.strictEqual(status, 400);
});

// ── Templates ────────────────────────────────────────────────────────────
console.log('templates:');
await check('catalog lists every bundled d4 module', async () => {
  const { status, body } = await call('GET', '/v1/templates', { key: fullKey });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.templates.length, BUNDLED);
  const site = body.templates.find((t) => t.name === 'd4-site-template');
  assert.strictEqual(site.kind, 'site');
  assert.strictEqual(site.source, 'bundled');
});
await check('template detail returns the full manifest; unknown → 404', async () => {
  const { body } = await call('GET', '/v1/templates/d4-cms-core', { key: fullKey });
  assert.strictEqual(body.manifest.kind, 'core');
  assert.strictEqual((await call('GET', '/v1/templates/nope', { key: fullKey })).status, 404);
});
await check('manifest validate: real manifest passes, broken one gets a full report', async () => {
  const good = await call('POST', '/v1/templates/validate', { key: fullKey, body: { manifest: goodManifest } });
  assert.deepStrictEqual(good.body, { ok: true, errors: [] });
  const bad = await call('POST', '/v1/templates/validate', {
    key: fullKey,
    body: { manifest: { name: 'Bad Name', version: 'v1', kind: 'zap', surprise: true } },
  });
  assert.strictEqual(bad.body.ok, false);
  assert.strictEqual(bad.body.errors.length >= 6, true);
});
// ── Template import (the template-kit gate) ─────────────────────────────
console.log('template import:');
const { REQUIRED_SITE_FILES } = await import(
  new URL('../../../packages/template-kit/index.mjs', import.meta.url)
);
const auroraBundle = {
  manifest: {
    name: 'aurora-template',
    version: '1.0.0',
    kind: 'site',
    description: 'E2E import fixture.',
    provides: { routes: ['/', '/about', '/contact'], nav: [{ label: 'About', href: '/about' }], adminPanels: [], collections: [] },
    copy: [{ from: 'files', to: '.' }],
  },
  files: [
    ...REQUIRED_SITE_FILES.map((p) => ({
      path: p,
      content: p.endsWith('theme.css')
        ? ':root { --accent: 67 56 202; }\n.dark { --accent: 159 153 255; }\n'
        : `// default ${p}\nexport {};\n`,
    })),
    { path: 'src/components/Hero.tsx', content: 'const accent = "#ff5500"; export default () => null;\n' },
  ],
};
await check('invalid bundle → 422 with the full error list', async () => {
  const { status, body } = await call('POST', '/v1/templates', {
    key: fullKey,
    body: { manifest: { name: 'x' }, files: [{ path: '../evil.ts', content: 'x' }] },
  });
  assert.strictEqual(status, 422);
  assert.strictEqual(body.error.code, 'invalid_bundle');
  assert.strictEqual(body.errors.length >= 3, true);
});
await check('valid bundle imports (201) and carries its lint warnings', async () => {
  const { status, body } = await call('POST', '/v1/templates', { key: fullKey, body: auroraBundle });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.name, 'aurora-template');
  assert.strictEqual(body.warnings.some((w) => w.includes('Hero.tsx')), true);
});
await check('re-import replaces (200); bundled names cannot be shadowed (409)', async () => {
  assert.strictEqual((await call('POST', '/v1/templates', { key: fullKey, body: auroraBundle })).status, 200);
  const shadow = await call('POST', '/v1/templates', {
    key: fullKey,
    body: { ...auroraBundle, manifest: { ...auroraBundle.manifest, name: 'd4-site-template' } },
  });
  assert.strictEqual(shadow.status, 409);
});
await check('imported template appears in the list and in detail with warnings', async () => {
  const list = await call('GET', '/v1/templates', { key: fullKey });
  const aurora = list.body.templates.find((t) => t.name === 'aurora-template');
  assert.strictEqual(aurora.source, 'imported');
  assert.strictEqual(list.body.templates.length, BUNDLED + 1);
  const detail = await call('GET', '/v1/templates/aurora-template', { key: fullKey });
  assert.strictEqual(detail.body.source, 'imported');
  assert.strictEqual(detail.body.warnings.length >= 1, true);
});
await check('ACCOUNT ISOLATION: another licensee cannot see, fetch, or collide with my templates', async () => {
  const theirList = await call('GET', '/v1/templates', { key: otherAccountKey });
  assert.strictEqual(theirList.body.templates.length, BUNDLED, 'only the shared catalog');
  assert.strictEqual(theirList.body.templates.some((t) => t.name === 'aurora-template'), false);
  assert.strictEqual((await call('GET', '/v1/templates/aurora-template', { key: otherAccountKey })).status, 404);
  const theirImport = await call('POST', '/v1/templates', { key: otherAccountKey, body: auroraBundle });
  assert.strictEqual(theirImport.status, 201, 'same name, different account, no collision');
  const mineStill = await call('GET', '/v1/templates/aurora-template', { key: fullKey });
  assert.strictEqual(mineStill.status, 200);
  assert.strictEqual((await call('DELETE', '/v1/templates/aurora-template', { key: otherAccountKey })).status, 200);
});
await check('ACCOUNT ISOLATION: stored mappings are private per account', async () => {
  await call('PUT', '/v1/mappings/coffee-cart', { key: fullKey, body: coffeeMapping });
  assert.strictEqual((await call('GET', '/v1/mappings/coffee-cart', { key: otherAccountKey })).status, 404);
  const theirs = await call('GET', '/v1/mappings', { key: otherAccountKey });
  assert.deepStrictEqual(theirs.body.mappings, []);
  await call('DELETE', '/v1/mappings/coffee-cart', { key: fullKey });
});
await check('a site assembles from an imported base template', async () => {
  const created = await call('POST', '/v1/sites', {
    key: fullKey,
    body: { templateId: 'aurora-template', config: { siteName: 'Aurora Client' } },
  });
  assert.strictEqual(created.status, 202);
  const job = await waitForJob(fullKey, created.body.jobId);
  assert.strictEqual(job.status, 'done');
});
await check('delete imported → gone; bundled catalog protected (403)', async () => {
  assert.strictEqual((await call('DELETE', '/v1/templates/aurora-template', { key: fullKey })).status, 200);
  assert.strictEqual((await call('DELETE', '/v1/templates/aurora-template', { key: fullKey })).status, 404);
  assert.strictEqual((await call('DELETE', '/v1/templates/d4-cms-core', { key: fullKey })).status, 403);
});

// ── Sites + jobs (dry engine) ────────────────────────────────────────────
console.log('sites + jobs:');
let siteId;
await check('assemble from explicit config: job runs to done with a skipped-QA report', async () => {
  const created = await call('POST', '/v1/sites', {
    key: fullKey,
    body: { templateId: 'd4-site-template', config: { siteName: 'Cart & Crema', modules: ['d4-cms-core'] } },
  });
  assert.strictEqual(created.status, 202);
  siteId = created.body.siteId;
  const job = await waitForJob(fullKey, created.body.jobId);
  assert.strictEqual(job.status, 'done');
  assert.strictEqual(job.result.qa.mode, 'dry');
  assert.strictEqual(job.result.qa.verdict, 'skipped');
  const marker = JSON.parse(fs.readFileSync(path.join(varDir, 'workspaces', siteId, 'd4.assembly.json'), 'utf-8'));
  assert.strictEqual(marker.config.siteName, 'Cart & Crema');
  assert.strictEqual(marker.engine, 'dry');
});
await check('site detail shows config + job summaries', async () => {
  const { body } = await call('GET', `/v1/sites/${siteId}`, { key: fullKey });
  assert.strictEqual(body.config.siteName, 'Cart & Crema');
  assert.strictEqual(body.jobs.length, 1);
  assert.strictEqual(body.jobs[0].status, 'done');
});
await check('change loop: delta merges, history kept, second job runs', async () => {
  const changed = await call('POST', `/v1/sites/${siteId}/change`, { key: fullKey, body: { config: { tagline: 'Espresso anywhere.' } } });
  assert.strictEqual(changed.status, 202);
  const job = await waitForJob(fullKey, changed.body.jobId);
  assert.strictEqual(job.status, 'done');
  const { body } = await call('GET', `/v1/sites/${siteId}`, { key: fullKey });
  assert.strictEqual(body.config.tagline, 'Espresso anywhere.');
  assert.strictEqual(body.config.siteName, 'Cart & Crema');
  assert.strictEqual(body.configHistory.length, 1);
  assert.strictEqual(body.jobs.length, 2);
});
await check('parse-and-assemble in one step stores the parse summary', async () => {
  await call('PUT', '/v1/mappings/coffee-cart', { key: fullKey, body: coffeeMapping });
  const created = await call('POST', '/v1/sites', {
    key: fullKey,
    body: { templateId: 'd4-site-template', mappingId: 'coffee-cart', answers: coffeeAnswers },
  });
  assert.strictEqual(created.status, 202);
  await waitForJob(fullKey, created.body.jobId);
  const { body } = await call('GET', `/v1/sites/${created.body.siteId}`, { key: fullKey });
  assert.strictEqual(body.config.siteName, 'Cart & Crema');
  assert.strictEqual(Array.isArray(body.parse.notes) && body.parse.notes.length >= 1, true);
  assert.strictEqual(body.parse.contact.name, 'Sam Bean');
});
await check('guards: unknown template 422, feature-module base 422, nameless config 422, config+answers 400', async () => {
  const unknown = await call('POST', '/v1/sites', { key: fullKey, body: { templateId: 'nope', config: { siteName: 'X' } } });
  assert.strictEqual(unknown.status, 422);
  const feature = await call('POST', '/v1/sites', { key: fullKey, body: { templateId: 'd4-catalog', config: { siteName: 'X' } } });
  assert.strictEqual(feature.status, 422);
  assert.strictEqual(feature.body.error.code, 'not_a_base_template');
  const nameless = await call('POST', '/v1/sites', { key: fullKey, body: { templateId: 'd4-site-template', config: {} } });
  assert.strictEqual(nameless.status, 422);
  const both = await call('POST', '/v1/sites', {
    key: fullKey,
    body: { templateId: 'd4-site-template', config: { siteName: 'X' }, answers: {} },
  });
  assert.strictEqual(both.status, 400);
});
await check('job lookups: bad id 400, unknown uuid 404', async () => {
  assert.strictEqual((await call('GET', '/v1/jobs/not-a-uuid', { key: fullKey })).status, 400);
  assert.strictEqual((await call('GET', '/v1/jobs/00000000-0000-4000-8000-000000000000', { key: fullKey })).status, 404);
});
await check('deploy and export of a dry (unassembled) site are honest 409s, never fakes', async () => {
  // This site was assembled by the DRY engine (marker only) — no real repo.
  const dep = await call('POST', `/v1/sites/${siteId}/deploy`, { key: fullKey, body: {} });
  assert.strictEqual(dep.status, 409);
  assert.strictEqual(dep.body.error.code, 'not_assembled');
  const exp = await call('GET', `/v1/sites/${siteId}/export`, { key: fullKey });
  assert.strictEqual(exp.status, 409);
  assert.strictEqual(exp.body.error.code, 'not_assembled');
});
await check('ACCOUNT ISOLATION: sites and jobs are invisible across accounts', async () => {
  const theirView = await call('GET', `/v1/sites/${siteId}`, { key: otherAccountKey });
  assert.strictEqual(theirView.status, 404);
  const mine = await call('GET', `/v1/sites/${siteId}`, { key: fullKey });
  const jobId = mine.body.jobs[0].id;
  assert.strictEqual((await call('GET', `/v1/jobs/${jobId}`, { key: otherAccountKey })).status, 404);
  assert.strictEqual((await call('POST', `/v1/sites/${siteId}/change`, { key: otherAccountKey, body: { config: { tagline: 'x' } } })).status, 404);
});
await check('asset compartments: upload → slotted target, wrong type/full slot named, file served, delete works', async () => {
  const slots = await call('GET', `/v1/sites/${siteId}/assets`, { key: fullKey });
  assert.strictEqual(slots.status, 200);
  assert.strictEqual(slots.body.slots.some((s) => s.id === 'logo' && s.max === 1), true);
  const png = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG magic; content is irrelevant to the dry engine
  const up = await call('POST', `/v1/sites/${siteId}/assets/logo`, {
    key: fullKey, body: { filename: 'My Logo (final).png', contentBase64: png.toString('base64') },
  });
  assert.strictEqual(up.status, 201);
  assert.strictEqual(up.body.asset.target, 'public/assets/brand/My-Logo--final-.png');
  assert.strictEqual(up.body.note.includes('next assembly'), true);
  // Slot caps: logo holds 1.
  const full = await call('POST', `/v1/sites/${siteId}/assets/logo`, {
    key: fullKey, body: { filename: 'second.png', contentBase64: png.toString('base64') },
  });
  assert.strictEqual(full.status, 422);
  assert.strictEqual(full.body.error.message.includes('at most 1'), true);
  // Wrong type for the slot.
  const wrong = await call('POST', `/v1/sites/${siteId}/assets/hero`, {
    key: fullKey, body: { filename: 'movie.ico', contentBase64: png.toString('base64') },
  });
  assert.strictEqual(wrong.status, 422);
  // Unknown compartment.
  assert.strictEqual((await call('POST', `/v1/sites/${siteId}/assets/nope`, { key: fullKey, body: { filename: 'x.png', contentBase64: 'aGk=' } })).status, 422);
  // The file serves back, and only to its own account.
  const assetId = up.body.asset.id;
  const served = await fetch(`${BASE}/v1/sites/${siteId}/assets/logo/${assetId}`, { headers: { Authorization: `Bearer ${fullKey}` } });
  assert.strictEqual(served.status, 200);
  assert.strictEqual(served.headers.get('content-type'), 'image/png');
  assert.strictEqual(Buffer.from(await served.arrayBuffer()).equals(png), true);
  assert.strictEqual((await call('GET', `/v1/sites/${siteId}/assets/logo/${assetId}`, { key: otherAccountKey })).status, 404);
  // Gallery takes several.
  await call('POST', `/v1/sites/${siteId}/assets/gallery`, { key: fullKey, body: { filename: 'g1.jpg', contentBase64: png.toString('base64') } });
  await call('POST', `/v1/sites/${siteId}/assets/gallery`, { key: fullKey, body: { filename: 'g2.jpg', contentBase64: png.toString('base64') } });
  const after = await call('GET', `/v1/sites/${siteId}/assets`, { key: fullKey });
  assert.strictEqual((after.body.assets.gallery || []).length, 2);
});
await check('re-assemble records the slotting in the workspace marker', async () => {
  const re = await call('POST', `/v1/sites/${siteId}/assemble`, { key: fullKey, body: { force: true } });
  assert.strictEqual(re.status, 202);
  await waitForJob(fullKey, re.body.jobId);
  const marker = JSON.parse(fs.readFileSync(path.join(varDir, 'workspaces', siteId, 'd4.assembly.json'), 'utf-8'));
  assert.strictEqual(marker.assets.logo.length, 1);
  assert.strictEqual(marker.assets.logo[0].target, 'public/assets/brand/My-Logo--final-.png');
  assert.strictEqual(marker.assets.gallery.length, 2);
  assert.strictEqual(marker.assets.gallery.every((a) => a.target.startsWith('public/assets/gallery/')), true);
  // Delete → next assembly drops it from the slotting.
  const state = await call('GET', `/v1/sites/${siteId}/assets`, { key: fullKey });
  const g1 = state.body.assets.gallery[0].id;
  assert.strictEqual((await call('DELETE', `/v1/sites/${siteId}/assets/gallery/${g1}`, { key: fullKey })).status, 200);
  const re2 = await call('POST', `/v1/sites/${siteId}/assemble`, { key: fullKey, body: { force: true } });
  await waitForJob(fullKey, re2.body.jobId);
  const marker2 = JSON.parse(fs.readFileSync(path.join(varDir, 'workspaces', siteId, 'd4.assembly.json'), 'utf-8'));
  assert.strictEqual(marker2.assets.gallery.length, 1);
});
await check('template-declared assetSlots surface as extra compartments', async () => {
  const slotted = {
    ...auroraBundle,
    manifest: {
      ...auroraBundle.manifest,
      name: 'aurora-slotted',
      assetSlots: [{ id: 'menu-pages', label: 'Menu pages', accept: ['jpg', 'png'], max: 8 }],
    },
  };
  assert.strictEqual((await call('POST', '/v1/templates', { key: fullKey, body: slotted })).status, 201);
  const mk = await call('POST', '/v1/sites', { key: fullKey, body: { templateId: 'aurora-slotted', config: { siteName: 'Slotted Cafe' } } });
  assert.strictEqual(mk.status, 202);
  const slots = await call('GET', `/v1/sites/${mk.body.siteId}/assets`, { key: fullKey });
  const extra = slots.body.slots.find((s) => s.id === 'menu-pages');
  assert.strictEqual(extra.declaredBy, 'aurora-slotted');
  assert.strictEqual(extra.target, 'public/assets/menu-pages/');
  // A reserved-id assetSlot is now NORMALIZED AWAY at import (the standard slot
  // already exists, so it is harmless to drop) with a warning, rather than
  // hard-rejected — part of making a generated template never fail on a
  // mechanical metadata mistake.
  const badSlots = { ...auroraBundle, manifest: { ...auroraBundle.manifest, name: 'aurora-bad-slots', assetSlots: [{ id: 'logo', label: 'Logo' }] } };
  const normalized = await call('POST', '/v1/templates', { key: fullKey, body: badSlots });
  assert.strictEqual(normalized.status, 201);
  assert.strictEqual((normalized.body.warnings || []).some((w) => /assetSlots/.test(w)), true);
  await call('DELETE', '/v1/templates/aurora-bad-slots', { key: fullKey });
  await call('DELETE', '/v1/templates/aurora-slotted', { key: fullKey });
});
await check('GET /v1/sites lists only the caller\'s sites, newest first', async () => {
  const mine = await call('GET', '/v1/sites', { key: fullKey });
  assert.strictEqual(mine.body.sites.some((s) => s.id === siteId), true);
  assert.strictEqual(mine.body.sites.every((s) => typeof s.siteName === 'string' && s.templateId), true);
  const theirs = await call('GET', '/v1/sites', { key: otherAccountKey });
  assert.strictEqual(theirs.body.sites.some((s) => s.id === siteId), false);
});

// ── Connections: BYO hosting credentials ────────────────────────────────
console.log('connections:');
await check('connections: set → masked read (token never echoed), scoped per account', async () => {
  const put = await call('PUT', '/v1/connections/vercel', { key: fullKey, body: { token: 'vercel_tok_abc123XYZ9' } });
  assert.strictEqual(put.status, 200);
  assert.strictEqual(put.body.connections.vercel.connected, true);
  assert.strictEqual(put.body.connections.vercel.last4, 'XYZ9');
  assert.strictEqual(JSON.stringify(put.body).includes('vercel_tok_abc123XYZ9'), false, 'full token never in a response');
  const gh = await call('PUT', '/v1/connections/github', { key: fullKey, body: { token: 'ghp_e2etoken1234', owner: 'ada-web-co' } });
  assert.strictEqual(gh.body.connections.github.owner, 'ada-web-co');
  const theirs = await call('GET', '/v1/connections', { key: otherAccountKey });
  assert.strictEqual(theirs.body.connections.vercel.connected, false, 'connections are per-account');
});
await check('connections: encrypted at rest — raw store never contains token plaintext', async () => {
  const dir = path.join(varDir, 'connections');
  const raw = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
  assert.strictEqual(raw.includes('vercel_tok_abc123XYZ9'), false);
  assert.strictEqual(raw.includes('ghp_e2etoken1234'), false);
  assert.strictEqual(raw.includes('"enc"'), true, 'ciphertext structure present');
});
await check('connections: unknown provider 422, bad token 400, delete works', async () => {
  assert.strictEqual((await call('PUT', '/v1/connections/netlify', { key: fullKey, body: { token: 'x'.repeat(20) } })).status, 422);
  assert.strictEqual((await call('PUT', '/v1/connections/turso', { key: fullKey, body: { token: 'has spaces' } })).status, 400);
  assert.strictEqual((await call('DELETE', '/v1/connections/github', { key: fullKey })).status, 200);
  assert.strictEqual((await call('DELETE', '/v1/connections/github', { key: fullKey })).status, 404);
});
await check('deploy actuator: 409 before assembly; per-site targets endpoint works', async () => {
  // This (dry-assembled) site has no real repo to push.
  const notAssembled = await call('POST', `/v1/sites/${siteId}/deploy`, { key: fullKey, body: {} });
  assert.strictEqual(notAssembled.status, 409);
  assert.strictEqual(notAssembled.body.error.code, 'not_assembled');
  // Per-site deploy target: none saved yet; account default reflected.
  const tgt = await call('GET', `/v1/sites/${siteId}/deploy-target`, { key: fullKey });
  assert.strictEqual(tgt.status, 200);
  assert.strictEqual(tgt.body.site, null);
});
await check('create-first flow: assemble:false creates without building; photos then build', async () => {
  const made = await call('POST', '/v1/sites', { key: fullKey, body: {
    templateId: 'd4-site-template', config: { siteName: 'Photos First Co' }, assemble: false,
  } });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.body.status, 'created');
  const detail = await call('GET', `/v1/sites/${made.body.siteId}`, { key: fullKey });
  assert.strictEqual(detail.body.jobs.length, 0, 'no build yet');
  // Upload a photo BEFORE the first build…
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const up = await call('POST', `/v1/sites/${made.body.siteId}/assets/logo`, { key: fullKey, body: { filename: 'first.png', contentBase64: png.toString('base64') } });
  assert.strictEqual(up.status, 201);
  // …then the first build includes it (dry: recorded in the marker).
  const built = await call('POST', `/v1/sites/${made.body.siteId}/assemble`, { key: fullKey, body: { force: true } });
  assert.strictEqual(built.status, 202);
  await waitForJob(fullKey, built.body.jobId);
  const marker = JSON.parse(fs.readFileSync(path.join(varDir, 'workspaces', made.body.siteId, 'd4.assembly.json'), 'utf-8'));
  assert.strictEqual(marker.assets.logo.length, 1, 'first build already carries the photo');
});

// ── Workbench: static pages + the BYO-key chat relay ────────────────────
console.log('workbench:');
await check('/ redirects into the Console; the Workbench serves at /workbench/; no auth for pages', async () => {
  const home = await fetch(BASE + '/', { redirect: 'manual' });
  assert.strictEqual(home.status, 302);
  assert.strictEqual(home.headers.get('location'), '/workbench/');
  const wb = await fetch(BASE + '/workbench/');
  assert.strictEqual(wb.status, 200);
  assert.strictEqual((await wb.text()).includes('Workbench'), true);
  assert.strictEqual((await fetch(BASE + '/workbench/app.js')).status, 200);
  assert.strictEqual((await fetch(BASE + '/workbench/styles.css')).status, 200);
  const redir = await fetch(BASE + '/workbench', { redirect: 'manual' });
  assert.strictEqual(redir.status, 302);
  assert.strictEqual(redir.headers.get('location'), '/workbench/');
});
await check('static serving refuses traversal and unknown paths', async () => {
  assert.strictEqual((await fetch(BASE + '/server.mjs')).status, 404);
  assert.strictEqual((await fetch(BASE + '/workbench/..%2F..%2Fserver.mjs')).status, 404);
  assert.strictEqual((await fetch(BASE + '/app.js')).status, 404, 'workbench assets are not at the root');
});
await check('request-access: stores valid leads, rejects junk, throttles per IP', async () => {
  const post = (body) => call('POST', '/site/request-access', { body });
  const good = await post({ name: 'Ada Agency', email: 'ada@example.com', company: 'Ada Web Co', message: 'We ship ~20 sites a year.' });
  assert.strictEqual(good.status, 201);
  assert.strictEqual(good.body.ok, true);
  assert.strictEqual((await post({ name: '', email: 'ada@example.com' })).status, 400);
  assert.strictEqual((await post({ name: 'Ada', email: 'not-an-email' })).status, 400);
  // Per-IP throttle is 5/hour; the calls above used 3 slots, so two more fill it.
  for (let i = 0; i < 2; i += 1) await post({ name: 'Ada', email: 'ada@example.com' });
  assert.strictEqual((await post({ name: 'Ada', email: 'ada@example.com' })).status, 429);
});
await check('studio relay: needs a Stardrive key; dormant (501) until the operator configures the model; no customer key involved', async () => {
  // No Stardrive key at all → 401.
  assert.strictEqual((await call('POST', '/workbench/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } })).status, 401);
  // Health advertises the Studio as off in this env (no STARDRIVE_LLM_KEY).
  const health = await call('GET', '/v1/health');
  assert.strictEqual(health.body.studio.enabled, false);
  assert.strictEqual(health.body.studio.model, null);
  // Valid key + valid messages, but model unconfigured → honest 501 (never calls out).
  const dormant = await call('POST', '/workbench/chat', { key: fullKey, body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.strictEqual(dormant.status, 501);
  assert.strictEqual(dormant.body.error.code, 'studio_unconfigured');
  assert.strictEqual(dormant.body.error.message.includes('no key of yours'), true);
});
await check('studio fair-use: an oversized request is capped (413) before any model spend', async () => {
  const huge = 'x'.repeat(320_000);
  const big = await call('POST', '/workbench/chat', { key: fullKey, body: { messages: [{ role: 'user', content: huge }] } });
  assert.strictEqual(big.status, 413);
  assert.strictEqual(big.body.error.code, 'input_too_large');
  const manyTurns = { messages: Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'turn' })) };
  const long = await call('POST', '/workbench/chat', { key: fullKey, body: manyTurns });
  assert.strictEqual(long.status, 413);
  assert.strictEqual(long.body.error.code, 'conversation_too_long');
});

// ── Batch Building (Agency perk) ─────────────────────────────────────────
console.log('batch building:');
// Everything content.mjs requires of a site with no feature modules. A batch
// build carries the same intake an interactive one does, so a submit without
// these is refused before any token is spent.
const BATCH_FACTS = {
  whatYouDo: 'We build simple things.',
  aboutFacts: 'Started in 2020, two people, still hands on.',
  services: ['Consulting'],
  contactEmail: 'hello@batch.example',
};

await check('batch endpoints: empty list, honest 501 while unconfigured, 404 isolation', async () => {
  // The list is account-scoped and starts empty (batches + backlog shape).
  const ls = await call('GET', '/v1/batches', { key: fullKey });
  assert.strictEqual(ls.status, 200);
  assert.deepStrictEqual(ls.body, { batches: [], backlog: [] });
  // Submitting with no operator model key: the plan gate passes (beta has
  // batch), the readiness gate passes (every question answered), and then the
  // provider seam answers an honest 501 — never a fake queue.
  const sub = await call('POST', '/v1/batches', { key: fullKey, body: {
    builds: [{ name: 'Batch Test Co', siteName: 'Batch Test Co', prompt: 'A simple site.', facts: BATCH_FACTS }],
  } });
  assert.strictEqual(sub.status, 501);
  assert.strictEqual(sub.body.error.code, 'studio_unconfigured');
  // Unknown batch id → 404; malformed id → 400.
  const miss = await call('GET', '/v1/batches/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', { key: fullKey });
  assert.strictEqual(miss.status, 404);
  const badId = await call('GET', '/v1/batches/not-a-uuid', { key: fullKey });
  assert.strictEqual(badId.status, 400);
});

await check('batch intake: a build missing required answers is refused before any model spend', async () => {
  const sub = await call('POST', '/v1/batches', { key: fullKey, body: {
    builds: [{ name: 'Thin Co', siteName: 'Thin Co', prompt: 'A simple site.', facts: { whatYouDo: 'Things.' } }],
  } });
  assert.strictEqual(sub.status, 422, 'gated before the provider seam is reached at all');
  assert.strictEqual(sub.body.error.code, 'builds_incomplete');
  assert.strictEqual(sub.body.builds[0].index, 0);
  assert.strictEqual(sub.body.builds[0].missing.length, 3, 'every unanswered question is named at once');
});

await check('batch draft: rows save with readiness, photos stage per row, an empty draft cannot submit', async () => {
  const empty = await call('GET', '/v1/batches/draft', { key: fullKey });
  assert.strictEqual(empty.status, 200);
  assert.deepStrictEqual(empty.body.rows, []);
  assert.strictEqual(empty.body.max, 20);

  const saved = await call('PUT', '/v1/batches/draft', { key: fullKey, body: {
    rows: [{ name: 'Draft Co', siteName: 'Draft Co', prompt: 'A calm site.', features: ['careers'], facts: BATCH_FACTS }],
  } });
  assert.strictEqual(saved.status, 200);
  const row = saved.body.rows[0];
  assert.deepStrictEqual(row.modules, ['d4-careers-portal']);
  assert.strictEqual(row.readiness.submittable, false, 'careers has not listed its roles yet');
  assert.deepStrictEqual(row.readiness.missing.map((m) => m.label), ['Open roles']);

  // A photo staged against the row, before the site it belongs to exists.
  const up = await call('POST', `/v1/batches/draft/rows/${row.rowId}/assets/logo`, {
    key: fullKey,
    body: { filename: 'logo.svg', contentBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') },
  });
  assert.strictEqual(up.status, 201);
  const listed = await call('GET', `/v1/batches/draft/rows/${row.rowId}/assets`, { key: fullKey });
  assert.strictEqual(listed.body.assets.logo.length, 1);
  const reread = await call('GET', '/v1/batches/draft', { key: fullKey });
  assert.strictEqual(reread.body.rows[0].photos, 1, 'the row reports its staged photo');

  // Another licensee cannot see or touch that row.
  const foreign = await call('GET', `/v1/batches/draft/rows/${row.rowId}/assets`, { key: otherAccountKey });
  assert.strictEqual(foreign.status, 404);

  const cleared = await call('DELETE', '/v1/batches/draft', { key: fullKey });
  assert.strictEqual(cleared.status, 200);
  const gone = await call('POST', '/v1/batches', { key: fullKey, body: {} });
  assert.strictEqual(gone.status, 400, 'an empty draft cannot be submitted');
});

// These four run on the SECOND licensee: that account never connects a host,
// so the "Stardrive holds no token here" path is exercised for real (and no
// live Vercel call is made from the suite).
await check('custom domain: set, read, re-check, remove — host-agnostic and honest about what it knows', async () => {
  const made = await call('POST', '/v1/sites', { key: otherAccountKey, body: {
    templateId: 'd4-site-template', config: { siteName: 'Domain Co' }, assemble: false,
  } });
  assert.strictEqual(made.status, 201);
  const id = made.body.siteId;

  const none = await call('GET', `/v1/sites/${id}/domain`, { key: otherAccountKey });
  assert.strictEqual(none.body.domain, null);
  assert.strictEqual(none.body.siteUrlEnv, 'NEXT_PUBLIC_SITE_URL', 'the canonical-URL variable is named up front');

  // What people actually paste is accepted; junk is not.
  const set = await call('PUT', `/v1/sites/${id}/domain`, { key: otherAccountKey, body: { name: 'https://WWW.TheClient.com/pricing' } });
  assert.strictEqual(set.status, 200);
  assert.strictEqual(set.body.domain.name, 'theclient.com', 'scheme, www, path and case all normalized away');
  assert.strictEqual(set.body.siteUrlValue, 'https://theclient.com');
  const bad = await call('PUT', `/v1/sites/${id}/domain`, { key: otherAccountKey, body: { name: 'not a domain' } });
  assert.strictEqual(bad.status, 422);
  assert.strictEqual(bad.body.error.code, 'bad_domain');

  // With no host token, Stardrive says so instead of inventing DNS values.
  const view = await call('GET', `/v1/sites/${id}/domain`, { key: otherAccountKey });
  assert.strictEqual(view.body.manageable, false, 'no Vercel token on this account');
  assert.ok(view.body.records.length, 'the record SHAPE is still shown');
  assert.strictEqual(view.body.records[0].value, null, 'no invented IP for a host we cannot see');
  assert.strictEqual(view.body.records[0].source, 'shape');
  const verify = await call('POST', `/v1/sites/${id}/domain/verify`, { key: otherAccountKey });
  assert.strictEqual(verify.status, 422, 'cannot check a host we hold no token for');
  assert.strictEqual(verify.body.error.code, 'no_target');

  const gone = await call('DELETE', `/v1/sites/${id}/domain`, { key: otherAccountKey });
  assert.strictEqual(gone.status, 200);
  assert.match(gone.body.note, /still at your registrar/i, 'honest that DNS is untouched');
  assert.strictEqual((await call('GET', `/v1/sites/${id}/domain`, { key: otherAccountKey })).body.domain, null);
  await call('DELETE', `/v1/sites/${id}`, { key: otherAccountKey });
});

await check('studio draft: a design survives a reload, and an oversized one is refused', async () => {
  const empty = await call('GET', '/v1/studio/draft', { key: otherAccountKey });
  assert.strictEqual(empty.status, 200);
  assert.deepStrictEqual(empty.body.messages, []);

  const saved = await call('PUT', '/v1/studio/draft', { key: otherAccountKey, body: {
    brief: { business: 'a bakery', vibe: 'Warm & friendly' },
    features: ['contact-form'],
    messages: [{ role: 'user', content: 'Design a bakery site.' }, { role: 'assistant', content: '=== FILE: manifest.json ===\n{}\n=== END FILE ===' }],
  } });
  assert.strictEqual(saved.status, 200);
  const back = await call('GET', '/v1/studio/draft', { key: otherAccountKey });
  assert.strictEqual(back.body.brief.business, 'a bakery');
  assert.strictEqual(back.body.messages.length, 2);
  assert.deepStrictEqual(back.body.features, ['contact-form']);

  const huge = await call('PUT', '/v1/studio/draft', { key: otherAccountKey, body: {
    messages: [{ role: 'assistant', content: 'x'.repeat(3_600_000) }],
  } });
  assert.strictEqual(huge.status, 413, 'a runaway draft cannot grow the var dir without bound');

  assert.strictEqual((await call('DELETE', '/v1/studio/draft', { key: otherAccountKey })).status, 200);
  assert.deepStrictEqual((await call('GET', '/v1/studio/draft', { key: otherAccountKey })).body.messages, []);
});

await check('templates: own bundles are reopenable, the shared catalog is not, thumbnails 404 cleanly', async () => {
  // Re-import the fixture: a design has to be reopenable to be refinable.
  assert.strictEqual((await call('POST', '/v1/templates', { key: otherAccountKey, body: auroraBundle })).status < 300, true);
  const mine = await call('GET', '/v1/templates/aurora-template?include=files', { key: otherAccountKey });
  assert.strictEqual(mine.status, 200);
  assert.ok(Array.isArray(mine.body.files) && mine.body.files.length, 'the bundle comes back so it can be refined');
  assert.ok(mine.body.files[0].path && typeof mine.body.files[0].content === 'string');

  const shared = await call('GET', '/v1/templates/d4-site-template?include=files', { key: otherAccountKey });
  assert.strictEqual(shared.status, 403, 'the first-party catalog is not the licensee\'s to edit');
  assert.strictEqual(shared.body.error.code, 'not_editable');
  // Without ?include=files the catalog manifest is still readable.
  assert.strictEqual((await call('GET', '/v1/templates/d4-site-template', { key: otherAccountKey })).status, 200);

  const shot = await call('GET', '/v1/templates/aurora-template/thumbnail', { key: otherAccountKey });
  assert.strictEqual(shot.status, 404, 'no screenshot without the full QA tier, and it says so');
  assert.strictEqual(shot.body.error.code, 'no_thumbnail');
  await call('DELETE', '/v1/templates/aurora-template', { key: otherAccountKey });
});

await check('studio previews stay out of the client roster', async () => {
  const before = (await call('GET', '/v1/sites', { key: otherAccountKey })).body.sites.length;
  const demo = await call('POST', '/v1/sites', { key: otherAccountKey, body: {
    templateId: 'd4-site-template', config: { siteName: 'Preview · demo' }, assemble: false, preview: true,
  } });
  assert.strictEqual(demo.status, 201);
  const after = await call('GET', '/v1/sites', { key: otherAccountKey });
  assert.strictEqual(after.body.sites.length, before, 'the demo is not in the client list');
  const withPreviews = await call('GET', '/v1/sites?include=previews', { key: otherAccountKey });
  assert.strictEqual(withPreviews.body.sites.length, before + 1, 'but it is still reachable when asked for');

  // A second preview supersedes the first rather than piling up.
  await call('POST', '/v1/sites', { key: otherAccountKey, body: {
    templateId: 'd4-site-template', config: { siteName: 'Preview · demo 2' }, assemble: false, preview: true,
  } });
  const again = await call('GET', '/v1/sites?include=previews', { key: otherAccountKey });
  assert.strictEqual(again.body.sites.filter((s) => s.siteName.startsWith('Preview')).length, 1, 'only the newest demo is kept');
});

await check('content fields: the intake schema for a build that has no site yet', async () => {
  const base = await call('GET', '/v1/content/fields', { key: fullKey });
  assert.strictEqual(base.status, 200);
  assert.deepStrictEqual(base.body.modules, []);
  assert.strictEqual(base.body.fields.filter((f) => f.required).length, 4, 'four questions every site must answer');
  assert.ok(base.body.groups.identity, 'the group labels come with it');
  const careers = await call('GET', '/v1/content/fields?features=careers', { key: fullKey });
  assert.deepStrictEqual(careers.body.modules, ['d4-careers-portal']);
  assert.ok(careers.body.fields.some((f) => f.id === 'roles' && f.required), 'the module adds its own required question');
});

// ── Usage metering ───────────────────────────────────────────────────────
console.log('usage:');
await check('per-key counters reflect this suite', async () => {
  const { body } = await call('GET', '/v1/usage', { key: fullKey });
  const c = body.counters;
  assert.strictEqual(c.requests >= 20, true, `requests=${c.requests}`);
  // Failed calls (4xx/5xx) are never metered; the full key performs exactly
  // one successful parse in this suite (the other ran on the mappings key).
  assert.strictEqual(c['intake.parse'] >= 1, true, `intake.parse=${c['intake.parse']}`);
  assert.strictEqual(c['sites.assemble'] >= 2, true);
  assert.strictEqual(c['sites.change'] >= 1, true);
  assert.strictEqual(c['mappings.validate'] >= 2, true);
  assert.strictEqual(c['templates.validate'] >= 2, true);
});
await check('keys meter separately', async () => {
  const { body } = await call('GET', '/v1/usage', { key: mappingsOnlyKey });
  assert.strictEqual(body.counters['intake.parse'], 1);
  assert.strictEqual((body.counters['sites.assemble'] || 0), 0);
});

// ── Real engine (vendored d4 assembler) ──────────────────────────────────
console.log('real engine:');
await check('STARDRIVE_ENGINE=real assembles a genuine Next.js site, QA passes, export is a real tar.gz', async () => {
  const PORT_D = 4654;
  await startServer(PORT_D, { STARDRIVE_ENGINE: 'real' });
  const base = `http://localhost:${PORT_D}`;
  // Feature toggles map to modules: gallery + blog (each auto-pulls cms-core).
  const mk = await call('POST', '/v1/sites', { key: fullKey, base, body: {
    templateId: 'd4-site-template',
    config: { siteName: 'Real Fab Co', tagline: 'We build.', contactEmail: 'hi@realfab.example', pairing: 'industrial-confidence', modules: ['d4-gallery-editor', 'd4-insights-blog'] },
  } });
  assert.strictEqual(mk.status, 202);
  assert.strictEqual((await call('GET', '/v1/health', { base })).body.qa, 'structural', 'real engine defaults to structural QA');
  const job = await waitForJob(fullKey, mk.body.jobId, 30000);
  assert.strictEqual(job.status, 'done', 'real assembly completes');
  assert.strictEqual(job.result.engine, 'real');
  assert.strictEqual(job.result.qa.verdict, 'passed');
  assert.strictEqual(job.result.qa.checks.some((c) => c.name.includes('contrast') && c.status === 'pass'), true);
  assert.strictEqual(job.result.files > 10, true, 'a real site has many files');
  assert.strictEqual(job.result.assembly.routes.includes('/'), true);
  // The selected feature-modules produced real routes, deps auto-resolved.
  assert.strictEqual(job.result.assembly.routes.includes('/gallery'), true, 'gallery module route');
  assert.strictEqual(job.result.assembly.routes.includes('/insights'), true, 'blog module route');
  assert.strictEqual(Object.keys(job.result.assembly.modules).includes('d4-cms-core'), true, 'cms-core dependency auto-resolved');
  // The assembled site really exists on disk, with the per-client config baked in.
  const ws = path.join(varDir, 'workspaces', mk.body.siteId);
  assert.strictEqual(fs.existsSync(path.join(ws, 'package.json')), true);
  assert.strictEqual(fs.readFileSync(path.join(ws, 'src/config/site.ts'), 'utf-8').includes('Real Fab Co'), true);
  // Export → a real gzip stream (engine never included — it's a standalone site).
  const exp = await fetch(`${base}/v1/sites/${mk.body.siteId}/export`, { headers: { Authorization: `Bearer ${fullKey}` } });
  assert.strictEqual(exp.status, 200);
  assert.strictEqual((exp.headers.get('content-type') || '').includes('gzip'), true);
  const buf = Buffer.from(await exp.arrayBuffer());
  assert.strictEqual(buf[0] === 0x1f && buf[1] === 0x8b, true, 'gzip magic bytes');
  assert.strictEqual(buf.length > 1000, true, 'non-trivial archive');
  // Deploy of a real, assembled site with no target anywhere → clear guidance.
  const dep = await call('POST', `/v1/sites/${mk.body.siteId}/deploy`, { key: fullKey, base, body: {} });
  assert.strictEqual(dep.status, 422);
  assert.strictEqual(dep.body.error.code, 'no_target');
  assert.strictEqual(dep.body.error.message.includes('different account'), true);
  // The generated asset map exists in the assembled site (empty here).
  const gen = fs.readFileSync(path.join(varDir, 'workspaces', mk.body.siteId, 'src/config/assets.generated.ts'), 'utf-8');
  assert.strictEqual(gen.includes('siteAssets'), true);
});
await check('real engine: a bad module fails the job honestly (never a fake pass)', async () => {
  const base = 'http://localhost:4654';
  const mk = await call('POST', '/v1/sites', { key: fullKey, base, body: {
    templateId: 'd4-site-template', config: { siteName: 'Broken Co', modules: ['d4-does-not-exist'] },
  } });
  assert.strictEqual(mk.status, 202);
  const job = await waitForJob(fullKey, mk.body.jobId, 30000);
  assert.strictEqual(job.status, 'failed');
  assert.strictEqual((job.logs.at(-1)?.line || '').includes('Assembly failed'), true);
});
await check("real engine: d4 modules layer onto a customer's OWN imported template", async () => {
  const base = 'http://localhost:4654';
  // A gate-clean, module-compatible customer base (has package.json, which the
  // assembler needs to merge module deps into).
  const ownTemplate = {
    manifest: {
      name: 'my-own-template', version: '1.0.0', kind: 'site',
      description: 'Customer-authored base for the imported+modules test.',
      provides: { routes: ['/', '/about', '/contact'], nav: [], adminPanels: [], collections: [] },
      copy: [{ from: 'files', to: '.' }],
    },
    files: [
      { path: 'package.json', content: JSON.stringify({ name: 'placeholder', version: '0.1.0', dependencies: {}, devDependencies: {} }, null, 2) },
      ...REQUIRED_SITE_FILES.map((p) => ({
        path: p,
        content: p.endsWith('theme.css')
          ? ':root { --accent: 67 56 202; --text-muted: 90 90 90; }\n.dark { --accent: 159 153 255; --text-muted: 170 170 170; }\n'
          : `// ${p}\nexport {};\n`,
      })),
    ],
  };
  assert.strictEqual((await call('POST', '/v1/templates', { key: fullKey, base, body: ownTemplate })).status < 300, true, 'imported the customer template');
  // Assemble it WITH the gallery + blog modules layered on (blog pulls cms-core).
  const mk = await call('POST', '/v1/sites', { key: fullKey, base, body: {
    templateId: 'my-own-template', config: { siteName: 'Imported Plus', modules: ['d4-gallery-editor', 'd4-insights-blog'] },
  } });
  assert.strictEqual(mk.status, 202);
  const job = await waitForJob(fullKey, mk.body.jobId, 30000);
  assert.strictEqual(job.status, 'done', 'imported + modules assembly completes');
  assert.strictEqual(job.result.qa.verdict, 'passed');
  assert.strictEqual(job.result.assembly.imported, true);
  assert.strictEqual(job.result.assembly.routes.includes('/'), true, 'the customer base routes survive');
  assert.strictEqual(job.result.assembly.routes.includes('/gallery'), true, 'gallery module layered on');
  assert.strictEqual(job.result.assembly.routes.includes('/insights'), true, 'blog module layered on');
  assert.strictEqual(Object.keys(job.result.assembly.modules).includes('d4-cms-core'), true, 'dependency auto-resolved');
  // The customer's per-client name was written into their own base config.
  const siteTs = fs.readFileSync(path.join(varDir, 'workspaces', mk.body.siteId, 'src/config/site.ts'), 'utf-8');
  assert.strictEqual(siteTs.includes('Imported Plus'), true);
});

// ── Rate limiting (separate low-limit server) ────────────────────────────
console.log('rate limiting:');
await check('a burst past the per-key limit gets 429 + Retry-After', async () => {
  await startServer(PORT_B, { RATE_LIMIT_PER_MIN: '5' });
  const base = `http://localhost:${PORT_B}`;
  let last;
  for (let i = 0; i < 7; i++) last = await call('GET', '/v1/usage', { key: fullKey, base });
  assert.strictEqual(last.status, 429);
  assert.strictEqual(last.body.error.code, 'rate_limited');
  assert.strictEqual(Number(last.headers.get('retry-after')) >= 1, true);
});

await check('signup is rationed per address, and only a CREATED account counts', async () => {
  // A random port: a leftover server from an interrupted run holding a fixed
  // one makes this look like a product failure when it is a port collision.
  const PORT_D = 4800 + Math.floor(Math.random() * 150);
  await startServer(PORT_D, { SIGNUP_LIMIT_PER_HOUR: '2' });
  const base = `http://localhost:${PORT_D}`;
  const signup = (body) => cookieCall('POST', '/auth/signup', { body, base });

  // Rejected attempts are free: they cost nothing to serve, and a typo must
  // not burn a legitimate person's allowance. Two of them, then a duplicate,
  // all while only ONE account has actually been created.
  assert.strictEqual((await signup({ email: 'nope', password: 'longenough' })).status, 400);
  assert.strictEqual((await signup({ email: `a+${Date.now()}@e.com`, password: 'short' })).status, 400);
  const taken = `one+${Date.now()}@e.com`;
  assert.strictEqual((await signup({ email: taken, password: 'longenough' })).status, 201, 'account 1 of 2');
  assert.strictEqual((await signup({ email: taken, password: 'longenough' })).status, 409, 'a duplicate is refused, and costs nothing');

  // Only real creations count, so the second one still gets through.
  assert.strictEqual((await signup({ email: `two+${Date.now()}@e.com`, password: 'longenough' })).status, 201, 'account 2 of 2');

  const over = await signup({ email: `three+${Date.now()}@e.com`, password: 'longenough' });
  assert.strictEqual(over.status, 429, 'the third real account from this address is refused');
  assert.strictEqual(over.body.error.code, 'rate_limited');
});

await check('email verification is dormant when no email provider is configured', async () => {
  // Locking someone out of a capability we have no way to unlock would be a
  // bug, not a safeguard: with no provider, accounts arrive verified.
  const me = await cookieCall('GET', '/auth/me', { cookie: sessionCookie });
  assert.strictEqual(me.body.account.emailVerified, true);
  // And the model-spend gate lets them through to the honest 501.
  const relay = await call('POST', '/workbench/chat', { key: sessionKeySecret, body: { messages: [{ role: 'user', content: 'hi' }] } });
  assert.strictEqual(relay.status, 501, 'stopped by the dormant model, not by verification');
  // A person clicks this link, so a stale one lands them in the Console
  // rather than showing them raw JSON. redirect:'manual' to see the 302.
  const bad = await fetch(`${BASE}/auth/verify?token=${'f'.repeat(64)}`, { redirect: 'manual' });
  assert.strictEqual(bad.status, 302);
  assert.match(bad.headers.get('location'), /verified=0/);
});

await check('an account can take its data with it, and then really leave', async () => {
  // Its own server: this check signs up several times and would otherwise
  // trip the per-address signup ration that the suite has already spent.
  const PORT_E = 4850 + Math.floor(Math.random() * 140);
  await startServer(PORT_E, { SIGNUP_LIMIT_PER_HOUR: '50' });
  const base = `http://localhost:${PORT_E}`;
  const cookieCall = (m, p, o = {}) => cookieCallBase(m, p, { ...o, base });
  const call = (m, p, o = {}) => callBase(m, p, { ...o, base });

  // A licensee with something to lose: a template, a site, and hosting.
  const email = `leaver+${Date.now()}@example.com`;
  const made = await cookieCall('POST', '/auth/signup', { body: { email, password: 'longenough', company: 'Leaving Co' } });
  assert.strictEqual(made.status, 201);
  const cookie = `sd_session=${made.token}`;
  const leaverKey = made.body.apiKey.secret;
  const accountId = made.body.account.id;

  await call('POST', '/v1/templates', { key: leaverKey, body: auroraBundle });
  const site = await call('POST', '/v1/sites', {
    key: leaverKey, body: { templateId: 'aurora-template', config: { siteName: 'Leaving Site' }, assemble: false },
  });
  assert.strictEqual(site.status, 201);
  await call('PUT', '/v1/connections/vercel', { key: leaverKey, body: { token: 'tok-leaving-1234' } });

  // Export: everything we hold, and deliberately nothing we should not.
  const exported = await cookieCall('GET', '/v1/account/export', { cookie });
  assert.strictEqual(exported.status, 200);
  assert.strictEqual(exported.body.account.email, email);
  assert.strictEqual(exported.body.templates.length, 1, 'their template is in it');
  assert.strictEqual(exported.body.sites.length, 1, 'their site is in it');
  assert.strictEqual(exported.body.apiKeys.length, 1, 'their keys are listed');
  const dump = JSON.stringify(exported.body);
  assert.strictEqual(dump.includes('tok-leaving-1234'), false, 'the hosting token is NOT exported, it is only stored encrypted');
  assert.strictEqual(dump.includes(leaverKey), false, 'nor the key secret, which is stored only as a hash');

  // Deleting takes both the password and a typed confirmation.
  assert.strictEqual((await cookieCall('DELETE', '/v1/account', { cookie, body: { confirm: email } })).status, 403, 'password required');
  assert.strictEqual((await cookieCall('DELETE', '/v1/account', { cookie, body: { password: 'longenough' } })).status, 400, 'confirmation required');
  assert.strictEqual((await cookieCall('DELETE', '/v1/account', { cookie, body: { password: 'wrong', confirm: email } })).status, 403);

  const gone = await cookieCall('DELETE', '/v1/account', { cookie, body: { password: 'longenough', confirm: email } });
  assert.strictEqual(gone.status, 200);
  assert.strictEqual(gone.body.deleted, true);
  assert.strictEqual(gone.body.sites, 1);
  assert.strictEqual(gone.body.templates, 1);

  // And it is really gone: no login, no session, no key, and the email is
  // free again rather than permanently burned.
  assert.strictEqual((await cookieCall('POST', '/auth/login', { body: { email, password: 'longenough' } })).status, 401, 'the account is gone');
  assert.strictEqual((await cookieCall('GET', '/auth/me', { cookie })).status, 401, 'the session died with it');
  assert.strictEqual((await call('GET', '/v1/templates', { key: leaverKey })).status, 401, 'the API key stopped working');
  const reused = await cookieCall('POST', '/auth/signup', { body: { email, password: 'longenough' } });
  assert.strictEqual(reused.status, 201, 'the address can be used again');
  assert.notStrictEqual(reused.body.account.id, accountId, 'as a genuinely new account');
});

// ── Studio configured (server-side model key present) ────────────────────
console.log('studio configured:');
await check('with the operator model key set, health advertises the Studio on + the configured model (key never exposed)', async () => {
  const PORT_C = 4653;
  await startServer(PORT_C, { STARDRIVE_LLM_KEY: 'operator-secret-should-never-surface', STARDRIVE_LLM_PROVIDER: 'anthropic', STARDRIVE_LLM_MODEL: 'claude-sonnet-5' });
  const base = `http://localhost:${PORT_C}`;
  const health = await call('GET', '/v1/health', { base });
  assert.strictEqual(health.body.studio.enabled, true);
  assert.strictEqual(health.body.studio.model, 'claude-sonnet-5');
  assert.strictEqual(JSON.stringify(health.body).includes('operator-secret'), false, 'the operator key is never in a response');
});

// ── Operator telemetry ───────────────────────────────────────────────────
console.log('ops:');
await check('public health is coarse: load and a degraded flag, never free disk', async () => {
  const { body } = await call('GET', '/v1/health');
  assert.strictEqual(body.degraded, false);
  assert.deepStrictEqual(Object.keys(body.builds).sort(), ['accountsWaiting', 'active', 'concurrency', 'queued']);
  assert.strictEqual('diskFreeMb' in body.builds, false, 'the internet does not need our disk numbers');
});

await check('with no operator token, /v1/ops is honestly dormant rather than open', async () => {
  const { status, body } = await call('GET', '/v1/ops');
  assert.strictEqual(status, 501);
  assert.strictEqual(body.error.code, 'ops_unconfigured');
  assert.match(body.error.message, /STARDRIVE_OPS_TOKEN/, 'and says how to switch it on');
});

await check('a licensee API key cannot read the operator view', async () => {
  const res = await fetch(`${BASE}/v1/ops`, { headers: { Authorization: `Bearer ${fullKey}` } });
  assert.notStrictEqual(res.status, 200, 'a customer key is not an operator token');
});

await check('with a token set: wrong token 401, right token returns the whole picture', async () => {
  const PORT_O = 4900 + Math.floor(Math.random() * 90);
  await startServer(PORT_O, { STARDRIVE_OPS_TOKEN: 'operator-token-abcdef' });
  const base = `http://localhost:${PORT_O}`;
  const opsCall = (m, token) => fetch(base + '/v1/ops', {
    method: m, headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  assert.strictEqual((await opsCall('GET')).status, 401, 'no token');
  assert.strictEqual((await opsCall('GET', 'wrong')).status, 401, 'wrong token');
  assert.strictEqual((await opsCall('GET', 'operator-token-abcdefX')).status, 401, 'a prefix is not enough');
  const res = await opsCall('GET', 'operator-token-abcdef');
  assert.strictEqual(res.status, 200);
  const snap = await res.json();
  assert.ok(snap.uptimeSec >= 0);
  assert.ok(snap.requests.requests >= 3, 'the failed attempts were counted');
  assert.strictEqual(snap.requests.clientErrors >= 3, true, 'as client errors, not ours');
  assert.ok('diskFreeMb' in snap.builds, 'free disk lives here, behind the token');
  assert.deepStrictEqual(snap.alerts, [], 'a healthy deployment alerts about nothing');
  assert.strictEqual(snap.alerting.configured, false, 'no mail provider in this run');
});

await check('the watchdog can be run on demand, and finds nothing wrong here', async () => {
  const PORT_O = 5000 + Math.floor(Math.random() * 90);
  await startServer(PORT_O, { STARDRIVE_OPS_TOKEN: 'tok' });
  const res = await fetch(`http://localhost:${PORT_O}/v1/ops/check`, {
    method: 'POST', headers: { Authorization: 'Bearer tok' },
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.alerts, []);
  assert.strictEqual(body.checked.length, 0, 'nothing to watch on an idle, healthy box');
  const test = await fetch(`http://localhost:${PORT_O}/v1/ops/test-alert`, {
    method: 'POST', headers: { Authorization: 'Bearer tok' },
  });
  const t = await test.json();
  assert.strictEqual(t.sent, false);
  assert.strictEqual(t.reason, 'alerting_unconfigured', 'it says why rather than pretending it sent');
});

await check('a real bad condition on a real server reaches health and the ops view', async () => {
  const PORT_O = 5100 + Math.floor(Math.random() * 90);
  // An absurd disk floor makes the runner refuse builds for lack of space,
  // which is a genuine condition read off the real queue, not a stubbed one.
  await startServer(PORT_O, { STARDRIVE_OPS_TOKEN: 'tok', STARDRIVE_MIN_FREE_MB: '99999999' });
  const base = `http://localhost:${PORT_O}`;
  assert.strictEqual((await call('GET', '/v1/health', { base })).body.degraded, false, 'nothing has looked yet');
  const checked = await (await fetch(`${base}/v1/ops/check`, { method: 'POST', headers: { Authorization: 'Bearer tok' } })).json();
  assert.deepStrictEqual(checked.checked, [{ name: 'disk_low', action: 'alerted' }]);
  assert.strictEqual((await call('GET', '/v1/health', { base })).body.degraded, true, 'and now the public flag says so');
  const snap = await (await fetch(`${base}/v1/ops`, { headers: { Authorization: 'Bearer tok' } })).json();
  assert.strictEqual(snap.builds.diskOk, false);
  assert.strictEqual(snap.alerts[0].name, 'disk_low');
  assert.strictEqual(snap.alerts[0].notified, true);
  assert.strictEqual(snap.alerting.configured, false, 'it recorded it, it just had nowhere to send it');
});

await check('a real server records its start, and (on POSIX) marks a SIGTERM exit deliberate', async () => {
  // Its own var dir: this is about one process's boot record, and the rest of
  // the suite has a dozen servers writing to the shared one.
  const soloVar = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-ops-boot-'));
  const PORT_O = 5200 + Math.floor(Math.random() * 90);
  const child = await startServer(PORT_O, { STARDRIVE_VAR_DIR: soloVar });
  const bootsPath = path.join(soloVar, 'ops', 'boots.json');
  const first = JSON.parse(fs.readFileSync(bootsPath, 'utf-8'));
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].clean, false, 'a running process has not exited yet');
  assert.strictEqual(first[0].pid, child.pid);
  // The SIGTERM half only means anything on POSIX: Windows terminates the
  // process outright rather than delivering the signal, so no handler can run.
  // Production is a Linux container, where `docker stop` is a real SIGTERM.
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    const after = JSON.parse(fs.readFileSync(bootsPath, 'utf-8'));
    assert.strictEqual(after[0].clean, true, 'so the next process does not read a deploy as a crash');
  } else {
    child.kill();
  }
  fs.rmSync(soloVar, { recursive: true, force: true });
});

// ── Teardown ─────────────────────────────────────────────────────────────
for (const c of children) c.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll Stardrive API e2e checks passed.');
