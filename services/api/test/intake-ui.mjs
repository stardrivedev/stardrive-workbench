/**
 * The client intake link, driven from both sides in a real browser.
 *
 * The API suite proves the boundary; this proves the thing works as a piece of
 * software a person uses. Two browser contexts, because that is the actual
 * situation: the licensee in theirs, the client in a different one with no
 * account, no session and no key, holding nothing but a URL.
 *
 * Playwright is optional, as it is for the rest of the browser tier. Without
 * it this SKIPS rather than failing.
 *
 * Run: node services/api/test/intake-ui.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startServer, stopAll } from './helpers/server.mjs';
import { confirmDialog } from './helpers/dialog.mjs';

const spec = process.env.STARDRIVE_PLAYWRIGHT || 'playwright';
let chromium = null;
try {
  const pw = await import(path.isAbsolute(spec) ? pathToFileURL(spec).href : spec);
  chromium = pw.chromium ?? pw.default?.chromium ?? null;
} catch { /* not installed */ }
if (!chromium) {
  console.log('intake UI: SKIPPED (no Playwright — set STARDRIVE_PLAYWRIGHT to an install).');
  process.exit(0);
}

/** axe-core, if it is around: same optional treatment as the a11y suite. */
function axeSource() {
  const explicit = process.env.STARDRIVE_AXE_CORE;
  if (explicit && fs.existsSync(explicit)) return fs.readFileSync(explicit, 'utf-8');
  if (path.isAbsolute(spec)) {
    const guess = path.join(spec, '..', '..', 'axe-core', 'axe.min.js');
    if (fs.existsSync(guess)) return fs.readFileSync(guess, 'utf-8');
  }
  try { return fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf-8'); } catch { return null; }
}

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-intakeui-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

const { base: BASE } = await startServer({ varDir });
const browser = await chromium.launch();

// The licensee's browser, and the client's: separate contexts, so the client
// genuinely has no session.
const studio = await browser.newContext();
const client = await browser.newContext();
const shop = await studio.newPage();
const buyer = await client.newPage();

const errors = [];
// Expected by design: the pre-login session probe, and missing screenshots
// (no full QA tier here) behind the template tiles.
const EXPECTED = /401 \(Unauthorized\)|404 \(Not Found\)/;
for (const [who, page] of [['studio', shop], ['client', buyer]]) {
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(`${who}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
}
shop.on('dialog', (d) => d.accept());

const asUser = (p, init = {}) => shop.evaluate(async ({ p, init }) => {
  const key = localStorage.getItem('sd.apiKey');
  const r = await fetch(p, {
    method: init.method || 'GET',
    headers: { Authorization: 'Bearer ' + key, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}, { p, init });

console.log('intake UI:');

let linkUrl;

await check('the licensee signs up and creates a site needing answers', async () => {
  await shop.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });
  await shop.click('[data-authtab="signup"]');
  await shop.fill('input[name="email"]', 'intake-ui@example.com');
  await shop.fill('input[name="password"]', 'a-long-enough-password');
  await shop.fill('input[name="company"]', 'Bread & Butter Studio');
  await shop.click('#authSubmit');
  await shop.waitForSelector('#appLayout:not([hidden])', { timeout: 8000 });

  const made = await asUser('/v1/sites', {
    method: 'POST',
    body: { templateId: 'd4-site-template', config: { siteName: 'Otley Bakes', modules: ['d4-cms-core'] } },
  });
  assert.strictEqual(made.status, 202, made.text);
  globalThis.__site = made.json.siteId;
  for (let i = 0; i < 100; i += 1) {
    const job = await asUser(`/v1/jobs/${made.json.jobId}`);
    if (job.json?.status === 'done') return;
    assert.notStrictEqual(job.json?.status, 'failed', 'the dry build should not fail');
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the build never finished');
});

await check('sending it to the client is an offer, not the first thing asked', async () => {
  await shop.goto(`${BASE}/workbench/#/sites?site=${globalThis.__site}`, { waitUntil: 'networkidle' });
  await shop.waitForSelector('#intakeOffer .intake-offer', { timeout: 10000 });

  // A licensee usually has these answers already. The questions must come
  // first, and the offer must not open the form with a decision about who
  // fills it in.
  const order = await shop.evaluate(() => {
    const q = document.querySelector('#siteContent .card');
    const offer = document.querySelector('#intakeOffer');
    if (!q || !offer) return 'missing';
    // eslint-disable-next-line no-bitwise
    return (q.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'offer-after' : 'offer-before';
  });
  assert.strictEqual(order, 'offer-after', 'the offer sits above the questions');
  assert.strictEqual(await shop.isVisible('[data-intakeact="mint"]'), false, 'and it starts collapsed rather than demanding a choice');

  const summary = await shop.textContent('#intakeOffer summary');
  assert.match(summary, /Rather have the client answer these/i);
});

await check('creating a link shows it once, ready to send', async () => {
  await shop.click('#intakeOffer summary'); // open the disclosure
  await shop.waitForSelector('#intakeNote', { timeout: 5000 });
  assert.match(await shop.textContent('#intakeOffer'), /until you read it and say so/i,
    'it says plainly that nothing changes without them');
  await shop.fill('#intakeNote', 'Anything you are unsure about, leave blank.');
  await shop.click('[data-intakeact="mint"]');
  await shop.waitForSelector('#intakeOut .codeblock pre', { timeout: 8000 });
  linkUrl = (await shop.textContent('#intakeOut .codeblock pre')).trim();
  assert.match(linkUrl, /\/intake\/[A-Za-z0-9_-]{20,}$/, `a real URL: ${linkUrl}`);
  assert.match(await shop.textContent('#intakeOut'), /shown once/i);
});

await check('the client opens it with no account and sees their own form', async () => {
  await buyer.goto(linkUrl, { waitUntil: 'networkidle' });
  await buyer.waitForSelector('#form .q', { timeout: 8000 });
  const text = await buyer.textContent('body');
  assert.match(text, /About Otley Bakes/, 'it is about their business, by name');
  assert.match(text, /Bread & Butter Studio/, 'and says who sent it');
  assert.match(text, /Anything you are unsure about/, 'including the note');
  // The client must never be shown the console, nor anything about the
  // machinery. "The AI writes your About page" is the right thing to tell a
  // licensee and the wrong thing to tell the owner of a family bakery.
  assert.strictEqual(/Workbench|API key|template|module/i.test(text), false, 'no jargon reaches the client');
  assert.strictEqual(/\bAI\b/.test(text), false, 'the client is not told a machine is writing about their business');
  assert.match(text, /becomes the headline on your home page/i, 'the questions are worded for them instead');
  // And they are not logged into anything.
  const session = await buyer.evaluate(() => document.cookie);
  assert.strictEqual(session.includes('sd_session'), false, 'the client has no session');
});

await check('answers save as they type, without a save button', async () => {
  await buyer.fill('#f-whatYouDo', 'We bake sourdough in Otley.');
  await buyer.waitForFunction(() => /Saved/.test(document.querySelector('#saveState')?.textContent || ''), null, { timeout: 6000 });
  // And they survive a reload, which is the whole point of saving as you go.
  await buyer.reload({ waitUntil: 'networkidle' });
  await buyer.waitForSelector('#f-whatYouDo', { timeout: 8000 });
  assert.strictEqual(await buyer.locator('#f-whatYouDo').inputValue(), 'We bake sourdough in Otley.');
});

await check('the progress bar counts only what a build cannot do without', async () => {
  const text = await buyer.textContent('#progresstext');
  assert.match(text, /of \d+ essential questions answered/);
  assert.strictEqual(await buyer.isDisabled('#submit'), true, 'and finishing is not offered yet');
});

await check('a repeating answer takes as many lines as the client needs', async () => {
  const services = buyer.locator('.q[data-field="services"]');
  await services.locator('input').first().fill('Sourdough loaves');
  await services.locator('[data-add]').click();
  await services.locator('input').nth(1).fill('Pastries');
  await services.locator('[data-add]').click();
  await services.locator('input').nth(2).fill('Celebration cakes');
  await buyer.waitForFunction(() => /Saved/.test(document.querySelector('#saveState')?.textContent || ''), null, { timeout: 6000 });

  const saved = await buyer.evaluate(async () => {
    const token = location.pathname.replace('/intake/', '');
    const r = await fetch(`/v1/public/intake/${token}`);
    return (await r.json()).facts.services;
  });
  assert.deepStrictEqual(saved, ['Sourdough loaves', 'Pastries', 'Celebration cakes']);
});

await check('a line can be removed again, because a client always adds one too many', async () => {
  const services = buyer.locator('.q[data-field="services"]');
  await services.locator('[data-add]').click();
  await services.locator('.row').last().locator('[data-drop]').click();
  await buyer.waitForTimeout(1200);
  const saved = await buyer.evaluate(async () => {
    const token = location.pathname.replace('/intake/', '');
    return (await (await fetch(`/v1/public/intake/${token}`)).json()).facts.services;
  });
  assert.deepStrictEqual(saved, ['Sourdough loaves', 'Pastries', 'Celebration cakes'], 'and nothing else went with it');
});

await check('the client uploads their own logo', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await buyer.locator('.slot[data-slot="logo"] [data-file]').setInputFiles({ name: 'our-logo.png', mimeType: 'image/png', buffer: png });
  await buyer.waitForSelector('.slot[data-slot="logo"] .thumb', { timeout: 8000 });
  assert.match(await buyer.textContent('.slot[data-slot="logo"]'), /our-logo\.png/);
});

await check('finishing the form is only offered once it is finishable', async () => {
  await buyer.fill('#f-aboutFacts', 'Started in 2018 by two sisters. Everything is baked the morning it is sold.');
  await buyer.fill('#f-contactEmail', 'hello@otleybakes.example');
  await buyer.waitForFunction(() => !document.querySelector('#submit')?.disabled, null, { timeout: 8000 });
  await buyer.click('#submit');
  await buyer.waitForSelector('#reopen', { timeout: 8000 });
  const done = await buyer.textContent('.donecard');
  assert.match(done, /Thank you/);
  assert.match(done, /Bread & Butter Studio/, 'and it names who has it now');
});

await check('the licensee sees it come back, and reads it before using it', async () => {
  // A real reload: the console was already sitting on this exact site, and a
  // goto to the same hash changes nothing. In practice they come back later,
  // or press Sites again, which does reload.
  await shop.goto(`${BASE}/workbench/#/sites?site=${globalThis.__site}`, { waitUntil: 'networkidle' });
  await shop.reload({ waitUntil: 'networkidle' });
  await shop.waitForSelector('#intakeAnswers table', { timeout: 12000 });
  const shown = await shop.textContent('#intakeBlock');
  assert.match(shown, /The client has finished/);
  assert.match(shown, /We bake sourdough in Otley/, 'their words, before adopting');
  assert.match(shown, /Sourdough loaves; Pastries; Celebration cakes/, 'a list reads as a list');
  assert.match(shown, /1 picture came with it/);
  assert.match(shown, /Anything you have already typed above wins/, 'and it says whose version wins');

  // Once a link IS out, whether the client has replied is the first thing
  // worth knowing, so the status goes above the questions even though the
  // offer that created it sat below them.
  const order = await shop.evaluate(() => {
    const status = document.querySelector('#intakeBlock');
    const q = document.querySelector('#siteContent .card');
    // eslint-disable-next-line no-bitwise
    return (status.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'status-first' : 'questions-first';
  });
  assert.strictEqual(order, 'status-first', 'a reply the licensee has not read is buried below the form');
});

await check('adopting fills in the site and brings the picture with it', async () => {
  await shop.click('[data-intakeact="adopt"]');
  await shop.waitForFunction(
    () => document.querySelector('#f-whatYouDo, [data-fact="whatYouDo"]')?.value?.includes('sourdough'),
    null, { timeout: 12000 },
  );
  const site = await asUser(`/v1/sites/${globalThis.__site}/content`);
  assert.strictEqual(site.json.facts.contactEmail, 'hello@otleybakes.example');
  assert.strictEqual(site.json.readiness.ready, true, 'the site can now be built');
  const shopAssets = await asUser(`/v1/sites/${globalThis.__site}/assets`);
  assert.strictEqual((shopAssets.json.assets.logo || []).length, 1, 'their logo is on the site');
});

await check('the client is told it is closed, not handed a form that refuses them', async () => {
  await buyer.goto(linkUrl, { waitUntil: 'networkidle' });
  await buyer.waitForSelector('.donecard', { timeout: 8000 });
  const text = await buyer.textContent('.donecard');
  assert.match(text, /Bread & Butter Studio has your answers/i, 'it says who has it and what is happening');
  assert.match(text, /Tell Bread & Butter Studio directly/i, 'and what to do about a mistake');
  // No button that cannot work: every save from here would be refused.
  assert.strictEqual(await buyer.isVisible('#reopen'), false, 'the change button is not offered once it cannot work');
  assert.strictEqual(await buyer.locator('#form').count(), 0, 'and there is no form to type into');
});

await check('cancelling a link asks first, in words that name the consequence', async () => {
  const second = await asUser('/v1/sites', {
    method: 'POST',
    body: { templateId: 'd4-site-template', config: { siteName: 'Second Client', modules: ['d4-cms-core'] } },
  });
  for (let i = 0; i < 100; i += 1) {
    const job = await asUser(`/v1/jobs/${second.json.jobId}`);
    if (job.json?.status === 'done') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await shop.goto(`${BASE}/workbench/#/sites?site=${second.json.siteId}`, { waitUntil: 'networkidle' });
  await shop.waitForSelector('#intakeOffer summary', { timeout: 10000 });
  await shop.click('#intakeOffer summary');
  await shop.click('[data-intakeact="mint"]');
  await shop.waitForSelector('#intakeOut .codeblock pre', { timeout: 8000 });

  await shop.reload({ waitUntil: 'networkidle' });
  await shop.waitForSelector('[data-intakeact="revoke"]', { timeout: 12000 });
  await shop.click('[data-intakeact="revoke"]');
  const asked = await confirmDialog(shop);
  assert.match(asked.title, /Cancel the client's link/i);
  assert.match(asked.body, /uploaded but you have not taken is deleted/i);
  assert.match(asked.confirmLabel, /Cancel the link/i);
  // Back to the offer, collapsed again: with no link out there is nothing to
  // report, only something to offer.
  await shop.waitForSelector('#intakeOffer summary', { timeout: 10000 });
  assert.strictEqual(await shop.isVisible('[data-intakeact="mint"]'), false);
});

/**
 * The client's page held to the same bar as the sites we build.
 *
 * This is the one screen a licensee's CLIENT sees, on a phone, probably once.
 * If it overflows or fails contrast, that is our name on it as much as theirs.
 */
await check('the client form fits a phone and passes axe, in both themes', async () => {
  const AXE = axeSource();
  const phone = await client.newPage({ viewport: { width: 375, height: 780 } });
  try {
    // A fresh link, since the one above is closed now.
    const third = await asUser('/v1/sites', {
      method: 'POST',
      body: { templateId: 'd4-site-template', config: { siteName: 'Phone Client', modules: ['d4-cms-core', 'd4-careers-portal'] } },
    });
    for (let i = 0; i < 100; i += 1) {
      const job = await asUser(`/v1/jobs/${third.json.jobId}`);
      if (job.json?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const mint = await asUser(`/v1/sites/${third.json.siteId}/intake-link`, { method: 'POST', body: {} });
    await phone.goto(mint.json.url, { waitUntil: 'networkidle' });
    await phone.waitForSelector('#form .q', { timeout: 8000 });

    for (const theme of ['light', 'dark']) {
      await phone.emulateMedia({ colorScheme: theme });
      await phone.waitForTimeout(150);
      const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.strictEqual(over <= 1, true, `${theme}: the form scrolls sideways by ${over}px on a phone`);
      if (!AXE) continue;
      await phone.addScriptTag({ content: AXE });
      const bad = await phone.evaluate(async () => {
        const r = await window.axe.run(document, { resultTypes: ['violations'] });
        return r.violations
          .filter((v) => ['critical', 'serious', 'moderate'].includes(v.impact))
          .map((v) => `${v.id} (${v.impact}, ${v.nodes.length}x)`);
      });
      assert.deepStrictEqual(bad, [], `${theme}: ${bad.join(', ')}`);
    }
    if (!AXE) console.log('        (axe-core not found — overflow checked, accessibility skipped)');
  } finally {
    await phone.close();
  }
});

await check('no JavaScript errors on either side of the whole flow', async () => {
  assert.deepStrictEqual(errors, [], errors.join('\n        '));
});

await browser.close();
stopAll();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll intake UI checks passed.');
