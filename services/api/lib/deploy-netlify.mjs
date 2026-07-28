/**
 * Netlify deploys, so Vercel is a choice rather than the only road out.
 *
 * Netlify's deploy API takes a digest first: you send it a map of path to
 * SHA1, it replies with the subset it has never seen, and you upload only
 * those. That is why this is not simply "post a zip", and it is also why a
 * redeploy of a site with one changed page is fast.
 *
 * DORMANT until the licensee connects a Netlify token, like every other
 * capability here. Env vars are set on the site BEFORE the deploy, so the
 * admin area and the contact form work on the very first publish rather than
 * after a second one nobody told them to do.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.netlify.com/api/v1';
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

/** Netlify site names are DNS labels: lowercase, hyphens, 63 chars. */
export function netlifySiteName(name) {
  return String(name || 'site')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'site';
}

async function netlify(token, method, url, body, contentType = 'application/json') {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': contentType } : {}),
    },
    body: body ? (contentType === 'application/json' ? JSON.stringify(body) : body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    throw httpError(502, 'netlify_error', `Netlify ${method} ${url} failed (${res.status}): ${data?.message || text.slice(0, 200)}`);
  }
  return data;
}

/** Every file under `dir`, as posix-relative paths with their SHA1 digests. */
function digestTree(dir) {
  const files = new Map(); // "/path" → { abs, sha }
  const skip = new Set(['node_modules', '.git', '.next', '.env', '.env.local']);
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) {
        files.set(rel, { abs, sha: crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex') });
      }
    }
  };
  walk(dir, '');
  return files;
}

/** Find the site by name, or create it. */
async function ensureSite(token, name, accountSlug) {
  const existing = await netlify(token, 'GET', `/sites?name=${encodeURIComponent(name)}`);
  const match = Array.isArray(existing) ? existing.find((s) => s.name === name) : null;
  if (match) return match;
  const where = accountSlug ? `/${accountSlug}/sites` : '/sites';
  return netlify(token, 'POST', where, { name });
}

/**
 * Publish a directory to Netlify.
 *
 * Note the shape of what is sent: this uploads the SOURCE and lets Netlify
 * build it, which is what makes the Next.js runtime (admin area, API routes)
 * work. Uploading a pre-built folder would strip the site back to static
 * files and silently break every form on it.
 */
export async function deployToNetlify({ token, name, dir, accountSlug = null, env = null }) {
  if (!token) throw httpError(422, 'no_target', 'A Netlify personal access token is required.');
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw httpError(409, 'not_assembled', 'Build the site before publishing.');
  }

  const siteName = netlifySiteName(name);
  const site = await ensureSite(token, siteName, accountSlug);

  // Settings first, so the very first build has them.
  await netlify(token, 'PATCH', `/sites/${site.id}`, {
    build_settings: { cmd: 'npm run build', dir: '.next' },
  });
  if (env && Object.keys(env).length) {
    // Netlify's newer env API is per-account; the site-level field works on
    // both and keeps this to one call.
    await netlify(token, 'PATCH', `/sites/${site.id}`, { build_settings: { env } });
  }

  const files = digestTree(dir);
  const digest = Object.fromEntries([...files].map(([rel, f]) => [rel, f.sha]));

  const deploy = await netlify(token, 'POST', `/sites/${site.id}/deploys`, { files: digest, async: false });

  // Upload only what Netlify says it is missing.
  const required = new Set(deploy.required || []);
  let uploaded = 0;
  for (const [rel, f] of files) {
    if (!required.has(f.sha)) continue;
    await netlify(token, 'PUT', `/deploys/${deploy.id}/files${rel}`, fs.readFileSync(f.abs), 'application/octet-stream');
    uploaded += 1;
  }

  return {
    url: deploy.ssl_url || deploy.url || site.ssl_url || site.url,
    id: deploy.id,
    site: siteName,
    siteId: site.id,
    files: files.size,
    uploaded,
    envWired: Boolean(env && Object.keys(env).length),
    adminUrl: site.admin_url || null,
  };
}

/** Attach a custom domain. Netlify serves DNS instructions from its own UI,
 *  so this sets the domain and never invents records. */
export async function attachNetlifyDomain({ token, siteId, domain }) {
  await netlify(token, 'PATCH', `/sites/${siteId}`, { custom_domain: domain });
  return { attached: true, domain };
}
