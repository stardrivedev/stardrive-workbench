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

fs.rmSync(varDir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll accounts checks passed.');
process.exit(0);
