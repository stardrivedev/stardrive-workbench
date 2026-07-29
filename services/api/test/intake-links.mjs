/**
 * Client intake links, over real HTTP.
 *
 * This is the only surface where somebody with no account can write to a
 * licensee's data, so most of what is below is about the boundary rather than
 * the happy path: what a stranger can reach, what a revoked link can still do,
 * whether a client can overwrite work that has already been adopted, and
 * whether one client's link reaches another client's answers.
 *
 * Run: node services/api/test/intake-links.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, stopAll } from './helpers/server.mjs';

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-intake-'));

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); },
);

const { base: BASE } = await startServer({ varDir });

const api = async (method, p, { key, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json ?? {}, text, headers: res.headers };
};

/** An account with a built site to hang an intake link off. */
async function licensee(email) {
  const up = await api('POST', '/auth/signup', { body: { email, password: 'a-long-enough-password', company: 'Bread & Butter Studio' } });
  assert.strictEqual(up.status, 201, up.text);
  const key = up.body.apiKey.secret;
  const made = await api('POST', '/v1/sites', {
    key,
    body: { templateId: 'd4-site-template', config: { siteName: 'Otley Bakes', modules: ['d4-cms-core', 'd4-careers-portal'] } },
  });
  assert.strictEqual(made.status, 202, made.text);
  for (let i = 0; i < 100; i += 1) {
    const job = await api('GET', `/v1/jobs/${made.body.jobId}`, { key });
    if (job.body.status === 'done') break;
    assert.notStrictEqual(job.body.status, 'failed', 'the dry build should not fail');
    await new Promise((r) => setTimeout(r, 100));
  }
  return { key, siteId: made.body.siteId };
}

console.log('client intake links:');

const owner = await licensee('intake-owner@example.com');
let url;
let token;
let linkId;

await check('a licensee mints a link, and the token is shown exactly once', async () => {
  const res = await api('POST', `/v1/sites/${owner.siteId}/intake-link`, {
    key: owner.key, body: { note: 'Anything you are unsure about, leave blank and we will talk.' },
  });
  assert.strictEqual(res.status, 201, res.text);
  assert.match(res.body.url, /\/intake\/[A-Za-z0-9_-]{20,}$/, 'a real URL to send');
  url = res.body.url;
  token = url.split('/intake/')[1];
  linkId = res.body.link.id;

  // The token is never recoverable, from the listing or the detail view.
  const list = await api('GET', '/v1/intake-links', { key: owner.key });
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.text.includes(token), false, 'the listing must not echo the token');
  const detail = await api('GET', `/v1/intake-links/${linkId}`, { key: owner.key });
  assert.strictEqual(detail.text.includes(token), false, 'nor the detail view');
});

await check('and it is not sitting in plaintext on disk either', async () => {
  const raw = fs.readFileSync(path.join(varDir, 'intake-links', `${linkId}.json`), 'utf-8');
  assert.strictEqual(raw.includes(token), false, 'a stolen var directory must not yield working links');
});

await check('the client opens it with no account and is asked what the build needs', async () => {
  const res = await api('GET', `/v1/public/intake/${token}`);
  assert.strictEqual(res.status, 200, res.text);
  assert.strictEqual(res.body.siteName, 'Otley Bakes');
  assert.strictEqual(res.body.studio, 'Bread & Butter Studio', 'the client sees who sent it');
  assert.match(res.body.note, /leave blank/);
  const ids = res.body.fields.map((f) => f.id);
  assert.ok(ids.includes('whatYouDo'), 'the base questions are asked');
  assert.ok(ids.includes('roles'), 'and the ones this site\'s careers page needs');
  assert.ok(res.body.photoSlots.some((s) => s.id === 'logo'), 'their logo is asked for');
  // The form must not leak the licensee's account or anything else about them.
  assert.strictEqual(res.text.includes('intake-owner@example.com'), false, 'no licensee email reaches the client');
  assert.strictEqual(res.text.includes(owner.siteId), false, 'nor internal ids');
});

await check('answers save as they are typed, partially, and come back', async () => {
  const first = await api('PATCH', `/v1/public/intake/${token}`, { body: { facts: { whatYouDo: 'We bake sourdough.' } } });
  assert.strictEqual(first.status, 200, first.text);
  assert.strictEqual(first.body.readiness.ready, false, 'one answer is not the whole form');

  await api('PATCH', `/v1/public/intake/${token}`, { body: { facts: { contactEmail: 'hello@otleybakes.example' } } });
  const back = await api('GET', `/v1/public/intake/${token}`);
  assert.strictEqual(back.body.facts.whatYouDo, 'We bake sourdough.', 'the earlier answer survived');
  assert.strictEqual(back.body.facts.contactEmail, 'hello@otleybakes.example');
});

await check('a field this site never asked for is ignored, not stored', async () => {
  const res = await api('PATCH', `/v1/public/intake/${token}`, {
    body: { facts: { whatYouDo: 'We bake sourdough.', notAQuestion: 'x', menuItems: [{ name: 'x' }] } },
  });
  assert.strictEqual(res.status, 200);
  const back = await api('GET', `/v1/public/intake/${token}`);
  assert.strictEqual('notAQuestion' in back.body.facts, false, 'invented fields do not stick');
  assert.strictEqual('menuItems' in back.body.facts, false, 'nor fields belonging to a module this site does not have');
});

await check('rubbish in a typed field is refused with something a person can act on', async () => {
  const res = await api('PATCH', `/v1/public/intake/${token}`, { body: { facts: { contactEmail: 'not-an-email' } } });
  assert.strictEqual(res.status, 422, res.text);
  assert.match(res.body.error.message, /email/i);
});

await check('a photo uploads, is served back, and can be removed', async () => {
  // A real 1x1 PNG: the store checks the extension, and the client's own form
  // renders what comes back, so it has to be a genuine image.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  const up = await api('POST', `/v1/public/intake/${token}/photos/logo`, {
    body: { filename: 'logo.png', contentBase64: png.toString('base64') },
  });
  assert.strictEqual(up.status, 201, up.text);
  const got = await fetch(`${BASE}/v1/public/intake/${token}/photos/logo/${up.body.asset.id}`);
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.headers.get('content-type'), 'image/png');

  const gone = await api('DELETE', `/v1/public/intake/${token}/photos/logo/${up.body.asset.id}`);
  assert.strictEqual(gone.status, 200);
  const after = await fetch(`${BASE}/v1/public/intake/${token}/photos/logo/${up.body.asset.id}`);
  assert.strictEqual(after.status, 404, 'and it is really gone');
});

await check('a file of the wrong sort is refused by name', async () => {
  const res = await api('POST', `/v1/public/intake/${token}/photos/logo`, {
    body: { filename: 'accounts.pdf', contentBase64: Buffer.from('%PDF-1.4').toString('base64') },
  });
  assert.strictEqual(res.status, 422, res.text);
  assert.match(res.body.error.message, /accepts/i);
});

await check('a picture cannot be pushed into a compartment the client was not offered', async () => {
  // Page hero backgrounds are the designer's call, not something to put to a
  // bakery, so they are not in the client's list and must not be reachable.
  const res = await api('POST', `/v1/public/intake/${token}/photos/hero-about`, {
    body: { filename: 'x.png', contentBase64: 'AA==' },
  });
  assert.strictEqual(res.status, 422, res.text);
  assert.match(res.body.error.message, /not a picture this site asks for/i);
});

await check('submitting is refused while a required answer is missing', async () => {
  const res = await api('POST', `/v1/public/intake/${token}/submit`);
  assert.strictEqual(res.status, 422, res.text);
  assert.match(res.body.error.message, /still needed/i);
  // And it names them, so the client knows what to go back to.
  assert.match(res.body.error.message, /facts about the business|services/i);
});

await check('a finished form submits, and the licensee sees it waiting', async () => {
  const filled = await api('PATCH', `/v1/public/intake/${token}`, {
    body: {
      facts: {
        whatYouDo: 'We bake sourdough in Otley.',
        aboutFacts: 'Started in 2018 by two sisters. Everything is made the same morning it is sold.',
        services: ['Sourdough loaves', 'Pastries', 'Celebration cakes'],
        contactEmail: 'hello@otleybakes.example',
        roles: [{ title: 'Weekend baker', summary: 'Early starts, four shifts a week.' }],
      },
    },
  });
  assert.strictEqual(filled.status, 200, filled.text);
  assert.strictEqual(filled.body.readiness.ready, true, 'the form is complete');

  const sent = await api('POST', `/v1/public/intake/${token}/submit`);
  assert.strictEqual(sent.status, 200, sent.text);

  const list = await api('GET', '/v1/intake-links', { key: owner.key });
  const mine = list.body.links.find((l) => l.id === linkId);
  assert.strictEqual(mine.status, 'submitted');
  assert.ok(mine.answeredCount >= 5, `answers counted: ${mine.answeredCount}`);
});

await check('a client who spots a typo can reopen it themselves', async () => {
  const reopened = await api('POST', `/v1/public/intake/${token}/reopen`);
  assert.strictEqual(reopened.status, 200, reopened.text);
  const back = await api('GET', `/v1/public/intake/${token}`);
  assert.strictEqual(back.body.submitted, false);
  await api('PATCH', `/v1/public/intake/${token}`, { body: { facts: { phone: '01943 000000' } } });
  await api('POST', `/v1/public/intake/${token}/submit`);
});

await check('ACCOUNT ISOLATION: another licensee reaches none of it', async () => {
  const other = await licensee('intake-stranger@example.com');
  assert.strictEqual((await api('GET', `/v1/intake-links/${linkId}`, { key: other.key })).status, 404);
  assert.strictEqual((await api('POST', `/v1/intake-links/${linkId}/adopt`, { key: other.key, body: {} })).status, 404);
  assert.strictEqual((await api('DELETE', `/v1/intake-links/${linkId}`, { key: other.key })).status, 404);
  const theirs = await api('GET', '/v1/intake-links', { key: other.key });
  assert.deepStrictEqual(theirs.body.links, [], 'and their own list is empty');
});

await check('adopting merges the answers and the photos onto the site', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await api('POST', `/v1/public/intake/${token}/reopen`);
  await api('POST', `/v1/public/intake/${token}/photos/logo`, { body: { filename: 'logo.png', contentBase64: png.toString('base64') } });
  await api('POST', `/v1/public/intake/${token}/submit`);

  const res = await api('POST', `/v1/intake-links/${linkId}/adopt`, { key: owner.key, body: {} });
  assert.strictEqual(res.status, 200, res.text);
  assert.strictEqual(res.body.photos, 1, 'the logo came across');
  assert.strictEqual(res.body.readiness.ready, true, 'and the site is now ready to build');

  const content = await api('GET', `/v1/sites/${owner.siteId}/content`, { key: owner.key });
  assert.strictEqual(content.body.facts.whatYouDo, 'We bake sourdough in Otley.');
  assert.deepStrictEqual(content.body.facts.services, ['Sourdough loaves', 'Pastries', 'Celebration cakes']);
  assert.strictEqual(content.body.facts.phone, '01943 000000');

  const siteAssets = await api('GET', `/v1/sites/${owner.siteId}/assets`, { key: owner.key });
  assert.strictEqual((siteAssets.body.assets.logo || []).length, 1, 'the photo is on the site now');
});

await check('an adopted link stops accepting writes', async () => {
  // An old email forwarded to somebody else must not be able to change work
  // that has already been taken up.
  const res = await api('PATCH', `/v1/public/intake/${token}`, { body: { facts: { whatYouDo: 'vandalism' } } });
  assert.strictEqual(res.status, 409, res.text);
  assert.match(res.body.error.message, /already picked these answers up/i);

  const content = await api('GET', `/v1/sites/${owner.siteId}/content`, { key: owner.key });
  assert.strictEqual(content.body.facts.whatYouDo, 'We bake sourdough in Otley.', 'the site is untouched');
});

await check("the licensee's own corrections survive an adopt", async () => {
  // They may have fixed something the client got wrong; adopting must not
  // quietly put the client's version back.
  const site2 = await api('POST', '/v1/sites', {
    key: owner.key,
    body: { templateId: 'd4-site-template', config: { siteName: 'Second Client', modules: ['d4-cms-core'] } },
  });
  for (let i = 0; i < 100; i += 1) {
    const job = await api('GET', `/v1/jobs/${site2.body.jobId}`, { key: owner.key });
    if (job.body.status === 'done') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const mint = await api('POST', `/v1/sites/${site2.body.siteId}/intake-link`, { key: owner.key });
  const t2 = mint.body.url.split('/intake/')[1];

  await api('PATCH', `/v1/public/intake/${t2}`, { body: { facts: { contactEmail: 'typo@wrong.example', whatYouDo: 'A shop.' } } });
  await api('PATCH', `/v1/sites/${site2.body.siteId}/content`, { key: owner.key, body: { facts: { contactEmail: 'correct@right.example' } } });

  const adopted = await api('POST', `/v1/intake-links/${mint.body.link.id}/adopt`, { key: owner.key, body: {} });
  assert.strictEqual(adopted.status, 200, adopted.text);
  const content = await api('GET', `/v1/sites/${site2.body.siteId}/content`, { key: owner.key });
  assert.strictEqual(content.body.facts.contactEmail, 'correct@right.example', 'the correction stood');
  assert.strictEqual(content.body.facts.whatYouDo, 'A shop.', 'and the rest still came through');
});

await check('minting a second link revokes the first', async () => {
  const third = await api('POST', '/v1/sites', {
    key: owner.key,
    body: { templateId: 'd4-site-template', config: { siteName: 'Third Client', modules: ['d4-cms-core'] } },
  });
  const a = await api('POST', `/v1/sites/${third.body.siteId}/intake-link`, { key: owner.key });
  const tokenA = a.body.url.split('/intake/')[1];
  assert.strictEqual((await api('GET', `/v1/public/intake/${tokenA}`)).status, 200);

  const b = await api('POST', `/v1/sites/${third.body.siteId}/intake-link`, { key: owner.key });
  const tokenB = b.body.url.split('/intake/')[1];
  assert.strictEqual((await api('GET', `/v1/public/intake/${tokenA}`)).status, 404, 'the old link is dead');
  assert.strictEqual((await api('GET', `/v1/public/intake/${tokenB}`)).status, 200, 'the new one works');
});

await check('a revoked link is gone, and takes the uploads with it', async () => {
  const fourth = await api('POST', '/v1/sites', {
    key: owner.key,
    body: { templateId: 'd4-site-template', config: { siteName: 'Fourth Client', modules: ['d4-cms-core'] } },
  });
  const mint = await api('POST', `/v1/sites/${fourth.body.siteId}/intake-link`, { key: owner.key });
  const t = mint.body.url.split('/intake/')[1];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  await api('POST', `/v1/public/intake/${t}/photos/logo`, { body: { filename: 'logo.png', contentBase64: png.toString('base64') } });

  assert.strictEqual((await api('DELETE', `/v1/intake-links/${mint.body.link.id}`, { key: owner.key })).status, 200);
  assert.strictEqual((await api('GET', `/v1/public/intake/${t}`)).status, 404);
  assert.strictEqual(fs.existsSync(path.join(varDir, 'assets', `intake-${mint.body.link.id}`)), false,
    "a revoked link's uploads are not left lying about");
});

await check('a made-up token is refused the same way a revoked one is', async () => {
  const res = await api('GET', `/v1/public/intake/${'z'.repeat(32)}`);
  assert.strictEqual(res.status, 404);
  assert.match(res.body.error.message, /not valid any more/i);
  assert.strictEqual(/revoked|expired|unknown/i.test(res.body.error.message), false,
    'a stranger learns nothing about whether that token ever existed');
});

await check('an expired link reads as gone without erroring', async () => {
  const fifth = await api('POST', '/v1/sites', {
    key: owner.key,
    body: { templateId: 'd4-site-template', config: { siteName: 'Fifth Client', modules: ['d4-cms-core'] } },
  });
  const mint = await api('POST', `/v1/sites/${fifth.body.siteId}/intake-link`, { key: owner.key, body: { ttlDays: 1 } });
  const t = mint.body.url.split('/intake/')[1];
  // Reach into the record and age it, rather than waiting a day.
  const file = path.join(varDir, 'intake-links', `${mint.body.link.id}.json`);
  const record = JSON.parse(fs.readFileSync(file, 'utf-8'));
  record.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(record));

  assert.strictEqual((await api('GET', `/v1/public/intake/${t}`)).status, 404);
  const list = await api('GET', '/v1/intake-links', { key: owner.key });
  const shown = list.body.links.find((l) => l.id === mint.body.link.id);
  assert.strictEqual(shown.status, 'expired', 'and the licensee is told why, not left guessing');
});

await check('the client page is served for any token, and told not to be indexed', async () => {
  const page = await fetch(`${BASE}/intake/${token}`);
  assert.strictEqual(page.status, 200);
  assert.match(page.headers.get('x-robots-tag') || '', /noindex/, "a client's answers must not turn up in a search engine");
  const html = await page.text();
  assert.match(html, /About your website/);
  assert.strictEqual(html.includes('Workbench'), false, 'the client never sees the console');
  // Its own assets are served by name rather than being treated as tokens.
  assert.strictEqual((await fetch(`${BASE}/intake/app.js`)).status, 200);
  assert.strictEqual((await fetch(`${BASE}/intake/styles.css`)).status, 200);
});

await check('the token cannot be used to walk out of its own directory', async () => {
  for (const nasty of ['..%2F..%2Fserver.mjs', '..%2F..%2F..%2Fetc%2Fpasswd', 'a/../../server.mjs']) {
    const res = await fetch(`${BASE}/intake/${nasty}`);
    assert.strictEqual(res.status < 500, true, `no crash on ${nasty} (got ${res.status})`);
    const body = await res.text();
    assert.strictEqual(body.includes('createServer'), false, `served source for ${nasty}`);
  }
});

stopAll();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(varDir, { recursive: true, force: true });

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll client intake link checks passed.');
