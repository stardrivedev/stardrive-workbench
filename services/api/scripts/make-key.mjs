#!/usr/bin/env node
/**
 * Mint a Stardrive API key.
 *
 *   node scripts/make-key.mjs --name "beta agency" --scopes mappings,templates,sites
 *   node scripts/make-key.mjs --name "beta agency ci" --account <accountId>
 *   node scripts/make-key.mjs --revoke <keyId>
 *
 * The secret is printed ONCE and stored only as a sha256 hash in
 * var/keys.json (override the location with --var-dir or STARDRIVE_VAR_DIR).
 *
 * Accounts: every key belongs to an account (licensee). Templates, stored
 * mappings, and sites are PRIVATE to the account that created them — the
 * bundled d4 catalog is the only shared surface. By default a new key gets
 * its own fresh account id; pass --account to mint an additional key for an
 * existing account (e.g. a CI key beside a dashboard key).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VarStore } from '../lib/store.mjs';
import { mintKey, revokeKey, normalizeScopes } from '../lib/keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const optOf = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const varDir = optOf('var-dir') || process.env.STARDRIVE_VAR_DIR || path.join(HERE, '..', 'var');
const store = new VarStore(varDir);

const revokeId = optOf('revoke');
if (revokeId) {
  const keys = store.readJson('keys.json', []);
  const key = keys.find((k) => k.id === revokeId);
  if (!key) { console.error(`No key with id ${revokeId}.`); process.exit(1); }
  revokeKey(store, key.id, key.account);
  console.log(`Revoked key ${key.id} ("${key.name}").`);
  process.exit(0);
}

const name = optOf('name');
if (!name) { console.error('Usage: make-key.mjs --name <label> [--scopes a,b,c] [--account <id>] | --revoke <keyId>'); process.exit(2); }

let scopes;
try { scopes = normalizeScopes(optOf('scopes')); }
catch (err) { console.error(err.message); process.exit(2); }

const account = optOf('account') || crypto.randomUUID();
if (optOf('account') && !store.readJson('keys.json', []).some((k) => k.account === account)) {
  console.error(`Warning: no existing key belongs to account ${account} — minting anyway (this creates that account).`);
}

const { record, secret } = mintKey(store, { name, scopes, account });
console.log(`Key minted for "${name}" (id ${record.id}, account ${account}, scopes: ${record.scopes.join(', ')}).`);
console.log('The secret below is shown ONCE and stored only as a hash:');
console.log(secret);
