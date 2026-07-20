/**
 * Live, clickable preview servers — one per site, on the operator's OWN
 * machine. After a full-QA build a workspace already has node_modules and a
 * production .next, so we just `next start` it on a free localhost port and hand
 * back the URL. The customer clicks around the REAL assembled site instead of
 * judging a single screenshot of the home page.
 *
 * Servers are tracked in-process, auto-stop after an idle period, and are all
 * killed when the API shuts down. Local-only: bound to localhost, never exposed.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SHELL = process.platform === 'win32'; // Node needs a shell to spawn .cmd on Windows
const IDLE_MS = 30 * 60 * 1000; // stop a preview 30 min after it was last touched
// Ports the WHATWG fetch spec refuses ("bad ports") — a server on one is
// unreachable by fetch() by design, which would make readiness never succeed.
const BLOCKED = new Set([4045, 4160, 4190, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697]);

function killTree(child) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  } catch { /* already gone */ }
}

async function findFreePort(start, tries = 25) {
  for (let p = start; p < start + tries; p += 1) {
    if (BLOCKED.has(p)) continue;
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen({ port: p, host: '127.0.0.1' });
    });
    if (free) return p;
  }
  throw new Error('No free preview port available.');
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const err = (status, code, message) => Object.assign(new Error(message), { status, code });

export function createLivePreview({ basePort = 4300 } = {}) {
  const running = new Map(); // siteId -> { child, port, url, startedAt, timer }

  function touch(siteId) {
    const rec = running.get(siteId);
    if (!rec) return;
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => stop(siteId), IDLE_MS);
  }

  function status(siteId) {
    const rec = running.get(siteId);
    if (!rec) return null;
    if (rec.child.exitCode != null) { running.delete(siteId); return null; } // crashed
    touch(siteId);
    return { url: rec.url, port: rec.port, startedAt: rec.startedAt };
  }

  async function start(siteId, dir) {
    const existing = status(siteId);
    if (existing) return existing;
    if (!fs.existsSync(path.join(dir, 'package.json'))) {
      throw err(409, 'not_assembled', 'This site has not been built yet. Build it first, then open the live preview.');
    }
    if (!fs.existsSync(path.join(dir, '.next'))) {
      throw err(409, 'no_build', 'No production build found for this site. Rebuild it (full QA) and try again.');
    }
    const port = await findFreePort(basePort);
    const child = spawn(NPM, ['run', 'start', '--', '-p', String(port)], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], shell: SHELL,
      // PORT is set explicitly so the child never inherits the API's own PORT.
      env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
    });
    let out = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });

    const ok = await waitForServer(`http://127.0.0.1:${port}/`, 60_000);
    if (!ok) {
      killTree(child);
      throw err(500, 'preview_failed', 'The preview server did not start in time. ' + out.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200));
    }
    const url = `http://localhost:${port}`;
    const rec = { child, port, url, startedAt: new Date().toISOString(), timer: null };
    running.set(siteId, rec);
    child.on('exit', () => { const r = running.get(siteId); if (r && r.child === child) running.delete(siteId); });
    touch(siteId);
    return { url, port, startedAt: rec.startedAt };
  }

  function stop(siteId) {
    const rec = running.get(siteId);
    if (!rec) return false;
    clearTimeout(rec.timer);
    killTree(rec.child);
    running.delete(siteId);
    return true;
  }

  function stopAll() {
    for (const id of [...running.keys()]) stop(id);
  }

  return { start, stop, status, stopAll };
}
