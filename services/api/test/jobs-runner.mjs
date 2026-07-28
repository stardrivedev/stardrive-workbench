/**
 * Job runner scheduling — the properties that decide whether one busy
 * licensee can ruin everyone else's afternoon:
 *
 *   1. builds run CONCURRENTLY, up to a bounded limit;
 *   2. work is taken ROUND-ROBIN per account, so a batch of twenty cannot
 *      starve a single build queued behind it;
 *   3. two jobs for the SAME site never overlap, because they share one
 *      workspace directory and would corrupt each other.
 *
 * Driven on the dry engine so it is deterministic and takes milliseconds.
 * Each check gets its own store, because a runner re-queues interrupted jobs
 * when it starts and would otherwise inherit the previous check's work.
 *
 * Run: node services/api/test/jobs-runner.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VarStore } from '../lib/store.mjs';
import { createJobRunner } from '../lib/jobs.mjs';

const roots = [];
/** A fresh, isolated store per check. */
function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-runner-'));
  roots.push(dir);
  return new VarStore(dir);
}

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(10); }
  return cond();
};
const allDone = (runner, ids) => ids.every((id) => ['done', 'failed'].includes(runner.get(id)?.status));

console.log('job runner scheduling:');

await check('the queue is bounded: no more than `concurrency` builds run at once', async () => {
  const store = freshStore();
  const runner = createJobRunner(store, { engine: 'dry', concurrency: 2 });
  for (let i = 0; i < 6; i += 1) {
    store.writeJson(`sites/c-${i}.json`, { id: `c-${i}`, account: 'acct-1', templateId: 'd4-site-template', config: { siteName: `c${i}` }, jobs: [], configHistory: [] });
  }
  const ids = [];
  let peak = 0;
  for (let i = 0; i < 6; i += 1) ids.push(runner.enqueue('assemble', `c-${i}`, 'acct-1').id);
  // Sample the live stats while the queue drains.
  const sampler = setInterval(() => { peak = Math.max(peak, runner.stats().active); }, 2);
  await waitFor(() => allDone(runner, ids));
  clearInterval(sampler);
  assert.strictEqual(allDone(runner, ids), true, 'every job finished');
  assert.ok(peak <= 2, `never exceeded the limit (peak ${peak})`);
  assert.deepStrictEqual(runner.stats(), { concurrency: 2, active: 0, queued: 0, accountsWaiting: 0 }, 'drains to empty');
});

await check('a big batch does not starve another account queued behind it', async () => {
  const store = freshStore();
  const runner = createJobRunner(store, { engine: 'dry', concurrency: 1 });
  const mk = (id, account) => {
    store.writeJson(`sites/${id}.json`, { id, account, templateId: 'd4-site-template', config: { siteName: id }, jobs: [], configHistory: [] });
    return runner.enqueue('assemble', id, account).id;
  };
  // The agency queues twenty first; the freelancer queues one after.
  const big = [];
  for (let i = 0; i < 20; i += 1) big.push(mk(`big-${i}`, 'agency'));
  const small = mk('small-1', 'freelancer');

  await waitFor(() => runner.get(small)?.status === 'done', 8000);
  const smallJob = runner.get(small);
  assert.strictEqual(smallJob.status, 'done', 'the single build finished');
  // Fairness: it should land near the FRONT, not after all twenty. With
  // round-robin at concurrency 1 it runs second.
  const finishedBefore = big.filter((id) => {
    const j = runner.get(id);
    return j?.finishedAt && j.finishedAt < smallJob.finishedAt;
  }).length;
  assert.ok(finishedBefore <= 2, `only ${finishedBefore} of the agency's twenty ran first (round-robin, not FIFO)`);
  await waitFor(() => allDone(runner, big), 12000);
});

await check('two builds for the SAME site never overlap', async () => {
  const store = freshStore();
  const runner = createJobRunner(store, { engine: 'dry', concurrency: 4 });
  store.writeJson('sites/solo.json', { id: 'solo', account: 'acct-2', templateId: 'd4-site-template', config: { siteName: 'solo' }, jobs: [], configHistory: [] });
  const ids = [0, 1, 2].map(() => runner.enqueue('assemble', 'solo', 'acct-2').id);
  // While they drain, the same site must never be running twice over.
  let sawDouble = false;
  const sampler = setInterval(() => {
    const running = ids.filter((id) => runner.get(id)?.status === 'running').length;
    if (running > 1) sawDouble = true;
  }, 2);
  await waitFor(() => allDone(runner, ids));
  clearInterval(sampler);
  assert.strictEqual(sawDouble, false, 'one workspace, one build at a time');
  assert.strictEqual(allDone(runner, ids), true, 'and all three still completed');
});

await check('an unowned job (no account) still runs', async () => {
  const store = freshStore();
  const runner = createJobRunner(store, { engine: 'dry', concurrency: 2 });
  store.writeJson('sites/orphan.json', { id: 'orphan', account: null, templateId: 'd4-site-template', config: { siteName: 'orphan' }, jobs: [], configHistory: [] });
  const id = runner.enqueue('assemble', 'orphan', null).id;
  await waitFor(() => ['done', 'failed'].includes(runner.get(id)?.status));
  assert.strictEqual(runner.get(id).status, 'done');
});

for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll job runner checks passed.');
process.exit(0);
