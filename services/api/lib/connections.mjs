/**
 * Per-account hosting connections — the licensee's OWN credentials
 * (Vercel, Turso, GitHub), so assembled sites deploy to hosting THEY own
 * and Stardrive never owns a customer's website.
 *
 * Security model:
 * - Tokens are encrypted at rest (AES-256-GCM, key derived via scrypt from
 *   STARDRIVE_SECRET — or a generated var/secret.key on first boot so dev
 *   works out of the box; production sets the env var).
 * - The API NEVER returns a stored token. Reads are masked: which providers
 *   are connected, the last 4 characters, and when they were updated.
 * - Decryption happens only server-side at deploy time, and deploy logs
 *   never echo credentials.
 * - The flip side of the same boundary: the customer's credentials receive
 *   only the ASSEMBLED SITE OUTPUT. The engine itself is never pushed,
 *   deployed, or exported to customer-controlled surfaces.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PROVIDERS = ['vercel', 'turso', 'github'];

function loadSecret(varDir) {
  if (process.env.STARDRIVE_SECRET) return process.env.STARDRIVE_SECRET;
  const file = path.join(varDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(varDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf-8').trim();
}

export function createConnections(store, varDir) {
  const key = crypto.scryptSync(loadSecret(varDir), 'stardrive-connections-v1', 32);
  // Account-level defaults, plus per-SITE overrides — an agency often ships
  // each client to a different account, so the site scope wins when present.
  const rel = (scope) => `connections/${scope}.json`;
  const siteScope = (siteId) => `site-${siteId}`;

  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') };
  }

  function decrypt(enc) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(enc.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(enc.data, 'hex')), decipher.final()]).toString('utf-8');
  }

  function mask(record) {
    const out = {};
    for (const p of PROVIDERS) {
      out[p] = record?.[p]
        ? { connected: true, last4: record[p].last4, updatedAt: record[p].updatedAt, ...(record[p].owner ? { owner: record[p].owner } : {}) }
        : { connected: false };
    }
    return out;
  }

  /** Set/replace one provider's token. Returns the masked record. */
  function set(account, provider, token, extra = {}) {
    const record = store.readJson(rel(account), {});
    record[provider] = {
      enc: encrypt(token),
      last4: token.slice(-4),
      ...(extra.owner ? { owner: extra.owner } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.writeJson(rel(account), record);
    return mask(record);
  }

  /** Masked view — never includes token material. */
  function get(account) {
    return mask(store.readJson(rel(account), {}));
  }

  /** Server-side only (deploy time). Never exposed through any route. */
  function reveal(account, provider) {
    const record = store.readJson(rel(account), {});
    return record?.[provider] ? decrypt(record[provider].enc) : null;
  }

  function remove(account, provider) {
    const record = store.readJson(rel(account), {});
    if (!record?.[provider]) return false;
    delete record[provider];
    store.writeJson(rel(account), record);
    return true;
  }

  /** Store an encrypted per-site github target { token?, owner, repo? }. */
  function setSiteTarget(siteId, { token, owner, repo }) {
    const record = store.readJson(rel(siteScope(siteId)), {});
    record.github = {
      ...(token ? { enc: encrypt(token), last4: token.slice(-4) } : record.github?.enc ? { enc: record.github.enc, last4: record.github.last4 } : {}),
      ...(owner ? { owner } : record.github?.owner ? { owner: record.github.owner } : {}),
      ...(repo ? { repo } : record.github?.repo ? { repo: record.github.repo } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.writeJson(rel(siteScope(siteId)), record);
    return getSiteTarget(siteId);
  }

  /** Masked per-site target (never token material). */
  function getSiteTarget(siteId) {
    const g = store.readJson(rel(siteScope(siteId)), {}).github;
    return g ? { connected: Boolean(g.enc), last4: g.last4 ?? null, owner: g.owner ?? null, repo: g.repo ?? null, updatedAt: g.updatedAt } : null;
  }

  function revealSiteToken(siteId) {
    const g = store.readJson(rel(siteScope(siteId)), {}).github;
    return g?.enc ? decrypt(g.enc) : null;
  }

  return { set, get, reveal, remove, setSiteTarget, getSiteTarget, revealSiteToken };
}
