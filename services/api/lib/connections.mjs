/**
 * Per-account hosting connections — the licensee's OWN credentials
 * (Vercel, GitHub, and a database), so assembled sites deploy to hosting THEY
 * own and Stardrive never owns a customer's website.
 *
 * The "turso" provider is really a generic libSQL database connection (a
 * `url` + optional `authToken`): Turso is the recommended hosted provider,
 * but the CMS's data layer (@libsql/client) talks to ANY libsql://, https://,
 * or local file endpoint, so this is vendor-neutral, not Turso-exclusive.
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

export const PROVIDERS = ['vercel', 'netlify', 'turso', 'github'];

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
        ? {
            connected: true, last4: record[p].last4, updatedAt: record[p].updatedAt,
            ...(record[p].owner ? { owner: record[p].owner } : {}),
            ...(record[p].url ? { url: record[p].url } : {}),
          }
        : { connected: false };
    }
    return out;
  }

  /** Set/replace one provider's token. Returns the masked record. */
  function set(account, provider, token, extra = {}) {
    const record = store.readJson(rel(account), {});
    record[provider] = {
      enc: encrypt(token),
      last4: token ? token.slice(-4) : null,
      ...(extra.owner ? { owner: extra.owner } : {}),
      ...(extra.url ? { url: extra.url } : {}),
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

  /**
   * Store an encrypted per-site deploy target for one provider (github keeps
   * owner/repo; vercel just a token; turso/database keeps url + authToken).
   * Each client site can ship to a different account. Provider defaults to
   * github for backward compatibility.
   */
  function setSiteTarget(siteId, { provider = 'github', token, owner, repo, url }) {
    const record = store.readJson(rel(siteScope(siteId)), {});
    const prev = record[provider] || {};
    // token !== undefined (rather than truthy) so an explicit empty string —
    // a database endpoint that needs no auth — still marks the target
    // "connected" instead of silently falling through to any prior value.
    record[provider] = {
      ...(token !== undefined ? { enc: encrypt(token), last4: token ? token.slice(-4) : null } : prev.enc ? { enc: prev.enc, last4: prev.last4 } : {}),
      ...(owner ? { owner } : prev.owner ? { owner: prev.owner } : {}),
      ...(repo ? { repo } : prev.repo ? { repo: prev.repo } : {}),
      ...(url ? { url } : prev.url ? { url: prev.url } : {}),
      updatedAt: new Date().toISOString(),
    };
    store.writeJson(rel(siteScope(siteId)), record);
    return getSiteTarget(siteId, provider);
  }

  /** Masked per-site target (never token material). */
  function getSiteTarget(siteId, provider = 'github') {
    const g = store.readJson(rel(siteScope(siteId)), {})[provider];
    return g ? { connected: Boolean(g.enc), last4: g.last4 ?? null, owner: g.owner ?? null, repo: g.repo ?? null, url: g.url ?? null, updatedAt: g.updatedAt } : null;
  }

  function revealSiteToken(siteId, provider = 'github') {
    const g = store.readJson(rel(siteScope(siteId)), {})[provider];
    return g?.enc ? decrypt(g.enc) : null;
  }

  return { set, get, reveal, remove, setSiteTarget, getSiteTarget, revealSiteToken };
}
