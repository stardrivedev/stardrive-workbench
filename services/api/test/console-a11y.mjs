/**
 * Accessibility of the Workbench itself.
 *
 * Stardrive runs axe against every client site it builds and, until this file
 * existed, never once against its own console. It was failing: `--muted` sat
 * at 4.0:1 against the sidebar, so roughly a hundred elements across every
 * view were below the contrast floor we hold customers' sites to.
 *
 * This runs the same tool over every view so that cannot come back. It also
 * checks the things axe cannot: that the keyboard reaches the navigation, and
 * that focus is actually visible when it gets there.
 *
 * Playwright and axe-core are optional, as they are for the full QA tier:
 * point STARDRIVE_PLAYWRIGHT and STARDRIVE_AXE_CORE at installs, or have them
 * resolvable. Without them this SKIPS rather than failing.
 *
 * Run: node services/api/test/console-a11y.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startServer } from './helpers/server.mjs';

const require = createRequire(import.meta.url);

const pwSpec = process.env.STARDRIVE_PLAYWRIGHT || 'playwright';
let chromium = null;
try {
  const pw = await import(path.isAbsolute(pwSpec) ? pathToFileURL(pwSpec).href : pwSpec);
  chromium = pw.chromium ?? pw.default?.chromium ?? null;
} catch { /* not installed */ }

/** axe-core ships as a single browser script; inject the source directly. */
function axeSource() {
  const explicit = process.env.STARDRIVE_AXE_CORE;
  if (explicit && fs.existsSync(explicit)) return fs.readFileSync(explicit, 'utf-8');
  // Beside a Playwright install is where it usually already is.
  if (path.isAbsolute(pwSpec)) {
    const guess = path.join(pwSpec, '..', '..', 'axe-core', 'axe.min.js');
    if (fs.existsSync(guess)) return fs.readFileSync(guess, 'utf-8');
  }
  try { return fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8'); } catch { return null; }
}

const AXE = chromium ? axeSource() : null;
if (!chromium || !AXE) {
  console.log(`console a11y: SKIPPED (${!chromium ? 'no Playwright' : 'no axe-core'} — set STARDRIVE_PLAYWRIGHT / STARDRIVE_AXE_CORE).`);
  process.exit(0);
}

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-a11y-'));

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

const { child: server, base: BASE } = await startServer({ varDir });
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('dialog', (d) => d.accept());

/**
 * Same bar the client sites are held to: critical and serious fail. Moderate
 * is included as well, because the whole point is not to ship our customers a
 * standard we do not meet ourselves.
 */
async function violations() {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'] }));
  return result.violations
    .filter((v) => ['critical', 'serious', 'moderate'].includes(v.impact))
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length}x): ${v.help}`);
}

console.log('console a11y:');

await page.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });

await check('the login gate is clean', async () => {
  const bad = await violations();
  assert.deepStrictEqual(bad, [], `\n        ${bad.join('\n        ')}`);
});

await check('sign in', async () => {
  await page.click('[data-authtab="signup"]');
  await page.fill('input[name="email"]', 'a11y@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.click('#authSubmit');
  await page.waitForSelector('#appLayout:not([hidden])', { timeout: 8000 });
});

// Every view a licensee can reach from the sidebar.
for (const view of ['home', 'studio', 'templates', 'sites', 'connections', 'going-live', 'keys', 'billing', 'reference', 'rulebook']) {
  await check(`${view} is clean`, async () => {
    await page.goto(`${BASE}/workbench/#/${view}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500); // let the view finish painting before scanning
    const bad = await violations();
    assert.deepStrictEqual(bad, [], `\n        ${bad.join('\n        ')}`);
  });
}

await check('both themes pass, not just the one that happens to be on', async () => {
  await page.goto(`${BASE}/workbench/#/home`, { waitUntil: 'networkidle' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await page.waitForTimeout(200);
    const bad = await violations();
    assert.deepStrictEqual(bad, [], `${theme}:\n        ${bad.join('\n        ')}`);
  }
});

await check('the keyboard reaches the navigation, and focus is visible when it does', async () => {
  await page.goto(`${BASE}/workbench/#/home`, { waitUntil: 'networkidle' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), 'light');

  // Tab until a sidebar link has focus. Someone who cannot use a mouse has to
  // be able to get there at all.
  let reached = false;
  for (let i = 0; i < 25 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => Boolean(document.activeElement?.closest?.('.sidebar')));
  }
  assert.strictEqual(reached, true, 'no sidebar link was reachable by keyboard');

  // And it must be SEEN. A focus ring the browser draws by default counts;
  // one suppressed by `outline: none` with nothing in its place does not.
  const visible = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    return ring || s.boxShadow !== 'none' || s.backgroundColor !== getComputedStyle(el.parentElement).backgroundColor;
  });
  assert.strictEqual(visible, true, 'the focused element gives no visible sign of it');
});

await browser.close();
server.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll console accessibility checks passed.');
