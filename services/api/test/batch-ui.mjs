/**
 * Browser verification of the Batch Building view: boots a real Stardrive API
 * on a throwaway var dir, signs up through the UI, and drives the build list
 * the way an operator would — add a build, watch the readiness pill count
 * down, toggle a module and see its question appear, stage a photo against a
 * row that has no site yet, reload and find the list intact, duplicate, paste
 * a spreadsheet, and get refused while a build is still short. Fails on any
 * unexpected console error.
 *
 * Playwright is optional here, as it is for full QA: have it resolvable, or
 * point STARDRIVE_PLAYWRIGHT at an install. Without one this SKIPS rather
 * than fails, so the suite still runs on a machine without browsers.
 *
 * Run: node services/api/test/batch-ui.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const spec = process.env.STARDRIVE_PLAYWRIGHT || 'playwright';
let chromium = null;
try {
  const pw = await import(path.isAbsolute(spec) ? pathToFileURL(spec).href : spec);
  chromium = pw.chromium ?? pw.default?.chromium ?? null;
} catch { /* not installed */ }
if (!chromium) {
  console.log('batch building UI: SKIPPED (no Playwright — set STARDRIVE_PLAYWRIGHT to an install).');
  process.exit(0);
}

const PORT = Number(process.env.STARDRIVE_TEST_PORT || 4657);
const BASE = `http://localhost:${PORT}`;
const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-batchui-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.mjs', '--port', String(PORT)], {
      cwd: API_DIR, env: { ...process.env, STARDRIVE_VAR_DIR: varDir }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const t = setTimeout(() => reject(new Error('server never came up: ' + buf)), 15000);
    child.stdout.on('data', (d) => { buf += d; if (buf.includes('listening')) { clearTimeout(t); resolve(child); } });
    child.stderr.on('data', (d) => { buf += d; });
  });
}

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
// Two responses are the design, not defects: the gate probes /auth/me before
// anyone is logged in (401), and this throwaway server has no operator model
// key, so a real submit gets the honest 501 rather than a fake queue.
const EXPECTED = /401 \(Unauthorized\)|501 \(Not Implemented\)/;
page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.message)));
// The submit nudges once when a build has no photos yet; say yes.
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

const pill = () => page.locator('[data-batchrow] [data-role="pill"]').first().innerText();
const rows = () => page.locator('[data-batchrow]').count();

console.log('batch building UI:');

await page.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });

await check('sign up, then Batch Building is reachable', async () => {
  await page.click('[data-authtab="signup"]');
  await page.fill('input[name="email"]', 'batch-ui@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  const company = page.locator('#companyRow input');
  if (await company.count()) await company.first().fill('Batch UI Co');
  await page.click('#authSubmit');
  await page.waitForSelector('#navBatch:not([hidden])', { timeout: 8000 });
  await page.click('#navBatch');
  await page.waitForSelector('#view-batch.active');
});

await check('empty list invites a first build', async () => {
  assert.strictEqual(await rows(), 0);
  assert.match(await page.locator('#batchBuildRows').innerText(), /No builds queued/i);
});

await check('add a build: the card opens and says what it needs first', async () => {
  await page.click('#batchAddRow');
  await page.waitForSelector('[data-batchrow]');
  assert.strictEqual(await rows(), 1);
  assert.match(await pill(), /Needs a template name/);
  assert.ok(await page.locator('[data-bpane="design"]').isVisible(), 'the design pane opens first');
});

await check('the guided brief composes the same prompt the Studio would', async () => {
  await page.fill('[data-bf="name"]', 'Solstice Bakery');
  await page.fill('[data-bf="siteName"]', 'Solstice Bakery');
  await page.fill('[data-bbrief="business"]', 'a family bakery in Portland');
  await page.click('[data-bvibe="Warm & friendly"]');
  await page.fill('[data-bbrief="colors"]', 'cream and deep green');
  const prompt = await page.locator('[data-role="prompt"]').textContent(); // inside a collapsed <details>
  assert.match(prompt, /Design a website template for a family bakery in Portland\./);
  assert.match(prompt, /Overall vibe: Warm & friendly\./);
  assert.match(prompt, /Colors: cream and deep green\./);
  assert.match(await pill(), /0 of 4 essentials/);
});

await check('the essentials tab asks exactly what Sites asks, and counts down', async () => {
  await page.click('[data-btab="content"]');
  await page.waitForSelector('[data-bpane="content"] [data-fact="whatYouDo"]');
  for (const [id, v] of [
    ['whatYouDo', 'We bake bread fresh every morning.'],
    ['aboutFacts', 'Family run since 2019. Everything baked on site.'],
    ['services', 'Sourdough\nPastries'],
    ['contactEmail', 'hello@solstice.example'],
  ]) await page.fill('[data-fact="' + id + '"]', v);
  await page.waitForFunction(() => /Ready/.test(document.querySelector('[data-role="pill"]').textContent), null, { timeout: 4000 });
  assert.match(await page.locator('#batchHeadNote').innerText(), /1 of 1/);
});

await check('turning on a feature adds that module\'s own required question', async () => {
  await page.click('[data-btab="features"]');
  await page.click('input[data-bfeat="careers"]');
  await page.waitForFunction(() => /essentials/.test(document.querySelector('[data-role="pill"]').textContent), null, { timeout: 4000 });
  assert.match(await page.locator('[data-role="modnote"]').innerText(), /d4-careers-portal/);
  await page.click('[data-btab="content"]');
  await page.waitForSelector('[data-fact="roles"]');
  assert.match(await pill(), /4 of 5 essentials/);
  await page.fill('[data-fact="roles"]', 'Baker - Early mornings, sourdough focus');
  await page.waitForFunction(() => /Ready/.test(document.querySelector('[data-role="pill"]').textContent), null, { timeout: 4000 });
});

await check('photos stage against the row before any site exists', async () => {
  await page.click('[data-btab="photos"]');
  await page.waitForSelector('input[data-brupload="logo"]');
  const svg = path.join(varDir, 'logo.svg');
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
  await page.setInputFiles('input[data-brupload="logo"]', svg);
  await page.waitForSelector('button[data-brassetdel]', { timeout: 20000 });
  await page.waitForFunction(() => /photo/.test(document.querySelector('[data-role="sub"]').textContent), null, { timeout: 4000 });
  // The careers page hero compartment appeared with the careers module.
  assert.ok(await page.locator('input[data-brupload="hero-careers"]').count(), 'module-gated compartments follow the feature set');
});

await check('the list survives a reload (saved server-side, not in the tab)', async () => {
  await page.waitForFunction(() => document.querySelector('#batchSaveState')?.textContent === 'Saved', null, { timeout: 5000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#navBatch');
  await page.waitForSelector('[data-batchrow]');
  assert.strictEqual(await rows(), 1);
  assert.match(await pill(), /Ready/);
  assert.match(await page.locator('[data-role="sub"]').first().innerText(), /1 photo/);
});

await check('duplicate copies the work but not the identity', async () => {
  await page.locator('[data-batchrow] .brow-head').first().click();
  await page.waitForSelector('[data-bact="duplicate"]');
  await page.click('[data-bact="duplicate"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-batchrow]').length === 2, null, { timeout: 5000 });
  const second = page.locator('[data-batchrow]').nth(1);
  assert.match(await second.locator('[data-role="pill"]').innerText(), /Needs a template name/);
  await second.locator('[data-bbrief="business"]').first().waitFor();
  assert.strictEqual(await second.locator('[data-bbrief="business"]').inputValue(), 'a family bakery in Portland');
});

await check('submitting is blocked while any build is short, and says which', async () => {
  await page.click('#batchSubmitBtn');
  await page.waitForSelector('#batchSubmitOut .report.err');
  const out = await page.locator('#batchSubmitOut').innerText();
  assert.match(out, /1 build\(s\) still need answers/);
  assert.match(out, /needs a template name/);
});

await check('paste a spreadsheet: one line per client becomes a queued build', async () => {
  await page.click('#batchPasteToggle');
  await page.fill('#batchPasteText',
    'North Forge | North Forge Metalworks | an industrial fabrication shop | We fabricate steel | Welding;Machining | hi@northforge.example | Founded 1998, family owned\n' +
    'Cedar Clinic | Cedar Clinic | a calm family dental practice | We look after teeth | Cleanings;Fillings | hi@cedar.example | Open since 2011');
  await page.click('#batchPasteGo');
  await page.waitForFunction(() => document.querySelectorAll('[data-batchrow]').length === 4, null, { timeout: 6000 });
  const third = page.locator('[data-batchrow]').nth(2);
  assert.match(await third.locator('[data-role="pill"]').innerText(), /Ready/, 'a pasted row arrives complete');
  assert.match(await third.locator('[data-role="title"]').innerText(), /North Forge/);
});

await check('a complete list reaches the provider seam and reports honestly', async () => {
  // Drop the empty duplicate so every remaining build is ready. Pasting leaves
  // the previously open row open, so only toggle it if it is not already.
  const dupe = page.locator('[data-batchrow]').nth(1);
  const remove = dupe.locator('[data-bact="removerow"]');
  if (!(await remove.isVisible())) await dupe.locator('.brow-head').click();
  await remove.waitFor({ state: 'visible', timeout: 5000 });
  await remove.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-batchrow]').length === 3, null, { timeout: 5000 });
  await page.evaluate(() => { document.querySelector('#batchSubmitOut').innerHTML = ''; });
  await page.click('#batchSubmitBtn');
  // No operator model key on this throwaway server, so the honest 501 shows:
  // the readiness gate is behind us and the request reached the provider seam.
  await page.waitForFunction(
    () => /operator model key|Batch Building/i.test(document.querySelector('#batchSubmitOut').textContent),
    null, { timeout: 10000 });
  const msg = await page.locator('#batchSubmitOut').innerText();
  assert.doesNotMatch(msg, /still need answers/, 'the readiness gate passed');
  assert.ok(dialogs.some((d) => /no logo or photos/.test(d)), 'and the photo nudge asked once first');
});

await check('no JavaScript errors anywhere in the flow', () => {
  assert.deepStrictEqual(errors, []);
});

await browser.close();
server.kill();
fs.rmSync(varDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll batch UI checks passed.');
process.exit(0);
