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
 */
import crypto from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

export function createAccounts(store) {
  const acctRel = (id) => `accounts/${id}.json`;
  const EMAILS = 'account-emails.json';

  const publicAccount = (a) => ({
    id: a.id, email: a.email, company: a.company || null, plan: a.plan || 'beta', createdAt: a.createdAt,
  });

  function idForEmail(email) {
    return store.readJson(EMAILS, {})[String(email).toLowerCase()] || null;
  }

  function signup({ email, password, company }) {
    email = String(email || '').trim();
    password = String(password || '');
    if (!isEmail(email) || email.length > 320) throw httpError(400, 'bad_request', 'A valid email is required.');
    if (password.length < 8 || password.length > 200) throw httpError(400, 'bad_request', 'Password must be 8–200 characters.');
    if (idForEmail(email)) throw httpError(409, 'email_taken', 'An account with that email already exists — try logging in.');
    const salt = crypto.randomBytes(16).toString('hex');
    const account = {
      id: crypto.randomUUID(),
      email,
      salt,
      passwordHash: hashPassword(password, salt),
      company: company ? String(company).slice(0, 300) : null,
      plan: 'beta',
      createdAt: new Date().toISOString(),
    };
    store.writeJson(acctRel(account.id), account);
    const idx = store.readJson(EMAILS, {});
    idx[email.toLowerCase()] = account.id;
    store.writeJson(EMAILS, idx);
    return publicAccount(account);
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

  return { signup, login, getAccount, setPlan, createSession, verifySession, destroySession };
}
