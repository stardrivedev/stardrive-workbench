/**
 * Batch Building — the Agency tier's flagship perk.
 *
 * One submitted BATCH of N builds becomes 2N requests on the model provider's
 * Batch API (per build: the template DESIGN on the Studio model + the site
 * COPY on the copywriter model, ~half the token price, async up to 24h). A
 * reconciler polls open batches; when the provider completes, each build runs
 * the SAME pipeline an interactive build does — parse the FILE blocks, autofix
 * + validate + import the template, normalize the copy pack, create the site,
 * enqueue the deterministic assemble (no live model call left) — and lands
 * `ready` with a siteId. A build failing any stage is marked `failed` with the
 * stage + reason and NEVER sinks the rest of the batch; the user can then
 * "generate now" (run that one build immediately on the live model) or
 * "requeue" it into a per-account backlog that pre-fills the next batch.
 *
 * File-backed like everything else: batches/{id}.json, backlog under
 * batches/backlog/{account}.json — restarts resume cleanly (the provider
 * batch keeps running server-side regardless).
 */
import crypto from 'node:crypto';
import { studioConfig, copyModel, relayChat, realBatchProvider } from './chat-proxy.mjs';
import { designSystemPrompt, parseGeneratedBundle, modulesForFeatures, FEATURES } from './studio-bundle.mjs';
import { copyPromptFor, packFromText, generateCopy } from './copy-gen.mjs';
import { validateBundle, autofixManifest, autofixTemplateFiles } from './templates.mjs';

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export const MAX_BATCH_BUILDS = 20;
const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));
const TERMINAL = new Set(['ready', 'failed', 'requeued']);

/** Validate one build spec from the wire → the stored spec shape. */
function normalizeSpec(raw, i) {
  const bad = (m) => { throw httpError(422, 'bad_build', `builds[${i}]: ${m}`); };
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) bad('must be an object.');
  const name = String(raw.name ?? '').trim();
  const siteName = String(raw.siteName ?? '').trim();
  const prompt = String(raw.prompt ?? '').trim();
  if (!name) bad('name (the template name) is required.');
  if (!siteName) bad('siteName is required.');
  if (!prompt || prompt.length > 20_000) bad('prompt is required (max 20k chars).');
  const features = Array.isArray(raw.features) ? raw.features.filter((f) => FEATURE_IDS.has(f)) : [];
  const facts = raw.facts != null && typeof raw.facts === 'object' && !Array.isArray(raw.facts) ? raw.facts : {};
  return { name, siteName, prompt, features, facts };
}

export function createBatches(store, { runner, imported, catalog, accounts, email, authMeter, provider = null, relay = relayChat } = {}) {
  const batchPath = (id) => `batches/${id}.json`;
  const backlogPath = (account) => `batches/backlog/${account}.json`;
  const providerOf = () => provider || realBatchProvider();

  const save = (b) => { b.updatedAt = new Date().toISOString(); store.writeJson(batchPath(b.id), b); };
  const get = (id) => store.readJson(batchPath(id));

  function meter(batch, name, n = 1) {
    try { if (batch.keyId && authMeter) authMeter(batch.keyId, name, n); } catch { /* metering never breaks a build */ }
  }

  /* ── submit ─────────────────────────────────────────────────────────── */

  async function submit(account, keyId, rawBuilds) {
    if (!Array.isArray(rawBuilds) || !rawBuilds.length) {
      throw httpError(400, 'bad_request', 'Body must be { builds: [ { name, prompt, siteName, features?, facts? }, … ] }.');
    }
    if (rawBuilds.length > MAX_BATCH_BUILDS) {
      throw httpError(422, 'too_many_builds', `A batch holds at most ${MAX_BATCH_BUILDS} builds (got ${rawBuilds.length}).`);
    }
    const specs = rawBuilds.map(normalizeSpec);
    const requests = [];
    const builds = specs.map((s, i) => {
      const modules = modulesForFeatures(s.features);
      requests.push({
        customId: `b${i}-design`,
        model: studioConfig().model,
        system: designSystemPrompt(s.features),
        messages: [{ role: 'user', content: s.prompt }],
      });
      const cp = copyPromptFor({ siteName: s.siteName, facts: s.facts, modules });
      requests.push({
        customId: `b${i}-copy`,
        model: copyModel(),
        system: cp.system,
        messages: [{ role: 'user', content: cp.user }],
        maxTokens: 8000,
      });
      return { customId: `b${i}`, ...s, modules, status: 'generating', stage: null, error: null, templateName: null, siteId: null, jobId: null, tokens: 0 };
    });

    const { providerBatchId } = await providerOf().submit(requests);
    const batch = {
      id: crypto.randomUUID(),
      account,
      keyId: keyId || null,
      status: 'in_progress',
      providerBatchId,
      outputsProcessed: false,
      builds,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    };
    save(batch);
    // Submitted backlog entries are consumed (matched by template name).
    const names = new Set(specs.map((s) => s.name));
    const backlog = store.readJson(backlogPath(account), []);
    const kept = backlog.filter((s) => !names.has(s.name));
    if (kept.length !== backlog.length) store.writeJson(backlogPath(account), kept);
    return batch;
  }

  /* ── the finish pipeline (shared by reconcile + generate-now) ───────── */

  /** Design text + copy pack → imported template + created site + assemble job. */
  function finishBuild(batch, build, designText, pack) {
    build.stage = 'import';
    const bundle = parseGeneratedBundle(designText, build.name);
    const mf = autofixManifest(bundle.manifest);
    const repaired = autofixTemplateFiles(bundle.files);
    const fixed = { manifest: mf.manifest, files: repaired.files };
    const v = validateBundle(fixed);
    if (!v.ok) throw new Error(`Template rejected: ${v.errors.slice(0, 3).join(' | ')}`);
    if (catalog && catalog.has(fixed.manifest.name)) {
      throw new Error(`"${fixed.manifest.name}" is a first-party catalog name — pick another template name.`);
    }
    const { name } = imported.put(batch.account, fixed, [...mf.fixes.map((f) => `manifest: ${f}`), ...repaired.fixes, ...v.warnings]);
    build.templateName = name;

    build.stage = 'assemble';
    const site = {
      id: crypto.randomUUID(),
      account: batch.account,
      templateId: name,
      config: { siteName: build.siteName, modules: build.modules },
      parse: null,
      content: build.facts,
      copy: pack,
      configHistory: [],
      jobs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const job = runner.enqueue('assemble', site.id, batch.account);
    site.jobs.push(job.id);
    store.writeJson(`sites/${site.id}.json`, site);
    build.siteId = site.id;
    build.jobId = job.id;
    build.status = 'assembling';
    build.stage = null;
  }

  function failBuild(build, stage, err) {
    build.status = 'failed';
    build.stage = stage;
    build.error = String(err?.message || err).slice(0, 500);
  }

  /* ── reconcile ──────────────────────────────────────────────────────── */

  function maybeFinishBatch(batch) {
    if (batch.status !== 'in_progress') return;
    if (!batch.builds.every((b) => TERMINAL.has(b.status))) return;
    batch.status = 'ready';
    batch.finishedAt = new Date().toISOString();
    const ready = batch.builds.filter((b) => b.status === 'ready').length;
    const failed = batch.builds.filter((b) => b.status === 'failed').length;
    const acct = accounts?.getAccount?.(batch.account);
    if (acct?.email && email) {
      email.send({
        to: acct.email,
        subject: `Your Stardrive batch is done: ${ready} site(s) ready${failed ? `, ${failed} need attention` : ''}`,
        text: `Batch ${batch.id} finished.\n\n${batch.builds.map((b) => `- ${b.name}: ${b.status}${b.error ? ` (${b.error})` : ''}`).join('\n')}\n\nOpen the Workbench Batch tab to publish the finished sites${failed ? ' and retry the failed ones (Generate now, or add them to your next batch)' : ''}.`,
      });
    }
  }

  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      for (const id of store.listIds('batches')) {
        const batch = get(id);
        if (!batch || batch.status !== 'in_progress') continue;
        try {
          await reconcileOne(batch);
        } catch (e) {
          // A transient provider error just leaves the batch for the next tick.
          if (process.env.STARDRIVE_DEBUG) console.error(`batch ${id} reconcile: ${e.message}`);
        }
      }
    } finally {
      reconciling = false;
    }
  }

  async function reconcileOne(batch) {
    const prov = providerOf();
    // 1. Collect provider outputs once, when the provider batch completes.
    if (!batch.outputsProcessed) {
      const p = await prov.poll(batch.providerBatchId);
      if (['failed', 'expired', 'cancelled'].includes(p.status)) {
        for (const b of batch.builds) if (b.status === 'generating') failBuild(b, 'design', `Provider batch ${p.status}.`);
        batch.outputsProcessed = true;
        maybeFinishBatch(batch);
        save(batch);
        return;
      }
      if (p.status !== 'completed') { save(batch); return; } // still running
      const out = { ...(p.errorFileId ? await prov.outputs(p.errorFileId) : {}), ...(p.outputFileId ? await prov.outputs(p.outputFileId) : {}) };
      for (const build of batch.builds) {
        if (build.status !== 'generating') continue;
        const design = out[`${build.customId}-design`];
        const copyRow = out[`${build.customId}-copy`];
        if (!design || design.error || !design.content) {
          failBuild(build, 'design', design?.error || 'The provider returned no design output for this build.');
          continue;
        }
        // Copy degrades to the deterministic heuristic pack; never fails a build.
        const pack = packFromText(copyRow?.content || '', { siteName: build.siteName, facts: build.facts });
        build.tokens = (design.tokens || 0) + (copyRow?.tokens || 0);
        try {
          finishBuild(batch, build, design.content, pack);
          meter(batch, 'studio.generations');
          if (build.tokens) meter(batch, 'studio.tokens', build.tokens);
        } catch (e) {
          failBuild(build, build.stage || 'import', e);
        }
      }
      batch.outputsProcessed = true;
      save(batch);
    }
    // 2. Promote assembling builds as their (local) assemble jobs finish.
    let changed = false;
    for (const build of batch.builds) {
      if (build.status !== 'assembling' || !build.jobId) continue;
      const job = runner.get(build.jobId);
      if (!job) continue;
      if (job.status === 'done') { build.status = 'ready'; changed = true; }
      else if (job.status === 'failed') {
        failBuild(build, 'assemble', job.logs?.at(-1)?.line || 'Assembly failed.');
        changed = true;
      }
    }
    maybeFinishBatch(batch);
    if (changed || batch.status !== 'in_progress') save(batch);
  }

  /* ── failed-build recovery ──────────────────────────────────────────── */

  function findBuild(account, batchId, customId) {
    const batch = get(batchId);
    if (!batch || batch.account !== account) throw httpError(404, 'not_found', `Batch ${batchId} not found.`);
    const build = batch.builds.find((b) => b.customId === customId);
    if (!build) throw httpError(404, 'not_found', `Build ${customId} not found in this batch.`);
    return { batch, build };
  }

  const specOf = (b) => ({ name: b.name, siteName: b.siteName, prompt: b.prompt, features: b.features, facts: b.facts });

  /** "Add to next batch": the failed build's spec joins the account backlog. */
  function requeue(account, batchId, customId) {
    const { batch, build } = findBuild(account, batchId, customId);
    if (build.status !== 'failed') throw httpError(409, 'not_failed', 'Only a failed build can be added to the next batch.');
    const backlog = store.readJson(backlogPath(account), []);
    backlog.push(specOf(build));
    store.writeJson(backlogPath(account), backlog);
    build.status = 'requeued';
    maybeFinishBatch(batch);
    save(batch);
    return { backlogged: backlog.length };
  }

  /** "Generate now": run this one failed build immediately on the LIVE model. */
  function generateNow(account, batchId, customId) {
    const { batch, build } = findBuild(account, batchId, customId);
    if (build.status !== 'failed') throw httpError(409, 'not_failed', 'Only a failed build can be regenerated now.');
    build.status = 'generating';
    build.stage = null;
    build.error = null;
    // Reopen a finished batch so the reconciler tracks this build to `ready`.
    batch.status = 'in_progress';
    batch.finishedAt = null;
    save(batch);
    (async () => {
      try {
        const design = await relay({ system: designSystemPrompt(build.features), messages: [{ role: 'user', content: build.prompt }] });
        meter(batch, 'studio.generations');
        if (design.tokens) meter(batch, 'studio.tokens', design.tokens);
        const copy = await generateCopy({ siteName: build.siteName, facts: build.facts, modules: build.modules });
        if (copy.tokens) meter(batch, 'studio.tokens', copy.tokens);
        finishBuild(batch, build, design.content, copy.pack);
      } catch (e) {
        failBuild(build, build.stage || 'design', e);
      }
      save(batch);
    })();
    return { status: build.status };
  }

  /* ── reads ──────────────────────────────────────────────────────────── */

  const buildView = (b) => ({
    customId: b.customId, name: b.name, siteName: b.siteName, status: b.status,
    stage: b.stage, error: b.error, templateName: b.templateName, siteId: b.siteId, jobId: b.jobId,
  });

  function list(account) {
    return store.listIds('batches')
      .map(get)
      .filter((b) => b && b.account === account)
      .sort((a, z) => z.createdAt.localeCompare(a.createdAt))
      .map((b) => ({
        id: b.id, status: b.status, createdAt: b.createdAt, finishedAt: b.finishedAt,
        counts: {
          total: b.builds.length,
          ready: b.builds.filter((x) => x.status === 'ready').length,
          failed: b.builds.filter((x) => x.status === 'failed').length,
        },
      }));
  }

  function detail(account, id) {
    const b = get(id);
    if (!b || b.account !== account) throw httpError(404, 'not_found', `Batch ${id} not found.`);
    return { id: b.id, status: b.status, createdAt: b.createdAt, finishedAt: b.finishedAt, builds: b.builds.map(buildView) };
  }

  const backlogList = (account) => store.readJson(backlogPath(account), []);

  return { submit, reconcile, list, detail, requeue, generateNow, backlogList, MAX_BATCH_BUILDS };
}
