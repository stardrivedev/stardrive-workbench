/**
 * API keys, scopes, rate limiting, and usage metering.
 *
 * The key IS the license (see docs/api-design.md): keys live hashed
 * (sha256) in var/keys.json, are compared timing-safely, carry scopes
 * (mappings, templates, sites, deploy), and every successful call lands in
 * a per-key monthly usage counter — the billing meter.
 */
import crypto from 'node:crypto';

export const SCOPES = ['mappings', 'templates', 'sites', 'deploy'];

export function generateKey() {
  return 'sk_live_' + crypto.randomBytes(24).toString('hex');
}

export function hashKey(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export function createAuth(store, { rateLimitPerMin = 120 } = {}) {
  const buckets = new Map(); // keyId → { tokens, last }

  function loadKeys() {
    return store.readJson('keys.json', []);
  }

  /** Bearer sk_live_… → the key record, or null. Timing-safe. */
  function verify(req) {
    const header = req.headers['authorization'] || '';
    const m = /^Bearer\s+(sk_live_[0-9a-f]{48})$/.exec(header);
    if (!m) return null;
    const digest = Buffer.from(hashKey(m[1]), 'hex');
    for (const key of loadKeys()) {
      if (key.revoked) continue;
      const stored = Buffer.from(key.hash, 'hex');
      if (stored.length === digest.length && crypto.timingSafeEqual(stored, digest)) {
        // Pre-account key records default to their own id as the account.
        return { ...key, account: key.account || key.id };
      }
    }
    return null;
  }

  function hasScope(key, scope) {
    return scope === 'public' || (key.scopes || []).includes(scope);
  }

  /** Continuous-refill token bucket per key. */
  function rateCheck(keyId) {
    const now = Date.now();
    let b = buckets.get(keyId);
    if (!b) {
      b = { tokens: rateLimitPerMin, last: now };
      buckets.set(keyId, b);
    }
    b.tokens = Math.min(rateLimitPerMin, b.tokens + ((now - b.last) / 60_000) * rateLimitPerMin);
    b.last = now;
    if (b.tokens < 1) {
      const retryAfter = Math.ceil(((1 - b.tokens) / rateLimitPerMin) * 60);
      return { ok: false, retryAfter: Math.max(1, retryAfter) };
    }
    b.tokens -= 1;
    return { ok: true };
  }

  function meter(keyId, counter, n = 1) {
    const usage = store.readJson('usage.json', {});
    const period = currentPeriod();
    usage[keyId] = usage[keyId] || {};
    usage[keyId][period] = usage[keyId][period] || {};
    usage[keyId][period][counter] = (usage[keyId][period][counter] || 0) + n;
    store.writeJson('usage.json', usage);
  }

  function usageFor(keyId) {
    const usage = store.readJson('usage.json', {});
    const period = currentPeriod();
    return { period, counters: usage[keyId]?.[period] || {} };
  }

  return { verify, hasScope, rateCheck, meter, usageFor };
}
