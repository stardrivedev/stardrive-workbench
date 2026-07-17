/**
 * Async job framework: an in-process FIFO worker over file-backed job
 * records, with pluggable executors per job kind.
 *
 * Engines:
 *   dry  (default) — assembles a workspace MARKER (d4.assembly.json with the
 *          resolved template/modules/config) and records a skipped-QA
 *          report. Exists so the whole API lifecycle is real and testable
 *          before the real engine is wired to this service.
 *   real — pending: will invoke d4-site-builder + the verify battery in an
 *          isolated per-job workspace (docs/api-design.md, implementation
 *          notes). Selecting it fails the job with a clear message until
 *          then — never silently pretending.
 *
 * Job records survive restarts (var/jobs/); anything found queued/running
 * at boot is requeued.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createJobRunner(store, { engine = 'dry', assets = null } = {}) {
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

    if (job.engine !== 'dry') {
      throw new Error(
        'The real assembly engine is not wired to this service yet (see docs/api-design.md, implementation notes). Run with STARDRIVE_ENGINE=dry.'
      );
    }

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
