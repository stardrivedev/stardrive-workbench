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
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { startServer } from './helpers/server.mjs';
import { confirmDialog } from './helpers/dialog.mjs';

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

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-batchui-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

// An OS-assigned port, so this can never land on a server left over from an
// earlier run and silently serve STALE code to the browser.
const { child: server, base: BASE } = await startServer({ varDir });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
// These responses are the design, not defects: the gate probes /auth/me before
// anyone is logged in (401); this throwaway server has no operator model key,
// so a real submit gets the honest 501 rather than a fake queue; and with the
// full QA tier off there are no screenshots, so thumbnail/preview requests
// 404 and the UI falls back to a lettered plate.
const EXPECTED = /401 \(Unauthorized\)|501 \(Not Implemented\)|404 \(Not Found\)/;
page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.message)));
// The submit nudges once when a build has no photos yet; say yes.
// Confirmations are real in-page dialogs now, driven with confirmDialog()
// where they appear. This stays for any native one a browser raises by itself
// (a beforeunload, say), which would otherwise hang the run.
page.on('dialog', (d) => d.accept());

const pill = () => page.locator('[data-batchrow] [data-role="pill"]').first().innerText();
const rows = () => page.locator('[data-batchrow]').count();

/** Open Batch Building and wait for the build list to actually settle: the
 *  view loads the template library first, so it renders a beat after the nav
 *  click and asserting straight away is a race. */
async function gotoBatch() {
  await page.click('#navBatch');
  await page.waitForSelector('#view-batch.active');
  await page.waitForFunction(() => {
    const el = document.querySelector('#batchBuildRows');
    return el && el.innerHTML.trim().length > 0;
  }, null, { timeout: 15000 });
}

/**
 * A finished batch, planted directly in the store. The provider is not
 * configured on this throwaway server, so a real batch can never complete
 * here; this is the only way to exercise the screen an operator actually
 * comes back to. Two built sites, both waiting for review.
 */
async function plantFinishedBatch() {
  const ids = await page.evaluate(async () => {
    const key = localStorage.getItem('sd.apiKey');
    const make = async (siteName) => {
      const r = await fetch('/v1/sites', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'd4-site-template', config: { siteName }, assemble: false }),
      });
      return (await r.json()).siteId;
    };
    return [await make('Planted One'), await make('Planted Two')];
  });

  const batchId = crypto.randomUUID();
  const builds = ids.map((siteId, i) => {
    const sitePath = path.join(varDir, 'sites', `${siteId}.json`);
    const site = JSON.parse(fs.readFileSync(sitePath, 'utf-8'));
    // A build that is done: a finished job so the site reads as built, and the
    // review flag the gate keys off.
    const jobId = crypto.randomUUID();
    fs.mkdirSync(path.join(varDir, 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(varDir, 'jobs', `${jobId}.json`), JSON.stringify({
      id: jobId, kind: 'assemble', siteId, account: site.account, engine: 'dry',
      status: 'done', logs: [], result: null,
      createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    }));
    site.jobs = [jobId];
    site.review = { state: 'pending', batchId, customId: `b${i}` };
    fs.writeFileSync(sitePath, JSON.stringify(site, null, 2));
    return {
      customId: `b${i}`, name: `planted-${i}`, siteName: site.config.siteName,
      status: 'review', stage: null, error: null, templateName: `planted-${i}`,
      siteId, jobId, tokens: 0, photos: 0, features: [], modules: [],
      generatedTemplate: true, templateId: null, facts: {}, brief: {}, prompt: 'p', rowId: null, tagline: '',
    };
  });

  const account = JSON.parse(fs.readFileSync(path.join(varDir, 'sites', `${ids[0]}.json`), 'utf-8')).account;
  fs.mkdirSync(path.join(varDir, 'batches'), { recursive: true });
  fs.writeFileSync(path.join(varDir, 'batches', `${batchId}.json`), JSON.stringify({
    id: batchId, account, keyId: null, status: 'ready', providerBatchId: 'planted',
    outputsProcessed: true, builds,
    createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
  }, null, 2));
  return { batchId, pendingSiteId: ids[1], approvedSiteId: ids[0] };
}

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
  await gotoBatch();
});

await check('empty list invites a first build', async () => {
  assert.strictEqual(await rows(), 0);
  assert.match(await page.locator('#batchBuildRows').innerText(), /No builds queued/i);
});

await check('add a build: the card opens and says what it needs first', async () => {
  await page.click('#batchAddRow');
  await page.waitForSelector('[data-batchrow]');
  assert.strictEqual(await rows(), 1);
  assert.match(await pill(), /Needs a (business|template) name/);
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
  await gotoBatch();
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
  assert.match(await second.locator('[data-role="pill"]').innerText(), /Needs a (business|template) name/, 'the copy has no identity of its own');
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
  // The photo nudge asks first, and it is a genuine two-way choice, so both
  // buttons name their own outcome rather than reading OK and Cancel.
  const nudge = await confirmDialog(page);
  assert.match(nudge.title, /no logo or photos/i);
  assert.match(nudge.confirmLabel, /Submit without them/i);
  assert.match(nudge.cancelLabel, /Add photos first/i);
  // No operator model key on this throwaway server, so the honest 501 shows:
  // the readiness gate is behind us and the request reached the provider seam.
  await page.waitForFunction(
    () => /operator model key|Batch Building/i.test(document.querySelector('#batchSubmitOut').textContent),
    null, { timeout: 10000 });
  const msg = await page.locator('#batchSubmitOut').innerText();
  assert.doesNotMatch(msg, /still need answers/, 'the readiness gate passed');
});

await check('a row can build from a template already in the library, and stops asking for a brief', async () => {
  await page.click('#batchAddRow');
  await page.waitForFunction(() => document.querySelectorAll('[data-batchrow]').length === 4, null, { timeout: 6000 });
  const row = page.locator('[data-batchrow]').last();
  await row.locator('[data-bf="siteName"]').fill('Franchise Two');
  assert.match(await row.locator('[data-role="pill"]').innerText(), /template name|design brief/i, 'a new design needs both');
  await row.locator('[data-bsource="reuse"]').click();
  await row.locator('[data-bf="templateId"]').waitFor();
  await row.locator('[data-bf="templateId"]').selectOption('d4-site-template');
  // Reusing a design means no brief and no new template name are wanted.
  assert.strictEqual(await row.locator('[data-role="sourceNew"]').isVisible(), false, 'the brief is put away');
  await row.locator('[data-btab="content"]').click();
  for (const [id, v] of [
    ['whatYouDo', 'We run a franchise location.'],
    ['aboutFacts', 'Opened in 2021, part of a national group.'],
    ['services', 'Retail'],
    ['contactEmail', 'two@franchise.example'],
  ]) await row.locator('[data-fact="' + id + '"]').fill(v);
  await page.waitForFunction(
    () => /Ready/.test(document.querySelectorAll('[data-batchrow] [data-role="pill"]')[3].textContent),
    null, { timeout: 5000 });
});

await check('the review gate and bulk actions render once a batch has landed', async () => {
  // Plant a finished batch directly in the store: the provider is not
  // configured here, so this is the only way to see the post-batch screen.
  await page.evaluate(async () => {
    const r = await fetch('/v1/batches/draft', { headers: { Authorization: 'Bearer ' + localStorage.getItem('sd.apiKey') } });
    return r.status;
  });
  const planted = await plantFinishedBatch();
  await page.reload({ waitUntil: 'networkidle' });
  await gotoBatch();
  await page.waitForSelector('[data-bact="expand"]');
  await page.click('[data-bact="expand"]');
  await page.waitForSelector('.sheet-card');
  assert.strictEqual(await page.locator('.sheet-card').count(), 2, 'a card per design');
  assert.ok(await page.locator('[data-bact="approve-all"]').count(), 'approve-all offered while designs wait');
  assert.ok(await page.locator('[data-bact="export-all"]').count(), 'download-all offered');
  assert.strictEqual(await page.locator('[data-bact="publish-all"]').count(), 0, 'nothing to publish before anything is approved');
  assert.match(await page.locator('.sheet-card').first().innerText(), /Waiting for your review/);
  globalThis.__planted = planted;
});

await check('approving one design unlocks publishing for it alone', async () => {
  await page.locator('.sheet-card').first().locator('[data-bact="approve"]').click();
  await page.waitForSelector('[data-bact="publish-all"]', { timeout: 8000 });
  assert.match(await page.locator('.sheet-card').first().innerText(), /Approved/);
  assert.match(await page.locator('.sheet-card').nth(1).innerText(), /Waiting for your review/, 'the other is untouched');
  assert.match(await page.locator('[data-bact="publish-all"]').innerText(), /Publish 1 approved/);
  assert.ok(await page.locator('[data-bact="approve-all"]').count(), 'one still waiting');
});

await check('an unreviewed design cannot be published from Sites either', async () => {
  const pending = globalThis.__planted.pendingSiteId;
  await page.goto(BASE + '/workbench/#/sites?site=' + pending, { waitUntil: 'networkidle' });
  await page.waitForSelector('#siteDetail .sstep[data-step="4"]');
  const step4 = await page.locator('#siteDetail .sstep[data-step="4"]').innerText();
  assert.match(step4, /waiting for your review/i, 'the gate is explained where the operator would publish');
  assert.strictEqual(await page.locator('#launchPanel').count(), 0, 'no publish panel while it is pending');
  assert.ok(await page.locator('[data-siteact="review-approve"]').count(), 'and it can be approved right here');
});

await check('approving from Sites reveals the publish panel and the custom-domain block', async () => {
  await page.click('[data-siteact="review-approve"]');
  await page.waitForSelector('#launchPanel .launch', { timeout: 8000 });
  await page.waitForSelector('#domInput', { timeout: 8000 });
  assert.ok(await page.locator('#domainBlock').count(), 'the domain block is part of publishing');
});

await check('a custom domain is normalized, and Stardrive never invents DNS for a host it cannot see', async () => {
  await page.fill('#domInput', 'https://WWW.TheClient.com/pricing');
  await page.click('[data-siteact="domain-save"]');
  await page.waitForSelector('[data-siteact="domain-remove"]', { timeout: 8000 });
  const panel = await page.locator('#domainBlock').innerText();
  assert.match(panel, /theclient\.com/, 'scheme, www, path and case normalized away');
  assert.match(panel, /NEXT_PUBLIC_SITE_URL=https:\/\/theclient\.com/, 'the canonical URL is handed over');
  assert.match(panel, /values come from your host/i, 'honest that we did not check a host we have no token for');
  // The record shape is shown, with no invented IP.
  assert.match(panel, /\bA\b/);
  assert.doesNotMatch(panel, /\d+\.\d+\.\d+\.\d+/, 'no made-up IP address');
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
