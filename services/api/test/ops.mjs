/**
 * Ops/monitoring checks — driven directly, with a fake clock, a fake mailer,
 * and a fake build queue, so the whole watchdog is exercised in milliseconds
 * and nothing leaves the machine.
 *
 * What these are really testing is judgement, not plumbing: that a brief spike
 * does NOT alert, that a real condition does, that it is not repeated every
 * minute, that recovery is reported, and that the debounce survives the crash
 * loop it exists to describe.
 *
 * Run: node services/api/test/ops.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VarStore } from '../lib/store.mjs';
import { createOps } from '../lib/ops.mjs';

const MIN = 60_000;
// Where alerts would really go. The recipient is env, not a constructor
// argument, because that is how the operator configures it in production.
process.env.STARDRIVE_ALERT_TO = 'ops@example.test';

let failures = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log(`  ok    ${name}`),
  (e) => { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
);

/** A fresh ops with its own store, clock, mailbox, and queue reading. */
function rig({ configured = true, queue = {} } = {}) {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stardrive-ops-'));
  const store = new VarStore(varDir);
  const sent = [];
  const email = { configured: () => configured, send: async (m) => { sent.push(m); return { sent: true }; } };
  const clock = { t: Date.UTC(2026, 0, 1) };
  let stats = { concurrency: 2, active: 0, queued: 0, accountsWaiting: 0, diskFreeMb: 50_000, diskOk: true, oldestActiveMs: 0, ...queue };
  // Fake pids and a fake liveness probe, so a whole restart history can be
  // played out inside one process.
  const dead = new Set();
  let nextPid = 1000;
  const build = () => createOps(store, {
    email, sample: () => stats, now: () => clock.t,
    pid: (nextPid += 1), alive: (p) => !dead.has(p),
  });
  const ops = build();
  return {
    ops, store, sent, clock, varDir,
    set: (patch) => { stats = { ...stats, ...patch }; },
    advance: (ms) => { clock.t += ms; },
    // Re-open the same store as a new process would. `died` says whether the
    // process it replaces is gone (a crash) or still running (another instance).
    restart: ({ died = true } = {}) => { if (died) dead.add(nextPid); return build(); },
  };
}

const actions = (results) => Object.fromEntries(results.map((r) => [r.name, r.action]));

console.log('ops:');

await check('with no mail provider it still watches, and says why it cannot alert', async () => {
  const r = rig({ configured: false, queue: { diskOk: false, diskFreeMb: 200 } });
  const res = actions(await r.ops.checkNow());
  assert.strictEqual(res.disk_low, 'alerted', 'the condition is still detected and recorded');
  assert.strictEqual(r.sent.length, 0, 'but nothing is sent');
  const snap = r.ops.snapshot();
  assert.strictEqual(snap.alerting.configured, false);
  assert.strictEqual(snap.alerting.reason, 'email_unconfigured');
  assert.strictEqual(snap.alerts[0].name, 'disk_low', 'and an operator can still read it at /v1/ops');
  assert.strictEqual(r.ops.degraded(), true);
});

await check('a mail provider with nobody to mail is reported as such', () => {
  const saved = process.env.STARDRIVE_ALERT_TO;
  delete process.env.STARDRIVE_ALERT_TO;
  try {
    const s = rig().ops.snapshot();
    assert.strictEqual(s.alerting.configured, false);
    assert.strictEqual(s.alerting.reason, 'no_recipient');
  } finally { process.env.STARDRIVE_ALERT_TO = saved; }
});

await check('a full disk alerts at once: waiting five minutes would not un-fill it', async () => {
  const r = rig({ queue: { diskOk: false, diskFreeMb: 180 } });
  assert.strictEqual(actions(await r.ops.checkNow()).disk_low, 'alerted');
  assert.strictEqual(r.sent.length, 1);
  assert.match(r.sent[0].subject, /Low disk: 180 MB free/);
  assert.match(r.sent[0].text, /STARDRIVE_PRUNE_BUILDS=1/, 'the alert says what to do about it');
});

await check('a deep queue is watched first and only alerts once it persists', async () => {
  const r = rig({ queue: { queued: 30, active: 2 } });
  assert.strictEqual(actions(await r.ops.checkNow()).queue_deep, 'watching', 'a batch of 30 is normal for a moment');
  assert.strictEqual(r.sent.length, 0);
  r.advance(2 * MIN);
  assert.strictEqual(actions(await r.ops.checkNow()).queue_deep, 'watching', 'still inside the sustain window');
  r.advance(4 * MIN);
  assert.strictEqual(actions(await r.ops.checkNow()).queue_deep, 'alerted');
  assert.strictEqual(r.sent.length, 1);
  assert.match(r.sent[0].subject, /queue is 30 deep/);
});

await check('a queue that drains before the window never alerts at all', async () => {
  const r = rig({ queue: { queued: 30, active: 2 } });
  await r.ops.checkNow();
  r.advance(2 * MIN);
  r.set({ queued: 0, active: 0 });
  const res = actions(await r.ops.checkNow());
  assert.strictEqual(res.queue_deep, 'recovered', 'the watch is dropped');
  assert.strictEqual(r.sent.length, 0, 'and no recovery note either, because nothing was ever sent');
  assert.deepStrictEqual(r.ops.activeAlerts(), []);
});

await check('an alert is not repeated every minute, and recovery is reported once', async () => {
  const r = rig({ queue: { diskOk: false, diskFreeMb: 100 } });
  await r.ops.checkNow();
  r.advance(MIN);
  assert.strictEqual(actions(await r.ops.checkNow()).disk_low, 'debounced');
  r.advance(30 * MIN);
  assert.strictEqual(actions(await r.ops.checkNow()).disk_low, 'debounced');
  assert.strictEqual(r.sent.length, 1, 'one email for one ongoing condition');
  r.advance(7 * 3600_000);
  assert.strictEqual(actions(await r.ops.checkNow()).disk_low, 'alerted', 'after six hours it is worth saying again');
  assert.strictEqual(r.sent.length, 2);
  r.set({ diskOk: true, diskFreeMb: 40_000 });
  assert.strictEqual(actions(await r.ops.checkNow()).disk_low, 'recovered');
  assert.strictEqual(r.sent.length, 3);
  assert.match(r.sent[2].subject, /^\[Stardrive\] Recovered:/);
  assert.strictEqual(r.ops.degraded(), false);
});

await check('a stalled queue (work waiting, nothing running) is its own alarm', async () => {
  const r = rig({ queue: { queued: 3, active: 0 } });
  assert.strictEqual(actions(await r.ops.checkNow()).queue_stalled, 'watching');
  r.advance(6 * MIN);
  assert.strictEqual(actions(await r.ops.checkNow()).queue_stalled, 'alerted');
  assert.match(r.sent[0].text, /watching a spinner/);
});

await check('a build wedged for 45 minutes is reported without waiting any longer', async () => {
  const r = rig({ queue: { active: 1, queued: 0, oldestActiveMs: 50 * MIN } });
  assert.strictEqual(actions(await r.ops.checkNow()).build_stuck, 'alerted');
  assert.match(r.sent[0].subject, /running 50 min/);
});

await check('a burst of 5xx alerts, and the last few are named in the email', async () => {
  const r = rig();
  for (let i = 0; i < 9; i += 1) r.ops.noteResponse({}, { statusCode: 500 });
  assert.strictEqual(actions(await r.ops.checkNow()).errors_spiking, undefined, 'nine is under the line');
  r.ops.noteError(Object.assign(new Error('boom'), { status: 500, code: 'internal' }), { method: 'POST', url: '/v1/sites/abc/assemble' });
  r.ops.noteResponse({}, { statusCode: 500 });
  assert.strictEqual(actions(await r.ops.checkNow()).errors_spiking, 'alerted');
  assert.match(r.sent[0].text, /POST \/v1\/sites\/abc\/assemble\s+internal: boom/);
});

await check('the error window slides: an old burst does not alert forever', async () => {
  const r = rig();
  for (let i = 0; i < 12; i += 1) r.ops.noteResponse({}, { statusCode: 500 });
  assert.strictEqual(actions(await r.ops.checkNow()).errors_spiking, 'alerted');
  r.advance(20 * MIN);
  assert.strictEqual(actions(await r.ops.checkNow()).errors_spiking, 'recovered');
  assert.strictEqual(r.ops.snapshot().requests.serverErrorsLast15m, 0);
});

await check('request counters split client mistakes from our failures', () => {
  const r = rig();
  r.ops.noteResponse({}, { statusCode: 200 });
  r.ops.noteResponse({}, { statusCode: 404 });
  r.ops.noteResponse({}, { statusCode: 401 });
  r.ops.noteResponse({}, { statusCode: 503 });
  const s = r.ops.snapshot().requests;
  assert.strictEqual(s.requests, 4);
  assert.strictEqual(s.clientErrors, 2);
  assert.strictEqual(s.serverErrors, 1);
});

await check('recorded errors drop the query string, which is where the tokens are', () => {
  const r = rig();
  r.ops.noteError(Object.assign(new Error('nope'), { status: 400, code: 'bad_request' }),
    { method: 'GET', url: '/auth/verify?token=deadbeefdeadbeef' });
  const [e] = r.ops.snapshot().recentErrors;
  assert.strictEqual(e.path, '/auth/verify');
  assert.strictEqual(JSON.stringify(r.ops.snapshot()).includes('deadbeef'), false, 'the token is nowhere in the ops view');
});

await check('the error ring is bounded, so a bad hour cannot eat the heap', () => {
  const r = rig();
  for (let i = 0; i < 200; i += 1) r.ops.noteError(new Error(`e${i}`), { method: 'GET', url: '/v1/x' });
  const errs = r.ops.snapshot().recentErrors;
  assert.strictEqual(errs.length, 50);
  assert.strictEqual(errs[0].message, 'e199', 'newest first');
});

await check('telemetry never throws, whatever it is handed', () => {
  const r = rig();
  assert.doesNotThrow(() => r.ops.noteResponse(null, {}));
  assert.doesNotThrow(() => r.ops.noteError('a bare string'));
  assert.doesNotThrow(() => r.ops.noteError(null, null));
  assert.strictEqual(r.ops.snapshot().recentErrors.length, 2);
});

await check('the debounce survives a restart, because a crash loop is what it is for', async () => {
  const r = rig({ queue: { diskOk: false, diskFreeMb: 90 } });
  await r.ops.checkNow();
  assert.strictEqual(r.sent.length, 1);
  const reborn = r.restart(); // same store, new process
  r.advance(MIN);
  assert.strictEqual(actions(await reborn.checkNow()).disk_low, 'debounced');
  assert.strictEqual(r.sent.length, 1, 'the new process does not re-send what the old one already said');
});

await check('five starts in an hour, each replacing a dead process, is a crash loop', async () => {
  const r = rig();
  r.ops.noteBoot();
  for (let i = 0; i < 3; i += 1) { r.advance(MIN); r.restart().noteBoot(); }
  assert.strictEqual(r.sent.length, 0, 'a few restarts are just deploys');
  r.advance(MIN);
  assert.strictEqual(r.restart().noteBoot(), 5);
  await new Promise((res) => setImmediate(res)); // fire() is fire-and-forget
  assert.strictEqual(r.sent.length, 1);
  assert.match(r.sent[0].subject, /Restart loop: 5 starts/);
  assert.match(r.sent[0].text, /4 of them replacing a process that died/);
});

await check('instances that are still running are not crashes, however many there are', async () => {
  const r = rig();
  r.ops.noteBoot();
  for (let i = 0; i < 8; i += 1) { r.advance(2_000); assert.strictEqual(r.restart({ died: false }).noteBoot(), 1); }
  assert.strictEqual(r.sent.length, 0, 'eight live instances sharing a store is a deployment, not a loop');
});

await check('a clean shutdown is not a crash, so orderly restarts stay quiet', async () => {
  const r = rig();
  let cur = r.ops;
  cur.noteBoot();
  for (let i = 0; i < 8; i += 1) {
    assert.strictEqual(cur.noteCleanExit(), true);
    r.advance(MIN);
    cur = r.restart();
    assert.strictEqual(cur.noteBoot(), 1, 'each predecessor said goodbye properly');
  }
  assert.strictEqual(r.sent.length, 0);
});

await check('old boots age out, so yesterday cannot look like a loop', async () => {
  const r = rig();
  r.ops.noteBoot();
  for (let i = 0; i < 6; i += 1) { r.advance(20 * MIN); r.restart().noteBoot(); }
  assert.strictEqual(r.sent.length, 0, 'a restart every twenty minutes is not a loop');
  r.advance(6 * 3600_000);
  assert.strictEqual(r.restart().noteBoot(), 1, 'only this one is inside the hour');
});

await check('an event alert ages out of the view: last week\'s crash is not today\'s problem', async () => {
  const r = rig();
  await r.ops.noteFatal('uncaughtException', new Error('boom'));
  assert.strictEqual(r.ops.degraded(), true, 'right after a crash, something is wrong');
  r.advance(7 * 3600_000);
  assert.deepStrictEqual(r.ops.activeAlerts(), [], 'six hours later it is history, not a live alarm');
  assert.strictEqual(r.ops.degraded(), false);
});

await check('a test alert never makes the deployment read as degraded', async () => {
  const r = rig();
  await r.ops.testAlert();
  assert.strictEqual(r.sent.length, 1);
  assert.strictEqual(r.ops.degraded(), false);
  assert.deepStrictEqual(r.ops.activeAlerts(), []);
});

await check('a crash is recorded and mailed with its stack', async () => {
  const r = rig();
  const err = Object.assign(new Error('cannot read properties of undefined'), { stack: 'Error: x\n  at boom (server.mjs:1:1)' });
  await r.ops.noteFatal('uncaughtException', err);
  assert.strictEqual(r.sent.length, 1);
  assert.match(r.sent[0].subject, /Crash: uncaughtException/);
  assert.match(r.sent[0].text, /at boom \(server\.mjs:1:1\)/);
  assert.strictEqual(r.ops.snapshot().recentErrors[0].code, 'uncaughtException');
});

await check('the test alert ignores the debounce, because that is the whole point', async () => {
  const r = rig();
  await r.ops.testAlert();
  await r.ops.testAlert();
  assert.strictEqual(r.sent.length, 2);
  assert.match(r.sent[0].subject, /Test alert/);
});

await check('the snapshot is a whole picture: uptime, queue, disk, and what is watched', () => {
  const r = rig({ queue: { queued: 4, active: 2, diskFreeMb: 12_345 } });
  r.advance(90_000);
  const s = r.ops.snapshot();
  assert.strictEqual(s.uptimeSec, 90);
  assert.strictEqual(s.builds.queued, 4);
  assert.strictEqual(s.builds.diskFreeMb, 12_345, 'free disk lives here, not on public health');
  assert.deepStrictEqual(s.alerting.watching,
    ['disk_low', 'queue_stalled', 'queue_deep', 'build_stuck', 'errors_spiking']);
});

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll ops checks passed.');
