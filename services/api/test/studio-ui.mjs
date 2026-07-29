/**
 * Browser verification of the Studio and the template library: a design in
 * progress survives a reload, a template in the library can be reopened and
 * refined instead of being frozen at import, and the library reads as a grid
 * of designs rather than a list of slugs.
 *
 * The Studio's model relay is dormant on a throwaway server (no operator
 * key), so this drives the parts that do not need a live generation: the
 * saved draft, the reopen-to-refine path, and the library UI.
 *
 * Playwright is optional, as it is for full QA: have it resolvable, or point
 * STARDRIVE_PLAYWRIGHT at an install. Without one this SKIPS.
 *
 * Run: node services/api/test/studio-ui.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import { REQUIRED_SITE_FILES } from '../../../packages/template-kit/index.mjs';
import { startServer } from './helpers/server.mjs';

const spec = process.env.STARDRIVE_PLAYWRIGHT || 'playwright';
let chromium = null;
try {
  const pw = await import(path.isAbsolute(spec) ? pathToFileURL(spec).href : spec);
  chromium = pw.chromium ?? pw.default?.chromium ?? null;
} catch { /* not installed */ }
if (!chromium) {
  console.log('studio UI: SKIPPED (no Playwright — set STARDRIVE_PLAYWRIGHT to an install).');
  process.exit(0);
}

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-studioui-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

const { child: server, base: BASE } = await startServer({ varDir });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
// Expected by design: the pre-login session probe, and the missing screenshots
// (no full QA tier here) that make thumbnails fall back to lettered plates.
const EXPECTED = /401 \(Unauthorized\)|404 \(Not Found\)/;
page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('dialog', (d) => d.accept());

/** A valid site-template bundle (the real required file set), imported
 *  through the API so the library has one of the licensee's OWN designs. */
async function importTemplate(name) {
  const files = [
    { path: 'package.json', content: JSON.stringify({ name: 'placeholder', version: '0.1.0', dependencies: {}, devDependencies: {} }) },
    ...REQUIRED_SITE_FILES.map((p) => ({
      path: p,
      content: p.endsWith('theme.css')
        ? ':root { --accent: 67 56 202; --text-muted: 90 90 90; }\n.dark { --accent: 159 153 255; --text-muted: 170 170 170; }\n'
        : `// ${p} (${name})\nexport {};\n`,
    })),
  ];
  return page.evaluate(async ({ tplName, payload }) => {
    const key = localStorage.getItem('sd.apiKey');
    const manifest = {
      name: tplName, version: '1.0.0', kind: 'site',
      description: `A ${tplName} template for the studio UI check.`,
      provides: { routes: ['/', '/about', '/contact'], nav: [], adminPanels: [], collections: [] },
      copy: [{ from: 'files', to: '.' }],
    };
    const r = await fetch('/v1/templates', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, files: payload }),
    });
    return { status: r.status, body: await r.json() };
  }, { tplName: name, payload: files });
}

console.log('studio UI:');

await page.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });

await check('sign up and reach the Studio', async () => {
  await page.click('[data-authtab="signup"]');
  await page.fill('input[name="email"]', 'studio-ui@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.click('#authSubmit');
  await page.waitForSelector('#appLayout:not([hidden])', { timeout: 8000 });
  await page.click('[data-view="studio"]');
  await page.waitForSelector('#view-studio.active');
});

await check('a half-filled brief survives a reload', async () => {
  await page.fill('#brBusiness', 'a family bakery in Portland');
  await page.fill('#brColors', 'warm cream and deep green');
  await page.click('[data-vibe="Warm & friendly"]');
  // Autosave is debounced; wait for it to report.
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#studioSaveState')?.textContent || ''), null, { timeout: 6000 });

  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-view="studio"]');
  await page.waitForSelector('#view-studio.active');
  await page.waitForFunction(() => document.querySelector('#brBusiness')?.value.length > 0, null, { timeout: 8000 });
  assert.strictEqual(await page.locator('#brBusiness').inputValue(), 'a family bakery in Portland');
  assert.strictEqual(await page.locator('#brColors').inputValue(), 'warm cream and deep green');
  assert.ok(await page.locator('[data-vibe="Warm & friendly"].on').count(), 'the chosen vibe came back too');
});

await check('"Start over" clears the saved draft, not just the screen', async () => {
  await page.click('#clearChatBtn');
  await page.waitForFunction(() => document.querySelector('#brBusiness')?.value === '', null, { timeout: 5000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-view="studio"]');
  await page.waitForSelector('#view-studio.active');
  await page.waitForTimeout(800);
  assert.strictEqual(await page.locator('#brBusiness').inputValue(), '', 'it stays gone');
});

await check('the library shows designs as cards, with a plate when there is no screenshot', async () => {
  const imported = await importTemplate('harbour-light');
  assert.ok(imported.status < 300, 'template imported: ' + JSON.stringify(imported.body).slice(0, 200));
  await page.click('[data-view="templates"]');
  await page.waitForSelector('#templateGrid .tmpl-card');
  const cards = await page.locator('#templateGrid .tmpl-card').count();
  assert.ok(cards >= 7, 'the shared catalog plus the new design: ' + cards);
  // No full QA tier here, so every tile falls back rather than showing a broken image.
  await page.waitForFunction(() => document.querySelectorAll('#templateGrid .tmpl-noshot').length > 0, null, { timeout: 8000 });
  const mine = page.locator('#templateGrid .tmpl-card', { hasText: 'harbour-light' });
  assert.ok(await mine.locator('[data-act="refine"]').count(), 'my own design can be reopened');
});

await check('the shared catalog is not offered for refining', async () => {
  const shared = page.locator('#templateGrid .tmpl-card', { hasText: 'd4-site-template' });
  assert.strictEqual(await shared.locator('[data-act="refine"]').count(), 0, 'first-party templates are not the licensee\'s to edit');
  assert.ok(await shared.locator('[data-act="view"]').count(), 'but the manifest is still readable');
});

await check('a template reopens in the Studio ready to refine', async () => {
  await page.locator('#templateGrid .tmpl-card', { hasText: 'harbour-light' }).locator('[data-act="refine"]').click();
  await page.waitForSelector('#view-studio.active', { timeout: 8000 });
  await page.waitForSelector('#refineWrap:not([hidden])', { timeout: 8000 });
  // #chatlog sits inside a collapsed <details>, so read textContent.
  const log = await page.locator('#chatlog').textContent();
  assert.match(log, /harbour-light/, 'the Studio says what it opened');
  // The design's own files are back in the conversation, so Refine continues
  // from the real template instead of a blank brief.
  const files = await page.evaluate(() => Object.keys(collectFiles()));
  assert.ok(files.includes('manifest.json'), 'manifest is in the conversation');
  assert.ok(files.includes('src/app/layout.tsx'), 'and so are its real files');
});

await check('the reopened design is saved too, so a reload does not lose it', async () => {
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#studioSaveState')?.textContent || ''), null, { timeout: 6000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('[data-view="studio"]');
  await page.waitForFunction(() => Object.keys(collectFiles()).length > 0, null, { timeout: 8000 });
  const files = await page.evaluate(() => Object.keys(collectFiles()));
  assert.ok(files.includes('manifest.json') && files.includes('src/app/layout.tsx'), 'the whole file set came back');
});

await check('no JavaScript errors anywhere in the flow', () => {
  assert.deepStrictEqual(errors, []);
});

await browser.close();
server.kill();
fs.rmSync(varDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll studio UI checks passed.');
process.exit(0);
