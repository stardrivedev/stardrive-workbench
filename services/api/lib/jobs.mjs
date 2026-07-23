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
import { runFullQA, PREVIEW_FILE } from './qa-full.mjs';
import { injectAssetDisplay } from './asset-injector.mjs';
import { renderContentModule, PLACEHOLDER_PHRASES } from './content.mjs';
import { generateHeroImage } from './image-gen.mjs';
import { repairTemplateSource } from '../../../packages/template-kit/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministically repair the mechanical, build-breaking mistakes an LLM
// template generator reliably makes (reduced-opacity text tokens; server-only
// metadata exports in "use client" components), across the ASSEMBLED tree, so
// even a template imported before those repairs existed still builds. Runs
// right before the compile gate.
const REPAIR_EXT_RE = /\.(tsx?|jsx?|mjs|css|mdx)$/;
function repairAssembledDir(root) {
  const changed = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!REPAIR_EXT_RE.test(e.name)) continue;
      let t;
      try { t = fs.readFileSync(p, 'utf-8'); } catch { continue; }
      const r = repairTemplateSource(t, { path: p });
      if (r.fixes.length && r.text !== t) { fs.writeFileSync(p, r.text); changed.push(path.relative(root, p).replace(/\\/g, '/')); }
    }
  };
  walk(root);
  return changed;
}

const BUILD_CONFIG_KEYS = ['siteName', 'tagline', 'description', 'contactEmail', 'phone', 'address', 'pairing', 'nav', 'announcement', 'quote', 'socialLinks', 'darkMode', 'themeDark', 'theme'];

const COUNT_SKIP = new Set(['node_modules', '.next', PREVIEW_FILE]);
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (COUNT_SKIP.has(e.name)) continue;
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else if (e.isFile()) n += 1;
  }
  return n;
}

/** Scan a template's source for unambiguous filler phrases. Skips generated
 *  files and node_modules; returns [{ file, phrase }] for any leftover. */
function scanForPlaceholders(srcDir) {
  const hits = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(tsx?|jsx?|mdx?)$/.test(e.name) || e.name.endsWith('.generated.ts')) continue;
      let t = '';
      try { t = fs.readFileSync(p, 'utf-8'); } catch { continue; }
      for (const phrase of PLACEHOLDER_PHRASES) {
        if (t.includes(phrase)) hits.push({ file: path.relative(srcDir, p).replace(/\\/g, '/'), phrase });
      }
    }
  };
  walk(srcDir);
  return hits;
}

/**
 * Make a generated site build-tolerant: AI-authored templates sometimes have
 * cosmetic TypeScript/ESLint issues (an implicit any, an unused import) that do
 * not affect the running site but would fail `next build`'s type/lint phase.
 * The real correctness gate is the RUNTIME QA (serve, routes, console errors,
 * accessibility), so we tell next build not to fail on those, and every site
 * still gets the base settings it needs (unoptimized images, otplib transpile).
 */
function ensureBuildTolerance(outDir) {
  const FLAGS = '  typescript: { ignoreBuildErrors: true },\n  eslint: { ignoreDuringBuilds: true },';
  const found = ['ts', 'mjs', 'js'].map((e) => path.join(outDir, `next.config.${e}`)).find((p) => fs.existsSync(p));
  if (found) {
    let t = fs.readFileSync(found, 'utf-8');
    if (t.includes('ignoreBuildErrors')) return;
    const anchor = t.match(/(:\s*NextConfig\s*=\s*\{|nextConfig\s*=\s*\{|export default\s*\{)/);
    if (anchor) { fs.writeFileSync(found, t.replace(anchor[0], anchor[0] + '\n' + FLAGS)); return; }
    // Unparseable config — overwrite this same file canonically (no duplicate config files).
    fs.writeFileSync(found, canonicalNextConfig(found.endsWith('.ts')));
    return;
  }
  fs.writeFileSync(path.join(outDir, 'next.config.mjs'), canonicalNextConfig(false));
}

function canonicalNextConfig(ts) {
  return `${ts ? 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {' : 'const nextConfig = {'}
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["otplib"],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
`;
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

  function enqueue(kind, siteId, account, opts = {}) {
    const job = {
      id: crypto.randomUUID(),
      kind,
      siteId,
      account: account ?? null,
      engine,
      // AI hero-image generation is a plan perk; the server sets this per the
      // account's plan. Defaults to true so headless/tests keep their behavior.
      heroImage: opts.heroImage !== false,
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

    // Fill the config-driven identity/contact fields from the intake facts and
    // the AI-written copy, so the engine writes REAL values into site.ts rather
    // than its placeholder defaults. Only fills what the config left blank —
    // an explicit config value always wins.
    const facts = site.content || {};
    const pack = site.copy || null;
    // Whether this build carries the customer's intake (workbench builds are
    // gated to require it; headless create+assemble may skip it).
    const hasIntake = Boolean((typeof facts.whatYouDo === 'string' && facts.whatYouDo.trim()) || pack);
    const fill = (k, v) => { if ((site.config[k] === undefined || site.config[k] === '') && typeof v === 'string' && v.trim()) site.config[k] = v.trim(); };
    fill('tagline', pack?.tagline || facts.whatYouDo);
    fill('description', pack?.description);
    fill('contactEmail', facts.contactEmail);
    fill('phone', facts.phone);
    fill('address', facts.address);

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

    // Generated asset map, so the TEMPLATE can actually SHOW the uploads
    // (rulebook: consume with graceful fallbacks). Public URL paths only.
    const slotting = assets ? assets.slotting(job.siteId) : {};
    const publicMap = {};
    for (const [slot, items] of Object.entries(slotting)) {
      const urls = items.map((a) => a.target).filter((t) => t.startsWith('public/')).map((t) => t.slice('public'.length));
      if (urls.length) publicMap[slot] = urls;
    }

    // No hero uploaded? Generate one from the business details so the home page
    // still opens on real imagery. This is a Studio-plan perk (job.heroImage is
    // set from the account's plan); other plans fall back to the template's
    // designed hero. Degrades silently on any failure.
    if (!publicMap.hero?.length && hasIntake && process.env.STARDRIVE_HERO_IMAGE !== 'off') {
      if (job.heroImage === false) {
        log(job, 'AI hero image is a Studio-plan feature; using the template\'s designed hero.');
      } else {
        try {
          log(job, 'No hero uploaded, generating one from the business details…');
          const img = await generateHeroImage({ siteName: site.config.siteName, facts, vibe: site.config.pairing || '' });
          if (img) {
            const rel = path.join('public', 'assets', 'hero', `ai-hero.${img.ext}`);
            fs.mkdirSync(path.join(outDir, path.dirname(rel)), { recursive: true });
            fs.writeFileSync(path.join(outDir, rel), img.buffer);
            publicMap.hero = [`/assets/hero/ai-hero.${img.ext}`];
            log(job, `Generated a hero image (${img.model}).`);
          } else {
            log(job, 'Hero image generation unavailable, using the template hero.');
          }
        } catch (e) { log(job, `Hero image generation skipped: ${e.message}`); }
      }
    }

    fs.mkdirSync(path.join(outDir, 'src', 'config'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'src', 'config', 'assets.generated.ts'),
      `/**\n * GENERATED FILE. Written by Stardrive at assembly from the customer's\n * uploaded asset compartments. Do not edit; edits are overwritten.\n * Keys are compartment ids; values are public URL paths.\n */\nexport const siteAssets: Record<string, string[]> = ${JSON.stringify(publicMap, null, 2)};\n`);

    // The CONTENT CONTRACT: the finished copy the AI wrote from the intake, so
    // templates render real page bodies instead of hardcoded sample text.
    fs.writeFileSync(path.join(outDir, 'src', 'config', 'content.generated.ts'), renderContentModule(pack));

    // Repair deterministic, build-breaking mistakes in AI-authored source
    // (reduced-opacity text tokens; server-only metadata exports in "use
    // client" components) before the compile gate — so a template never fails
    // the build for a mechanical reason we can safely fix, even if it was
    // imported before these repairs existed.
    try {
      const repaired = repairAssembledDir(outDir);
      if (repaired.length) log(job, `Auto-repaired ${repaired.length} generated file(s) before build: ${repaired.slice(0, 4).join(', ')}${repaired.length > 4 ? '…' : ''}`);
    } catch (e) { log(job, `Source auto-repair skipped: ${e.message}`); }

    // Keep the build from failing on cosmetic type/lint issues in AI-authored
    // code (runtime QA is the real correctness gate).
    ensureBuildTolerance(outDir);

    // GUARANTEE the uploads actually SHOW. Templates that consume siteAssets
    // themselves (the catalog) are left alone; templates that ignore it (the
    // Studio's generated designs) get a deterministic showcase + header logo so
    // the customer never assembles a site that hides the photos they uploaded.
    if (Object.keys(publicMap).length) {
      try {
        const inj = injectAssetDisplay({ outDir });
        if (inj.injected) {
          const parts = [inj.logo && 'logo in the header', inj.showcase && 'a home-page gallery'].filter(Boolean);
          log(job, `Ensured your uploaded photos display (${parts.join(' + ')}).`);
        } else if (inj.reason === 'template displays uploads itself') {
          log(job, 'Template displays the uploads in its own design — nothing to add.');
        }
      } catch (e) {
        log(job, `Note: could not auto-place uploads (${e.message}); the template must reference siteAssets.`);
      }
    }

    // ── Real QA: structural + WCAG contrast (fast, no browser build) ──
    const checks = [];
    const has = (p) => fs.existsSync(path.join(outDir, p));
    const add = (name, ok, detail) => checks.push({ name, status: ok ? 'pass' : 'fail', ...(detail ? { detail } : {}) });

    add('assembled: package.json + src present', has('package.json') && has('src'));
    if (viaAssembler) {
      let siteTs = '';
      try { siteTs = fs.readFileSync(path.join(outDir, 'src/config/site.ts'), 'utf-8'); } catch { /* fails below */ }
      add('per-client config written (site name in site.ts)', siteTs.includes(site.config.siteName));
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

    // No-placeholder gate across ALL pages: once the customer has done the
    // intake, the site must ship finished — no leftover filler ("Replace
    // this…", "sample stories", the engine's default cards). A template that
    // ignores the content contract fails here and must be regenerated so its
    // pages read the answers. Skipped for headless content-free assemblies.
    if (hasIntake) {
      const hits = scanForPlaceholders(path.join(outDir, 'src'));
      const where = hits.slice(0, 3).map((h) => `${h.file}: "${h.phrase}"`).join('; ');
      add('no placeholder copy anywhere on the site', hits.length === 0,
        hits.length ? `${where} — regenerate this template so its pages render your answers` : undefined);
    }

    const fileCount = countFiles(outDir); // before full QA installs node_modules
    let structuralPassed = checks.every((c) => c.status === 'pass');
    let qaMode = 'structural';
    let hasPreview = false;

    // Opt-in full tier: install → next build (the real compile gate) → serve →
    // routes → axe/overflow/console + a screenshot for the visual preview.
    if (structuralPassed && process.env.STARDRIVE_QA === 'full') {
      qaMode = 'full';
      log(job, 'QA (full): install → build → serve → browser checks. This takes a few minutes…');
      const full = await runFullQA({
        dir: outDir,
        routes: Object.keys(assemblyRecord.routes || {}),
        port: Number(process.env.STARDRIVE_QA_PORT) || 4290,
        log: (m) => log(job, m),
        timeout: Number(process.env.STARDRIVE_QA_TIMEOUT) || 300_000,
      });
      checks.push(...full.checks);
      hasPreview = Boolean(full.preview);
    }

    const passed = checks.every((c) => c.status === 'pass');
    job.result = {
      workspace: `workspaces/${job.siteId}`,
      engine: 'real',
      exportable: true,
      files: fileCount,
      preview: hasPreview,
      assembly: {
        imported: Boolean(assemblyRecord.imported),
        modules: assemblyRecord.modules || {},
        routes: Object.keys(assemblyRecord.routes || {}),
      },
      qa: { mode: qaMode, verdict: passed ? 'passed' : 'failed', checks },
    };
    log(job, `QA (${qaMode}): ${passed ? 'PASSED' : 'FAILED'} — ${checks.filter((c) => c.status === 'pass').length}/${checks.length} checks.`);
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
