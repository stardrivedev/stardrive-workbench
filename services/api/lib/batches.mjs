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
 * A batch build carries the SAME intake an interactive build does, because a
 * batched site ships to a client exactly like a hand-built one:
 *   - the design brief (Studio),
 *   - the feature set → engine modules (Sites),
 *   - the full FACT set content.mjs requires for those modules (Sites step 1),
 *   - the client's photos and logo (Sites step 2), staged per draft row and
 *     adopted onto the site the moment it is created.
 * Submission is READINESS-GATED per build for the same reason the interactive
 * assemble is: nothing half-finished ships, and here it also protects the
 * operator from spending a whole overnight run on a thin site.
 *
 * A DRAFT (batches/draft/{account}.json) holds the build list between visits,
 * so a 20-site stack can be filled in over a day, from any browser, without
 * losing work; submitting consumes it. File-backed like everything else:
 * batches/{id}.json, backlog under batches/backlog/{account}.json — restarts
 * resume cleanly (the provider batch keeps running server-side regardless).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { studioConfig, copyModel, relayChat, realBatchProvider } from './chat-proxy.mjs';
import { designSystemPrompt, parseGeneratedBundle, modulesForFeatures, FEATURES } from './studio-bundle.mjs';
import { copyPromptFor, packFromText, generateCopy } from './copy-gen.mjs';
import { validateBundle, autofixManifest, autofixTemplateFiles } from './templates.mjs';
import { readiness, validateFacts } from './content.mjs';

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });

export const MAX_BATCH_BUILDS = 20;
const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));
// `review` and `discarded` are terminal for the BATCH (the automated work is
// finished and the operator is emailed) even though `review` still wants a
// human. Publishing is what the review gates, not batch completion.
const TERMINAL = new Set(['ready', 'review', 'failed', 'requeued', 'discarded']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The guided design brief — the same questions the Studio asks interactively,
// kept field-by-field so a row can be reopened and edited, not just re-read as
// the prose prompt they compose into.
const BRIEF_KEYS = ['business', 'vibe', 'colors', 'audience', 'extra'];
const pickBrief = (raw) => {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of BRIEF_KEYS) {
    const v = String(src[k] ?? '').trim().slice(0, 2000);
    if (v) out[k] = v;
  }
  return out;
};

/** Validate one build spec from the wire → the stored spec shape. Throws on a
 *  malformed row; incomplete CONTENT is reported by preflight(), not here, so
 *  the operator sees every unanswered question at once. */
function normalizeSpec(raw, i) {
  const bad = (m) => { throw httpError(422, 'bad_build', `builds[${i}]: ${m}`); };
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) bad('must be an object.');
  const name = String(raw.name ?? '').trim();
  const siteName = String(raw.siteName ?? '').trim();
  const prompt = String(raw.prompt ?? '').trim();
  const tagline = String(raw.tagline ?? '').trim();
  // Build on a template the operator already has instead of designing a new
  // one: no design request at all (half the tokens), and ten franchise sites
  // come out looking like one brand.
  const templateId = String(raw.templateId ?? '').trim();
  if (!siteName) bad('siteName is required.');
  if (templateId) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(templateId)) bad('templateId must be a template name (lowercase, digits, hyphens).');
  } else {
    if (!name) bad('name (the template name) is required.');
    if (!prompt || prompt.length > 20_000) bad('prompt is required (max 20k chars).');
  }
  const features = Array.isArray(raw.features) ? raw.features.filter((f) => FEATURE_IDS.has(f)) : [];
  const facts = raw.facts != null && typeof raw.facts === 'object' && !Array.isArray(raw.facts) ? raw.facts : {};
  // A row that staged photos carries its row id so they can be adopted onto
  // the site this build creates.
  const rowId = UUID_RE.test(String(raw.rowId ?? '')) ? String(raw.rowId) : null;
  // The guided brief the prompt was composed from, kept so a retry (or a
  // duplicated row) reopens with the same answers rather than raw prose.
  const brief = pickBrief(raw.brief);
  return { rowId, name, siteName, tagline, prompt, brief, features, facts, templateId: templateId || null };
}

export function createBatches(store, { runner, imported, catalog, accounts, email, authMeter, assets = null, resolveTemplate = null, publishSite = null, provider = null, relay = relayChat } = {}) {
  const batchPath = (id) => `batches/${id}.json`;
  const backlogPath = (account) => `batches/backlog/${account}.json`;
  const draftPath = (account) => `batches/draft/${account}.json`;
  const providerOf = () => provider || realBatchProvider();

  const save = (b) => { b.updatedAt = new Date().toISOString(); store.writeJson(batchPath(b.id), b); };
  const get = (id) => store.readJson(batchPath(id));

  function meter(batch, name, n = 1) {
    try { if (batch.keyId && authMeter) authMeter(batch.keyId, name, n); } catch { /* metering never breaks a build */ }
  }

  /* ── preflight: is every build actually shippable? ───────────────────── */

  /**
   * Check the whole build list BEFORE a single provider token is spent, and
   * report every problem at once (not just the first) so the operator fixes
   * the stack in one pass. Same readiness rule as the interactive assemble.
   * Returns { specs, problems } — problems carry the row index so the UI can
   * point at the exact card. `specs` only lines up with the input when
   * `problems` is empty (a malformed row contributes a problem, not a spec),
   * which is exactly when submit() uses it.
   */
  function preflight(account, rawBuilds) {
    if (!Array.isArray(rawBuilds) || !rawBuilds.length) {
      throw httpError(400, 'bad_request', 'Body must be { builds: [ { name, prompt, siteName, features?, facts? }, … ] }.');
    }
    if (rawBuilds.length > MAX_BATCH_BUILDS) {
      throw httpError(422, 'too_many_builds', `A batch holds at most ${MAX_BATCH_BUILDS} builds (got ${rawBuilds.length}).`);
    }
    const specs = [];
    const problems = [];
    rawBuilds.forEach((raw, i) => {
      let spec;
      try {
        spec = normalizeSpec(raw, i);
      } catch (e) {
        problems.push({ index: i, name: String(raw?.name ?? '').trim(), missing: [], message: e.message });
        return;
      }
      specs.push(spec);
      // Reusing a template: it has to exist for this account and be a base
      // site template, checked now rather than hours later mid-batch.
      if (spec.templateId) {
        const entry = resolveTemplate ? resolveTemplate(account, spec.templateId) : null;
        if (!entry) {
          problems.push({ index: i, name: spec.name || spec.siteName, missing: [], message: `Template "${spec.templateId}" is not in your library.` });
          return;
        }
        if (entry.manifest?.kind !== 'site') {
          problems.push({ index: i, name: spec.name || spec.siteName, missing: [], message: `"${spec.templateId}" is a ${entry.manifest?.kind} module, not a base site template.` });
          return;
        }
      }
      const modules = modulesForFeatures(spec.features);
      const shape = validateFacts(spec.facts, modules);
      if (!shape.ok) {
        problems.push({ index: i, name: spec.name, missing: [], message: shape.errors.join(' ') });
        return;
      }
      const r = readiness(spec.facts, modules);
      if (!r.ready) {
        const labels = r.missing.map((m) => m.label);
        problems.push({
          index: i,
          name: spec.name,
          missing: labels,
          message: `Still needs: ${labels.join(', ')}.`,
        });
      }
    });
    return { specs, problems };
  }

  /* ── submit ─────────────────────────────────────────────────────────── */

  async function submit(account, keyId, rawBuilds) {
    const { specs, problems } = preflight(account, rawBuilds);
    if (problems.length) {
      throw Object.assign(
        httpError(422, 'builds_incomplete',
          `${problems.length} build(s) are missing required answers, so nothing was submitted. Batch runs cost real tokens and take hours, so every build is checked first.`),
        { builds: problems }
      );
    }
    const requests = [];
    const builds = specs.map((s, i) => {
      const modules = modulesForFeatures(s.features);
      // A row reusing an existing template needs NO design generation, only
      // its copy: half the requests, and a design that was already reviewed.
      if (!s.templateId) {
        requests.push({
          customId: `b${i}-design`,
          model: studioConfig().model,
          system: designSystemPrompt(s.features),
          messages: [{ role: 'user', content: s.prompt }],
        });
      }
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

  /** Design text (or a reused template) + copy pack → template + created site
   *  + assemble job. `designText` is null for a build reusing a template. */
  function finishBuild(batch, build, designText, pack) {
    let name = build.templateId;
    if (!name) {
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
      // Only a template this build GENERATED is its own to delete on discard.
      ({ name } = imported.put(batch.account, fixed, [...mf.fixes.map((f) => `manifest: ${f}`), ...repaired.fixes, ...v.warnings]));
      build.generatedTemplate = true;
    }
    build.templateName = name;

    build.stage = 'assemble';
    const site = {
      id: crypto.randomUUID(),
      account: batch.account,
      templateId: name,
      config: {
        siteName: build.siteName,
        ...(build.tagline ? { tagline: build.tagline } : {}),
        modules: build.modules,
      },
      parse: null,
      content: build.facts,
      copy: pack,
      // A design this batch invented has never been seen by a human, so it is
      // held back from publishing until the operator approves it. A design
      // they picked from their own library was already reviewed at import.
      review: build.generatedTemplate
        ? { state: 'pending', batchId: batch.id, customId: build.customId }
        : { state: 'approved', batchId: batch.id, customId: build.customId },
      configHistory: [],
      jobs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Photos staged on the draft row move onto the real site BEFORE the
    // assemble runs, so the first build already carries the client's images.
    if (assets && build.rowId) {
      try { build.photos = assets.adopt(build.rowId, site.id); } catch { /* photos never sink a build */ }
    }
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
    const review = batch.builds.filter((b) => b.status === 'review').length;
    const failed = batch.builds.filter((b) => b.status === 'failed').length;
    const acct = accounts?.getAccount?.(batch.account);
    if (acct?.email && email) {
      const headline = [
        review ? `${review} design(s) ready for your review` : '',
        ready ? `${ready} site(s) ready to publish` : '',
        failed ? `${failed} need attention` : '',
      ].filter(Boolean).join(', ');
      email.send({
        to: acct.email,
        subject: `Your Stardrive batch is done: ${headline || 'nothing to do'}`,
        text: `Batch ${batch.id} finished.\n\n${batch.builds.map((b) => `- ${b.name}: ${b.status}${b.error ? ` (${b.error})` : ''}`).join('\n')}\n\n`
          + (review ? `Open the Workbench Batch tab to look over the ${review} new design(s) side by side. Nothing publishes until you approve it.\n` : '')
          + (ready ? 'Approved sites can be published together from the same screen.\n' : '')
          + (failed ? 'Failed builds can be rerun now on the live model, or added to your next batch.\n' : ''),
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
        const copyRow = out[`${build.customId}-copy`];
        // A build reusing a template asked for no design, so there is no
        // design row to wait for or fail on.
        let design = null;
        if (!build.templateId) {
          design = out[`${build.customId}-design`];
          if (!design || design.error || !design.content) {
            failBuild(build, 'design', design?.error || 'The provider returned no design output for this build.');
            continue;
          }
        }
        // Copy degrades to the deterministic heuristic pack; never fails a build.
        const pack = packFromText(copyRow?.content || '', { siteName: build.siteName, facts: build.facts });
        build.tokens = (design?.tokens || 0) + (copyRow?.tokens || 0);
        try {
          finishBuild(batch, build, design?.content ?? null, pack);
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
      // A generated design goes to the operator for review before it can be
      // published; a reused template is already approved and lands ready.
      if (job.status === 'done') { build.status = build.generatedTemplate ? 'review' : 'ready'; changed = true; }
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

  // Everything a retry needs, including the row id so photos staged for the
  // original attempt (never adopted, because it never reached a site) are
  // still there when the build runs again.
  const specOf = (b) => ({
    rowId: b.rowId || null, name: b.name, siteName: b.siteName, tagline: b.tagline || '',
    prompt: b.prompt, brief: b.brief || {}, features: b.features, facts: b.facts,
    templateId: b.templateId || null,
  });

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

  /* ── design review (the publish gate) ───────────────────────────────── */

  const setSiteReview = (siteId, state) => {
    const site = store.readJson(`sites/${siteId}.json`);
    if (!site) return;
    site.review = { ...(site.review || {}), state };
    site.updatedAt = new Date().toISOString();
    store.writeJson(`sites/${siteId}.json`, site);
  };

  /** Approve one design: its site becomes publishable. */
  function approve(account, batchId, customId) {
    const { batch, build } = findBuild(account, batchId, customId);
    if (build.status !== 'review') throw httpError(409, 'not_in_review', 'Only a build waiting for review can be approved.');
    build.status = 'ready';
    setSiteReview(build.siteId, 'approved');
    save(batch);
    return { status: build.status };
  }

  /** Approve every design still waiting in this batch. */
  function approveAll(account, batchId) {
    const batch = get(batchId);
    if (!batch || batch.account !== account) throw httpError(404, 'not_found', `Batch ${batchId} not found.`);
    let approved = 0;
    for (const build of batch.builds) {
      if (build.status !== 'review') continue;
      build.status = 'ready';
      setSiteReview(build.siteId, 'approved');
      approved += 1;
    }
    if (approved) save(batch);
    return { approved };
  }

  /**
   * Reject a design: the site, its workspace, its uploads, and the template
   * this build generated all go. A template the operator picked from their
   * own library is never deleted, only the site built from it.
   */
  function discard(account, batchId, customId) {
    const { batch, build } = findBuild(account, batchId, customId);
    if (!['review', 'ready'].includes(build.status)) {
      throw httpError(409, 'not_discardable', 'Only a finished build can be discarded.');
    }
    if (build.siteId) {
      store.deleteJson(`sites/${build.siteId}.json`);
      try { assets?.discard(build.siteId); } catch { /* best effort */ }
      try { fs.rmSync(store.path('workspaces', build.siteId), { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (build.generatedTemplate && build.templateName) {
      try { imported.remove(batch.account, build.templateName); } catch { /* best effort */ }
    }
    build.status = 'discarded';
    build.siteId = null;
    save(batch);
    return { status: build.status };
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
        // Reusing a template needs no design call, live or batched.
        let designText = null;
        if (!build.templateId) {
          const design = await relay({ system: designSystemPrompt(build.features), messages: [{ role: 'user', content: build.prompt }] });
          meter(batch, 'studio.generations');
          if (design.tokens) meter(batch, 'studio.tokens', design.tokens);
          designText = design.content;
        }
        const copy = await generateCopy({ siteName: build.siteName, facts: build.facts, modules: build.modules });
        if (copy.tokens) meter(batch, 'studio.tokens', copy.tokens);
        finishBuild(batch, build, designText, copy.pack);
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
    photos: b.photos || 0, features: b.features || [],
    generatedTemplate: Boolean(b.generatedTemplate), reusedTemplate: b.templateId || null,
  });

  /* ── bulk publish ───────────────────────────────────────────────────── */

  /**
   * Publish every approved, built site in this batch. N deploys take minutes,
   * so this runs detached (the same fire-and-forget shape generateNow uses)
   * and reports progress on the batch record, which the Workbench already
   * polls. One site failing to publish never stops the rest.
   */
  function publishAll(account, batchId) {
    const batch = get(batchId);
    if (!batch || batch.account !== account) throw httpError(404, 'not_found', `Batch ${batchId} not found.`);
    if (!publishSite) throw httpError(501, 'publish_unavailable', 'Publishing is not wired up on this server.');
    if (batch.publishRun && !batch.publishRun.finishedAt) {
      throw httpError(409, 'already_running', 'A publish run is already going for this batch.');
    }
    const targets = batch.builds.filter((b) => b.status === 'ready' && b.siteId);
    const waiting = batch.builds.filter((b) => b.status === 'review').length;
    if (!targets.length) {
      throw httpError(422, 'nothing_to_publish', waiting
        ? `Nothing is approved yet. ${waiting} design(s) are waiting for your review.`
        : 'No built, approved sites in this batch to publish.');
    }
    batch.publishRun = { startedAt: new Date().toISOString(), finishedAt: null, total: targets.length, done: 0, skipped: waiting, results: [] };
    save(batch);
    (async () => {
      for (const build of targets) {
        let row;
        try {
          const res = await publishSite(account, build.siteId);
          row = { customId: build.customId, siteName: build.siteName, ok: true, url: res?.url || null };
        } catch (e) {
          row = { customId: build.customId, siteName: build.siteName, ok: false, error: String(e?.message || e).slice(0, 300) };
        }
        const fresh = get(batch.id);
        if (!fresh?.publishRun) return;
        fresh.publishRun.results.push(row);
        fresh.publishRun.done = fresh.publishRun.results.length;
        if (fresh.publishRun.done >= fresh.publishRun.total) fresh.publishRun.finishedAt = new Date().toISOString();
        save(fresh);
      }
    })();
    return { started: true, total: targets.length, skipped: waiting };
  }

  /** Site ids to include in a whole-batch export (built sites only). */
  function exportable(account, batchId) {
    const batch = get(batchId);
    if (!batch || batch.account !== account) throw httpError(404, 'not_found', `Batch ${batchId} not found.`);
    return batch.builds
      .filter((b) => b.siteId && ['ready', 'review'].includes(b.status))
      .map((b) => ({ siteId: b.siteId, siteName: b.siteName }));
  }

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
          review: b.builds.filter((x) => x.status === 'review').length,
          failed: b.builds.filter((x) => x.status === 'failed').length,
          discarded: b.builds.filter((x) => x.status === 'discarded').length,
        },
        publishRun: b.publishRun ?? null,
      }));
  }

  function detail(account, id) {
    const b = get(id);
    if (!b || b.account !== account) throw httpError(404, 'not_found', `Batch ${id} not found.`);
    return {
      id: b.id, status: b.status, createdAt: b.createdAt, finishedAt: b.finishedAt,
      builds: b.builds.map(buildView), publishRun: b.publishRun ?? null,
    };
  }

  const backlogList = (account) => store.readJson(backlogPath(account), []);

  /* ── the draft build list ───────────────────────────────────────────── */
  // A stack of 20 client sites is not filled in one sitting. The draft is the
  // build list itself, saved server-side as the operator types, so the work
  // survives a reload, a closed laptop, or a different machine — and so a
  // row's staged photos have a stable id to hang off before any site exists.

  const clip = (v, n) => String(v ?? '').slice(0, n).trim();

  /** One wire row → the stored draft row. Deliberately permissive: a draft is
   *  work in progress, so nothing here rejects an unfinished row. */
  function draftRow(raw) {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      rowId: UUID_RE.test(String(o.rowId ?? '')) ? String(o.rowId) : crypto.randomUUID(),
      name: clip(o.name, 200),
      siteName: clip(o.siteName, 200),
      tagline: clip(o.tagline, 300),
      prompt: clip(o.prompt, 20_000),
      brief: pickBrief(o.brief),
      templateId: clip(o.templateId, 64) || null,
      features: Array.isArray(o.features) ? o.features.filter((f) => FEATURE_IDS.has(f)) : [],
      facts: o.facts && typeof o.facts === 'object' && !Array.isArray(o.facts) ? o.facts : {},
    };
  }

  const readDraft = (account) => {
    const rows = store.readJson(draftPath(account), []);
    return Array.isArray(rows) ? rows : [];
  };

  /** Rows + the same readiness verdict the submit gate will apply, so the UI
   *  never has to re-implement content.mjs to show what a row still needs. */
  function draftView(account, rows = readDraft(account)) {
    const withState = rows.map((r) => {
      const modules = modulesForFeatures(r.features || []);
      const ready = readiness(r.facts || {}, modules);
      const blocked = [];
      if (!r.siteName) blocked.push('Business name');
      // A row reusing a template needs neither a new template name nor a
      // design brief: it is not designing anything.
      if (!r.templateId) {
        if (!r.name) blocked.push('Template name');
        if (!r.prompt) blocked.push('Design brief');
      }
      return {
        ...r,
        modules,
        photos: assets ? Object.values(assets.state(r.rowId)).reduce((n, items) => n + items.length, 0) : 0,
        readiness: { ...ready, blocked, submittable: ready.ready && !blocked.length },
      };
    });
    return {
      rows: withState,
      backlog: backlogList(account),
      counts: { total: withState.length, ready: withState.filter((r) => r.readiness.submittable).length },
      max: MAX_BATCH_BUILDS,
    };
  }

  function saveDraft(account, rawRows) {
    if (!Array.isArray(rawRows)) throw httpError(400, 'bad_request', 'Body must be { rows: [ … ] }.');
    if (rawRows.length > MAX_BATCH_BUILDS) {
      throw httpError(422, 'too_many_builds', `A batch holds at most ${MAX_BATCH_BUILDS} builds (got ${rawRows.length}).`);
    }
    const rows = rawRows.map(draftRow);
    // A removed row takes its staged photos with it, so uploads never leak.
    const keep = new Set(rows.map((r) => r.rowId));
    for (const old of readDraft(account)) {
      if (!keep.has(old.rowId) && UUID_RE.test(String(old.rowId)) && assets) assets.discard(old.rowId);
    }
    store.writeJson(draftPath(account), rows);
    return draftView(account, rows);
  }

  /** One draft row by id — the scope check for staging photo uploads. */
  function draftRowById(account, rowId) {
    const row = readDraft(account).find((r) => r.rowId === rowId);
    if (!row) throw httpError(404, 'not_found', `Build row ${rowId} is not in your draft — save the list first.`);
    return row;
  }

  const clearDraft = (account) => { store.deleteJson(draftPath(account)); };

  /** Submit the saved draft (the normal path from the Workbench). */
  async function submitDraft(account, keyId) {
    const rows = readDraft(account);
    if (!rows.length) throw httpError(400, 'bad_request', 'Your build list is empty — add at least one build.');
    const batch = await submit(account, keyId, rows);
    clearDraft(account); // staged photos are NOT discarded: they are being adopted
    return batch;
  }

  return {
    submit, submitDraft, preflight, reconcile, list, detail, requeue, generateNow,
    approve, approveAll, discard, publishAll, exportable,
    backlogList, draftView, saveDraft, draftRowById, clearDraft, MAX_BATCH_BUILDS,
  };
}
