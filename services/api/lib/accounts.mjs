/**
 * Accounts + sessions — the human front door to the Workbench.
 *
 * The API key stays the machine license (see auth.mjs); this adds the
 * person: signup creates an account, login opens a browser SESSION (an
 * httpOnly cookie), and the account OWNS its API keys and its private
 * template/mapping/site library. One account id threads through everything.
 *
 * Passwords: scrypt with a per-account random salt, compared timing-safely.
 * Sessions: a random token; only its sha256 is stored (var/sessions/), so a
 * leaked store cannot be replayed into a live session.
 *
 * Email verification exists to protect real money: every generation spends
 * the OPERATOR's model budget, so an address nobody proved they own must not
 * be able to spend it. Signing up still works and still hands over a key and
 * a session (there is plenty to set up before building), but model spend is
 * gated until the address is confirmed. Like every other capability here it
 * is DORMANT when it cannot work: with no email provider configured there is
 * no way to send a link, so accounts are created already verified rather than
 * being stranded. The verification token is stored only as a sha256, so a
 * leaked store cannot be replayed into a verified account.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

/** Remove a directory if it is there; used to clear per-account folders. */
const rmDir = (abs) => { try { fs.rmSync(abs, { recursive: true, force: true }); } catch { /* best effort */ } };

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
// Short on purpose: a reset link is a live key to the account, and one left
// sitting in an old inbox is a spare under the mat.
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

export function createAccounts(store) {
  const acctRel = (id) => `accounts/${id}.json`;
  const EMAILS = 'account-emails.json';

  const publicAccount = (a) => ({
    id: a.id, email: a.email, company: a.company || null, plan: a.plan || 'beta',
    overageEnabled: Boolean(a.overageEnabled), createdAt: a.createdAt,
    // Accounts created before verification existed are treated as verified:
    // they were vouched for by hand, and retro-locking them would be wrong.
    emailVerified: a.emailVerified !== false,
  });

  function idForEmail(email) {
    return store.readJson(EMAILS, {})[String(email).toLowerCase()] || null;
  }

  /**
   * Create an account. `requireVerification` is the caller's answer to "can I
   * actually send this person a link?" — when false the account is verified on
   * the spot, because locking someone out of a capability we have no way to
   * unlock would be a bug, not a safeguard.
   *
   * Returns { account, verifyToken }; the raw token is handed back exactly
   * once, for the email, and only its hash is kept.
   */
  function signup({ email, password, company }, { requireVerification = false } = {}) {
    email = String(email || '').trim();
    password = String(password || '');
    if (!isEmail(email) || email.length > 320) throw httpError(400, 'bad_request', 'A valid email is required.');
    if (password.length < 8 || password.length > 200) throw httpError(400, 'bad_request', 'Password must be 8–200 characters.');
    if (idForEmail(email)) throw httpError(409, 'email_taken', 'An account with that email already exists — try logging in.');
    const salt = crypto.randomBytes(16).toString('hex');
    const verifyToken = requireVerification ? crypto.randomBytes(32).toString('hex') : null;
    const account = {
      id: crypto.randomUUID(),
      email,
      salt,
      passwordHash: hashPassword(password, salt),
      company: company ? String(company).slice(0, 300) : null,
      plan: 'beta',
      emailVerified: !requireVerification,
      verifyTokenHash: verifyToken ? sha256(verifyToken) : null,
      createdAt: new Date().toISOString(),
    };
    store.writeJson(acctRel(account.id), account);
    const idx = store.readJson(EMAILS, {});
    idx[email.toLowerCase()] = account.id;
    store.writeJson(EMAILS, idx);
    return { account: publicAccount(account), verifyToken };
  }

  /** Confirm an address from its emailed token. Single use. */
  function verifyEmail(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const hash = sha256(token);
    for (const id of store.listIds('accounts')) {
      const a = store.readJson(acctRel(id));
      if (!a || a.verifyTokenHash !== hash) continue;
      a.emailVerified = true;
      a.verifyTokenHash = null; // one use only
      store.writeJson(acctRel(id), a);
      return publicAccount(a);
    }
    return null;
  }

  /**
   * Begin a password reset. Returns the raw token exactly once, for the email.
   *
   * Returns null for an unknown address, and the CALLER must answer the same
   * either way: a different response would turn this endpoint into a way to
   * test which addresses have accounts.
   *
   * Only the hash is stored, so a leaked store cannot be replayed into a
   * reset, and it expires, because a link sitting in an old inbox forever is
   * a spare key under the mat.
   */
  function requestPasswordReset(email) {
    const id = idForEmail(String(email || '').trim());
    if (!id) return null;
    const a = store.readJson(acctRel(id));
    if (!a) return null;
    const token = crypto.randomBytes(32).toString('hex');
    a.resetTokenHash = sha256(token);
    a.resetExpiresAt = Date.now() + RESET_TTL_MS;
    store.writeJson(acctRel(id), a);
    return { account: publicAccount(a), token };
  }

  /**
   * Complete a reset. Single use, and every existing session for the account
   * is destroyed: someone resetting a password may be doing it precisely
   * because a session is in the wrong hands, and leaving those alive would
   * defeat the point.
   */
  function resetPassword(token, password) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    password = String(password || '');
    if (password.length < 8 || password.length > 200) {
      throw httpError(400, 'bad_request', 'Password must be 8–200 characters.');
    }
    const hash = sha256(token);
    for (const id of store.listIds('accounts')) {
      const a = store.readJson(acctRel(id));
      if (!a || a.resetTokenHash !== hash) continue;
      if (!a.resetExpiresAt || a.resetExpiresAt < Date.now()) return null; // expired reads as invalid
      a.salt = crypto.randomBytes(16).toString('hex');
      a.passwordHash = hashPassword(password, a.salt);
      a.resetTokenHash = null;
      a.resetExpiresAt = null;
      // Proving control of the inbox is exactly what verification asks for,
      // so a reset settles it too rather than leaving them half locked out.
      a.emailVerified = true;
      a.verifyTokenHash = null;
      store.writeJson(acctRel(id), a);
      for (const s of store.listIds('sessions')) {
        const rec = store.readJson(`sessions/${s}.json`);
        if (rec && rec.account === id) store.deleteJson(`sessions/${s}.json`);
      }
      return publicAccount(a);
    }
    return null;
  }

  /** A fresh token for "send it again", invalidating any earlier one. */
  function reissueVerification(id) {
    const a = store.readJson(acctRel(id));
    if (!a || a.emailVerified === true) return null;
    const token = crypto.randomBytes(32).toString('hex');
    a.verifyTokenHash = sha256(token);
    store.writeJson(acctRel(id), a);
    return { account: publicAccount(a), verifyToken: token };
  }

  function login({ email, password }) {
    const id = idForEmail(String(email || '').trim());
    if (!id) return null;
    const a = store.readJson(acctRel(id));
    if (!a) return null;
    const candidate = Buffer.from(hashPassword(String(password || ''), a.salt), 'hex');
    const stored = Buffer.from(a.passwordHash, 'hex');
    if (candidate.length !== stored.length || !crypto.timingSafeEqual(candidate, stored)) return null;
    return publicAccount(a);
  }

  function getAccount(id) {
    const a = store.readJson(acctRel(id));
    return a ? publicAccount(a) : null;
  }

  function setPlan(id, plan) {
    const a = store.readJson(acctRel(id));
    if (!a) return null;
    a.plan = plan;
    store.writeJson(acctRel(id), a);
    return publicAccount(a);
  }

  function setOverage(id, enabled) {
    const a = store.readJson(acctRel(id));
    if (!a) return null;
    a.overageEnabled = Boolean(enabled);
    store.writeJson(acctRel(id), a);
    return publicAccount(a);
  }

  /**
   * Close an account and remove everything it owns. A partial delete is worse
   * than none: it leaves a licensee's client data on our disk while telling
   * them it is gone. So this walks every collection that can carry an account
   * id, and the caller supplies `purgeSite` because a site owns things
   * (workspace, uploads, deploy targets, jobs) only the server knows about.
   *
   * Not removed: webhook event records, which reference an account id but are
   * a payment audit trail rather than customer data.
   */
  function purge(id, { purgeSite = null } = {}) {
    const account = store.readJson(acctRel(id));
    if (!account) return null;
    const counts = { sites: 0, templates: 0, mappings: 0, keys: 0, batches: 0, sessions: 0 };

    for (const siteId of store.listIds('sites')) {
      const site = store.readJson(`sites/${siteId}.json`);
      if (!site || site.account !== id) continue;
      if (purgeSite) purgeSite(site); else store.deleteJson(`sites/${siteId}.json`);
      counts.sites += 1;
    }

    // Per-account folders: templates, mappings, and the batch/studio drafts.
    for (const [dir, key] of [['templates', 'templates'], ['mappings', 'mappings']]) {
      for (const name of store.listIds(`${dir}/${id}`)) {
        store.deleteJson(`${dir}/${id}/${name}.json`);
        counts[key] += 1;
      }
      rmDir(store.path(dir, id));
    }
    rmDir(store.path('templates', id)); // any thumbnails sitting beside the records

    for (const batchId of store.listIds('batches')) {
      const b = store.readJson(`batches/${batchId}.json`);
      if (b && b.account === id) { store.deleteJson(`batches/${batchId}.json`); counts.batches += 1; }
    }
    store.deleteJson(`batches/backlog/${id}.json`);
    store.deleteJson(`batches/draft/${id}.json`);
    store.deleteJson(`studio/draft/${id}.json`);
    store.deleteJson(`connections/${id}.json`);

    // API keys, and the usage counters keyed by them.
    const keys = store.readJson('keys.json', []);
    const mine = new Set(keys.filter((k) => k.account === id).map((k) => k.id));
    if (mine.size) {
      store.writeJson('keys.json', keys.filter((k) => !mine.has(k.id)));
      counts.keys = mine.size;
      const usage = store.readJson('usage.json', {});
      let touched = false;
      for (const keyId of mine) if (keyId in usage) { delete usage[keyId]; touched = true; }
      if (touched) store.writeJson('usage.json', usage);
    }

    // Every live session, so no browser stays logged into a deleted account.
    for (const s of store.listIds('sessions')) {
      const rec = store.readJson(`sessions/${s}.json`);
      if (rec && rec.account === id) { store.deleteJson(`sessions/${s}.json`); counts.sessions += 1; }
    }

    const idx = store.readJson(EMAILS, {});
    delete idx[String(account.email).toLowerCase()];
    store.writeJson(EMAILS, idx);
    store.deleteJson(acctRel(id));
    return counts;
  }

  // ── Sessions ──
  function createSession(accountId) {
    const token = crypto.randomBytes(32).toString('hex');
    store.writeJson(`sessions/${sha256(token)}.json`, {
      account: accountId,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
  }

  function verifySession(token) {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const s = store.readJson(`sessions/${sha256(token)}.json`);
    if (!s || s.expiresAt < Date.now()) return null;
    return getAccount(s.account);
  }

  function destroySession(token) {
    if (token && /^[0-9a-f]{64}$/.test(token)) store.deleteJson(`sessions/${sha256(token)}.json`);
  }

  return {
    signup, login, getAccount, setPlan, setOverage, verifyEmail, reissueVerification, purge,
    requestPasswordReset, resetPassword,
    createSession, verifySession, destroySession,
  };
}
