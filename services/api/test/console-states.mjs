/**
 * What the console says when it has nothing, when it is waiting, and when it
 * cannot reach the server.
 *
 * The error and empty states were mostly fine. The waiting and the broken ones
 * were not. `fetch` rejects when the network drops, every caller awaited it
 * without a catch, and so a flaky connection killed the view mid-render: the
 * table kept whatever was in it, "Failed to fetch" went to a console nobody
 * has open, and the licensee saw what looked like an empty account. Measured
 * before the fix: all five list views showed their intro text and nothing
 * else, with no error anywhere on the page.
 *
 * Playwright is optional, as it is for the rest of the browser tier. Without
 * it this SKIPS rather than failing.
 *
 * Run: node services/api/test/console-states.mjs
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
  console.log('console states: SKIPPED (no Playwright — set STARDRIVE_PLAYWRIGHT to an install).');
  process.exit(0);
}

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-states-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

const { base: BASE } = await startServer({ varDir });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());

/** Anything the page throws that nobody caught. The whole point of the safety
 *  net is that this stays empty. */
const thrown = [];
page.on('pageerror', (e) => thrown.push(String(e.message)));

const viewText = (view) => page.evaluate(
  (v) => (document.querySelector('#view-' + v)?.innerText || '').replace(/\s+/g, ' '),
  view,
);

console.log('console states:');

await page.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });
await check('sign in', async () => {
  await page.click('[data-authtab="signup"]');
  await page.fill('input[name="email"]', 'states@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.click('#authSubmit');
  await page.waitForSelector('#appLayout:not([hidden])', { timeout: 8000 });
});

// ── Empty ────────────────────────────────────────────────────────────────
// A brand new account. Every list should say what to do next, not sit blank.
await check('a new account is told what to do, not shown an empty box', async () => {
  await page.goto(`${BASE}/workbench/#/sites`, { waitUntil: 'networkidle' });
  // Waited for rather than slept on: a fixed pause races the Loading state
  // that now sits between navigating and the answer arriving.
  await page.waitForFunction(
    () => /No sites yet/i.test(document.querySelector('#sitesTable tbody')?.textContent || ''),
    null, { timeout: 8000 },
  ).catch(async () => {
    throw new Error(`Sites says nothing useful when empty, it says: "${(await page.textContent('#sitesTable tbody')).trim()}"`);
  });
});

await check('no list is left blank: every one either has rows or says why not', async () => {
  // Keys and Templates are never truly empty on a new account (signup mints a
  // key, and the shared catalog is always there), so the thing worth asserting
  // is that the body is never just... nothing.
  const blank = [];
  for (const [view, table] of [['keys', '#keysTable'], ['templates', '#templateTable'], ['sites', '#sitesTable']]) {
    await page.goto(`${BASE}/workbench/#/${view}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    // textContent, not innerText: the templates table lives inside a collapsed
    // <details>, and hidden-but-present is not the failure being looked for.
    const text = await page.evaluate((sel) => (document.querySelector(sel + ' tbody')?.textContent || '').trim(), table);
    if (!text) blank.push(view);
  }
  assert.deepStrictEqual(blank, [], `lists rendering nothing at all: ${blank.join(', ')}`);
});

// ── Home says where the job actually stands ──────────────────────────────
await check('Home describes the whole job, not the first half of it', async () => {
  await page.goto(`${BASE}/workbench/#/home`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const steps = await page.evaluate(() =>
    [...document.querySelectorAll('#view-home .jstep')].map((el) => el.querySelector('h2')?.textContent.trim()));
  assert.strictEqual(steps.length, 5, `Home shows ${steps.length} steps: ${steps.join(' | ')}`);
  // The two places licensees get stuck were missing from the one screen meant
  // to explain the product.
  assert.ok(steps.some((s) => /client can give you/i.test(s)), 'the settings the client owes are not explained');
  assert.ok(steps.some((s) => /Hand it over/i.test(s)), 'the handoff is not mentioned');
  // And the introduction must not contradict the cards under it.
  const lede = await page.textContent('#view-home .lede');
  assert.doesNotMatch(lede, /two steps/i, 'the lede still claims the old two-step shape');
});

await check('a site that owes something says so on Home and in the roster', async () => {
  const made = await page.evaluate(async () => {
    const key = localStorage.getItem('sd.apiKey');
    const r = await fetch('/v1/sites', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'd4-site-template', config: { siteName: 'Owing Bakery', modules: ['d4-cms-core'] } }),
    });
    return r.json();
  });
  // Wait for the dry build to land, so "built" is true rather than pending.
  // Polled from here rather than with waitForFunction: an async predicate
  // returns a Promise, which is truthy, so the wait can finish on the first
  // poll and hand back a site that has not been built yet.
  let settled = null;
  for (let i = 0; i < 150 && !settled; i += 1) {
    const status = await page.evaluate(async (jobId) => {
      const key = localStorage.getItem('sd.apiKey');
      const j = await (await fetch('/v1/jobs/' + jobId, { headers: { Authorization: 'Bearer ' + key } })).json();
      return j.status;
    }, made.jobId);
    if (status === 'done' || status === 'failed') settled = status;
    else await new Promise((r) => setTimeout(r, 100));
  }
  assert.strictEqual(settled, 'done', 'the dry build should finish');

  // Pressing the section you are already on re-loads it, which is the point of
  // doing it this way rather than reloading the page: it proves that works.
  await page.goto(`${BASE}/workbench/#/sites`, { waitUntil: 'networkidle' });
  await page.click('[data-view="sites"]');
  await page.waitForFunction(() => /needs \d+ setting/.test(document.querySelector('#sitesTable tbody')?.textContent || ''), null, { timeout: 8000 });

  await page.goto(`${BASE}/workbench/#/home`, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => /waiting on something from the client/i.test(document.querySelector('#homeSettings')?.textContent || ''),
    null, { timeout: 8000 },
  );
  const named = await page.textContent('#homeSettings');
  assert.match(named, /Owing Bakery/, 'and it names which client, not just a count');
});

// ── Waiting ──────────────────────────────────────────────────────────────
await check('a slow load says it is loading rather than looking empty', async () => {
  // Hold the response back once, long enough to observe the in-between state.
  let held = false;
  await page.route('**/v1/sites', async (route) => {
    if (!held) { held = true; await new Promise((r) => setTimeout(r, 1200)); }
    await route.continue();
  });
  await page.goto(`${BASE}/workbench/#/keys`, { waitUntil: 'networkidle' });
  await page.click('[data-view="sites"]');
  await page.waitForFunction(
    () => /Loading/i.test(document.querySelector('#sitesTable tbody')?.innerText || ''),
    null,
    { timeout: 2000 },
  );
  // Let the held request land before removing the handler, or Playwright is
  // still holding a route that no longer has anywhere to go.
  await page.waitForFunction(
    () => !/Loading/i.test(document.querySelector('#sitesTable tbody')?.innerText || ''),
    null,
    { timeout: 5000 },
  );
  await page.unroute('**/v1/sites');
});

// ── Broken ───────────────────────────────────────────────────────────────
await check('with the connection gone, every list view says so', async () => {
  await page.route('**/v1/**', (r) => r.abort());
  thrown.length = 0;

  const silent = [];
  for (const view of ['templates', 'sites', 'keys', 'billing', 'connections']) {
    await page.goto(`${BASE}/workbench/#/${view}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const text = await viewText(view);
    // Either the view says it in place, or the safety-net banner says it.
    const banner = await page.evaluate(() => {
      const b = document.getElementById('troubleBanner');
      return b && !b.hidden ? b.textContent : '';
    });
    if (!/reach Stardrive|offline|Could not load|unavailable/i.test(text + ' ' + banner)) silent.push(view);
  }
  assert.deepStrictEqual(silent, [], `views that failed in silence: ${silent.join(', ')}`);
});

await check('and nothing is left to die as an uncaught error', async () => {
  assert.deepStrictEqual(thrown, [], `uncaught in the page: ${thrown.join('; ')}`);
});

await check('signing in with no connection explains itself instead of doing nothing', async () => {
  await page.route('**/auth/**', (r) => r.abort());
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/workbench/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGate:not([hidden])', { timeout: 8000 });
  await page.fill('input[name="email"]', 'nowhere@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.click('#authSubmit');
  await page.waitForFunction(
    () => /reach Stardrive|went wrong/i.test(document.querySelector('#authNote')?.textContent || ''),
    null,
    { timeout: 4000 },
  );
  // And the button comes back, so they can try again once the wifi returns.
  assert.strictEqual(await page.isDisabled('#authSubmit'), false, 'the submit button stayed disabled');
});

await browser.close();
stopAll();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll console state checks passed.');
