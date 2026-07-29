/**
 * Spawning the API under test, without the port lottery.
 *
 * Seven suites each had their own copy of this, and each one picked a port out
 * of a random range: 4700-4899 here, 4800-4949 there, 5000-5399 somewhere else.
 * The ranges overlapped, so two suites running near each other would sometimes
 * pick the same number and one of them would die with EADDRINUSE. It passed on
 * a re-run, which is the worst possible failure mode: it trains you to shrug at
 * a red suite.
 *
 * The fix is to stop guessing. `--port 0` asks the kernel for a free port and
 * the kernel does not hand the same one to two processes, so a collision cannot
 * happen no matter how many suites run at once. The server prints what it bound
 * and we read the number back off that line.
 */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every child we spawn, so a suite can clean up without tracking them itself. */
const spawned = new Set();

/**
 * Start the API on an OS-assigned port.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.varDir]     STARDRIVE_VAR_DIR for this instance.
 * @param {object}  [opts.env]        Extra environment (overrides varDir if it also sets STARDRIVE_VAR_DIR).
 * @param {number}  [opts.timeoutMs]  How long to wait for the listening line.
 * @returns {Promise<{ child: import('node:child_process').ChildProcess, port: number, base: string, stop: () => void }>}
 */
export function startServer({ varDir, env = {}, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.mjs', '--port', '0'], {
      cwd: API_DIR,
      env: {
        ...process.env,
        ...(varDir ? { STARDRIVE_VAR_DIR: varDir } : {}),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    spawned.add(child);
    child.on('exit', () => spawned.delete(child));

    let buf = '';
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

    const timer = setTimeout(
      () => finish(reject, new Error(`Server never became ready within ${timeoutMs}ms. Output:\n${buf}`)),
      timeoutMs,
    );

    child.stdout.on('data', (d) => {
      buf += d;
      const found = /listening on http:\/\/localhost:(\d+)/.exec(buf);
      if (!found) return;
      const port = Number(found[1]);
      finish(resolve, {
        child,
        port,
        base: `http://localhost:${port}`,
        stop: () => stopServer(child),
      });
    });
    child.stderr.on('data', (d) => { buf += d; });
    child.on('exit', (code) => finish(reject, new Error(`Server exited early (${code}). Output:\n${buf}`)));
  });
}

/** Kill one child and stop counting it among the strays. */
export function stopServer(child) {
  spawned.delete(child);
  try { child.kill(); } catch { /* already gone */ }
}

/**
 * Kill everything this helper started. Suites call it at the end; it is also
 * safe to call twice, which matters when a suite fails partway through.
 */
export function stopAll() {
  for (const child of spawned) {
    try { child.kill(); } catch { /* already gone */ }
  }
  spawned.clear();
}
