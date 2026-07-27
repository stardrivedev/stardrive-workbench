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
import { createAssets } from '../lib/assets.mjs';
import { loadCatalog, createImportedStore } from '../lib/templates.mjs';
import { createBatches, MAX_BATCH_BUILDS } from '../lib/batches.mjs';
import { REQUIRED_SITE_FILES } from '../../../packages/template-kit/index.mjs';

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-batch-'));
const store = new VarStore(varDir);
const runner = createJobRunner(store, { engine: 'dry' });
const catalog = loadCatalog();
const imported = createImportedStore(store);
const assets = createAssets(store);

/** The answers content.mjs requires of every site (no feature modules). */
const FULL_FACTS = {
  whatYouDo: 'We bake bread every morning.',
  aboutFacts: 'Family run since 2019. Everything is baked on site.',
  services: ['Sourdough', 'Pastries'],
  contactEmail: 'hello@solstice.example',
};

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
  runner, imported, catalog, assets,
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
    { name: 'Solstice Bakery', siteName: 'Solstice Bakery', tagline: 'Baked daily', prompt: 'A warm bakery site.', features: ['contact-form', 'faq'], facts: FULL_FACTS },
    { name: 'North Forge', siteName: 'North Forge Metalworks', prompt: 'An industrial metals site.', features: [], facts: FULL_FACTS },
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
  assert.strictEqual(site.config.tagline, 'Baked daily', 'tagline carried into the site config');
  assert.deepStrictEqual(site.content, FULL_FACTS, 'the full intake landed on the site, not just a name');
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
  assert.deepStrictEqual(specs[0].facts, FULL_FACTS, 'a requeued spec keeps its answers');
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
  const bad = batches.preflight([{ siteName: 's', prompt: 'p', facts: FULL_FACTS }]);
  assert.match(bad.problems[0].message, /name/, 'a row with no template name is reported, not thrown past');
});

await check('readiness gate: an incomplete build blocks the WHOLE submit and every gap is listed', async () => {
  const before = batches.list(ACCT).length;
  const providerCalls = fake.submitted.length;
  const err = await batches.submit(ACCT, 'key-1', [
    { name: 'Good One', siteName: 'Good One', prompt: 'p', features: [], facts: FULL_FACTS },
    { name: 'Thin One', siteName: 'Thin One', prompt: 'p', features: [], facts: { whatYouDo: 'We do things' } },
  ]).then(() => null, (e) => e);
  assert.ok(err, 'submit rejected');
  assert.strictEqual(err.code, 'builds_incomplete');
  assert.strictEqual(err.builds.length, 1, 'only the thin build is reported');
  assert.strictEqual(err.builds[0].index, 1);
  // The three unanswered required questions, by their intake labels.
  assert.deepStrictEqual(err.builds[0].missing.sort(), [
    'A few facts about the business', 'Contact email', 'Main services or offerings',
  ]);
  assert.strictEqual(batches.list(ACCT).length, before, 'nothing was submitted, not even the good build');
  assert.strictEqual(fake.submitted.length, providerCalls, 'no provider batch was opened, so no tokens were spent');
});

await check('readiness gate: a feature module pulls in its own required questions', async () => {
  const withCareers = batches.preflight([
    { name: 'Hiring Co', siteName: 'Hiring Co', prompt: 'p', features: ['careers'], facts: FULL_FACTS },
  ]);
  assert.deepStrictEqual(withCareers.problems[0].missing, ['Open roles'], 'careers demands its roles');
  const answered = batches.preflight([
    { name: 'Hiring Co', siteName: 'Hiring Co', prompt: 'p', features: ['careers'],
      facts: { ...FULL_FACTS, roles: [{ title: 'Welder', summary: 'Fabrication work.' }] } },
  ]);
  assert.strictEqual(answered.problems.length, 0, 'answered, so it passes');
});

await check('readiness gate: a malformed email is caught before the run, not after', async () => {
  const p = batches.preflight([
    { name: 'Typo Co', siteName: 'Typo Co', prompt: 'p', features: [], facts: { ...FULL_FACTS, contactEmail: 'not-an-email' } },
  ]);
  assert.match(p.problems[0].message, /email/i);
});

await check('draft: the build list saves, reports what each row still needs, and submits', async () => {
  const rowId = '11111111-2222-4333-8444-555555555555';
  let view = batches.saveDraft(ACCT, [
    { rowId, name: 'Draft Co', siteName: 'Draft Co', prompt: 'A calm site.', features: ['careers'], facts: FULL_FACTS },
  ]);
  assert.strictEqual(view.rows.length, 1);
  assert.strictEqual(view.rows[0].rowId, rowId, 'the row id is stable, photos can stage against it');
  assert.deepStrictEqual(view.rows[0].modules, ['d4-careers-portal']);
  assert.strictEqual(view.rows[0].readiness.submittable, false, 'careers still needs its roles');
  assert.deepStrictEqual(view.rows[0].readiness.missing.map((m) => m.label), ['Open roles']);
  assert.strictEqual(view.counts.ready, 0);

  // A photo staged against the row before any site exists.
  const logoSlot = assets.slotsFor(null, ['d4-careers-portal']).find((s) => s.id === 'logo');
  assets.add(rowId, logoSlot, 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));

  view = batches.saveDraft(ACCT, [
    { ...view.rows[0], facts: { ...FULL_FACTS, roles: [{ title: 'Welder', summary: 'Fabrication.' }] } },
  ]);
  assert.strictEqual(view.rows[0].readiness.submittable, true, 'answered, so the row is submittable');
  assert.strictEqual(view.rows[0].photos, 1, 'the staged photo is counted on the row');
  assert.strictEqual(view.counts.ready, 1);

  fake.pollStatus = 'in_progress';
  const b = await batches.submitDraft(ACCT, 'key-1');
  assert.strictEqual(b.builds.length, 1);
  assert.strictEqual(b.builds[0].rowId, rowId, 'the build remembers the row its photos are staged under');
  assert.strictEqual(batches.draftView(ACCT).rows.length, 0, 'submitting consumes the draft');
  globalThis.__draftBatch = b.id;
  globalThis.__draftRow = rowId;
});

await check('draft photos are adopted onto the site the build creates', async () => {
  fake.pollStatus = 'completed';
  fake.results = { 'b0-design': { content: cannedDesign('draft'), tokens: 10 }, 'b0-copy': { content: cannedCopy, tokens: 5 } };
  const ok = await waitFor(() => batches.detail(ACCT, globalThis.__draftBatch).builds[0].status === 'ready');
  assert.strictEqual(ok, true, 'the drafted build lands ready');
  const build = batches.detail(ACCT, globalThis.__draftBatch).builds[0];
  assert.strictEqual(build.photos, 1, 'one photo moved onto the site');
  assert.strictEqual((assets.state(build.siteId).logo || []).length, 1, 'the logo is on the site, ready for assembly');
  assert.deepStrictEqual(assets.state(globalThis.__draftRow), {}, 'the staging bucket is emptied');
});

await check('draft: dropping a row takes its staged photos with it', () => {
  const rowId = '99999999-8888-4777-8666-555555555555';
  batches.saveDraft(ACCT, [{ rowId, name: 'Doomed', siteName: 'Doomed', prompt: 'p', features: [], facts: {} }]);
  const slot = assets.slotsFor(null, []).find((s) => s.id === 'logo');
  assets.add(rowId, slot, 'logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.strictEqual((assets.state(rowId).logo || []).length, 1);
  batches.saveDraft(ACCT, []);
  assert.deepStrictEqual(assets.state(rowId), {}, 'no orphaned uploads left behind');
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
