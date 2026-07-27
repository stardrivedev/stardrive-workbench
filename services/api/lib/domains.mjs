/**
 * Custom domains — the last mile of every client job, kept vendor-neutral.
 *
 * A domain is recorded on the SITE as plain data, never as a property of one
 * host. What Stardrive can do with it depends on whether the licensee gave us
 * a token for wherever that site lives:
 *
 *   - Host we hold a token for (Vercel today): attach it through the host's
 *     API, then read the required DNS records and the verification state BACK
 *     from that host, so what we display is what the host actually wants.
 *   - Any other host (a GitHub push into Netlify, Cloudflare, a VPS, …):
 *     Stardrive has no credentials and no business pretending otherwise. We
 *     record the domain, show the record SHAPE every host needs, and hand over
 *     the one environment variable the site itself cares about. The values
 *     come from their host, and we say so.
 *
 * That second case is the important one: never invent an IP or a CNAME target
 * for a host we cannot see, and never report "live" for DNS we did not check.
 * A wrong A record is a client's site down, and a confidently wrong instruction
 * is worse than an honest "your host will give you this value".
 *
 * Beyond DNS, a domain has to reach the site's own code: `robots.ts` and
 * `sitemap.ts` in the d4 site template resolve their base URL from
 * NEXT_PUBLIC_SITE_URL (falling back to VERCEL_URL, then localhost), so a site
 * on a custom domain that never gets that variable keeps advertising the wrong
 * canonical host to search engines. `siteUrlEnv()` is what callers wire in.
 */
import { vercelJson } from './deploy-vercel.mjs';

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

// Deliberately permissive on TLD length (new gTLDs are long) and strict on
// shape. Punycode is accepted as already-encoded (xn--…); we do not transcode
// unicode here, so a unicode domain must be entered in its ASCII form.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

/**
 * Free text → a usable apex domain. Accepts what people actually paste: a
 * full URL, a trailing slash, a leading www., stray whitespace, mixed case.
 * Returns { name, addWww }; `name` is always the apex, and a typed "www."
 * is stripped rather than rejected (it only ever means "and www too").
 */
export function normalizeDomain(input, { addWww = true } = {}) {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) throw httpError(422, 'bad_domain', 'Enter a domain, e.g. theclient.com.');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.split('/')[0].split('?')[0].split('#')[0]; // path/query/fragment
  s = s.replace(/:\d+$/, ''); // port
  s = s.replace(/\.+$/, ''); // trailing dot (root)
  if (s.startsWith('www.')) s = s.slice(4);
  if (!s || s.length > 253) throw httpError(422, 'bad_domain', `"${input}" is not a domain we can use.`);
  if (!DOMAIN_RE.test(s)) {
    throw httpError(422, 'bad_domain', `"${input}" is not a valid domain. Use the bare name, e.g. theclient.com.`);
  }
  return { name: s, addWww: Boolean(addWww) };
}

/** The canonical-URL variable the assembled site reads. */
export const SITE_URL_ENV = 'NEXT_PUBLIC_SITE_URL';
export const siteUrlEnv = (domain) => (domain ? { [SITE_URL_ENV]: `https://${domain}` } : {});

/**
 * The DNS rows to show. When a host told us what it wants (`hostRecords`),
 * those are the truth and are marked `source: 'host'`. Otherwise we describe
 * the SHAPE and leave the value to the host, marked `source: 'shape'` so the
 * UI can render it as an instruction rather than a copyable value.
 */
export function dnsPlanFor({ name, addWww = true, hostRecords = null }) {
  if (Array.isArray(hostRecords) && hostRecords.length) {
    return hostRecords.map((r) => ({
      type: String(r.type || '').toUpperCase(),
      host: r.name === '' || r.name == null ? '@' : String(r.name),
      value: String(r.value ?? ''),
      source: 'host',
    }));
  }
  const rows = [{
    type: 'A',
    host: '@',
    value: null,
    note: 'The IP address your host gives you for this site. Some hosts use an ALIAS or ANAME record here instead of an A record.',
    source: 'shape',
  }];
  if (addWww) {
    rows.push({
      type: 'CNAME',
      host: 'www',
      value: null,
      note: 'The hostname your host gives you, e.g. something.netlify.app or your-project.pages.dev.',
      source: 'shape',
    });
  }
  return rows;
}

/* ── Vercel ───────────────────────────────────────────────────────────── */
// The one host we hold a token for today. Everything here reads state back
// from Vercel rather than assuming it: the records to set, whether the domain
// is verified, and whether DNS is currently pointing the right way.

/** Attach a domain to a Vercel project. Already-attached is a success. */
export async function attachVercel({ token, teamId = null, project, domain }) {
  const res = await vercelJson(token, 'POST', `/v10/projects/${encodeURIComponent(project)}/domains`, { name: domain }, teamId);
  if (!res.ok) {
    const code = res.data?.error?.code || '';
    // Ours already, or attached by a previous run: not an error to re-attach.
    if (res.status === 409 || code === 'domain_already_in_use_by_this_project') {
      return { attached: true, alreadyAttached: true };
    }
    if (res.status === 403) throw httpError(401, 'vercel_auth', 'Vercel rejected the token. Check it has access to this project (vercel.com/account/tokens).');
    if (code === 'domain_already_in_use') {
      throw httpError(409, 'domain_taken', `${domain} is already attached to a different Vercel project or account. Remove it there first, then try again.`);
    }
    throw httpError(502, 'vercel_error', res.data?.error?.message || `Vercel returned ${res.status} attaching ${domain}.`);
  }
  return { attached: true, alreadyAttached: false };
}

/**
 * Where a Vercel domain actually stands: verified with Vercel, and whether
 * DNS resolves the way Vercel wants. Returns the records Vercel itself
 * recommends, so we never hardcode an IP that can change under us.
 */
export async function checkVercel({ token, teamId = null, project, domain }) {
  const dom = await vercelJson(token, 'GET', `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`, null, teamId);
  if (!dom.ok) {
    if (dom.status === 404) return { state: 'pending', verified: false, message: 'Not attached to this Vercel project yet.', records: [] };
    if (dom.status === 403) throw httpError(401, 'vercel_auth', 'Vercel rejected the token.');
    throw httpError(502, 'vercel_error', dom.data?.error?.message || `Vercel returned ${dom.status}.`);
  }
  const verified = dom.data?.verified === true;
  // /v6/domains/{domain}/config reports whether DNS currently points at
  // Vercel, plus what it should be. misconfigured=false means live.
  const cfg = await vercelJson(token, 'GET', `/v6/domains/${encodeURIComponent(domain)}/config`, null, teamId);
  const misconfigured = cfg.ok ? cfg.data?.misconfigured !== false : true;
  const records = [
    ...(dom.data?.verification ?? []).map((v) => ({ type: v.type, name: v.domain, value: v.value })),
    ...(cfg.ok ? (cfg.data?.recommendedIPv4 ?? []).flatMap((r) => (r.value ?? []).map((ip) => ({ type: 'A', name: '', value: ip }))) : []),
    ...(cfg.ok ? (cfg.data?.recommendedCNAME ?? []).map((c) => ({ type: 'CNAME', name: 'www', value: c.value })) : []),
  ];
  if (verified && !misconfigured) {
    return { state: 'live', verified, message: `${domain} is verified and serving.`, records: [] };
  }
  return {
    state: 'pending',
    verified,
    message: verified
      ? 'Verified with Vercel. Waiting for DNS to point here, which can take up to a few hours after you add the records.'
      : 'Waiting on the DNS records below. Vercel re-checks automatically; press Check again once your records are in.',
    records,
  };
}
