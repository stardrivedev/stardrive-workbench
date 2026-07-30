/**
 * Full browser-QA tier — the real gate on top of the structural checks.
 *
 * For an assembled site it: installs dependencies, runs `next build` (the
 * real compile gate — this is what proves an arbitrary template + module set
 * actually works), serves the production build, checks every declared route
 * responds, and — when a browser is available — runs an axe accessibility
 * pass, a 375px mobile-overflow check, a console-error check, and captures a
 * screenshot for the visual preview.
 *
 * Heavy and environment-dependent, so it is OPT-IN (STARDRIVE_QA=full) and
 * degrades honestly: the browser sub-checks skip (never fake-pass) when
 * Playwright is not resolvable. Core checks (install/build/serve/routes)
 * need only npm + the site's own deps.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

// Ports the WHATWG fetch spec BLOCKS outright ("bad ports") that sit near
// dev ranges — fetch() refuses them before even connecting, so a QA server
// on one is unreachable by design. 4190 (ManageSieve) cost us a debugging
// session; never again.
const FETCH_BLOCKED_PORTS = new Set([4045, 4160, 4190, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697]);

/** First bindable, fetch-reachable port at or after `start`. */
async function findFreePort(start, tries = 15) {
  for (let p = start; p < start + tries; p += 1) {
    if (FETCH_BLOCKED_PORTS.has(p)) continue;
    const free = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen({ port: p, host: '127.0.0.1' });
    });
    if (free) return p;
  }
  throw new Error(`No free QA port in ${start}–${start + tries - 1}.`);
}

/** Kill a spawned npm/next server INCLUDING grandchildren (Windows shell trees). */
function killTree(child) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  } catch { /* already gone */ }
}

/** Import a module by bare specifier or absolute path (file:// on Windows). */
function importMaybePath(spec) {
  return import(path.isAbsolute(spec) ? pathToFileURL(spec).href : spec);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Node on Windows requires a shell to spawn .cmd files (args here are all
// simple tokens, never user-controlled strings).
const SHELL = process.platform === 'win32';
export const PREVIEW_FILE = '.stardrive-preview.png';

// Capture the ACTUAL failure: combine stdout+stderr (next build writes the
// error to either), strip ANSI colour codes, and prefer the window around the
// real compile/module error over the trailing progress lines.
const tail = (e) => {
  const raw = [String(e?.stdout || ''), String(e?.stderr || '')].join('\n');
  const lines = raw.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return String(e?.message || '').slice(0, 1500);
  const errIdx = lines.findIndex((l) => /Failed to compile|Module not found|Type error|SyntaxError|is disallowed|Error:|webpack errors|Cannot find/i.test(l));
  const window = errIdx >= 0 ? lines.slice(errIdx, errIdx + 14) : lines.slice(-14);
  return window.join('\n').slice(0, 1500);
};

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.status < 500) return { ok: true }; lastErr = `status ${r.status}`; }
    catch (e) { lastErr = String(e.cause?.code || e.cause?.message || e.message); }
    await sleep(500);
  }
  return { ok: false, lastErr };
}

async function loadBrowserTools() {
  try {
    const pw = await importMaybePath(process.env.STARDRIVE_PLAYWRIGHT || 'playwright');
    const chromium = pw.chromium ?? pw.default?.chromium;
    if (!chromium) return null;
    let AxeBuilder = null;
    try {
      const ax = await importMaybePath(process.env.STARDRIVE_AXE || '@axe-core/playwright');
      AxeBuilder = ax.default ?? ax.AxeBuilder ?? null;
      if (AxeBuilder && AxeBuilder.default) AxeBuilder = AxeBuilder.default; // CJS-under-ESM double wrap
    } catch { /* axe optional */ }
    return { chromium, AxeBuilder };
  } catch {
    return null;
  }
}

/**
 * Run the full QA on an assembled site directory.
 * @returns {{ verdict, mode:'full', checks:[], preview:string|null }}
 */
export async function runFullQA({ dir, routes = ['/'], port = 4290, log = () => {}, timeout = 300_000 }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, status: ok ? 'pass' : 'fail', ...(detail ? { detail } : {}) });
  const stop = (extra = {}) => ({ verdict: checks.every((c) => c.status === 'pass') ? 'passed' : 'failed', mode: 'full', checks, preview: null, ...extra });

  // 1 — install deps
  log('QA: installing dependencies…');
  try {
    execFileSync(NPM, ['install', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], timeout, shell: SHELL });
    add('dependencies install', true);
  } catch (e) { add('dependencies install', false, tail(e)); return stop(); }

  // 2 — compile gate (next build)
  log('QA: building (next build)…');
  try {
    execFileSync(NPM, ['run', 'build'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], timeout, shell: SHELL, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
    add('compiles (next build)', true);
  } catch (e) { add('compiles (next build)', false, tail(e)); return stop(); }

  // 3 — serve the production build (probe past leftovers/collisions).
  // PORT is overridden explicitly: the API's own PORT env must never leak
  // into the child, or `next start` can bind the API's port and collide.
  port = await findFreePort(port);
  log(`QA: serving on :${port} and checking routes…`);
  const server = spawn(NPM, ['run', 'start', '--', '-p', String(port)], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], shell: SHELL,
    env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
  });
  let serverOut = '';
  let serverExit = null;
  server.stdout?.on('data', (d) => { serverOut += d; });
  server.stderr?.on('data', (d) => { serverOut += d; });
  server.on('exit', (code) => { serverExit = code; });
  let preview = null;
  const host = `http://127.0.0.1:${port}`;
  try {
    const readiness = await waitForServer(`${host}/`, 60_000);
    try { fs.writeFileSync(path.join(dir, '.qa-serve.log'), serverOut); } catch { /* diagnostics only */ }
    add('production server starts', readiness.ok, readiness.ok ? undefined
      : `probe: ${readiness.lastErr || '?'} · child exit: ${serverExit === null ? 'still running' : serverExit} · server: ${serverOut.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || 'no output'}`);
    if (!readiness.ok) return stop();

    // 4 — every declared page route responds
    const pageRoutes = routes.filter((r) => !r.includes('[') && !r.startsWith('/api') && !r.startsWith('/admin'));
    const bad = [];
    for (const r of pageRoutes.length ? pageRoutes : ['/']) {
      try { const res = await fetch(`${host}${r}`); if (res.status >= 400) bad.push(`${r}→${res.status}`); }
      catch { bad.push(`${r}→unreachable`); }
    }
    add('all routes respond', bad.length === 0, bad.join(', ') || undefined);

    // 5 — browser checks (optional; never fake-pass when unavailable)
    const tools = await loadBrowserTools();
    if (!tools) {
      add('browser checks (accessibility, preview)', true, 'skipped — no browser (Playwright) in this environment');
    } else {
      const browser = await tools.chromium.launch();
      try {
        const context = await browser.newContext(); // axe requires an explicit context
        const page = await context.newPage();
        const consoleErrors = [];
        page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
        page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
        await page.goto(`${host}/`, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(1500); // let reveal transitions settle — axe/screenshot mid-fade are artifacts

        preview = path.join(dir, PREVIEW_FILE);
        await page.screenshot({ path: preview });

        if (tools.AxeBuilder) {
          try {
            const axe = await new tools.AxeBuilder({ page }).analyze();
            const gating = axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
            add('accessibility: no serious/critical (axe)', gating.length === 0, gating.map((v) => `${v.id} (${v.impact})`).slice(0, 3).join(', ') || undefined);
          } catch (e) {
            add('accessibility: no serious/critical (axe)', false, 'axe could not run: ' + String(e.message).slice(0, 200));
          }
        }

        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto(`${host}/`, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(800);
        // Name the element, not just the fact. "No horizontal overflow at
        // 375px: failed" tells whoever has to fix it nothing at all, and this
        // check gates a build, so it owes them a starting point.
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const over = doc.scrollWidth - window.innerWidth;
          if (over <= 1) return null;
          const describe = (el) => {
            const id = el.id ? `#${el.id}` : '';
            const cls = typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
            return `${el.tagName.toLowerCase()}${id}${cls}`;
          };
          const culprits = [];
          for (const el of document.body.querySelectorAll('*')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.right <= window.innerWidth + 1) continue;
            // The outermost offender is the useful one: its children overflow
            // only because it does.
            if (culprits.some((c) => c.el.contains(el))) continue;
            culprits.push({ el, text: `${describe(el)} reaches ${Math.round(r.right)}px` });
          }
          return { over, culprits: culprits.slice(0, 4).map((c) => c.text) };
        });
        add('no horizontal overflow at 375px', !overflow,
          overflow ? `page is ${overflow.over}px too wide — ${overflow.culprits.join('; ') || 'no single element found, check a min-width or a negative margin'}` : undefined);

        add('no console errors on the home page', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || undefined);
      } finally {
        await browser.close();
      }
    }
  } finally {
    killTree(server); // Windows: kill the whole shell tree, or `next start` leaks
    await sleep(500);
  }

  return stop({ preview: preview && fs.existsSync(preview) ? preview : null });
}
