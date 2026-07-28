/**
 * The zero-cost proof run: the whole spine a paying licensee depends on,
 * driven against the REAL engine with the FULL QA tier, and deliberately
 * WITHOUT a model key, so it spends nothing.
 *
 *   sign up → import a template → create a client site → answer the full
 *   intake → write the copy (deterministic fallback, no model) → assemble for
 *   real → npm install + next build + serve + route checks → export a
 *   standalone .tar.gz → attach a custom domain → read back the DNS steps.
 *
 * The only thing this cannot cover is AI generation itself, which is the one
 * paid call and the one part already exercised daily in the Studio. Everything
 * else that has to work on day one is here.
 *
 * Takes several minutes: it really does install dependencies and compile a
 * Next.js app. That is the point.
 *
 * Run: node services/api/test/proof-run.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-proof-'));
const PORT = Number(process.env.STARDRIVE_TEST_PORT || (5400 + Math.floor(Math.random() * 200)));
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['server.mjs', '--port', String(PORT)], {
    cwd: API_DIR,
    env: {
      ...process.env,
      STARDRIVE_VAR_DIR: varDir,
      STARDRIVE_ENGINE: 'real',   // a genuine Next.js site, not the dry stub
      STARDRIVE_QA: 'full',       // npm install + next build + serve + routes
      STARDRIVE_LLM_KEY: '',      // no model: nothing here costs money
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  const t = setTimeout(() => reject(new Error('server never came up: ' + buf)), 20000);
  child.stdout.on('data', (d) => { buf += d; if (buf.includes('listening')) { clearTimeout(t); resolve(child); } });
  child.stderr.on('data', (d) => { buf += d; });
  child.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited (${c}): ${buf}`)); });
});

const api = async (method, p, { key, body, raw } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log(`proof run (real engine, full QA, no model key) on :${PORT}`);
let key;
let siteId;

await check('the deployment reports the real engine and the full QA tier', async () => {
  const h = await api('GET', '/v1/health');
  assert.strictEqual(h.body.engine, 'real');
  assert.strictEqual(h.body.qa, 'full');
  assert.strictEqual(h.body.studio.enabled, false, 'no model configured: this run spends nothing');
  assert.ok(h.body.builds, 'build queue is reported');
});

await check('a licensee signs up and gets a working key', async () => {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'proof@example.com', password: 'longenough', company: 'Proof Studio' }),
  });
  const b = await res.json();
  assert.strictEqual(res.status, 201);
  key = b.apiKey.secret;
  const t = await api('GET', '/v1/templates', { key });
  assert.strictEqual(t.status, 200);
  assert.ok(t.body.templates.length >= 1, 'the catalog is there to build from');
});

await check('a client site is created from a catalog template', async () => {
  const made = await api('POST', '/v1/sites', {
    key,
    body: {
      templateId: 'd4-site-template',
      config: { siteName: 'Harbour Light Dental', tagline: 'Gentle dentistry on the waterfront' },
      assemble: false,
    },
  });
  assert.strictEqual(made.status, 201);
  siteId = made.body.siteId;
});

await check('the intake gates the build until every required question is answered', async () => {
  const early = await api('POST', `/v1/sites/${siteId}/assemble`, { key, body: {} });
  assert.strictEqual(early.status, 422, 'a half-answered site cannot ship');
  assert.strictEqual(early.body.error.code, 'content_incomplete');

  const saved = await api('PATCH', `/v1/sites/${siteId}/content`, {
    key,
    body: {
      facts: {
        whatYouDo: 'We are a family dental practice on the harbour front.',
        aboutFacts: 'Opened in 2011 by Dr. Sana Iqbal. Two surgeries, six staff, and a waiting room that looks over the water. We see everyone from toddlers to their grandparents.',
        services: ['Check-ups and hygiene', 'Fillings and crowns', 'Teeth whitening', 'Emergency appointments'],
        contactEmail: 'hello@harbourlight.example',
        phone: '01632 960 421',
        address: '14 Quay Street, Harbour Light',
        hours: 'Mon to Fri 8:30 to 5:30, Sat mornings by appointment',
        mission: 'Dentistry that nobody dreads.',
        whoYouServe: 'Families along the harbour and the villages behind it',
        differentiator: 'Same-day emergency slots kept free every single day',
      },
    },
  });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual(saved.body.readiness.ready, true, 'now it is ready to ship');
});

await check('copy is written WITHOUT a model, from the facts alone', async () => {
  const gen = await api('POST', `/v1/sites/${siteId}/content/generate`, { key });
  assert.strictEqual(gen.status, 200);
  assert.notStrictEqual(gen.body.source, 'ai', `the deterministic path wrote it (source: ${gen.body.source})`);
  const c = gen.body.copy;
  assert.ok(c.home.heroHeadline.length > 0, 'there is a headline');
  assert.ok(c.about.paragraphs.length > 0, 'the about page has real paragraphs');
  assert.strictEqual(c.services.length, 4, 'every service made it through');
  // The house rule the copywriter is held to.
  const allText = JSON.stringify(c);
  assert.strictEqual(/—|–/.test(allText), false, 'no em-dashes or en-dashes anywhere in the copy');
  // And the fact-slot rule: nothing invented that was not supplied.
  assert.strictEqual(/lorem ipsum|replace this/i.test(allText), false, 'no placeholder filler');
});

await check('a photo is uploaded into its compartment', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#2b6"/></svg>');
  const up = await api('POST', `/v1/sites/${siteId}/assets/logo`, {
    key, body: { filename: 'harbour-light.svg', contentBase64: svg.toString('base64') },
  });
  assert.strictEqual(up.status, 201);
  assert.match(up.body.asset.target, /public\/assets\/brand\//);
});

let job;
await check('the site assembles for real: install, compile, serve, and check every route', async () => {
  const started = await api('POST', `/v1/sites/${siteId}/assemble`, { key, body: {} });
  assert.strictEqual(started.status, 202);
  const jobId = started.body.jobId;
  const t0 = Date.now();
  for (;;) {
    await sleep(4000);
    const r = await api('GET', `/v1/jobs/${jobId}`, { key });
    job = r.body;
    if (['done', 'failed'].includes(job.status)) break;
    if (Date.now() - t0 > 900_000) throw new Error('build did not finish within 15 minutes');
    if ((Date.now() - t0) % 60_000 < 4200) console.log(`        …building (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  if (job.status !== 'done') {
    throw new Error('build failed:\n' + job.logs.slice(-12).map((l) => '          ' + l.line).join('\n'));
  }
  console.log(`        built in ${Math.round((Date.now() - t0) / 1000)}s`);
});

await check('the QA tier actually compiled it and checked the pages', () => {
  const qa = job.result?.qa;
  assert.ok(qa, 'a QA report came back');
  const names = (qa.checks || []).map((c) => c.name.toLowerCase());
  assert.ok(names.some((n) => n.includes('install')), 'dependencies were installed');
  assert.ok(names.some((n) => n.includes('build')), 'the site was compiled by next build');
  const failed = (qa.checks || []).filter((c) => c.ok === false);
  assert.deepStrictEqual(failed.map((c) => c.name), [], 'every QA check passed');
});

await check('what came out is a real, standalone Next.js project', () => {
  const ws = path.join(varDir, 'workspaces', siteId);
  for (const f of ['package.json', 'next.config.ts', 'src/app/layout.tsx', 'src/app/page.tsx']) {
    assert.ok(fs.existsSync(path.join(ws, f)), `${f} is there`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf-8'));
  assert.ok(pkg.dependencies?.next, 'it depends on Next.js');
  assert.strictEqual(/stardrive/i.test(JSON.stringify(pkg)), false, 'and nothing of the engine ships inside it');
  // The client's own facts reached the built site.
  const site = fs.readFileSync(path.join(ws, 'src', 'config', 'site.ts'), 'utf-8');
  assert.match(site, /Harbour Light Dental/, 'the business name is baked in');
  // The uploaded logo landed where the assembler said it would.
  assert.ok(fs.existsSync(path.join(ws, 'public', 'assets', 'brand', 'harbour-light.svg')), 'the logo is in place');
});

await check('the finished site exports as a .tar.gz a developer could unpack anywhere', async () => {
  const res = await api('GET', `/v1/sites/${siteId}/export`, { key, raw: true });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-disposition') || '', /harbour-light-dental\.tar\.gz/);
  const tar = zlib.gunzipSync(res.buffer);
  const names = [];
  for (let off = 0; off + 512 <= tar.length;) {
    const head = tar.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const name = head.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(head.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    off += 512 + Math.ceil(size / 512) * 512;
    if (name) names.push(name);
  }
  assert.ok(names.some((n) => n.endsWith('package.json')), 'the archive has the project');
  assert.strictEqual(names.some((n) => n.includes('node_modules')), false, 'without dependencies');
  assert.strictEqual(names.some((n) => n.includes('.next/')), false, 'and without build output');
  console.log(`        ${names.length} files, ${(res.buffer.length / 1024).toFixed(0)} KB packaged`);
});

await check('a custom domain is recorded, with honest DNS steps for an unconnected host', async () => {
  const set = await api('PUT', `/v1/sites/${siteId}/domain`, { key, body: { name: 'https://WWW.HarbourLight.example/' } });
  assert.strictEqual(set.status, 200);
  assert.strictEqual(set.body.domain.name, 'harbourlight.example');
  assert.strictEqual(set.body.manageable, false, 'no host token here, and it says so');
  assert.ok(set.body.records.length, 'the record shape is still given');
  assert.strictEqual(set.body.records[0].value, null, 'with no invented IP for a host we cannot see');
  assert.strictEqual(set.body.siteUrlValue, 'https://harbourlight.example');
  assert.strictEqual(set.body.siteUrlEnv, 'NEXT_PUBLIC_SITE_URL', 'and the canonical URL variable to set');
});

await check('publishing is refused honestly when no hosting is connected', async () => {
  const pub = await api('POST', `/v1/sites/${siteId}/deploy/vercel`, { key, body: {} });
  assert.strictEqual(pub.status, 422);
  assert.strictEqual(pub.body.error.code, 'no_target', 'it asks for a token rather than pretending');
});

server.kill();
await sleep(400);
try { fs.rmSync(varDir, { recursive: true, force: true }); } catch { /* windows locks */ }
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nProof run complete: the whole spine works, and it cost nothing.');
process.exit(0);
