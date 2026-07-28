/**
 * Browser verification of the two surfaces a licensee reaches at the very end
 * of a job: the site's settings, and the handoff they send their client.
 *
 * These are the screens where a mistake is expensive and silent. A secret
 * echoed back into an input, a blank field that quietly erases a saved key, a
 * handoff that promises a section the client does not have. None of that shows
 * up in a unit test, so it is driven here in a real browser.
 *
 * Playwright is optional, as it is for full QA: have it resolvable, or point
 * STARDRIVE_PLAYWRIGHT at an install. Without one this SKIPS.
 *
 * Run: node services/api/test/handoff-ui.mjs
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
  console.log('handoff UI: SKIPPED (no Playwright — set STARDRIVE_PLAYWRIGHT to an install).');
  process.exit(0);
}

const PORT = Number(process.env.STARDRIVE_TEST_PORT || (5300 + Math.floor(Math.random() * 200)));
const BASE = `http://localhost:${PORT}`;
const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-handoffui-'));

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
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`server exited early (${code}) on :${PORT}. Output:\n${buf}`)); });
  });
}

const server = await startServer();
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
const EXPECTED = /401 \(Unauthorized\)|404 \(Not Found\)/;
page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('dialog', (d) => d.accept());

/** Call the API as the signed-in licensee, from inside the page. */
const asUser = (p, init = {}) => page.evaluate(async ({ p, init }) => {
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

console.log('handoff UI:');

await page.goto(BASE + '/workbench/', { waitUntil: 'networkidle' });

await check('sign up and build a site with a booking module', async () => {
  await page.click('[data-authtab="signup"]');
  await page.fill('input[name="email"]', 'handoff-ui@example.com');
  await page.fill('input[name="password"]', 'a-long-enough-password');
  await page.click('#authSubmit');
  await page.waitForSelector('#appLayout:not([hidden])', { timeout: 8000 });

  const made = await asUser('/v1/sites', {
    method: 'POST',
    body: { templateId: 'd4-site-template', config: { siteName: 'Otley Bakes', modules: ['d4-cms-core', 'd4-booking'] } },
  });
  assert.strictEqual(made.status, 202, JSON.stringify(made.json));
  globalThis.__site = made.json.siteId;

  // The publish panel only exists once there is something to publish.
  for (let i = 0; i < 100; i += 1) {
    const job = await asUser(`/v1/jobs/${made.json.jobId}`);
    if (job.json?.status === 'done') return;
    assert.notStrictEqual(job.json?.status, 'failed', 'the dry build should not fail');
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the build never finished');
});

await check('the settings panel separates what we handle from what they owe', async () => {
  await page.goto(`${BASE}/workbench/#/sites?site=${globalThis.__site}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#launchPanel .launch', { timeout: 10000 });
  await page.waitForSelector('#envBlock .launchPart', { timeout: 8000 });
  const text = await page.textContent('#envBlock');
  assert.match(text, /Site settings/);
  assert.match(text, /Resend API key/, 'the thing only they can give us is asked for by name');
  assert.match(text, /no email is ever sent/, 'with the consequence attached');
  assert.match(text, /Handled for you/, 'and the rest is visibly not their problem');
  assert.match(text, /still missing/, 'the gap is stated before they publish, not after');
});

await check('the admin password is never rendered into the settings panel', async () => {
  const html = await page.innerHTML('#envBlock');
  const stored = await asUser(`/v1/sites/${globalThis.__site}/env/file`);
  const password = /^ADMIN_PASSWORD=(.+)$/m.exec(stored.text)?.[1];
  assert.ok(password && password.length >= 20, 'a password was generated');
  assert.strictEqual(html.includes(password), false, 'and it is not sitting in the settings DOM');
});

await check('saving a key persists it, and the input never echoes it back', async () => {
  await page.fill('[data-env="RESEND_API_KEY"]', 're_live_browsersecret');
  await page.fill('[data-env="CONTACT_TO_EMAIL"]', 'owner@example.com');
  await page.click('[data-siteact="env-save"]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#launchOut')?.textContent || ''), null, { timeout: 8000 });

  await page.waitForFunction(() => /saved/.test(document.querySelector('#envBlock')?.textContent || ''), null, { timeout: 8000 });
  const html = await page.innerHTML('#envBlock');
  assert.strictEqual(html.includes('re_live_browsersecret'), false, 'a secret must not come back into the DOM');
  assert.ok(html.includes('owner@example.com'), 'but an address they typed is theirs to see and correct');

  const stored = await asUser(`/v1/sites/${globalThis.__site}/env`);
  assert.strictEqual(stored.json.set.RESEND_API_KEY.set, true);
  assert.strictEqual(stored.json.missing.some((m) => m.name === 'RESEND_API_KEY'), false);
});

await check('leaving a secret field blank does not erase the saved key', async () => {
  // The commonest way to lose a key: come back, change the email, save.
  await page.fill('[data-env="CONTACT_TO_EMAIL"]', 'newowner@example.com');
  await page.click('[data-siteact="env-save"]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#launchOut')?.textContent || ''), null, { timeout: 8000 });

  const file = await asUser(`/v1/sites/${globalThis.__site}/env/file`);
  assert.match(file.text, /^RESEND_API_KEY=re_live_browsersecret$/m, 'the untouched key survived');
  assert.match(file.text, /^CONTACT_TO_EMAIL=newowner@example\.com$/m, 'and the edit landed');
});

await check('the handoff reads for the client and lists only their own sections', async () => {
  const res = await asUser(`/v1/sites/${globalThis.__site}/handoff`);
  assert.strictEqual(res.status, 200);
  assert.match(res.text, /There is no username/);
  assert.match(res.text, /Bookings/, 'this client has a diary');
  assert.strictEqual(res.text.includes('Menus'), false, 'and no menu');
  assert.strictEqual(/Email delivery is not switched on/.test(res.text), false,
    'the email warning is gone now that a key is saved');
});

await check('rotating the password changes it and warns it is not live yet', async () => {
  const before = await asUser(`/v1/sites/${globalThis.__site}/env/file`);
  await page.click('[data-siteact="handoff-rotate"]');
  await page.waitForFunction(() => /New password/.test(document.querySelector('#launchOut')?.textContent || ''), null, { timeout: 8000 });
  const shown = await page.textContent('#launchOut');
  assert.match(shown, /Publish again/, 'the old one still works until they do');

  const after = await asUser(`/v1/sites/${globalThis.__site}/env/file`);
  assert.notStrictEqual(before.text, after.text);
});

await check('Going live explains the whole job without leaving the app', async () => {
  await page.goto(BASE + '/workbench/#/going-live', { waitUntil: 'networkidle' });
  await page.waitForSelector('#goingLiveRoot .card', { timeout: 8000 });
  const text = await page.textContent('#goingLiveRoot');

  assert.match(text, /Settings you supply/);
  assert.match(text, /Resend API key/, 'named, with what it is for');
  assert.match(text, /Handled for you/, 'and what they never have to touch');
  assert.match(text, /ADMIN_PASSWORD/);
  assert.match(text, /runs Node/, 'the constraint that bites is on the page');
  assert.match(text, /Vercel/);
  assert.match(text, /Cloudflare Pages/, 'including hosts we do not publish to directly');
  assert.match(text, /Handing over to your client/);
  assert.match(text, /Stripe key/, 'the question a licensee would otherwise email about');
});

await check('the publish panel links to it, so it is found at the moment of need', async () => {
  await page.goto(`${BASE}/workbench/#/sites?site=${globalThis.__site}`, { waitUntil: 'networkidle' });
  // Wait for the link itself, not for the panel around it. A hash-only
  // navigation does not reload, so the previous view's panel is still in the
  // DOM and any wait on it passes instantly, just before the re-render wipes
  // it. Waiting on the thing being asserted is the only race-free version.
  await page.waitForSelector('#launchPanel a[href="#/going-live"]', { timeout: 10000 });
});

await check('no JavaScript errors anywhere in the flow', () => {
  assert.deepStrictEqual(errors, []);
});

await browser.close();
server.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll handoff UI checks passed.');
