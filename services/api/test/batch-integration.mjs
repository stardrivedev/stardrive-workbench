/**
 * Batch Building integration — the whole reconcile pipeline driven by a FAKE
 * provider (no real Batch API, fully deterministic, seconds not hours):
 *   submit → provider "completes" → designs parsed/autofixed/imported, copy
 *   packs normalized, sites created, assembles enqueued (dry engine) → builds
 *   land `ready`; a broken design fails ITS build only; requeue moves the spec
 *   to the backlog; generate-now (fake live relay) drives it to `ready`.
 *
 * Run: node services/api/test/batch-integration.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VarStore } from '../lib/store.mjs';
import { createJobRunner } from '../lib/jobs.mjs';
import { loadCatalog, createImportedStore } from '../lib/templates.mjs';
import { createBatches, MAX_BATCH_BUILDS } from '../lib/batches.mjs';
import { REQUIRED_SITE_FILES } from '../../../packages/template-kit/index.mjs';

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-batch-'));
const store = new VarStore(varDir);
const runner = createJobRunner(store, { engine: 'dry' });
const catalog = loadCatalog();
const imported = createImportedStore(store);

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A canned VALID design generation in the Studio delivery format. */
function cannedDesign(label) {
  const manifest = {
    name: 'canned', version: '1.0.0', kind: 'site',
    description: `Canned ${label} template for the batch integration test.`,
    provides: { routes: ['/', '/about', '/contact'], nav: [], adminPanels: [], collections: [] },
    copy: [{ from: 'files', to: '.' }],
  };
  const block = (p, c) => `=== FILE: ${p} ===\n${c}\n=== END FILE ===`;
  const filesrc = (p) => p.endsWith('theme.css')
    ? ':root { --accent: 67 56 202; --text-muted: 90 90 90; }\n.dark { --accent: 159 153 255; --text-muted: 170 170 170; }\n'
    : `// ${p} (${label})\nexport {};\n`;
  return [
    `Here is the template.\n`,
    block('manifest.json', JSON.stringify(manifest, null, 2)),
    block('package.json', JSON.stringify({ name: 'placeholder', version: '0.1.0', dependencies: {}, devDependencies: {} })),
    ...REQUIRED_SITE_FILES.map((p) => block(p, filesrc(p))),
  ].join('\n');
}

const cannedCopy = JSON.stringify({
  tagline: 'Canned tagline', description: 'Canned description of the business.',
  home: { heroHeadline: 'Canned hero', heroSubhead: 'Sub', ctaLabel: 'Go', introHeading: 'Intro', introBody: 'Body.' },
  about: { heading: 'About', paragraphs: ['One.', 'Two.'], mission: 'Mission.' },
  services: [{ name: 'Service A', description: 'Does A.' }],
  contact: { heading: 'Talk', intro: 'Say hi.' },
  faq: [], team: [],
});

// The fake provider: submit captures requests; poll walks a scripted status;
// outputs returns the canned per-request results.
const fake = {
  submitted: [], pollStatus: 'in_progress', results: {},
  async submit(requests) { this.submitted.push(requests); return { providerBatchId: `fake-${this.submitted.length}` }; },
  async poll() { return { status: this.pollStatus, counts: {}, outputFileId: this.pollStatus === 'completed' ? 'out-1' : null, errorFileId: null }; },
  async outputs() { return this.results; },
};

// The fake live relay for generate-now.
let liveCalls = 0;
const fakeRelay = async () => { liveCalls++; return { content: cannedDesign('live'), model: 'fake-live', tokens: 111 }; };

const metered = [];
const batches = createBatches(store, {
  runner, imported, catalog,
  accounts: { getAccount: () => ({ id: 'acct-1', plan: 'agency', email: null }) },
  email: { send: () => ({ sent: false }) },
  authMeter: (keyId, name, n = 1) => metered.push([name, n]),
  provider: fake,
  relay: fakeRelay,
});

const ACCT = 'acct-1';

async function waitFor(cond, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await batches.reconcile();
    if (cond()) return true;
    await sleep(60);
  }
  return cond();
}

console.log('batch building (fake provider):');

await check('submit: 2 builds -> 4 provider requests (design on Studio model + copy on copywriter model each)', async () => {
  const b = await batches.submit(ACCT, 'key-1', [
    { name: 'Solstice Bakery', siteName: 'Solstice Bakery', prompt: 'A warm bakery site.', features: ['contact-form', 'faq'], facts: { whatYouDo: 'We bake bread' } },
    { name: 'North Forge', siteName: 'North Forge Metalworks', prompt: 'An industrial metals site.', features: [], facts: {} },
  ]);
  assert.strictEqual(b.builds.length, 2);
  assert.strictEqual(b.status, 'in_progress');
  const reqs = fake.submitted[0];
  assert.strictEqual(reqs.length, 4);
  assert.deepStrictEqual(reqs.map((r) => r.customId), ['b0-design', 'b0-copy', 'b1-design', 'b1-copy']);
  assert.notStrictEqual(reqs[0].model, reqs[1].model, 'design and copy ride different models');
  assert.strictEqual(reqs[0].system.includes('REQUESTED FEATURES'), true, 'feature block present when features selected');
  globalThis.__batchId = b.id;
});

await check('reconcile while provider still running -> nothing changes', async () => {
  await batches.reconcile();
  const d = batches.detail(ACCT, globalThis.__batchId);
  assert.strictEqual(d.status, 'in_progress');
  assert.strictEqual(d.builds.every((b) => b.status === 'generating'), true);
});

await check('provider completes: good build -> ready; broken design -> failed, isolated', async () => {
  fake.pollStatus = 'completed';
  fake.results = {
    'b0-design': { content: cannedDesign('good'), tokens: 1800 },
    'b0-copy': { content: cannedCopy, tokens: 200 },
    'b1-design': { error: 'model refused' }, // the broken one
    'b1-copy': { content: cannedCopy, tokens: 200 },
  };
  const done = await waitFor(() => {
    const d = batches.detail(ACCT, globalThis.__batchId);
    return d.builds[0].status === 'ready' && d.builds[1].status === 'failed';
  });
  assert.strictEqual(done, true, 'build 0 ready + build 1 failed');
  const d = batches.detail(ACCT, globalThis.__batchId);
  assert.strictEqual(d.builds[0].templateName, 'solstice-bakery', 'template imported under the chosen name');
  assert.ok(d.builds[0].siteId, 'site created');
  const site = store.readJson(`sites/${d.builds[0].siteId}.json`);
  assert.strictEqual(site.copy.tagline, 'Canned tagline', 'batched copy pack landed on the site');
  assert.strictEqual(site.config.siteName, 'Solstice Bakery');
  assert.strictEqual(d.builds[1].stage, 'design');
  assert.match(d.builds[1].error, /model refused/);
  assert.strictEqual(metered.some(([n]) => n === 'studio.generations'), true, 'generation metered');
  assert.strictEqual(metered.some(([n, v]) => n === 'studio.tokens' && v === 2000), true, 'tokens metered');
});

await check('requeue: failed build spec joins the backlog; batch finishes', async () => {
  const r = batches.requeue(ACCT, globalThis.__batchId, 'b1');
  assert.strictEqual(r.backlogged, 1);
  assert.strictEqual(batches.backlogList(ACCT)[0].name, 'North Forge');
  const d = batches.detail(ACCT, globalThis.__batchId);
  assert.strictEqual(d.builds[1].status, 'requeued');
  assert.strictEqual(d.status, 'ready', 'all builds terminal -> batch ready');
});

await check('a new submit consumes matching backlog entries', async () => {
  fake.pollStatus = 'in_progress';
  const specs = batches.backlogList(ACCT);
  await batches.submit(ACCT, 'key-1', specs);
  assert.strictEqual(batches.backlogList(ACCT).length, 0, 'backlog consumed');
  globalThis.__batchId2 = batches.list(ACCT)[0].id;
});

await check('generate-now: a failed build regenerates on the live model to ready', async () => {
  // Fail the requeued build's new incarnation via the provider…
  fake.pollStatus = 'completed';
  fake.results = { 'b0-design': { error: 'nope' }, 'b0-copy': { content: cannedCopy, tokens: 100 } };
  await waitFor(() => batches.detail(ACCT, globalThis.__batchId2).builds[0].status === 'failed');
  // …then recover it immediately on the (fake) live relay.
  const g = batches.generateNow(ACCT, globalThis.__batchId2, 'b0');
  assert.strictEqual(g.status, 'generating');
  const ok = await waitFor(() => batches.detail(ACCT, globalThis.__batchId2).builds[0].status === 'ready');
  assert.strictEqual(ok, true, 'live regeneration lands ready');
  assert.strictEqual(liveCalls, 1, 'exactly one live design call');
});

await check('validation: empty, oversized, and malformed submissions are rejected', async () => {
  await assert.rejects(() => batches.submit(ACCT, 'k', []), /builds/);
  await assert.rejects(() => batches.submit(ACCT, 'k', Array.from({ length: MAX_BATCH_BUILDS + 1 }, (_, i) => ({ name: `t${i}`, siteName: 's', prompt: 'p' }))), /at most/);
  await assert.rejects(() => batches.submit(ACCT, 'k', [{ siteName: 's', prompt: 'p' }]), /name/);
});

await check('account isolation: another account cannot read or act on the batch', async () => {
  assert.throws(() => batches.detail('acct-2', globalThis.__batchId), /not found/);
  assert.throws(() => batches.requeue('acct-2', globalThis.__batchId, 'b1'), /not found/);
  assert.strictEqual(batches.list('acct-2').length, 0);
});

fs.rmSync(varDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll batch-integration checks passed.');
process.exit(0);
