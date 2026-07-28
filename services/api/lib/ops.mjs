/**
 * Ops — the things the operator would otherwise only learn from a customer.
 *
 * Stardrive ships as ONE container with a Docker HEALTHCHECK, which is enough
 * to notice a dead process and nothing else. The failures that actually cost a
 * licensee their afternoon are quieter: the disk fills so every build dies in
 * `npm install`; the queue wedges so a batch of twenty sits at "queued"
 * forever; a bad config crash-loops the container; 500s start pouring out of
 * one route. All of those are invisible in a container log nobody is reading.
 *
 * So this keeps a little truth in memory (recent errors, request counters),
 * samples the build runner once a minute, and turns a SUSTAINED bad condition
 * into an email. Like every other capability here it is DORMANT when it cannot
 * work: with no email provider (or no STARDRIVE_ALERT_TO) the conditions are
 * still tracked and still readable at GET /v1/ops, they just cannot be pushed
 * anywhere.
 *
 * Three deliberate choices:
 *  - Most conditions must hold for a few minutes before they alert, so a queue
 *    that is briefly deep during a normal batch does not wake anyone.
 *  - Alert state is PERSISTED, because the failure that most needs an email is
 *    a crash loop, and an in-memory debounce resets on every crash.
 *  - Nothing here can fail a request. Telemetry that takes the service down
 *    with it is worse than no telemetry.
 *
 * Env: STARDRIVE_ALERT_TO       recipient (falls back to STARDRIVE_LEADS_TO)
 *      STARDRIVE_OPS_TOKEN      bearer token for GET /v1/ops
 *      STARDRIVE_QUEUE_ALERT    queued jobs that count as deep (default 25)
 */

const RECENT_ERRORS = 50;             // ring buffer size; memory, not history
const SAMPLE_MS = 60_000;             // how often the watchdog looks
const REPEAT_MS = 6 * 3_600_000;      // never re-send the same alert faster
const ERROR_WINDOW_MS = 15 * 60_000;
const ERROR_BURST = 10;               // server errors in that window
const STUCK_BUILD_MS = 45 * 60_000;   // a full-QA build is 3-5 min; 45 is wedged
const SUSTAIN_MS = 5 * 60_000;        // default "hold it for a while" window
const BOOT_WINDOW_MS = 3_600_000;
const BOOT_LIMIT = 5;                 // starts in an hour that mean crash loop
const BOOT_KEEP = 50;

const ALERTS_REL = 'ops/alerts.json';
const BOOTS_REL = 'ops/boots.json';

const QUEUE_DEEP = Number(process.env.STARDRIVE_QUEUE_ALERT) || 25;
const alertRecipient = () => process.env.STARDRIVE_ALERT_TO || process.env.STARDRIVE_LEADS_TO || null;

const mins = (ms) => Math.round(ms / 60_000);

/**
 * Is that process still running? Used to tell a CRASH loop from a run of
 * deliberate restarts: a predecessor that is still alive was never replaced,
 * it is simply another instance sharing this store (a rolling deploy, or the
 * test suite running eight servers against one var dir).
 */
function processAlive(pid) {
  if (!pid) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // exists, we just may not signal it
}

/**
 * @param store   VarStore, for the persisted alert/boot state.
 * @param email   the email seam (createEmail()); may be null.
 * @param sample  () => jobs.stats(); injected so this module never imports the
 *                runner and can be tested with a fake queue.
 * @param pid/alive  injected only so the crash-loop logic is testable in one
 *                process; production uses the real pid and a real liveness probe.
 */
export function createOps(store, {
  email = null, sample = () => ({}), now = () => Date.now(),
  pid = process.pid, alive = processAlive,
} = {}) {
  const bootAt = now();
  const startedAt = new Date(bootAt).toISOString();
  const counters = { requests: 0, clientErrors: 0, serverErrors: 0 };
  const recent = [];          // newest last, capped at RECENT_ERRORS
  const serverErrorTimes = []; // for the burst window
  let timer = null;

  const readAlerts = () => { try { return store.readJson(ALERTS_REL, {}) || {}; } catch { return {}; } };
  const writeAlerts = (s) => { try { store.writeJson(ALERTS_REL, s); } catch { /* telemetry never breaks the service */ } };

  /** Where a person can go to act on it. */
  const configured = () => Boolean(email?.configured?.() && alertRecipient());

  /**
   * Send one alert, subject to a persisted debounce. Fire-and-forget: callers
   * are watchdog ticks and crash handlers, neither of which can wait.
   */
  async function fire(name, subject, text, { force = false, persist = true } = {}) {
    const state = readAlerts();
    const rec = state[name] || {};
    const at = now();
    if (!force && rec.notifiedAt && at - rec.notifiedAt < REPEAT_MS) return { sent: false, reason: 'debounced' };
    if (persist) {
      state[name] = { ...rec, notifiedAt: at, lastSubject: subject };
      writeAlerts(state);
    }
    console.error(`[stardrive-ops] ALERT ${name}: ${subject}`);
    if (!configured()) return { sent: false, reason: 'alerting_unconfigured' };
    return email.send({
      to: alertRecipient(),
      subject: `[Stardrive] ${subject}`,
      text: `${text}\n\nHost uptime: ${mins(at - bootAt)} min (up since ${startedAt}).\nFull detail: GET /v1/ops with your STARDRIVE_OPS_TOKEN.`,
    }).catch((e) => ({ sent: false, reason: e.message }));
  }

  /** The matching "it stopped" note, sent only if the alert itself went out. */
  async function clear(name, detail) {
    const state = readAlerts();
    const rec = state[name];
    delete state[name];
    writeAlerts(state);
    if (!rec?.notifiedAt) return { sent: false, reason: 'never_alerted' };
    console.error(`[stardrive-ops] RECOVERED ${name}`);
    if (!configured()) return { sent: false, reason: 'alerting_unconfigured' };
    return email.send({
      to: alertRecipient(),
      subject: `[Stardrive] Recovered: ${rec.lastSubject || name}`,
      text: `${detail}\n\nIt was alerting for ${mins(now() - (rec.since || rec.notifiedAt))} min.`,
    }).catch((e) => ({ sent: false, reason: e.message }));
  }

  // ── What counts as trouble ─────────────────────────────────────────────

  const serverErrorsIn = (windowMs) => {
    const cutoff = now() - windowMs;
    while (serverErrorTimes.length && serverErrorTimes[0] < cutoff) serverErrorTimes.shift();
    return serverErrorTimes.length;
  };

  /**
   * Every watched condition, evaluated against one sample of the runner.
   * `sustainMs: 0` means the condition is already its own proof (a build that
   * has run for 45 minutes does not need five more to confirm it).
   */
  function conditions() {
    const s = sample() || {};
    const burst = serverErrorsIn(ERROR_WINDOW_MS);
    const queued = Number(s.queued) || 0;
    const active = Number(s.active) || 0;
    const oldest = Number(s.oldestActiveMs) || 0;
    return [
      {
        name: 'disk_low', active: s.diskOk === false, sustainMs: 0,
        subject: `Low disk: ${s.diskFreeMb} MB free`,
        detail: `The state volume is down to ${s.diskFreeMb} MB free and new builds are being refused rather than risking a half-written workspace.`
          + `\n\nFix: delete finished sites, or set STARDRIVE_PRUNE_BUILDS=1 so dependencies and compile output are reclaimed after every build.`,
      },
      {
        name: 'queue_stalled', active: queued > 0 && active === 0, sustainMs: SUSTAIN_MS,
        subject: `Build queue stalled (${queued} waiting, none running)`,
        detail: `${queued} build(s) are queued and nothing is running. Work is not being taken off the queue, so every one of those customers is watching a spinner.`,
      },
      {
        name: 'queue_deep', active: queued >= QUEUE_DEEP, sustainMs: SUSTAIN_MS,
        subject: `Build queue is ${queued} deep`,
        detail: `${queued} builds are waiting behind ${active} running (concurrency ${s.concurrency}). At 3-5 min each this is roughly ${mins(Math.ceil(queued / Math.max(1, Number(s.concurrency) || 1)) * 4 * 60_000)} min of backlog.`
          + `\n\nRaise STARDRIVE_BUILD_CONCURRENCY only if the host has CPU and memory to match.`,
      },
      {
        name: 'build_stuck', active: oldest > STUCK_BUILD_MS, sustainMs: 0,
        subject: `A build has been running ${mins(oldest)} min`,
        detail: `The oldest running build started ${mins(oldest)} min ago. A full-QA build is normally 3-5 min, so this one is wedged (usually a hung npm install or next build) and is holding a worker slot.`,
      },
      {
        name: 'errors_spiking', active: burst >= ERROR_BURST, sustainMs: 0,
        subject: `${burst} server errors in ${mins(ERROR_WINDOW_MS)} min`,
        detail: `${burst} requests have failed with 5xx in the last ${mins(ERROR_WINDOW_MS)} minutes. The most recent:\n\n`
          + recent.filter((e) => e.status >= 500).slice(-5).map((e) => `  ${e.at}  ${e.method} ${e.path}  ${e.code}: ${e.message}`).join('\n'),
      },
    ];
  }

  /**
   * One watchdog pass. Exposed so a test can drive it without waiting on a
   * timer. Each condition re-reads its own record, because fire() and clear()
   * write the file too and a cached copy would clobber them.
   */
  async function checkNow() {
    const at = now();
    const results = [];
    for (const c of conditions()) {
      const rec = readAlerts()[c.name];
      if (!c.active) {
        if (rec) {
          await clear(c.name, `${c.subject.split(':')[0]} is back to normal.`);
          results.push({ name: c.name, action: 'recovered' });
        }
        continue;
      }
      if (!rec) {
        // First sighting. Remember when it started; alerting waits for sustain.
        const state = readAlerts();
        state[c.name] = { since: at };
        writeAlerts(state);
        if (c.sustainMs > 0) { results.push({ name: c.name, action: 'watching' }); continue; }
      }
      const since = rec?.since || at;
      if (at - since < c.sustainMs) { results.push({ name: c.name, action: 'watching' }); continue; }
      const res = await fire(c.name, c.subject, c.detail);
      if (res.reason !== 'debounced') {
        const after = readAlerts(); // fire() rewrote it; keep when it started
        if (after[c.name]) { after[c.name].since = since; writeAlerts(after); }
      }
      results.push({ name: c.name, action: res.reason === 'debounced' ? 'debounced' : 'alerted' });
    }
    return results;
  }

  // ── Recording ──────────────────────────────────────────────────────────

  /**
   * Every finished response, from the server's own `finish` event. Cheap
   * enough to do on the hot path: two integer bumps and nothing else.
   */
  function noteResponse(req, res) {
    counters.requests += 1;
    const status = res.statusCode || 0;
    if (status >= 500) { counters.serverErrors += 1; serverErrorTimes.push(now()); }
    else if (status >= 400) counters.clientErrors += 1;
  }

  /**
   * A thrown error, from the server's catch. The query string is dropped
   * deliberately: it carries email-verification tokens and checkout session
   * ids, and an ops view is not a place to leak them.
   */
  function noteError(err, req = null) {
    const status = err?.status || 500;
    recent.push({
      at: new Date(now()).toISOString(),
      status,
      code: err?.code || 'internal',
      method: req?.method || '?',
      path: String(req?.url || '?').split('?')[0].slice(0, 200),
      message: String(err?.message || err || '').slice(0, 300),
    });
    while (recent.length > RECENT_ERRORS) recent.shift();
  }

  /**
   * A crash. Recorded, alerted on, and handed back as a promise so the caller
   * can give the email a moment before letting the process die.
   */
  function noteFatal(kind, err) {
    noteError(Object.assign(new Error(String(err?.message || err)), { status: 500, code: kind }), null);
    return fire(
      'fatal',
      `Crash: ${kind}`,
      `The API process hit an ${kind} and is going down. The container should restart it.\n\n${String(err?.stack || err).slice(0, 2000)}`,
    );
  }

  /**
   * Count this start. Five in an hour is a crash loop, which is the one
   * failure an in-memory debounce could never catch: the process that would
   * remember it keeps dying.
   *
   * A predecessor only counts as a CRASH if it both died (its pid is gone) and
   * did not shut down cleanly. Without that test, five deliberate restarts,
   * or five instances sharing one store, would cry wolf just as loudly as a
   * container in a loop. Returns how many crashed starts it counted.
   */
  function noteBoot() {
    let boots = [];
    try { boots = store.readJson(BOOTS_REL, []) || []; } catch { boots = []; }
    boots = boots
      .filter((b) => b && Number.isFinite(b.at) && bootAt - b.at < 24 * BOOT_WINDOW_MS)
      .slice(-BOOT_KEEP);
    const crashed = boots.filter((b) => bootAt - b.at < BOOT_WINDOW_MS && !b.clean && !alive(b.pid));
    boots.push({ at: bootAt, pid, clean: false });
    try { store.writeJson(BOOTS_REL, boots); } catch { /* best effort */ }
    const count = crashed.length + 1; // the dead ones, plus this replacement
    if (crashed.length >= BOOT_LIMIT - 1) {
      fire('restart_loop', `Restart loop: ${count} starts in an hour`,
        `The API has started ${count} times in the last hour, ${crashed.length} of them replacing a process that died without shutting down cleanly. It is crashing and being restarted rather than running.`
        + `\n\nCheck the container log for the exception, and GET /v1/ops for the recent errors it managed to record.`);
    }
    return count;
  }

  /**
   * Record that this process is going down on purpose, so the next one does
   * not mistake an orderly restart for a crash. Synchronous: it runs from a
   * signal handler on the way to process.exit.
   */
  function noteCleanExit() {
    try {
      const boots = store.readJson(BOOTS_REL, []) || [];
      const mine = [...boots].reverse().find((b) => b && b.pid === pid && b.at === bootAt);
      if (!mine) return false;
      mine.clean = true;
      store.writeJson(BOOTS_REL, boots);
      return true;
    } catch { return false; }
  }

  // ── Reading ────────────────────────────────────────────────────────────

  /**
   * Active alerts, for the ops view and the health flag.
   *
   * Two kinds live in this file. A CONDITION (disk, queue, errors) carries a
   * `since` and stays until the watchdog sees it clear. An EVENT (a crash, a
   * restart loop) has already happened and can never "recover", so it ages out
   * of the view once it is older than the repeat window: a crash last Tuesday
   * must not leave the deployment reading as degraded forever.
   */
  function activeAlerts() {
    const state = readAlerts();
    const at = now();
    return Object.entries(state)
      .filter(([, v]) => v && (v.since || (v.notifiedAt && at - v.notifiedAt < REPEAT_MS)))
      .map(([name, v]) => ({
        name,
        since: v.since ? new Date(v.since).toISOString() : null,
        notified: Boolean(v.notifiedAt),
        subject: v.lastSubject || null,
      }));
  }

  /** True when something is wrong that a person should look at. */
  const degraded = () => activeAlerts().some((a) => a.notified);

  function snapshot() {
    const at = now();
    return {
      startedAt,
      uptimeSec: Math.round((at - bootAt) / 1000),
      requests: { ...counters, serverErrorsLast15m: serverErrorsIn(ERROR_WINDOW_MS) },
      alerting: {
        configured: configured(),
        recipient: alertRecipient(),
        reason: configured() ? null : (email?.configured?.() ? 'no_recipient' : 'email_unconfigured'),
        watching: conditions().map((c) => c.name),
      },
      alerts: activeAlerts(),
      builds: sample(),
      recentErrors: recent.slice().reverse(),
    };
  }

  /** Prove the alert path works before a real failure has to. Not persisted:
   *  a test is not a problem, and must not make the deployment read degraded. */
  const testAlert = () => fire(
    'test', 'Test alert',
    'This is a test of Stardrive alerting, sent on request from POST /v1/ops/test-alert. If you are reading it, the alert path works: provider key, sender identity, recipient.',
    { force: true, persist: false });

  function start() {
    noteBoot();
    if (timer) return;
    timer = setInterval(() => { checkNow().catch(() => {}); }, SAMPLE_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start, stop, checkNow, snapshot, degraded, activeAlerts,
    noteResponse, noteError, noteFatal, noteBoot, noteCleanExit, testAlert, configured,
  };
}
