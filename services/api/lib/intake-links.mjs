/**
 * Client intake links — the client answers their own questions.
 *
 * Until now the licensee did the typing. They emailed the client a list of
 * questions, waited, then transcribed the reply into the console themselves,
 * which is both the dullest part of the job and where a phone number loses a
 * digit. A link hands the form to the person who actually knows the answers,
 * and their photos arrive with it.
 *
 * The security shape matters, because this is the only surface where somebody
 * with no account can write to a licensee's data:
 *
 *   - The URL token is 32 random base64url characters and is never stored. The
 *     record is keyed by its sha256, so a stolen var directory yields no
 *     working links, the same treatment sessions and password resets get.
 *   - Links expire, and an expired one reads as gone rather than erroring.
 *   - Saves are capped, so nobody can use a client's link as free storage.
 *   - A revoked or adopted link stops accepting writes, so an old email
 *     forwarded to somebody else cannot overwrite finished work.
 *
 * The questions themselves come from content.mjs, the same source the
 * licensee's own intake reads, so the client is asked exactly what the build
 * needs and nothing else.
 */
import crypto from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TTL_DAYS = 30;
/** Enough for a client to fill the form over several sittings, not enough to
 *  be a free key-value store. */
export const MAX_SAVES = 200;

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const rel = (id) => `intake-links/${id}.json`;

export function createIntakeLinks(store) {
  /**
   * Mint a link for one site. Returns the raw token exactly once: it is not
   * recoverable afterwards, so the caller must hand it over now.
   */
  function create({ account, siteId, siteName, modules = [], note = '', ttlDays = DEFAULT_TTL_DAYS }) {
    const token = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    const record = {
      id: hash(token),
      account,
      siteId,
      siteName,
      modules,
      note: String(note || '').slice(0, 500),
      facts: {},
      status: 'open',
      saves: 0,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + Math.max(1, ttlDays) * DAY_MS).toISOString(),
      submittedAt: null,
      adoptedAt: null,
    };
    store.writeJson(rel(record.id), record);
    return { record, token };
  }

  const get = (id) => store.readJson(rel(id), null);

  /** The record this token opens, or null. Never distinguishes "wrong token"
   *  from "expired": both are simply not a usable link. */
  function find(token) {
    const record = get(hash(String(token || '')));
    if (!record) return null;
    if (record.status === 'revoked') return null;
    if (Date.parse(record.expiresAt) < Date.now()) return null;
    return record;
  }

  function save(record) {
    store.writeJson(rel(record.id), record);
    return record;
  }

  /** Merge in what the client typed. Partial on purpose: they can come back. */
  function saveFacts(record, facts) {
    record.facts = { ...(record.facts || {}), ...facts };
    record.saves = (record.saves || 0) + 1;
    record.updatedAt = new Date().toISOString();
    return save(record);
  }

  function markSubmitted(record) {
    record.status = 'submitted';
    record.submittedAt = new Date().toISOString();
    return save(record);
  }

  /** Adopted: the licensee has pulled the answers onto the site. The link
   *  stops accepting writes, because the work has moved on from it. */
  function markAdopted(record) {
    record.status = 'adopted';
    record.adoptedAt = new Date().toISOString();
    return save(record);
  }

  function revoke(record) {
    record.status = 'revoked';
    record.revokedAt = new Date().toISOString();
    return save(record);
  }

  /** Every link this account owns, newest first. */
  function listFor(account, { siteId = null } = {}) {
    return store.listIds('intake-links')
      .map((id) => get(id))
      .filter((r) => r && r.account === account && (!siteId || r.siteId === siteId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** What the console shows. Never includes the token: it does not exist here. */
  function summary(record) {
    return {
      id: record.id,
      siteId: record.siteId,
      siteName: record.siteName,
      status: expiredStatus(record),
      note: record.note,
      answeredCount: Object.keys(record.facts || {}).filter((k) => hasAnswer(record.facts[k])).length,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      submittedAt: record.submittedAt,
      adoptedAt: record.adoptedAt,
    };
  }

  /** An open link past its date reads as expired, without rewriting the file:
   *  status is derived so a clock change cannot strand a record mid-state. */
  function expiredStatus(record) {
    if (record.status === 'open' && Date.parse(record.expiresAt) < Date.now()) return 'expired';
    return record.status;
  }

  return { create, get, find, saveFacts, markSubmitted, markAdopted, revoke, listFor, summary, expiredStatus };
}

/** Is this value something the client actually filled in? */
function hasAnswer(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return String(v ?? '').trim().length > 0;
}
