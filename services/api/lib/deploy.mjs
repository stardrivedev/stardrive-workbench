/**
 * Deploy actuator — push an assembled site to the customer's OWN GitHub,
 * using the token they connected (Connections, encrypted at rest). The
 * assembled site ONLY is pushed; no part of the engine is ever included.
 * Their repo, their code, their hosting: linking the repo to Vercel builds
 * it on every push, so this is a real path to live.
 *
 * Uses the GitHub Git Data API (blobs -> tree -> commit -> ref) so an entire
 * assembled tree lands in a single commit. The preconditions (site
 * assembled, GitHub connected with an owner) are enforced; the live GitHub
 * round-trip is exercised once a real token is connected.
 */
import fs from 'node:fs';
import path from 'node:path';

const GH = 'https://api.github.com';
const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

async function gh(token, method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : GH + url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stardrive',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function must(r, what) {
  if (!r.ok) throw httpError(502, 'github_error', `${what} failed: ${r.data?.message || r.status}`);
  return r.data;
}

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(abs, rel, out);
    else if (e.isFile()) out.push({ rel, abs });
  }
}

/** Push a directory tree to owner/repo as one commit on `branch`. */
export async function pushToGitHub({ token, owner, repo, dir, branch = 'main', message = 'Stardrive deploy' }) {
  // 1. Ensure the repo exists (create it private if missing).
  let repoInfo = null;
  const existing = await gh(token, 'GET', `/repos/${owner}/${repo}`);
  if (existing.ok) repoInfo = existing.data;
  let created = false;
  if (!repoInfo) {
    const me = must(await gh(token, 'GET', '/user'), 'GitHub identity check');
    const endpoint = String(me.login).toLowerCase() === String(owner).toLowerCase() ? '/user/repos' : `/orgs/${owner}/repos`;
    repoInfo = must(await gh(token, 'POST', endpoint, { name: repo, private: true, auto_init: false }), 'Repo creation');
    created = true;
  }

  // 2. Current head (empty repo -> no parent).
  let parentSha = null;
  if (!created) {
    const ref = await gh(token, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    if (ref.ok) parentSha = ref.data.object.sha;
  }

  // 3. Blobs for every file.
  const files = [];
  walk(dir, '', files);
  const tree = [];
  for (const f of files) {
    const blob = must(await gh(token, 'POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: fs.readFileSync(f.abs).toString('base64'), encoding: 'base64',
    }), `Blob upload (${f.rel})`);
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // 4/5/6. Tree -> commit -> ref.
  const treeObj = must(await gh(token, 'POST', `/repos/${owner}/${repo}/git/trees`, { tree }), 'Tree create');
  const commit = must(await gh(token, 'POST', `/repos/${owner}/${repo}/git/commits`, {
    message, tree: treeObj.sha, parents: parentSha ? [parentSha] : [],
  }), 'Commit create');
  if (parentSha) must(await gh(token, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true }), 'Ref update');
  else must(await gh(token, 'POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha }), 'Ref create');

  return { repo: repoInfo.full_name, url: repoInfo.html_url, commit: commit.sha, files: files.length, createdRepo: created };
}
