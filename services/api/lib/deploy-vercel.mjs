/**
 * Vercel deploy actuator — publish an assembled site straight to the customer's
 * OWN Vercel account and get back a live URL, no GitHub round-trip required.
 *
 * Flow (Vercel v13 file deployments): sha1 + upload each source file to
 * /v2/files, then POST /v13/deployments referencing them; Vercel runs the
 * Next.js build and serves it. Only the assembled site is uploaded (node_modules
 * and .next are excluded) — no part of the Stardrive engine ever leaves.
 *
 * The token is the customer's own Vercel token (Connections, encrypted at rest,
 * or entered per-site). The live round-trip is exercised once a real token is
 * connected; preconditions and the request shape are enforced here.
 *
 * Also wires environment variables (e.g. a connected database) into the
 * Vercel project BEFORE the deployment, so a site with a database connected
 * works immediately on first publish, no manual env copying on the host.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const V = 'https://api.vercel.com';
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

// Never upload build output, deps, VCS metadata, or our QA preview snapshot.
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.vercel']);
const SKIP_FILES = new Set(['.stardrive-preview.png']);

function walkFiles(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name, out);
    } else if (e.isFile() && !SKIP_FILES.has(e.name)) {
      out.push({ rel: base ? `${base}/${e.name}` : e.name, abs: path.join(dir, e.name) });
    }
  }
}

/** Vercel project slug rules: lowercase, alphanumeric + hyphen, <= 100 chars. */
function projectName(name) {
  const slug = String(name || 'site').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  return slug || 'site';
}

async function vercelJson(token, method, url, body, teamId) {
  const q = teamId ? (url.includes('?') ? `${url}&teamId=${teamId}` : `${url}?teamId=${teamId}`) : url;
  const res = await fetch(V + q, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Find (or create) the Vercel project, so env vars can be set BEFORE the
 *  deployment that needs to read them at runtime (e.g. the database). */
async function ensureProject(token, teamId, name) {
  const existing = await vercelJson(token, 'GET', `/v9/projects/${name}`, null, teamId);
  if (existing.ok) return existing.data.id;
  const created = await vercelJson(token, 'POST', '/v9/projects', { name, framework: 'nextjs' }, teamId);
  if (!created.ok) {
    if (created.status === 403) throw httpError(401, 'vercel_auth', 'Vercel rejected the token. Check it has deploy access (vercel.com/account/tokens).');
    throw httpError(502, 'vercel_error', created.data?.error?.message || `Vercel returned ${created.status} creating the project.`);
  }
  return created.data.id;
}

/** Upsert project environment variables (production + preview). */
async function setEnvVars(token, teamId, projectId, env) {
  for (const [envKey, value] of Object.entries(env)) {
    const q = teamId
      ? `/v10/projects/${projectId}/env?teamId=${teamId}&upsert=true`
      : `/v10/projects/${projectId}/env?upsert=true`;
    const res = await fetch(V + q, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: envKey, value, type: 'encrypted', target: ['production', 'preview'] }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw httpError(502, 'vercel_error', `Setting ${envKey} on Vercel failed: ${d?.error?.message || res.status}`);
    }
  }
}

/**
 * Deploy `dir` to Vercel as project `name`. Returns
 * { url, inspectorUrl, id, readyState, files }. Pass `env` (a plain object of
 * environment variables, e.g. a connected database's URL/auth token) to have
 * them wired into the Vercel project automatically — set BEFORE the
 * deployment is created so the very first live build already has them.
 */
export async function deployToVercel({ token, teamId = null, name, dir, target = 'production', env = null }) {
  if (!token) throw httpError(422, 'no_target', 'A Vercel token is required to publish here.');
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    throw httpError(409, 'not_assembled', 'Build the site before publishing.');
  }
  const project = projectName(name);

  let envWired = false;
  if (env && Object.keys(env).length) {
    const projectId = await ensureProject(token, teamId, project);
    await setEnvVars(token, teamId, projectId, env);
    envWired = true;
  }

  // 1. Upload every file, keyed by its sha1 digest.
  const files = [];
  walkFiles(dir, '', files);
  if (!files.length) throw httpError(409, 'empty_site', 'Nothing to deploy — the assembled site is empty.');
  const manifest = [];
  for (const f of files) {
    const buf = fs.readFileSync(f.abs);
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    const q = teamId ? `/v2/files?teamId=${teamId}` : '/v2/files';
    const res = await fetch(V + q, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha },
      body: buf,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 403) throw httpError(401, 'vercel_auth', 'Vercel rejected the token. Check it has deploy access (vercel.com/account/tokens).');
      throw httpError(502, 'vercel_error', `Uploading ${f.rel} failed: ${d?.error?.message || res.status}`);
    }
    manifest.push({ file: f.rel, sha, size: buf.length });
  }

  // 2. Create the deployment; Vercel builds it as a Next.js app.
  const create = await vercelJson(token, 'POST', '/v13/deployments', {
    name: project,
    files: manifest,
    projectSettings: { framework: 'nextjs' },
    target,
  }, teamId);
  if (!create.ok) {
    if (create.status === 403) throw httpError(401, 'vercel_auth', 'Vercel rejected the token. Check it has deploy access (vercel.com/account/tokens).');
    throw httpError(502, 'vercel_error', create.data?.error?.message || `Vercel returned ${create.status}.`);
  }
  const id = create.data.id;
  const host = create.data.url ? `https://${create.data.url}` : null;
  const inspectorUrl = create.data.inspectorUrl || null;
  let readyState = create.data.readyState || create.data.status || 'QUEUED';

  // 3. Briefly poll for an early error/ready state; a full Next build can take
  // minutes, so we don't block on it — the URL resolves once the build finishes.
  for (let i = 0; i < 6 && !['READY', 'ERROR', 'CANCELED'].includes(readyState); i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await vercelJson(token, 'GET', `/v13/deployments/${id}`, null, teamId);
    if (poll.ok) readyState = poll.data.readyState || poll.data.status || readyState;
  }
  if (readyState === 'ERROR') throw httpError(502, 'vercel_build_failed', 'Vercel accepted the upload but the build failed. Open the build logs in Vercel to see why.');

  return { url: host, inspectorUrl, id, readyState, files: manifest.length, project, envWired };
}
