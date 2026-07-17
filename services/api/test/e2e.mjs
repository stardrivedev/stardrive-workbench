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

async function call(method, pathname, { key, body, base = BASE } = {}) {
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
const goodManifest = JSON.parse(fs.readFileSync(path.join(API_DIR, 'data', 'catalog', 'd4-catalog.json'), 'utf-8'));

// ── Public + auth ────────────────────────────────────────────────────────
console.log('public + auth:');
await check('GET /v1/health is public and reports the engine', async () => {
  const { status, body } = await call('GET', '/v1/health');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.engine, 'dry');
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
await check('catalog lists the six bundled d4 modules', async () => {
  const { status, body } = await call('GET', '/v1/templates', { key: fullKey });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.templates.length, 6);
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
await check('template import is an honest 501', async () => {
  const { status, body } = await call('POST', '/v1/templates', { key: fullKey, body: { git: 'https://x' } });
  assert.strictEqual(status, 501);
  assert.strictEqual(body.error.code, 'not_implemented');
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
await check('deploy and export are honest 501s', async () => {
  const dep = await call('POST', `/v1/sites/${siteId}/deploy`, { key: fullKey, body: {} });
  assert.strictEqual(dep.status, 501);
  const exp = await call('GET', `/v1/sites/${siteId}/export`, { key: fullKey });
  assert.strictEqual(exp.status, 501);
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

// ── Teardown ─────────────────────────────────────────────────────────────
for (const c of children) c.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll Stardrive API e2e checks passed.');
