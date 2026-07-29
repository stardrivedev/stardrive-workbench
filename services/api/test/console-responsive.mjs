/**
 * The Workbench on a small screen.
 *
 * Every site Stardrive builds is checked for horizontal overflow at 375px.
 * The console itself was not, and it showed: three views made the whole page
 * scroll sideways on a phone, and the sidebar collapsed into a wrapped strip
 * of every section at once, 378px of navigation on a 780px screen. The
 * account, status and theme controls were simply display:none below 860px,
 * so on a phone there was no way to log out or change theme at all.
 *
 * What this fixes in place:
 *   - no view scrolls the page sideways at any width we claim to support
 *   - the sections collapse behind a Menu button that tells the truth about
 *     its own state, and every control still reachable
 *
 * Playwright is optional, as it is for the rest of the browser tier: point
 * STARDRIVE_PLAYWRIGHT at an install or have it resolvable. Without it this
 * SKIPS rather than failing.
 *
 * Run: node services/api/test/console-responsive.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { pathToFileURL } from 'node:url';
import { startServer, stopAll } from './helpers/server.mjs';

const spec = process.env.STARDRIVE_PLAYWRIGHT || 'playwright';
let chromium = null;
try {
  const pw = await import(path.isAbsolute(spec) ? pathToFileURL(spec).href : spec);
  chromium = pw.chromium ?? pw.default?.chromium ?? null;
} catch { /* not installed */ }
if (!chromium) {
  console.log('console responsive: SKIPPED (no Playwright — set STARDRIVE_PLAYWRIGHT to an install).');
  process.exit(0);
}

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-responsive-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

const { base: BASE } = await startServer({ varDir });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 375, height: 780 } });
page.on('dialog', (d) => d.accept());

/** Every view a licensee can reach from the sidebar. */
const VIEWS = ['home', 'studio', 'templates', 'sites', 'connections', 'going-live', 'keys', 'billing', 'reference', 'rulebook'];

/**
 * The widths we claim to support: a small phone, a large phone, a tablet, and
 * a laptop. 375 is the one that matters — it is the narrowest screen in
 * common use and the width the client-site QA tier checks.
 */
const WIDTHS = [375, 414, 768, 1280];

const goto = async (view) => {
  await page.goto(`${BASE}/workbench/#/${view}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300); // let the view finish painting before measuring
};

console.log('console responsive:');

await page.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });
await check('sign in', async () => {
  await page.click('[data-authtab="signup"]');
  await page.fill('input[name="email"]', 'small@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.click('#authSubmit');
  await page.waitForSelector('#appLayout:not([hidden])', { timeout: 8000 });
});

await check('the login card itself fits a phone', async () => {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.strictEqual(fits, true, 'the sign-in screen scrolls sideways at 375px');
});

for (const width of WIDTHS) {
  await check(`no view scrolls sideways at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 900 });
    const bad = [];
    for (const view of VIEWS) {
      await goto(view);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // A pixel of slack: sub-pixel layout rounding is not a bug.
      if (over > 1) bad.push(`${view} (+${over}px)`);
    }
    assert.deepStrictEqual(bad, [], `views overflowing: ${bad.join(', ')}`);
  });
}

await page.setViewportSize({ width: 375, height: 780 });
await goto('home');

await check('navigation is a compact bar on a phone, not half the screen', async () => {
  const h = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().height);
  // It was 378px before this: the sections wrapped into a strip that filled
  // half a phone screen before any content appeared.
  assert.strictEqual(h < 120, true, `the nav bar is ${Math.round(h)}px tall`);
});

await check('the sections are behind a Menu button, and it opens and closes', async () => {
  assert.strictEqual(await page.isVisible('#menuBtn'), true, 'no Menu button at 375px');
  assert.strictEqual(await page.isVisible('#navList .nav-item'), false, 'the sections are open before anything was pressed');

  await page.click('#menuBtn');
  assert.strictEqual(await page.isVisible('#navList .nav-item'), true, 'pressing Menu did not reveal the sections');
  assert.strictEqual(await page.getAttribute('#menuBtn', 'aria-expanded'), 'true');

  await page.click('#menuBtn');
  assert.strictEqual(await page.isVisible('#navList .nav-item'), false, 'pressing Menu again did not close it');
  assert.strictEqual(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
});

await check('choosing a section navigates and closes the menu', async () => {
  await page.click('#menuBtn');
  await page.click('[data-view="billing"]');
  await page.waitForSelector('#view-billing.active');
  assert.strictEqual(await page.isVisible('#navList .nav-item'), false, 'the menu stayed open over the view it just opened');
  assert.strictEqual(await page.getAttribute('#menuBtn', 'aria-expanded'), 'false');
});

await check('Escape closes the menu and puts focus somewhere real', async () => {
  await page.click('#menuBtn');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.isVisible('#navList .nav-item'), false);
  const focused = await page.evaluate(() => document.activeElement?.id);
  assert.strictEqual(focused, 'menuBtn', 'focus was left inside a menu that is no longer there');
});

await check('log out and theme are still reachable on a phone', async () => {
  // These were display:none below 860px, which meant a phone user could not
  // sign out of their own account.
  await page.click('#menuBtn');
  assert.strictEqual(await page.isVisible('#logoutBtn'), true, 'no way to log out on a phone');
  assert.strictEqual(await page.isVisible('#themeBtn'), true, 'no way to change theme on a phone');
  assert.strictEqual(await page.isVisible('#acctEmail'), true, 'no sign of which account you are in');
  await page.click('#menuBtn');
});

await check('the sections are big enough to hit with a thumb', async () => {
  await page.click('#menuBtn');
  const small = await page.evaluate(() => [...document.querySelectorAll('#navList .nav-item')]
    .filter((el) => el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().height < 32)
    .map((el) => el.textContent.trim()));
  assert.deepStrictEqual(small, [], `nav targets under 32px tall: ${small.join(', ')}`);
  await page.click('#menuBtn');
});

await check('no tickbox is stretched away from the label it belongs to', async () => {
  // A cascade collision, not a responsive one, but it was invisible until the
  // narrow layout put it under the nose: the feature and scope lists sit
  // inside a .field, whose `input { width: 100% }` had the same specificity
  // and came later, so every checkbox spread across its column and its label
  // wrapped underneath. Thirteen ticks floating nowhere near their words.
  const stretched = [];
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of VIEWS) {
      await goto(view);
      const bad = await page.evaluate(() => [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return (b.width || b.height) && (b.width > 30 || b.height > 30);
        })
        .map((el) => `${el.dataset.assemblefeat || el.value || el.id || '?'} ${Math.round(el.getBoundingClientRect().width)}px`));
      for (const b of bad) stretched.push(`${view}@${width}: ${b}`);
    }
  }
  assert.deepStrictEqual(stretched, [], stretched.join('; '));
  await page.setViewportSize({ width: 375, height: 780 });
  await goto('home');
});

await check('the API key field is usable rather than a 150px slot', async () => {
  const w = await page.evaluate(() => document.querySelector('#apiKeyInput').getBoundingClientRect().width);
  assert.strictEqual(w > 180, true, `the API key input is ${Math.round(w)}px wide`);
});

await check('the confirmation dialog fits a phone, buttons and all', async () => {
  await goto('keys');
  await page.reload({ waitUntil: 'networkidle' }); // as in the a11y suite: the list must really be fetched
  await page.waitForSelector('[data-keyact="revoke"]', { timeout: 15000 });
  await page.click('[data-keyact="revoke"]');
  await page.waitForSelector('#confirmDialog[open]');
  const fit = await page.evaluate(() => {
    const d = document.getElementById('confirmDialog').getBoundingClientRect();
    const go = document.getElementById('confirmGo').getBoundingClientRect();
    const cancel = document.getElementById('confirmCancel').getBoundingClientRect();
    return {
      inside: d.left >= 0 && d.right <= window.innerWidth + 1,
      // Stacked on a narrow screen rather than two buttons squeezed side by
      // side, and the way out is the one nearest the thumb: on a destructive
      // action the easiest target should be the harmless one.
      stacked: Math.abs(go.left - cancel.left) < 2 && go.top !== cancel.top,
      safeNearestThumb: cancel.top > go.top,
      pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  });
  assert.strictEqual(fit.inside, true, 'the dialog runs off the side of the screen');
  assert.strictEqual(fit.stacked, true, 'the buttons are not stacked at 375px');
  assert.strictEqual(fit.safeNearestThumb, true, 'the destructive button is the one under the thumb');
  assert.strictEqual(fit.pageFits, true, 'the open dialog made the page scroll sideways');
  await page.click('#confirmCancel');
  await page.waitForFunction(() => !document.getElementById('confirmDialog')?.open, null, { timeout: 3000 });
});

await check('on a laptop the sections are simply there, with no Menu button', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await goto('home');
  assert.strictEqual(await page.isVisible('#menuBtn'), false, 'the Menu button leaked into the wide layout');
  assert.strictEqual(await page.isVisible('[data-view="billing"]'), true, 'the sections are hidden on a laptop');
  assert.strictEqual(await page.isVisible('#logoutBtn'), true);
});

await browser.close();
stopAll();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll console responsive checks passed.');
