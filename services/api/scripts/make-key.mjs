#!/usr/bin/env node
/**
 * Mint a Stardrive API key.
 *
 *   node scripts/make-key.mjs --name "beta agency" --scopes mappings,templates,sites
 *   node scripts/make-key.mjs --revoke <keyId>
 *
 * The secret is printed ONCE and stored only as a sha256 hash in
 * var/keys.json (override the location with --var-dir or STARDRIVE_VAR_DIR).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VarStore } from '../lib/store.mjs';
import { generateKey, hashKey, SCOPES } from '../lib/auth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const optOf = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const varDir = optOf('var-dir') || process.env.STARDRIVE_VAR_DIR || path.join(HERE, '..', 'var');
const store = new VarStore(varDir);
const keys = store.readJson('keys.json', []);

const revokeId = optOf('revoke');
if (revokeId) {
  const key = keys.find((k) => k.id === revokeId);
  if (!key) { console.error(`No key with id ${revokeId}.`); process.exit(1); }
  key.revoked = new Date().toISOString();
  store.writeJson('keys.json', keys);
  console.log(`Revoked key ${key.id} ("${key.name}").`);
  process.exit(0);
}

const name = optOf('name');
if (!name) { console.error('Usage: make-key.mjs --name <label> [--scopes a,b,c] | --revoke <keyId>'); process.exit(2); }
const scopes = (optOf('scopes') || SCOPES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const bad = scopes.filter((s) => !SCOPES.includes(s));
if (bad.length) { console.error(`Unknown scope(s): ${bad.join(', ')}. Valid: ${SCOPES.join(', ')}.`); process.exit(2); }

const secret = generateKey();
const record = {
  id: crypto.randomUUID(),
  name,
  hash: hashKey(secret),
  scopes,
  createdAt: new Date().toISOString(),
  revoked: null,
};
keys.push(record);
store.writeJson('keys.json', keys);

console.log(`Key minted for "${name}" (id ${record.id}, scopes: ${scopes.join(', ')}).`);
console.log('The secret below is shown ONCE and stored only as a hash:');
console.log(secret);
