/**
 * Site environment, handoff, and portability.
 *
 * The bug these exist to prevent: a site that assembles perfectly and arrives
 * dead, because the CMS fails closed without ADMIN_PASSWORD and nothing ever
 * set one. So the checks below care most about which variables are filled for
 * whom, that secrets never leave through a listing, and that the client
 * handoff tells the truth about what is and is not switched on.
 *
 * Run: node services/api/test/site-env.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VarStore } from '../lib/store.mjs';
import {
  createSiteEnv, specFor, deployEnv, renderEnvFile, missingFrom,
  generateAdminPassword, MANAGED, SUPPLIED,
} from '../lib/site-env.mjs';
import { guideFor, notesFor, renderHandoffHtml } from '../lib/handoff.mjs';
import { renderDockerfile, renderDeployGuide } from '../lib/portable.mjs';
import { deployGuide, HOSTS } from '../lib/guide.mjs';
import { netlifySiteName } from '../lib/deploy-netlify.mjs';

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);

const fresh = () => createSiteEnv(new VarStore(fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-env-'))), fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-secret-')));

// A stand-in catalog: manifests declare their own env, which is how a module
// added later brings its settings with it.
const manifests = {
  'd4-cms-core': { env: [{ name: 'ADMIN_PASSWORD', required: true, description: 'Admin login.' }, { name: 'TURSO_DATABASE_URL', required: false, description: 'Database.' }] },
  'd4-booking': { env: [{ name: 'RESEND_API_KEY', required: false, description: 'Email.' }, { name: 'CONTACT_TO_EMAIL', required: false, description: 'Inbox.' }] },
};
const resolve = (name) => manifests[name] ?? null;

console.log('site env:');

await check('the spec sorts what the licensee owes above what we handle', () => {
  const spec = specFor(['d4-cms-core', 'd4-booking'], resolve);
  const names = spec.map((v) => v.name);
  assert.ok(names.includes('ADMIN_PASSWORD'));
  assert.ok(names.includes('RESEND_API_KEY'));
  const first = spec[0];
  assert.strictEqual(first.source, 'supplied', 'the things only they can answer come first');
  assert.strictEqual(spec.find((v) => v.name === 'ADMIN_PASSWORD').source, 'managed');
  assert.ok(spec.find((v) => v.name === 'RESEND_API_KEY').why.includes('no email is ever sent'),
    'an optional setting states what breaks without it');
});

await check('a required flag from any one module wins', () => {
  const spec = specFor(['d4-cms-core'], resolve);
  assert.strictEqual(spec.find((v) => v.name === 'ADMIN_PASSWORD').required, true);
});

await check('a site with no modules still needs an admin password and a canonical URL', () => {
  const names = specFor([], resolve).map((v) => v.name);
  assert.ok(names.includes('ADMIN_PASSWORD'));
  assert.ok(names.includes('NEXT_PUBLIC_SITE_URL'));
});

await check('the admin password is generated once and then stays put', () => {
  const env = fresh();
  const first = env.adminPassword('site-1');
  assert.strictEqual(env.adminPassword('site-1'), first, 'rotating on every read would lock out a client who wrote it down');
  assert.ok(first.length >= 20);
  assert.notStrictEqual(env.adminPassword('site-2'), first, 'each site gets its own');
});

await check('generated passwords avoid characters people misread', () => {
  const alphabet = new Set(generateAdminPassword(4000).split(''));
  for (const bad of ['l', 'I', '1', 'O', '0']) {
    assert.strictEqual(alphabet.has(bad), false, `"${bad}" is retyped wrongly off a printed sheet`);
  }
});

await check('rotating gives a new password and keeps it', () => {
  const env = fresh();
  const before = env.adminPassword('s');
  const after = env.rotateAdminPassword('s');
  assert.notStrictEqual(after, before);
  assert.strictEqual(env.adminPassword('s'), after);
});

await check('supplied keys round-trip, and an empty value clears one', () => {
  const env = fresh();
  env.setVar('s', 'RESEND_API_KEY', 're_live_abc123');
  assert.strictEqual(env.values('s').RESEND_API_KEY, 're_live_abc123');
  env.setVar('s', 'RESEND_API_KEY', '   ');
  assert.strictEqual('RESEND_API_KEY' in env.values('s'), false);
});

await check('the masked view never leaks a secret, but does show the contact address', () => {
  const env = fresh();
  env.adminPassword('s');
  env.setVar('s', 'RESEND_API_KEY', 're_live_secret');
  env.setVar('s', 'CONTACT_TO_EMAIL', 'owner@example.com');
  const masked = env.masked('s');
  const json = JSON.stringify(masked);
  assert.strictEqual(json.includes('re_live_secret'), false, 'the key is nowhere in the masked view');
  assert.strictEqual(masked.RESEND_API_KEY.set, true);
  assert.strictEqual('value' in masked.RESEND_API_KEY, false);
  assert.strictEqual('value' in masked.ADMIN_PASSWORD, false, 'not even the admin password');
  assert.strictEqual(masked.CONTACT_TO_EMAIL.value, 'owner@example.com', 'an address they typed is theirs to check');
});

await check('secrets survive a restart, and are unreadable without the same secret', () => {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-env-p-'));
  const secretA = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-sec-a-'));
  const secretB = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-sec-b-'));
  const store = new VarStore(varDir);
  createSiteEnv(store, secretA).setVar('s', 'RESEND_API_KEY', 're_persisted');
  assert.strictEqual(createSiteEnv(store, secretA).values('s').RESEND_API_KEY, 're_persisted');
  const wrong = createSiteEnv(store, secretB).values('s');
  assert.strictEqual('RESEND_API_KEY' in wrong, false, 'a different secret reads nothing rather than garbage');
});

await check('the raw store holds no plaintext', () => {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-env-r-'));
  const store = new VarStore(varDir);
  createSiteEnv(store, varDir).setVar('s', 'RESEND_API_KEY', 're_should_not_be_on_disk');
  const raw = fs.readFileSync(path.join(varDir, 'site-env', 's.json'), 'utf-8');
  assert.strictEqual(raw.includes('re_should_not_be_on_disk'), false);
});

// ── The deploy environment ──
await check('managed values beat a stale supplied copy of the same name', () => {
  const env = deployEnv({
    supplied: { RESEND_API_KEY: 're_x', TURSO_DATABASE_URL: 'libsql://stale' },
    adminPassword: 'pw',
    databaseUrl: 'libsql://live',
    siteUrl: 'https://example.com',
  });
  assert.strictEqual(env.TURSO_DATABASE_URL, 'libsql://live', 'derived from the live connection, not a typed copy');
  assert.strictEqual(env.ADMIN_PASSWORD, 'pw');
  assert.strictEqual(env.RESEND_API_KEY, 're_x');
});

await check('nothing absent is emitted as an empty variable', () => {
  const env = deployEnv({ supplied: {}, adminPassword: 'pw' });
  assert.deepStrictEqual(Object.keys(env), ['ADMIN_PASSWORD'], 'an empty TURSO_AUTH_TOKEN would look configured and break at runtime');
});

await check('missing lists only what the licensee still owes, with the consequence', () => {
  const spec = specFor(['d4-cms-core', 'd4-booking'], resolve);
  const missing = missingFrom(spec, { ADMIN_PASSWORD: 'pw' });
  const names = missing.map((m) => m.name);
  assert.ok(names.includes('RESEND_API_KEY'));
  assert.strictEqual(names.includes('ADMIN_PASSWORD'), false, 'we handle that one');
  assert.ok(missing[0].why.length > 0);
});

await check('the .env file documents each line and warns about committing it', () => {
  const body = renderEnvFile({ ADMIN_PASSWORD: 'pw', RESEND_API_KEY: 're_x' }, 'Otley Bakes');
  assert.match(body, /Otley Bakes/);
  assert.match(body, /never be committed/);
  assert.match(body, /^ADMIN_PASSWORD=pw$/m);
  assert.match(body, new RegExp(MANAGED.ADMIN_PASSWORD.slice(0, 20)));
});

// ── The client handoff ──
console.log('handoff:');

await check('the guide lists only the sections this client actually has', () => {
  const guide = guideFor(['d4-cms-core', 'd4-booking']);
  const panels = guide.map((g) => g.panel);
  assert.ok(panels.includes('Bookings'));
  assert.ok(panels.includes('Inbox'));
  assert.strictEqual(panels.includes('Menus'), false, 'never promise a Menu tab to a site with no menu');
});

await check('with no email configured the client is told their messages are only in the Inbox', () => {
  const notes = notesFor({ modules: ['d4-cms-core'], missingEnv: [], domain: 'x.com', hasEmail: false });
  assert.ok(notes.some((n) => /SAVED and visible in your dashboard Inbox/.test(n)));
});

await check('with email configured that warning disappears', () => {
  const notes = notesFor({ modules: ['d4-cms-core'], missingEnv: [], domain: 'x.com', hasEmail: true });
  assert.strictEqual(notes.some((n) => /Email delivery is not switched on/.test(n)), false);
});

await check('legal and booking each add the caution that matters for them', () => {
  const notes = notesFor({ modules: ['d4-legal', 'd4-booking'], missingEnv: [], domain: 'x.com', hasEmail: true });
  assert.ok(notes.some((n) => /not finished legal documents/.test(n)));
  assert.ok(notes.some((n) => /Check your working hours/.test(n)));
});

await check('the handoff page carries the password and escapes hostile content', () => {
  const html = renderHandoffHtml({
    siteName: '<script>alert(1)</script> Salon',
    siteUrl: 'https://example.com',
    adminUrl: 'https://example.com/admin',
    password: 'Xk7mPq2Wn9RtVb4Zc8Ly',
    guide: guideFor(['d4-cms-core']),
    notes: ['A note.'],
    supportEmail: 'me@example.com',
  });
  assert.match(html, /Xk7mPq2Wn9RtVb4Zc8Ly/, 'a handoff that hides the password is not a handoff');
  assert.strictEqual(html.includes('<script>alert(1)</script>'), false, 'a site name is untrusted text');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /There is no username/, 'answers the first question a client asks');
  assert.strictEqual(html.includes('src="http'), false, 'self-contained: it must open in five years');
});

await check('an unpublished site says so instead of printing a broken link', () => {
  const html = renderHandoffHtml({
    siteName: 'X', siteUrl: '(not published yet)', adminUrl: '(available once the site is published)',
    password: 'p', guide: [], notes: [],
  });
  assert.match(html, /not published yet/);
});

// ── Portability ──
console.log('portability:');

await check('the Dockerfile builds and runs without baking secrets in', () => {
  const df = renderDockerfile('Otley Bakes');
  assert.match(df, /FROM node:22-slim AS build/);
  assert.match(df, /npm run build/);
  assert.match(df, /CMD \["npm", "start"\]/);
  assert.match(df, /supplied at run time, never baked into the image/);
  assert.match(df, /docker run -p 3000:3000 --env-file .env otley-bakes/);
});

await check('the deploy guide names real hosts and states the Node requirement', () => {
  const guide = renderDeployGuide({ siteName: 'Otley Bakes', envNames: ['ADMIN_PASSWORD'], needsNode: true, hasDatabase: true });
  for (const host of ['Vercel', 'Netlify', 'Cloudflare Pages', 'Render', 'Railway', 'Fly.io', 'Coolify']) {
    assert.ok(guide.includes(host), `${host} should be named`);
  }
  // The guide is hard-wrapped prose, so assertions have to tolerate a line
  // break falling anywhere inside a sentence.
  const flat = guide.replace(/\s+/g, ' ');
  assert.match(flat, /rules out static-only hosting/, 'the constraint that actually bites is stated plainly');
  assert.match(flat, /Nobody can hold your site hostage/);
});

await check('the guide lists variable NAMES and never a value', () => {
  const guide = renderDeployGuide({ siteName: 'X', envNames: ['ADMIN_PASSWORD', 'RESEND_API_KEY'] });
  assert.match(guide, /- `ADMIN_PASSWORD`/);
  assert.strictEqual(/ADMIN_PASSWORD=/.test(guide), false, 'this file ships in the export and lands in git');
});

await check('the in-app guide is built from the same definitions the deploy path uses', () => {
  const guide = deployGuide();
  // If these could drift, the page in the app would describe a product that
  // no longer exists. Deriving them is the whole point.
  //
  // Every variable must be findable, but not necessarily as its own row: a
  // requirement with alternatives (image storage) appears once, with its
  // options named underneath, which is the point of grouping it. So the
  // invariant is reachability, not a flat one-to-one list.
  const onThePage = new Set();
  for (const entry of guide.environment.supplied) {
    if (entry.oneOf) for (const opt of entry.oneOf) for (const v of opt.vars) onThePage.add(v);
    else onThePage.add(entry.name);
  }
  const unreachable = Object.entries(SUPPLIED)
    // The optional extras of a group (endpoint, region, public URL) have
    // defaults and are deliberately not put in front of a licensee here.
    .filter(([, def]) => !def.optionalWithin)
    .map(([name]) => name)
    .filter((name) => !onThePage.has(name));
  assert.deepStrictEqual(unreachable, [], 'every setting the licensee owes is on the page');
  assert.deepStrictEqual(
    guide.environment.managed.map((v) => v.name).sort(),
    Object.keys(MANAGED).sort(),
    'and so is everything we handle'
  );
  assert.ok(guide.environment.supplied.every((v) => v.why && v.label), 'each one says what it is for');
});

await check('the guide and the generated DEPLOY.md name the same hosts', () => {
  const named = HOSTS.filter((h) => h.how !== 'server').map((h) => h.name);
  const doc = renderDeployGuide({ siteName: 'X', envNames: [] });
  for (const host of named) {
    assert.ok(doc.includes(host), `${host} is in the app guide but missing from DEPLOY.md`);
  }
});

await check('the guide answers the questions that would otherwise become support', () => {
  const guide = deployGuide();
  const asked = guide.faq.map((f) => f.q).join(' ');
  assert.match(asked, /Stripe key/, 'the one Ridhi asked, answered in the product');
  assert.match(asked, /Where do the API keys actually go/);
  assert.match(guide.faq.find((f) => /Stripe/.test(f.q)).a, /^No\./, 'answered plainly, not hedged');
  assert.match(guide.constraint, /runs Node/, 'the constraint that bites is stated once, up top');
  assert.ok(guide.steps.length >= 4 && guide.handoff.what, 'the whole job is described, not just the tricky bit');
});

await check('netlify site names become valid DNS labels', () => {
  assert.strictEqual(netlifySiteName('Otley Bakes & Co!'), 'otley-bakes-co');
  assert.strictEqual(netlifySiteName(''), 'site');
  assert.ok(netlifySiteName('x'.repeat(100)).length <= 63);
});

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll site-env, handoff and portability checks passed.');
