/**
 * Accounts unit checks — the parts that guard real money and real identity,
 * driven directly so they need no server and no network: password handling,
 * the email-verification lifecycle, and session hygiene.
 *
 * Run: node services/api/test/accounts.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VarStore } from '../lib/store.mjs';
import { createAccounts } from '../lib/accounts.mjs';

const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-accounts-'));
const store = new VarStore(varDir);
const accounts = createAccounts(store);

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);

console.log('accounts:');

await check('signup stores no plaintext password and returns no secrets', () => {
  const { account } = accounts.signup({ email: 'a@example.com', password: 'correcthorse' });
  const raw = fs.readFileSync(store.path('accounts', `${account.id}.json`), 'utf-8');
  assert.strictEqual(raw.includes('correcthorse'), false, 'the password never lands on disk');
  assert.strictEqual('passwordHash' in account, false, 'and never leaves through the public shape');
  assert.strictEqual('salt' in account, false);
  assert.ok(accounts.login({ email: 'a@example.com', password: 'correcthorse' }), 'the right password works');
  assert.strictEqual(accounts.login({ email: 'a@example.com', password: 'wrong' }), null);
  assert.strictEqual(accounts.login({ email: 'nobody@example.com', password: 'correcthorse' }), null);
});

await check('with no way to send mail, accounts arrive verified', () => {
  const { account, verifyToken } = accounts.signup({ email: 'dormant@example.com', password: 'longenough' });
  assert.strictEqual(account.emailVerified, true, 'not stranded behind a link we cannot send');
  assert.strictEqual(verifyToken, null);
});

await check('when mail CAN be sent, the address starts unconfirmed and the token is hashed', () => {
  const { account, verifyToken } = accounts.signup({ email: 'v@example.com', password: 'longenough' }, { requireVerification: true });
  assert.strictEqual(account.emailVerified, false);
  assert.match(verifyToken, /^[0-9a-f]{64}$/);
  const raw = fs.readFileSync(store.path('accounts', `${account.id}.json`), 'utf-8');
  assert.strictEqual(raw.includes(verifyToken), false, 'a leaked store cannot be replayed into a verified account');
  globalThis.__v = { id: account.id, token: verifyToken };
});

await check('the emailed token confirms the address exactly once', () => {
  const { id, token } = globalThis.__v;
  const confirmed = accounts.verifyEmail(token);
  assert.strictEqual(confirmed.id, id);
  assert.strictEqual(confirmed.emailVerified, true);
  assert.strictEqual(accounts.getAccount(id).emailVerified, true, 'and it persisted');
  assert.strictEqual(accounts.verifyEmail(token), null, 'the same link cannot be replayed');
});

await check('a junk or unknown token confirms nothing', () => {
  assert.strictEqual(accounts.verifyEmail(''), null);
  assert.strictEqual(accounts.verifyEmail('not-hex'), null);
  assert.strictEqual(accounts.verifyEmail('a'.repeat(64)), null);
  assert.strictEqual(accounts.verifyEmail(null), null);
});

await check('"send it again" issues a new token and retires the old one', () => {
  const first = accounts.signup({ email: 'again@example.com', password: 'longenough' }, { requireVerification: true });
  const second = accounts.reissueVerification(first.account.id);
  assert.match(second.verifyToken, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(second.verifyToken, first.verifyToken);
  assert.strictEqual(accounts.verifyEmail(first.verifyToken), null, 'the superseded link is dead');
  assert.ok(accounts.verifyEmail(second.verifyToken), 'the newest link works');
  assert.strictEqual(accounts.reissueVerification(first.account.id), null, 'nothing to reissue once confirmed');
});

await check('sessions store only a hash, expire, and can be destroyed', () => {
  const { account } = accounts.signup({ email: 's@example.com', password: 'longenough' });
  const token = accounts.createSession(account.id);
  assert.strictEqual(accounts.verifySession(token).id, account.id);
  assert.strictEqual(fs.existsSync(store.path('sessions', `${token}.json`)), false, 'the raw token is not the filename');
  assert.strictEqual(accounts.verifySession('nope'), null);
  accounts.destroySession(token);
  assert.strictEqual(accounts.verifySession(token), null, 'logout really ends it');
});

// ── Password reset ──
// Being locked out of your own account with no way back is the worst bug an
// account system can have, so this path gets the same scrutiny as login.

await check('a reset token is stored only as a hash and lets a new password be set', () => {
  const { account } = accounts.signup({ email: 'reset@example.com', password: 'originalpass' });
  const req = accounts.requestPasswordReset('reset@example.com');
  assert.ok(req.token && /^[0-9a-f]{64}$/.test(req.token));
  const raw = fs.readFileSync(store.path('accounts', `${account.id}.json`), 'utf-8');
  assert.strictEqual(raw.includes(req.token), false, 'a leaked store cannot be replayed into a reset');

  assert.ok(accounts.resetPassword(req.token, 'a-brand-new-password'));
  assert.ok(accounts.login({ email: 'reset@example.com', password: 'a-brand-new-password' }), 'the new one works');
  assert.strictEqual(accounts.login({ email: 'reset@example.com', password: 'originalpass' }), null, 'the old one does not');
});

await check('a reset token works exactly once', () => {
  accounts.signup({ email: 'once@example.com', password: 'originalpass' });
  const { token } = accounts.requestPasswordReset('once@example.com');
  assert.ok(accounts.resetPassword(token, 'first-new-password'));
  assert.strictEqual(accounts.resetPassword(token, 'second-new-password'), null, 'a used link is spent');
  assert.ok(accounts.login({ email: 'once@example.com', password: 'first-new-password' }));
});

await check('an expired token is refused', () => {
  const { account } = accounts.signup({ email: 'stale@example.com', password: 'originalpass' });
  const { token } = accounts.requestPasswordReset('stale@example.com');
  // Wind the clock past the hour, the way a link found in an old inbox would.
  const rec = store.readJson(`accounts/${account.id}.json`);
  rec.resetExpiresAt = Date.now() - 1000;
  store.writeJson(`accounts/${account.id}.json`, rec);
  assert.strictEqual(accounts.resetPassword(token, 'too-late-password'), null);
  assert.ok(accounts.login({ email: 'stale@example.com', password: 'originalpass' }), 'and the old password still works');
});

await check('resetting signs out every existing session', () => {
  const { account } = accounts.signup({ email: 'sessions@example.com', password: 'originalpass' });
  const a = accounts.createSession(account.id);
  const b = accounts.createSession(account.id);
  const { token } = accounts.requestPasswordReset('sessions@example.com');
  accounts.resetPassword(token, 'replacement-password');
  // Someone resetting may be doing it BECAUSE a session is in the wrong
  // hands; leaving those alive would defeat the whole point.
  assert.strictEqual(accounts.verifySession(a), null);
  assert.strictEqual(accounts.verifySession(b), null);
});

await check('a reset also confirms the address, since it proves the same thing', () => {
  const { account } = accounts.signup({ email: 'unconfirmed@example.com', password: 'originalpass' }, { requireVerification: true });
  assert.strictEqual(account.emailVerified, false);
  const { token } = accounts.requestPasswordReset('unconfirmed@example.com');
  const after = accounts.resetPassword(token, 'now-verified-password');
  assert.strictEqual(after.emailVerified, true, 'reading the inbox is exactly what verification asks for');
});

await check('an unknown address yields nothing for the caller to distinguish', () => {
  assert.strictEqual(accounts.requestPasswordReset('nobody@example.com'), null);
  assert.strictEqual(accounts.requestPasswordReset(''), null);
});

await check('a garbage token is refused without touching any account', () => {
  assert.strictEqual(accounts.resetPassword('not-a-token', 'whatever-password'), null);
  assert.strictEqual(accounts.resetPassword(null, 'whatever-password'), null);
  assert.strictEqual(accounts.resetPassword('a'.repeat(64), 'whatever-password'), null);
});

await check('a reset still enforces the password rules', () => {
  accounts.signup({ email: 'weak@example.com', password: 'originalpass' });
  const { token } = accounts.requestPasswordReset('weak@example.com');
  assert.throws(() => accounts.resetPassword(token, 'short'), /8/);
  assert.ok(accounts.login({ email: 'weak@example.com', password: 'originalpass' }), 'nothing changed on a rejected attempt');
});

fs.rmSync(varDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll accounts checks passed.');
process.exit(0);
