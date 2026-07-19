/**
 * Async job framework: an in-process FIFO worker over file-backed job
 * records, with pluggable executors per job kind.
 *
 * Engines:
 *   dry  — assembles a workspace MARKER (d4.assembly.json with the resolved
 *          template/modules/config) and records a skipped-QA report. Kept so
 *          the API lifecycle is testable with zero build tooling.
 *   real — invokes the VENDORED d4 assembler (vendor/d4) in an isolated
 *          per-job workspace, producing a real standalone Next.js site;
 *          slots the account's uploaded assets into it; and runs a real
 *          structural + WCAG-contrast QA gate (fast, no browser build).
 *          Imported customer templates are materialized directly (they are
 *          already complete sites). The output is exportable as a tar.gz —
 *          assembled site only, the engine itself is never included.
 *
 * Job records survive restarts (var/jobs/); anything found queued/running
 * at boot is requeued.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BUILD_CONFIG_KEYS = ['siteName', 'tagline', 'description', 'contactEmail', 'phone', 'address', 'pairing', 'nav', 'announcement', 'quote', 'socialLinks', 'darkMode', 'themeDark', 'theme'];

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else if (e.isFile()) n += 1;
  }
  return n;
}

function writeSafe(outDir, relPath, file) {
  const dest = path.resolve(outDir, relPath);
  if (!dest.startsWith(path.resolve(outDir) + path.sep)) throw new Error(`Unsafe path in bundle: ${relPath}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = file.contentBase64 != null ? Buffer.from(file.contentBase64, 'base64') : Buffer.from(String(file.content ?? ''), 'utf-8');
  fs.writeFileSync(dest, buf);
}

export function createJobRunner(store, { engine = 'dry', assets = null, engineDir = null, resolveTemplate = null } = {}) {
  const queue = [];
  let running = false;

  const jobPath = (id) => `jobs/${id}.json`;

  function save(job) {
    store.writeJson(jobPath(job.id), job);
  }

  function get(id) {
    return store.readJson(jobPath(id));
  }

  function log(job, line) {
    job.logs.push({ t: new Date().toISOString(), line });
    save(job);
  }

  function enqueue(kind, siteId, account) {
    const job = {
      id: crypto.randomUUID(),
      kind,
      siteId,
      account: account ?? null,
      engine,
      status: 'queued',
      logs: [],
      result: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    save(job);
    queue.push(job.id);
    setImmediate(tick);
    return job;
  }

  async function tick() {
    if (running) return;
    const id = queue.shift();
    if (!id) return;
    running = true;
    const job = get(id);
    try {
      job.status = 'running';
      save(job);
      const executor = EXECUTORS[job.kind];
      if (!executor) throw new Error(`No executor for job kind "${job.kind}".`);
      await executor(job);
      job.status = 'done';
    } catch (err) {
      job.status = 'failed';
      log(job, `FAILED: ${err.message}`);
    }
    job.finishedAt = new Date().toISOString();
    save(job);
    running = false;
    setImmediate(tick);
  }

  // ── Executors ──────────────────────────────────────────────────────────

  async function assemble(job) {
    const site = store.readJson(`sites/${job.siteId}.json`);
    if (!site) throw new Error(`Site ${job.siteId} not found.`);
    if (job.engine === 'real') return assembleReal(job, site);
    return assembleDry(job, site);
  }

  /** Write build.json, invoke the vendored assembler, return its record. */
  function runAssembler(job, site, outDir, modulesDir, modules) {
    const buildCfg = { output: outDir, modules };
    for (const k of BUILD_CONFIG_KEYS) if (site.config[k] !== undefined) buildCfg[k] = site.config[k];
    const buildPath = store.path('workspaces', `${job.siteId}.build.json`);
    fs.writeFileSync(buildPath, JSON.stringify(buildCfg, null, 2));
    try {
      const out = execFileSync(process.execPath, [
        path.join(engineDir, 'd4-site-builder', 'bin', 'assemble.mjs'),
        '--config', buildPath, '--modules-dir', modulesDir,
      ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      log(job, (out.trim().split('\n').find((l) => l.includes('Assembled')) || 'Assembled.').trim());
    } catch (err) {
      const msg = String(err.stderr || err.stdout || err.message || '').trim().split('\n').filter(Boolean).slice(-3).join(' ');
      throw new Error(`Assembly failed: ${msg}`);
    } finally {
      fs.rmSync(buildPath, { force: true });
    }
    return JSON.parse(fs.readFileSync(path.join(outDir, 'd4.assembly.json'), 'utf-8'));
  }

  /**
   * Stage a modules-dir where the customer's imported template stands in as
   * the base `d4-site-template`, beside the real feature modules — so the
   * SAME assembler layers d4 modules onto their own design (deps, route
   * conflicts, per-client config all handled by the real engine).
   */
  function stageImportedBase(stagingDir, resolved) {
    const baseDir = path.join(stagingDir, 'd4-site-template');
    fs.mkdirSync(path.join(baseDir, 'files'), { recursive: true });
    const manifest = { ...resolved.manifest, name: 'd4-site-template', kind: 'site', copy: [{ from: 'files', to: '.' }] };
    fs.writeFileSync(path.join(baseDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    for (const f of resolved.bundle.files) writeSafe(path.join(baseDir, 'files'), f.path, f);
    for (const name of fs.readdirSync(engineDir)) {
      if (name === 'd4-site-builder' || name === 'd4-site-template') continue;
      if (fs.existsSync(path.join(engineDir, name, 'manifest.json'))) {
        fs.cpSync(path.join(engineDir, name), path.join(stagingDir, name), { recursive: true });
      }
    }
  }

  async function assembleReal(job, site) {
    if (!engineDir || !fs.existsSync(path.join(engineDir, 'd4-site-builder', 'bin', 'assemble.mjs'))) {
      throw new Error('The d4 engine is not available (vendor/d4 missing).');
    }
    const resolved = resolveTemplate && resolveTemplate(site.account, site.templateId);
    if (!resolved) throw new Error(`Template "${site.templateId}" not found for this account.`);

    const outDir = store.path('workspaces', job.siteId);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(outDir), { recursive: true }); // parent only; the assembler creates outDir itself

    const modules = Array.isArray(site.config.modules) ? site.config.modules.filter((m) => m && m !== 'd4-site-template') : [];

    let assemblyRecord;
    let viaAssembler = false;
    if (resolved.source === 'bundled') {
      if (resolved.manifest.kind !== 'site') throw new Error(`"${site.templateId}" is a ${resolved.manifest.kind} module, not a base site template.`);
      log(job, `Assembling "${site.config.siteName}" with the d4 engine (${modules.length} module(s))…`);
      assemblyRecord = runAssembler(job, site, outDir, engineDir, modules);
      viaAssembler = true;
    } else if (modules.length) {
      log(job, `Assembling your template "${site.templateId}" with ${modules.length} engine module(s) layered on…`);
      const stagingDir = store.path('workspaces', `${job.siteId}.stage`);
      fs.rmSync(stagingDir, { recursive: true, force: true });
      stageImportedBase(stagingDir, resolved);
      try {
        assemblyRecord = runAssembler(job, site, outDir, stagingDir, modules);
      } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
      assemblyRecord.imported = true;
      viaAssembler = true;
    } else {
      log(job, `Materializing your template "${site.templateId}" (${resolved.bundle.files.length} files)…`);
      fs.mkdirSync(outDir, { recursive: true });
      for (const f of resolved.bundle.files) writeSafe(outDir, f.path, f);
      assemblyRecord = {
        imported: true, template: site.templateId, siteName: site.config.siteName,
        routes: Object.fromEntries((resolved.manifest.provides?.routes || []).map((r) => [r, site.templateId])),
        assembledAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(outDir, 'd4.assembly.json'), JSON.stringify(assemblyRecord, null, 2));
    }

    const slotted = assets ? assets.materialize(job.siteId, outDir) : 0;
    if (slotted) log(job, `Slotted ${slotted} uploaded asset(s) into the site.`);

    // ── Real QA: structural + WCAG contrast (fast, no browser build) ──
    const checks = [];
    const has = (p) => fs.existsSync(path.join(outDir, p));
    const add = (name, ok, detail) => checks.push({ name, status: ok ? 'pass' : 'fail', ...(detail ? { detail } : {}) });

    add('assembled: package.json + src present', has('package.json') && has('src'));
    if (viaAssembler) {
      let configApplied = false;
      try { configApplied = fs.readFileSync(path.join(outDir, 'src/config/site.ts'), 'utf-8').includes(site.config.siteName); } catch { /* fails below */ }
      add('per-client config written (site name in site.ts)', configApplied);
      add('theme.css present', has('src/app/theme.css'));
      let contrastOk = false; let detail;
      try {
        execFileSync(process.execPath, [path.join(engineDir, 'd4-site-builder', 'bin', 'validate-contrast.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
        contrastOk = true;
      } catch (e) {
        detail = String(e.stdout || '').split('\n').filter((l) => l.includes('FAIL')).slice(0, 2).join('; ') || undefined;
      }
      add('WCAG contrast (validated palettes)', contrastOk, detail);
    }
    add('routes declared', Object.keys(assemblyRecord.routes || {}).length > 0);

    const passed = checks.every((c) => c.status === 'pass');
    job.result = {
      workspace: `workspaces/${job.siteId}`,
      engine: 'real',
      exportable: true,
      files: countFiles(outDir),
      assembly: {
        imported: Boolean(assemblyRecord.imported),
        modules: assemblyRecord.modules || {},
        routes: Object.keys(assemblyRecord.routes || {}),
      },
      qa: { mode: 'structural', verdict: passed ? 'passed' : 'failed', checks },
    };
    log(job, `QA (structural): ${passed ? 'PASSED' : 'FAILED'} — ${checks.filter((c) => c.status === 'pass').length}/${checks.length} checks.`);
    if (!passed) throw new Error('QA failed: ' + checks.filter((c) => c.status === 'fail').map((c) => c.name).join(', '));
  }

  async function assembleDry(job, site) {
    log(job, `Resolving template ${site.templateId}.`);
    await sleep(25);
    const modules = Array.isArray(site.config.modules) ? site.config.modules : [];
    log(job, `Config parsed: siteName "${site.config.siteName}", ${modules.length} module(s).`);
    await sleep(25);

    // Resolve asset compartments → their exact target paths in the site.
    // The dry marker records the slotting; the real engine copies the files.
    const slotting = assets ? assets.slotting(job.siteId) : {};
    const slotted = Object.values(slotting).reduce((n, arr) => n + arr.length, 0);
    if (slotted) log(job, `Assets slotted: ${slotted} file(s) across ${Object.keys(slotting).length} compartment(s).`);

    const workspace = store.path('workspaces', job.siteId);
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(
      store.path('workspaces', job.siteId, 'd4.assembly.json'),
      JSON.stringify(
        {
          engine: 'dry',
          template: site.templateId,
          modules,
          config: site.config,
          assets: slotting,
          assembledAt: new Date().toISOString(),
          jobId: job.id,
        },
        null,
        2
      )
    );
    log(job, 'Assembled (dry): workspace marker written; no real site generated.');
    await sleep(25);

    const checks = ['routes render', 'internal links', 'console errors', 'axe accessibility', 'mobile overflow'];
    job.result = {
      workspace: `workspaces/${job.siteId}`,
      qa: {
        mode: 'dry',
        verdict: 'skipped',
        checks: checks.map((name) => ({ name, status: 'skipped (dry engine)' })),
      },
    };
    log(job, 'QA battery skipped (dry engine) — recorded as skipped, never as passed.');
  }

  const EXECUTORS = { assemble };

  // Requeue anything interrupted by a restart.
  for (const id of store.listIds('jobs')) {
    const job = get(id);
    if (job && (job.status === 'queued' || job.status === 'running')) {
      job.status = 'queued';
      save(job);
      queue.push(id);
    }
  }
  setImmediate(tick);

  return { enqueue, get };
}
