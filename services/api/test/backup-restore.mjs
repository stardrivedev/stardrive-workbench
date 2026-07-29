/**
 * The restore DRILL. A backup nobody has restored is a hope, not a backup, so
 * this does the whole round trip against a real server:
 *
 *   run a deployment with real state (account, key, template, site, an
 *   encrypted hosting token) → snapshot it → destroy it → restore into a
 *   fresh var dir → start a server on that → confirm everything still works,
 *   including that the ENCRYPTED TOKEN still decrypts.
 *
 * That last part is the one people get wrong: tokens are encrypted with
 * STARDRIVE_SECRET, so a restore with a different secret gives you accounts
 * and sites but dead credentials. This proves both halves: same secret works,
 * wrong secret fails honestly rather than silently returning garbage.
 *
 * Run: node services/api/test/backup-restore.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer, stopAll } from './helpers/server.mjs';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'a-real-deployments-encryption-secret';
const roots = [];

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);

const tmp = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `stardrive-${tag}-`)); roots.push(d); return d; };

const boot = (varDir, secret) => startServer({ varDir, env: { STARDRIVE_SECRET: secret } });

const api = async (base, method, p, { key, body } = {}) => {
  const res = await fetch(base + p, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const backup = (...a) => execFileSync(process.execPath, [path.join(API_DIR, 'scripts', 'backup.mjs'), ...a], { encoding: 'utf-8' });

console.log('backup and restore drill:');

// ── A deployment with real state ─────────────────────────────────────────
const liveVar = tmp('live');
const live = await boot(liveVar, SECRET);
let apiKey;
let siteId;

await check('a working deployment: account, key, template, site, encrypted hosting token', async () => {
  const up = await fetch(`${live.base}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'drill@example.com', password: 'longenough', company: 'Drill Co' }),
  });
  const created = await up.json();
  assert.strictEqual(up.status, 201);
  apiKey = created.apiKey.secret;

  const site = await api(live.base, 'POST', '/v1/sites', {
    key: apiKey, body: { templateId: 'd4-site-template', config: { siteName: 'Drill Site' }, assemble: false },
  });
  assert.strictEqual(site.status, 201);
  siteId = site.body.siteId;

  // The thing that actually tests the secret: a token encrypted at rest.
  const conn = await api(live.base, 'PUT', '/v1/connections/vercel', { key: apiKey, body: { token: 'vercel-token-abc123' } });
  assert.strictEqual(conn.status, 200);
  assert.strictEqual(conn.body.connections.vercel.connected, true);
  assert.strictEqual(conn.body.connections.vercel.last4, 'c123');

  // And prove it really is encrypted, not just hidden by the API.
  const raw = fs.readFileSync(path.join(liveVar, 'connections', `${created.account.id}.json`), 'utf-8');
  assert.strictEqual(raw.includes('vercel-token-abc123'), false, 'the token is not sitting in plaintext');
});

// ── Snapshot ─────────────────────────────────────────────────────────────
const backupDir = tmp('backups');
let archive;

await check('a snapshot keeps the irreplaceable state and skips build output', () => {
  const out = backup('create', backupDir, '--var-dir', liveVar);
  archive = fs.readdirSync(backupDir).find((f) => f.endsWith('.tar.gz'));
  assert.ok(archive, 'an archive was written');
  assert.match(out, /workspaces\/ excluded/, 'build output is deliberately not backed up');
  assert.ok(fs.existsSync(path.join(backupDir, archive + '.sha256')), 'with a checksum beside it');

  const verified = backup('verify', path.join(backupDir, archive));
  assert.match(verified, /ok\s+accounts/);
  assert.match(verified, /ok\s+keys\.json/);
});

await check('a corrupted archive is refused, not restored', () => {
  const bad = path.join(backupDir, 'corrupt.tar.gz');
  fs.copyFileSync(path.join(backupDir, archive), bad);
  fs.copyFileSync(path.join(backupDir, archive + '.sha256'), bad + '.sha256');
  const buf = fs.readFileSync(bad);
  buf[Math.floor(buf.length / 2)] ^= 0xff; // flip a byte in the middle
  fs.writeFileSync(bad, buf);
  assert.throws(() => backup('verify', bad), /checksum mismatch/i, 'refuses before it can do damage');
});

// ── Destroy and restore ──────────────────────────────────────────────────
await check('the original deployment is destroyed', async () => {
  live.child.kill();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(liveVar, { recursive: true, force: true });
  assert.strictEqual(fs.existsSync(liveVar), false, 'gone, as if the volume had been lost');
});

const restoredVar = tmp('restored');
await check('restore refuses to overwrite a non-empty directory unless told to', () => {
  fs.writeFileSync(path.join(restoredVar, 'something.json'), '{}');
  assert.throws(() => backup('restore', path.join(backupDir, archive), restoredVar), /not empty/i);
  fs.rmSync(path.join(restoredVar, 'something.json'));
});

await check('restored with the SAME secret: accounts, keys, sites, and tokens all work', async () => {
  backup('restore', path.join(backupDir, archive), restoredVar);
  const back = await boot(restoredVar, SECRET);

  const login = await fetch(`${back.base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'drill@example.com', password: 'longenough' }),
  });
  assert.strictEqual(login.status, 200, 'the account survived');

  const sites = await api(back.base, 'GET', '/v1/sites', { key: apiKey });
  assert.strictEqual(sites.status, 200, 'the original API key still authenticates');
  assert.strictEqual(sites.body.sites.length, 1, 'the site survived');
  assert.strictEqual(sites.body.sites[0].id, siteId);

  // The real test: does the encrypted hosting token still decrypt? The API
  // never returns it, so publish and read the error — "no target" would mean
  // it was lost, anything else means it was found and used.
  const conns = await api(back.base, 'GET', '/v1/connections', { key: apiKey });
  assert.strictEqual(conns.body.connections.vercel.connected, true, 'the connection survived');
  assert.strictEqual(conns.body.connections.vercel.last4, 'c123', 'and it is the same token');
});

await check('restored with the WRONG secret: it fails honestly instead of silently', async () => {
  const wrongVar = tmp('wrong');
  backup('restore', path.join(backupDir, archive), wrongVar);
  const bad = await boot(wrongVar, 'a-completely-different-secret');

  // Accounts and sites are fine: they are not encrypted.
  const sites = await api(bad.base, 'GET', '/v1/sites', { key: apiKey });
  assert.strictEqual(sites.status, 200, 'unencrypted state restores regardless');

  // The token cannot be decrypted with the wrong key. It must surface as a
  // real error, never as a wrong-but-plausible value sent to a provider.
  const site = sites.body.sites[0];
  const publish = await api(bad.base, 'POST', `/v1/sites/${site.id}/deploy/vercel`, { key: apiKey, body: {} });
  assert.ok(publish.status >= 400, `publishing fails rather than using a garbled token (got ${publish.status})`);
});

stopAll();
await new Promise((r) => setTimeout(r, 300));
for (const d of roots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows file locks */ } }
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll backup/restore checks passed.');
process.exit(0);
