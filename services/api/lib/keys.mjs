/**
 * API-key lifecycle, account-scoped. Shared by the CLI (make-key.mjs) and
 * the self-service console (signup + the Keys tab) so there is exactly one
 * place that mints, rotates, revokes, and lists keys.
 *
 * The secret is shown ONCE (at mint or rotate) and stored only as a sha256
 * hash in var/keys.json — never recoverable, so the public views expose id,
 * name, scopes, and timestamps but never the secret or a last4.
 */
import crypto from 'node:crypto';
import { generateKey, hashKey, SCOPES } from './auth.mjs';

export function publicKey(k) {
  return {
    id: k.id,
    name: k.name,
    scopes: k.scopes,
    account: k.account,
    createdAt: k.createdAt,
    rotatedAt: k.rotatedAt ?? null,
    revoked: k.revoked ?? null,
  };
}

export function normalizeScopes(scopes) {
  const list = (Array.isArray(scopes) ? scopes : String(scopes || '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
  const bad = list.filter((s) => !SCOPES.includes(s));
  if (bad.length) {
    throw Object.assign(new Error(`Unknown scope(s): ${bad.join(', ')}. Valid: ${SCOPES.join(', ')}.`), { status: 400, code: 'bad_scope' });
  }
  return list.length ? [...new Set(list)] : [...SCOPES];
}

export function mintKey(store, { name, scopes, account }) {
  if (!account) throw new Error('mintKey requires an account.');
  const keys = store.readJson('keys.json', []);
  const secret = generateKey();
  const record = {
    id: crypto.randomUUID(),
    name: String(name || 'key').slice(0, 120),
    hash: hashKey(secret),
    scopes: normalizeScopes(scopes),
    account,
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    revoked: null,
  };
  keys.push(record);
  store.writeJson('keys.json', keys);
  return { record: publicKey(record), secret };
}

export function listKeys(store, account) {
  return store.readJson('keys.json', [])
    .filter((k) => k.account === account)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map(publicKey);
}

/** Replace a key's secret in place (same id, same scopes). Returns the new secret once. */
export function rotateKey(store, keyId, account) {
  const keys = store.readJson('keys.json', []);
  const k = keys.find((x) => x.id === keyId && x.account === account && !x.revoked);
  if (!k) return null;
  const secret = generateKey();
  k.hash = hashKey(secret);
  k.rotatedAt = new Date().toISOString();
  store.writeJson('keys.json', keys);
  return { record: publicKey(k), secret };
}

export function revokeKey(store, keyId, account) {
  const keys = store.readJson('keys.json', []);
  const k = keys.find((x) => x.id === keyId && x.account === account);
  if (!k || k.revoked) return false;
  k.revoked = new Date().toISOString();
  store.writeJson('keys.json', keys);
  return true;
}
