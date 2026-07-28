/* Stardrive Workbench, plain JS, no build step, same-origin API. */
'use strict';

/* ══════════════ The authoring rulebook (system prompt for the Studio) ══════════════ */
// The rulebook + delivery format + feature catalog live in studio-prompt.js,
// shared verbatim with the API server (Batch Building generates against the
// exact same contract). Loaded before this script by index.html.
const { RULEBOOK_PROMPT, STUDIO_FORMAT, FEATURES, featureBlockFor, modulesForFeatures } = globalThis.STUDIO_PROMPTS;

/* ══════════════ Small utilities ══════════════ */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|svg|txt|html|yml|yaml)$/i;

function getApiKey() { return localStorage.getItem('sd.apiKey') || ''; }

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(getApiKey() ? { Authorization: 'Bearer ' + getApiKey() } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = raw ? await res.text() : await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: data };
}

/** The raw Response, for endpoints that return a file rather than JSON
 *  (the .env download, the client handoff page). The API key travels in a
 *  header, so a plain <a href> would come back unauthorised. */
function apiRaw(path, { method = 'GET' } = {}) {
  return fetch(path, {
    method,
    headers: { ...(getApiKey() ? { Authorization: 'Bearer ' + getApiKey() } : {}) },
  });
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copybtn');
  if (!btn) return;
  const pre = btn.closest('.codeblock')?.querySelector('pre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => flash(btn, 'Copied ✓'));
});

/* ══════════════ Theme ══════════════ */
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#themeBtn').textContent = 'Theme: ' + t;
}
let theme = localStorage.getItem('sd.theme') || 'system';
applyTheme(theme);
$('#themeBtn').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  localStorage.setItem('sd.theme', theme);
  applyTheme(theme);
});

/* ══════════════ Router ══════════════ */
const TITLES = {
  home: 'Home', templates: 'My templates', studio: 'AI Studio',
  sites: 'Sites', batch: 'Batch Building', connections: 'Hosting',
  'going-live': 'Going live',
  reference: 'API reference', keys: 'API keys', billing: 'Plan & usage', rulebook: 'Rulebook',
};
function route() {
  const [view, qs] = (location.hash.replace('#/', '') || 'home').split('?');
  const v = TITLES[view] ? view : 'home';
  const params = new URLSearchParams(qs || '');
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === 'view-' + v));
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === v));
  $('#viewTitle').textContent = TITLES[v];
  if (v === 'home') {
    loadHome();
    // Landing back from the confirmation email: pick up the new state so the
    // banner clears itself instead of lingering until a manual reload.
    if (params.has('verified')) confirmVerification(params.get('verified') === '1');
  }
  if (v === 'templates') loadTemplates();
  if (v === 'studio') restoreStudioDraft();
  if (v === 'sites') {
    loadSites();
    loadSiteTemplateOptions();
    // #/sites?site=<id> — how a finished batch build opens straight up.
    if (params.get('site')) openSiteDetail(params.get('site'));
  }
  if (v === 'batch') loadBatchView();
  if (v === 'going-live') renderGoingLive();
  if (v === 'connections') loadConnections();
  if (v === 'keys') { renderMaskedKey(); loadKeys(); }
  if (v === 'billing') loadBilling();
}
window.addEventListener('hashchange', route);

/* ══════════════ Home (guided journey) ══════════════ */
async function loadHome() {
  if (!getApiKey()) return;
  // Step 1, templates (imports beyond the shared catalog).
  try {
    const { body } = await api('/v1/templates');
    const mine = (body.templates || []).filter((t) => t.source !== 'bundled').length;
    const total = (body.templates || []).length;
    setStep('jstep-1', 'homeTemplates', mine > 0,
      mine > 0 ? `You have <span class="ok">${mine} of your own template${mine === 1 ? '' : 's'}</span> (plus ${total - mine} from the catalog).`
               : `<span class="todo">No templates of your own yet, the ${total}-design catalog is ready to start from.</span>`);
  } catch { /* not logged in / no key */ }
  // Step 2, sites.
  try {
    const { body } = await api('/v1/sites');
    const n = (body.sites || []).length;
    setStep('jstep-2', 'homeSites', n > 0,
      n > 0 ? `<span class="ok">${n} site${n === 1 ? '' : 's'} built.</span>` : '<span class="todo">No sites built yet.</span>');
  } catch { /* ignore */ }
  // Step 3, hosting.
  try {
    const { status, body } = await api('/v1/connections');
    if (status === 200) {
      const connected = Object.entries(body.connections).filter(([, c]) => c.connected).map(([p]) => p);
      setStep('jstep-3', 'homeHosting', connected.length > 0,
        connected.length ? `<span class="ok">Connected: ${connected.join(', ')}.</span>` : '<span class="todo">No hosting connected yet, you can still export finished sites.</span>');
    }
  } catch { /* ignore */ }
}
function setStep(stepId, statusId, done, html) {
  const el = document.getElementById(statusId);
  if (el) el.innerHTML = html;
  document.getElementById(stepId)?.classList.toggle('done', done);
}

/* ══════════════ Auth gate ══════════════ */
async function whoami() {
  try {
    const res = await fetch('/auth/me');
    if (!res.ok) return null;
    return (await res.json()).account;
  } catch { return null; }
}

function showGate() {
  $('#authGate').hidden = false;
  $('#appLayout').hidden = true;
}
function showApp(account) {
  $('#authGate').hidden = true;
  $('#appLayout').hidden = false;
  $('#acctEmail').textContent = account.email;
  renderVerifyBanner(account);
}

/**
 * Everything works before the address is confirmed except AI generation,
 * which spends real money. Say exactly that, once, at the top of the app,
 * rather than letting the operator discover it as a 403 mid-build.
 */
function renderVerifyBanner(account) {
  const host = $('#verifyBanner');
  if (!host) return;
  if (!account || account.emailVerified !== false) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML =
    '<b>Confirm your email to switch on AI generation.</b> We sent a link to ' + esc(account.email) +
    '. Everything else works now: connect hosting, import templates, set up a client. ' +
    '<button class="ghost" id="resendVerify" type="button">Send it again</button>' +
    '<span id="resendVerifyOut"></span>';
}

async function confirmVerification(ok) {
  const host = $('#verifyBanner');
  if (!host) return;
  if (!ok) {
    host.hidden = false;
    host.innerHTML = '<b>That confirmation link did not work.</b> It may have already been used, or it expired. ' +
      '<button class="ghost" id="resendVerify" type="button">Send a new one</button><span id="resendVerifyOut"></span>';
    return;
  }
  const account = await whoami();
  renderVerifyBanner(account);
  host.hidden = false;
  host.classList.add('ok');
  host.innerHTML = '<b>Email confirmed.</b> AI generation is on.';
  setTimeout(() => { host.hidden = true; host.classList.remove('ok'); }, 6000);
}

document.addEventListener('click', async (e) => {
  if (!e.target.closest('#resendVerify')) return;
  const btn = e.target.closest('#resendVerify');
  btn.disabled = true;
  const out = $('#resendVerifyOut');
  const res = await fetch('/auth/resend-verification', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (out) {
    out.textContent = res.ok
      ? (body.alreadyVerified ? ' Already confirmed, reload the page.' : ' Sent, check your inbox.')
      : ' ' + (body.error?.message || 'Could not send it just now.');
  }
  btn.disabled = false;
});

let authMode = 'login';
document.querySelectorAll('.authtab').forEach((t) => t.addEventListener('click', () => {
  authMode = t.dataset.authtab;
  document.querySelectorAll('.authtab').forEach((x) => x.classList.toggle('active', x === t));
  $('#companyRow').hidden = authMode !== 'signup';
  $('#authSubmit').textContent = authMode === 'signup' ? 'Create account' : 'Log in';
  $('#authForm').querySelector('[name="password"]').setAttribute('autocomplete', authMode === 'signup' ? 'new-password' : 'current-password');
  $('#authNote').textContent = '';
}));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const note = $('#authNote');
  note.className = 'authnote';
  const data = Object.fromEntries(new FormData(e.target).entries());
  $('#authSubmit').disabled = true;
  try {
    const res = await fetch('/auth/' + authMode, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { note.className = 'authnote err'; note.textContent = body.error?.message || 'Something went wrong.'; return; }
    if (authMode === 'signup' && body.apiKey?.secret) {
      // Auto-adopt the first key for product calls, and reveal it once.
      localStorage.setItem('sd.apiKey', body.apiKey.secret);
      $('#apiKeyInput').value = body.apiKey.secret;
    }
    showApp(body.account);
    renderMaskedKey();
    revealBatchNav(); // plan-gated nav, otherwise it only appeared after a reload
    // New customers land on the guided Home; returning users on their last view.
    if (authMode === 'signup') location.hash = '#/home';
    route();
  } finally {
    $('#authSubmit').disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  localStorage.removeItem('sd.apiKey');
  location.reload();
});

/* ══════════════ API key chip ══════════════ */
$('#apiKeyInput').value = getApiKey();
$('#saveKeyBtn').addEventListener('click', () => {
  localStorage.setItem('sd.apiKey', $('#apiKeyInput').value.trim());
  flash($('#saveKeyBtn'), 'Saved ✓');
  renderMaskedKey();
  loadTemplates();
});

function renderMaskedKey() {
  const k = getApiKey();
  $('#maskedKey').textContent = k ? k.slice(0, 12) + '…' + k.slice(-4) : 'none saved';
}

/* ══════════════ Health / service card ══════════════ */
$('#baseUrl').textContent = location.origin;
$('#healthCurl').textContent = 'curl ' + location.origin + '/v1/health';
(async () => {
  try {
    const { body } = await api('/v1/health');
    $('#statusDot').className = 'statusdot up';
    $('#statusText').textContent = 'API up';
    $('#versionText').textContent = 'v' + body.version + ' · engine: ' + body.engine;
    $('#svcStatus').textContent = 'up';
    $('#svcVersion').textContent = body.version;
    $('#svcEngine').textContent = body.engine;
    applyStudioConfig(body.studio);
  } catch {
    $('#statusDot').className = 'statusdot down';
    $('#statusText').textContent = 'API unreachable';
    $('#svcStatus').textContent = 'unreachable';
    applyStudioConfig({ enabled: false });
  }
})();

/* ══════════════ Templates ══════════════ */
async function loadTemplates() {
  const tbody = $('#templateTable tbody');
  if (!getApiKey()) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Save an API key to load your library.</td></tr>';
    return;
  }
  const { status, body } = await api('/v1/templates');
  if (status === 401 || status === 403) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--bad)">' +
      (status === 401 ? 'That key was not accepted.' : 'This key lacks the templates scope.') + '</td></tr>';
    return;
  }
  // A grid of designs, not a list of slugs: with twenty generated templates
  // the name tells you nothing and the picture tells you everything. The
  // screenshot comes from the full QA tier; without one the tile falls back
  // to a lettered plate rather than a broken image.
  const grid = $('#templateGrid');
  if (grid) {
    grid.innerHTML = body.templates.map((t) => {
      return '<div class="tmpl-card">' +
        thumbHtml('/v1/templates/' + encodeURIComponent(t.name) + '/thumbnail', initialOf(t.name), 'tmpl-shot') +
        '<div class="tmpl-body">' +
          '<b>' + esc(t.name) + '</b>' +
          '<span class="tmpl-meta">' + esc(t.kind) + ' · v' + esc(t.version) + ' · ' + t.routes.length + ' page(s)' +
            ' <span class="badge ' + (t.source === 'bundled' ? 'bundled' : 'imported') + '">' + esc(t.source) + '</span></span>' +
          '<div class="tmpl-actions">' +
            (t.source === 'imported' && t.kind === 'site'
              ? '<button class="primary" data-act="refine" data-name="' + esc(t.name) + '" type="button">Refine in Studio</button>' : '') +
            '<button class="ghost" data-act="view" data-name="' + esc(t.name) + '" type="button">Manifest</button>' +
            (t.source === 'imported' ? '<button class="ghost danger" data-act="del" data-name="' + esc(t.name) + '" type="button">Delete</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    wireThumbFallbacks(grid);
  }

  tbody.innerHTML = '';
  for (const t of body.templates) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><code>' + esc(t.name) + '</code></td>' +
      '<td>' + esc(t.kind) + '</td>' +
      '<td>' + esc(t.version) + '</td>' +
      '<td><span class="badge ' + (t.source === 'bundled' ? 'bundled' : 'imported') + '">' + esc(t.source) + '</span></td>' +
      '<td>' + t.routes.length + '</td>' +
      '<td style="white-space:nowrap"><button class="ghost" data-act="view" data-name="' + esc(t.name) + '">Manifest</button> ' +
      (t.source === 'imported' ? '<button class="ghost danger" data-act="del" data-name="' + esc(t.name) + '">Delete</button>' : '') + '</td>';
    tbody.appendChild(tr);
  }
}

async function onTemplateAction(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const name = btn.dataset.name;
  if (btn.dataset.act === 'view') {
    const { body } = await api('/v1/templates/' + encodeURIComponent(name));
    $('#manifestPanel').innerHTML =
      '<h3 style="margin-top:1rem;color:var(--ink)">' + esc(name) + '</h3>' +
      '<div class="codeblock"><pre>' + esc(JSON.stringify(body.manifest, null, 2)) + '</pre><button class="copybtn" type="button">Copy</button></div>' +
      (body.warnings?.length ? '<div class="report err"><b>Lint warnings kept on this import:</b><ul>' + body.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '');
  }
  if (btn.dataset.act === 'refine') { refineTemplate(name); return; }
  if (btn.dataset.act === 'del') {
    if (!confirm('Delete "' + name + '" from your library?')) return;
    await api('/v1/templates/' + encodeURIComponent(name), { method: 'DELETE' });
    $('#manifestPanel').innerHTML = '';
    loadTemplates();
  }
}
$('#templateTable').addEventListener('click', onTemplateAction);
$('#templateGrid')?.addEventListener('click', onTemplateAction);

/* Folder upload → bundle → import. */
const drop = $('#dropzone');
drop.addEventListener('click', () => $('#folderInput').click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('drag');
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const files = [];
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      files.push({ path: prefix + entry.name, file: f });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, prefix + entry.name + '/');
      } while (batch.length);
    }
  }
  for (const en of entries) await walk(en, '');
  importFromFileList(files);
});
$('#folderInput').addEventListener('change', (e) => {
  const files = [...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
  importFromFileList(files);
  e.target.value = '';
});

async function importFromFileList(list) {
  const out = $('#uploadReport');
  out.innerHTML = '<div class="report ok">Reading folder…</div>';
  try {
    if (!list.length) throw new Error('No files found.');
    // Strip a single common root folder.
    const first = list[0].path.split('/')[0];
    const wrapped = list.every((f) => f.path.split('/')[0] === first && f.path.includes('/'));
    const rel = (p) => (wrapped ? p.split('/').slice(1).join('/') : p);
    const skip = /(^|\/)(node_modules|\.git|\.next|dist|out)(\/|$)|(^|\/)\./;

    const manifestFile = list.find((f) => rel(f.path) === 'manifest.json');
    if (!manifestFile) throw new Error('No manifest.json at the folder root. Pick the folder that directly contains manifest.json and files/.');
    const manifest = JSON.parse(await manifestFile.file.text());

    const hasFilesDir = list.some((f) => rel(f.path).startsWith('files/'));
    const files = [];
    for (const f of list) {
      const r = rel(f.path);
      if (r === 'manifest.json' || skip.test(r)) continue;
      const payloadPath = hasFilesDir ? (r.startsWith('files/') ? r.slice(6) : null) : r;
      if (!payloadPath) continue;
      if (TEXT_EXT_RE.test(payloadPath)) {
        files.push({ path: payloadPath, content: await f.file.text() });
      } else {
        const buf = new Uint8Array(await f.file.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        files.push({ path: payloadPath, contentBase64: btoa(bin) });
      }
    }

    out.innerHTML = '<div class="report ok">Validating &amp; importing ' + files.length + ' files…</div>';
    const { status, body } = await api('/v1/templates', { method: 'POST', body: { manifest, files } });
    renderImportReport(out, status, body);
    if (status < 300) loadTemplates();
  } catch (err) {
    out.innerHTML = '<div class="report err">' + esc(err.message || String(err)) + '</div>';
  }
}

function renderImportReport(el, status, body) {
  if (status === 401) { el.innerHTML = '<div class="report err">Save a valid API key first (top right).</div>'; return; }
  if (status < 300) {
    el.innerHTML = '<div class="report ok">✓ Imported <b>' + esc(body.name) + '</b> into your private library.' +
      (body.warnings?.length ? '<div class="warns"><b>Warnings (review deliberately):</b><ul>' + body.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul></div>' : '') + '</div>';
  } else {
    el.innerHTML = '<div class="report err"><b>Rejected, fix these and re-upload:</b><ul>' +
      (body.errors || [body.error?.message || 'Unknown error']).map((er) => '<li>' + esc(er) + '</li>').join('') + '</ul></div>';
  }
}

/* ══════════════ Feature toggles → AI prompt ══════════════ */
// `module` ties a feature to a real d4 engine module added at assembly time.
// Features without `module` are template-design elements the AI builds in.
/* FEATURES is provided by studio-prompt.js (see the top of this file). */
const FEATURE_BY_ID = Object.fromEntries(FEATURES.map((f) => [f.id, f]));
/** Module-backed features enabled → the d4 module names to assemble with. */
function selectedModules() {
  return FEATURES.filter((f) => f.module && enabledFeatures.has(f.id)).map((f) => f.module);
}
const enabledFeatures = new Set(JSON.parse(localStorage.getItem('sd.features') || '["contact-form","dark-mode"]'));

function renderFeatures() {
  const root = $('#featureList');
  if (!root) return;
  root.innerHTML = '';
  for (const f of FEATURES) {
    const on = enabledFeatures.has(f.id);
    const label = document.createElement('label');
    label.className = 'feature' + (on ? ' on' : '');
    label.innerHTML = '<input type="checkbox" ' + (on ? 'checked' : '') + ' data-feature="' + f.id + '"> ' + esc(f.label);
    root.appendChild(label);
  }
  updateFeatureSummary();
}
function updateFeatureSummary() {
  const on = FEATURES.filter((f) => enabledFeatures.has(f.id));
  $('#featureSummary').innerHTML = on.length
    ? 'Sent to the AI with every message: <b>' + on.map((f) => esc(f.label)).join('</b>, <b>') + '</b>.'
    : 'No features selected. Toggle some above, or describe everything in your message.';
}
function featurePromptBlock() {
  return featureBlockFor([...enabledFeatures]);
}
document.getElementById('featureList')?.addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-feature]');
  if (!cb) return;
  if (cb.checked) enabledFeatures.add(cb.dataset.feature); else enabledFeatures.delete(cb.dataset.feature);
  localStorage.setItem('sd.features', JSON.stringify([...enabledFeatures]));
  cb.closest('.feature').classList.toggle('on', cb.checked);
  updateFeatureSummary();
});
renderFeatures();

/* ══════════════ Template Studio ══════════════ */
const chat = { messages: [] };
let studioEnabled = false;

/** Reflect the operator-configured model + on/off state (no key ever exposed). */
function applyStudioConfig(studio) {
  studioEnabled = Boolean(studio?.enabled);
  $('#studioModel').textContent = studioEnabled ? (studio.model || 'configured') : 'not enabled yet';
  $('#sendBtn').disabled = !studioEnabled;
  $('#studioStatus').innerHTML = studioEnabled
    ? '<div class="report ok" style="margin:0">Ready, template generation is on.</div>'
    : '<div class="report" style="margin:0;background:var(--code-bg);color:var(--muted)">The Studio is not enabled yet. It turns on once the operator configures the model, you never need a model key of your own.</div>';
}

function addMsg(role, content) {
  const log = $('#chatlog');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'systemnote') {
    div.textContent = content;
  } else {
    // Render with fenced code blocks; everything through textContent-safe nodes.
    const parts = String(content).split(/```[a-zA-Z]*\n?/);
    parts.forEach((part, i) => {
      const node = document.createElement(i % 2 ? 'pre' : 'div');
      if (i % 2 === 0) node.className = 'txt';
      node.textContent = part.replace(/\n?```\s*$/, '');
      if (part.trim()) div.appendChild(node);
    });
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

/* ── Guided brief → template generation ── */
const VIBES = ['Warm & friendly', 'Bold & modern', 'Elegant & minimal', 'Playful & bright', 'Classic & trustworthy', 'Sleek & techy'];
let currentVibe = '';

function renderVibes() {
  const el = $('#brVibe');
  if (!el) return;
  el.innerHTML = VIBES.map((v) => '<button type="button" class="chip-btn" data-vibe="' + esc(v) + '">' + esc(v) + '</button>').join('');
}
renderVibes();
$('#brVibe')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vibe]');
  if (!b) return;
  currentVibe = currentVibe === b.dataset.vibe ? '' : b.dataset.vibe;
  [...$('#brVibe').children].forEach((c) => c.classList.toggle('on', c.dataset.vibe === currentVibe));
});

function setGenResult(html) { const el = $('#genResult'); if (el) el.innerHTML = html; }
function genBusy(on) {
  const g = $('#genBtn'); const s = $('#sendBtn');
  if (g) g.disabled = on;
  if (s) s.disabled = on || !studioEnabled;
}

/** The guided brief → the design prompt. One composer, so a build queued in
 *  Batch Building asks the model for exactly what the Studio would. */
function composeBrief({ business = '', vibe = '', colors = '', audience = '', extra = '' } = {}) {
  if (!business.trim()) return '';
  const parts = ['Design a website template for ' + business.trim() + '.'];
  if (vibe.trim()) parts.push('Overall vibe: ' + vibe.trim() + '.');
  if (colors.trim()) parts.push('Colors: ' + colors.trim() + '.');
  if (audience.trim()) parts.push('Audience: ' + audience.trim() + '.');
  if (extra.trim()) parts.push(extra.trim());
  return parts.join(' ');
}

$('#genBtn')?.addEventListener('click', () => {
  const business = $('#brBusiness').value.trim();
  if (!business) { $('#brBusiness').focus(); setGenResult('<div class="report err">Tell us what kind of business it is to get started.</div>'); return; }
  runGeneration(composeBrief({
    business,
    vibe: [currentVibe, $('#brVibeCustom').value.trim()].filter(Boolean).join('; '),
    colors: $('#brColors').value.trim(),
    audience: $('#brAudience').value.trim(),
    extra: $('#brExtra').value.trim(),
  }), true);
});

$('#sendBtn').addEventListener('click', () => {
  const text = $('#chatText').value.trim();
  if (!text) return;
  $('#chatText').value = '';
  runGeneration(text, false);
});
$('#chatText')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#sendBtn').click();
});

async function runGeneration(userText, isFirst) {
  if (!getApiKey()) { setGenResult('<div class="report err">Save your Stardrive API key (top right) first.</div>'); return; }
  if (!studioEnabled) { setGenResult('<div class="report">The Template Studio is not enabled yet, it turns on once the operator configures the model.</div>'); return; }
  chat.messages.push({ role: 'user', content: userText });
  addMsg('user', userText);
  const active = FEATURES.filter((f) => enabledFeatures.has(f.id));
  const featNote = isFirst && active.length ? ' Including: ' + active.map((f) => f.label).join(', ') + '.' : '';
  setGenResult('<div class="report ok" style="display:flex;align-items:center;gap:0.55rem"><span class="spin"></span><span>' + (isFirst ? 'Designing your template' : 'Updating your template') + '… this takes a minute or two.' + esc(featNote) + '</span></div>');
  genBusy(true);
  try {
    const { status, body } = await api('/workbench/chat', {
      method: 'POST',
      body: { system: RULEBOOK_PROMPT + STUDIO_FORMAT + featurePromptBlock(), messages: chat.messages },
    });
    if (status !== 200) {
      setGenResult('<div class="report err">' + esc(body.error?.message || 'Generation failed (' + status + ').') + '</div>');
      chat.messages.pop();
      return;
    }
    chat.messages.push({ role: 'assistant', content: body.content });
    addMsg('assistant', body.content);
    renderGenOutcome(body.content);
    saveStudioDraft();
  } catch (err) {
    setGenResult('<div class="report err">Network error: ' + esc(err.message) + '</div>');
    chat.messages.pop();
  } finally {
    genBusy(false);
  }
}

/* ── the Studio draft ─────────────────────────────────────────────────── */
// A generated template plus its refine conversation is real work, and it used
// to live only in this tab: one reload and it was gone. Saved per account,
// the same way the batch build list is.

let studioSaveTimer = null;
let studioPreviewSiteId = null;

/** The brief fields, as the draft stores them. */
const readBrief = () => ({
  business: $('#brBusiness')?.value || '', vibe: currentVibe,
  vibeCustom: $('#brVibeCustom')?.value || '',
  colors: $('#brColors')?.value || '', audience: $('#brAudience')?.value || '',
  extra: $('#brExtra')?.value || '',
});

/**
 * Compact before saving: every generation is a WHOLE template, so keeping the
 * raw history would balloon. `collectFiles()` already resolves later file
 * blocks over earlier ones, so the merged file set plus the last exchange is
 * everything the Studio actually needs to carry on.
 */
function compactStudioMessages() {
  const files = collectFiles();
  if (!Object.keys(files).length) return chat.messages.slice(-6);
  const merged = Object.entries(files)
    .map(([p, c]) => `=== FILE: ${p} ===\n${c}\n=== END FILE ===`).join('\n');
  const firstUser = chat.messages.find((m) => m.role === 'user');
  return [
    ...(firstUser ? [firstUser] : []),
    { role: 'assistant', content: merged },
  ];
}

function saveStudioDraft() {
  clearTimeout(studioSaveTimer);
  studioSaveTimer = setTimeout(async () => {
    const { status, body } = await api('/v1/studio/draft', {
      method: 'PUT',
      body: {
        brief: readBrief(),
        features: [...enabledFeatures],
        messages: chat.messages.length ? compactStudioMessages() : [],
        previewSiteId: studioPreviewSiteId,
      },
    });
    const el = $('#studioSaveState');
    if (el) el.textContent = status === 200 ? 'Saved' : (body?.error?.message || 'Could not save this design.');
  }, 800);
}

async function clearStudioDraft() {
  clearTimeout(studioSaveTimer);
  await api('/v1/studio/draft', { method: 'DELETE' });
  const el = $('#studioSaveState');
  if (el) el.textContent = '';
}

/** Put a saved design back on screen, exactly where it was left. */
async function restoreStudioDraft() {
  if (!getApiKey() || chat.messages.length) return;
  const { status, body } = await api('/v1/studio/draft');
  if (status !== 200 || !body) return;
  const b = body.brief || {};
  if ($('#brBusiness')) $('#brBusiness').value = b.business || '';
  if ($('#brVibeCustom')) $('#brVibeCustom').value = b.vibeCustom || '';
  if ($('#brColors')) $('#brColors').value = b.colors || '';
  if ($('#brAudience')) $('#brAudience').value = b.audience || '';
  if ($('#brExtra')) $('#brExtra').value = b.extra || '';
  if (b.vibe) {
    currentVibe = b.vibe;
    [...($('#brVibe')?.children || [])].forEach((c) => c.classList.toggle('on', c.dataset.vibe === currentVibe));
  }
  studioPreviewSiteId = body.previewSiteId || null;
  if (!body.messages?.length) return;
  chat.messages = body.messages;
  for (const m of body.messages) addMsg(m.role, m.content);
  const last = body.messages.at(-1);
  if (last?.role === 'assistant') renderGenOutcome(last.content);
  const rw = $('#refineWrap'); if (rw) rw.hidden = false;
  const el = $('#studioSaveState');
  if (el) el.textContent = 'Picked up where you left off' + (body.updatedAt ? ' (' + new Date(body.updatedAt).toLocaleString() + ')' : '');
}

/**
 * Reopen a template from the library so it can be refined instead of being
 * frozen at import. Its files go back into the conversation as the FILE
 * blocks the Studio already speaks, so "Refine" carries on from there.
 */
async function refineTemplate(name) {
  const { status, body } = await api('/v1/templates/' + encodeURIComponent(name) + '?include=files');
  if (status !== 200) { alert(body.error?.message || 'Could not open that template.'); return; }
  const blocks = [
    `=== FILE: manifest.json ===\n${JSON.stringify(body.manifest, null, 2)}\n=== END FILE ===`,
    ...(body.files || []).map((f) => `=== FILE: ${f.path} ===\n${f.content}\n=== END FILE ===`),
  ].join('\n');
  chat.messages = [
    { role: 'user', content: `This is my existing template "${name}". I want to change it.` },
    { role: 'assistant', content: blocks },
  ];
  $('#chatlog').innerHTML = '';
  addMsg('systemnote', `Opened "${name}" from your library. Describe any change and press Refine; importing again under the same name replaces it.`);
  renderGenOutcome(blocks);
  const rw = $('#refineWrap'); if (rw) rw.hidden = false;
  location.hash = '#/studio';
  saveStudioDraft();
  setTimeout(() => $('#refineWrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
}

/** After each response: a friendly completion card (code hidden), or the
 *  model's question if it didn't deliver files yet. */
function renderGenOutcome(content) {
  const files = collectFiles();
  const fileCount = Object.keys(files).length;
  if (files['manifest.json'] && fileCount > 3) {
    let manifest = {};
    try { manifest = JSON.parse(files['manifest.json']); } catch { /* name-less card */ }
    const routes = (manifest.provides?.routes || []).filter((r) => !r.startsWith('/admin'));
    setGenResult(
      '<div class="card gen-done">' +
      '<div class="done-badge">✨ Your template is complete</div>' +
      '<div class="field" style="margin:0.6rem 0 0.3rem"><label>Name this template</label>' +
      '<input id="tplName" value="' + esc(manifest.name || 'my-template') + '" spellcheck="false" style="max-width:24rem" placeholder="my-template"></div>' +
      '<p style="font-size:0.83rem;color:var(--muted);margin:0 0 0.7rem">' + fileCount + ' files' + (routes.length ? ' · pages: ' + routes.map(esc).join(', ') : '') + '</p>' +
      '<p style="font-size:0.88rem;color:var(--body);margin:0 0 0.7rem">See how it looks before you decide. Preview builds a quick demo with sample content, then keep it or ask for changes.</p>' +
      '<button class="primary" data-genact="preview">👁 Preview this design</button>' +
      '<div id="genPreview" style="margin-top:0.7rem"></div>' +
      '</div>'
    );
    $('#importGenBtn')?.classList.add('glow');
    $('#studioActions')?.classList.add('ready');
    const rw = $('#refineWrap'); if (rw) rw.hidden = false;
  } else {
    const prose = content.replace(/^===\s*FILE:[\s\S]*?^===\s*END FILE\s*===/gm, '').trim();
    setGenResult('<div class="card"><p style="margin:0;white-space:pre-wrap;font-size:0.9rem">' + esc(prose.slice(0, 700) || 'The model replied, open "View the generated files" to see the details.') + '</p></div>');
  }
}

// Preview a generated design BEFORE the operator commits to it: import the
// bundle, build a throwaway demo site with sample content, and show the real
// result (screenshot + a clickable live preview).
const PREVIEW_FACTS = {
  whatYouDo: 'A friendly local business that does great work for its community.',
  aboutFacts: 'Started a few years ago by people who care about the craft. Serves the neighborhood and beyond. Known for quality work and a warm welcome.',
  services: ['A first core service', 'A second core service', 'A third core service'],
  contactEmail: 'hello@example.com', phone: '(555) 123-4567', address: '123 Main Street, Yourtown',
};

$('#view-studio')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-genact]');
  if (!b) return;
  if (b.dataset.genact === 'preview') previewGeneratedDesign();
  if (b.dataset.genact === 'preview-live') previewGeneratedLive(b.dataset.site);
});

/** Pull the real reason a build failed from the job's QA report (the failing
 *  checks + their captured detail, e.g. the next-build error tail), falling
 *  back to the last log line. */
function buildFailureDetail(jobBody) {
  const failed = (jobBody?.result?.qa?.checks || []).filter((c) => c.status === 'fail');
  if (failed.length) {
    return failed.map((c) => c.name + (c.detail ? ':\n' + c.detail : '')).join('\n\n');
  }
  return jobBody?.logs?.at(-1)?.line || 'The build failed; open the build history for details.';
}

async function previewGeneratedDesign() {
  const box = $('#genPreview');
  const spin = (msg) => { box.innerHTML = '<div class="report ok" style="display:flex;align-items:center;gap:0.5rem"><span class="spin"></span><span>' + esc(msg) + '</span></div>'; };
  let bundle;
  try { bundle = buildGeneratedBundle(); } catch (err) { box.innerHTML = '<div class="report err">' + esc(err.message) + '</div>'; return; }
  spin('Preparing a demo of this design…');
  const imp = await api('/v1/templates', { method: 'POST', body: bundle });
  if (imp.status >= 300 && imp.status !== 409) { box.innerHTML = '<div class="report err">' + esc(imp.body.errors?.join('; ') || imp.body.error?.message || 'Could not prepare the template.') + '</div>'; return; }
  // preview:true keeps this demo out of the Sites list (that list is the
  // client roster) and supersedes the last demo instead of piling up.
  const made = await api('/v1/sites', { method: 'POST', body: { templateId: bundle.manifest.name, config: { siteName: 'Preview · ' + bundle.manifest.name }, assemble: false, preview: true } });
  if (made.status !== 201) { box.innerHTML = '<div class="report err">Could not start the preview.</div>'; return; }
  const siteId = made.body.siteId;
  studioPreviewSiteId = siteId;
  saveStudioDraft();
  await api('/v1/sites/' + siteId + '/content', { method: 'PATCH', body: { facts: PREVIEW_FACTS } });
  const built = await api('/v1/sites/' + siteId + '/assemble', { method: 'POST', body: {} });
  if (built.status !== 202) { box.innerHTML = '<div class="report err">' + esc(built.body.error?.message || 'Preview build failed to start.') + '</div>'; return; }
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    let j;
    try { j = await api('/v1/jobs/' + built.body.jobId); } catch { continue; }
    if (j.status !== 200) continue;
    if (j.body.status === 'done') { showGenPreview(siteId); return; }
    if (j.body.status === 'failed') {
      const detail = buildFailureDetail(j.body);
      box.innerHTML = '<div class="report err"><b>The design did not build.</b> Here is what the build reported:<br>' +
        '<pre style="white-space:pre-wrap;margin:0.5rem 0;font-size:0.78rem;max-height:14rem;overflow:auto">' + esc(detail).slice(0, 6000) + '</pre>' +
        'The fix request is filled into <b>Want changes?</b> below, press <b>Refine</b> and the AI will correct the template.</div>';
      // Queue the exact error for the model, mirroring the import-error loop.
      $('#chatText').value = 'The generated template failed to build with the error below. Fix the affected file(s) and re-send ONLY the changed files (keep everything else):\n\n' + detail;
      const rw = $('#refineWrap'); if (rw) rw.hidden = false;
      return;
    }
    spin('Building the preview (' + (Math.round((Date.now() - started) / 6000) / 10) + ' min)…');
  }
}

async function showGenPreview(siteId) {
  const box = $('#genPreview');
  let img = '';
  try {
    const res = await fetch('/v1/sites/' + siteId + '/preview', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) img = '<img src="' + URL.createObjectURL(await res.blob()) + '" alt="Design preview" style="max-width:100%;border:1px solid var(--line);border-radius:10px">';
  } catch { /* screenshot optional */ }
  box.innerHTML = '<div class="card">' +
    '<h3 style="margin:0 0 0.5rem">How this design looks</h3>' + img +
    '<div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap"><button class="primary" data-genact="preview-live" data-site="' + esc(siteId) + '">▶ Click around it live</button></div>' +
    '<p style="font-size:0.8rem;color:var(--muted);margin:0.55rem 0 0">Shown with sample content so you can judge the look. Happy with it? Add it to your templates. Want changes? Describe them under "Want changes?". (This is a throwaway demo, not a client site, so it stays out of your Sites list and is replaced by your next preview.)</p></div>';
}

async function previewGeneratedLive(siteId) {
  const { status, body } = await api('/v1/sites/' + siteId + '/preview/live', { method: 'POST' });
  if (status === 200 && body.url) window.open(body.url, '_blank', 'noopener');
}

/** All FILE blocks across the conversation; a later path replaces an earlier one. */
function collectFiles() {
  const out = {};
  const re = /^===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n?^===\s*END FILE\s*===/gm;
  for (const m of chat.messages) {
    if (m.role !== 'assistant') continue;
    let hit;
    while ((hit = re.exec(m.content)) !== null) out[hit[1].trim()] = hit[2];
    re.lastIndex = 0;
  }
  return out;
}

function buildGeneratedBundle() {
  const files = collectFiles();
  const manifestSrc = files['manifest.json'];
  if (!manifestSrc) throw new Error('No manifest.json block in the conversation yet, ask the model to deliver the template files.');
  let manifest;
  try { manifest = JSON.parse(manifestSrc); } catch { throw new Error('The manifest.json block is not valid JSON, ask the model to re-send it.'); }
  // The operator names the template; override the AI's suggestion with theirs.
  const chosen = $('#tplName')?.value.trim();
  if (chosen) {
    const slug = chosen.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) throw new Error('Template name needs at least one letter or number.');
    manifest.name = slug;
  }
  const payload = Object.entries(files)
    .filter(([p]) => p !== 'manifest.json')
    .map(([path, content]) => ({ path: path.replace(/^files\//, ''), content }));
  if (!payload.length) throw new Error('No payload files yet, the template needs its files/ content.');
  return { manifest, files: payload };
}

$('#importGenBtn').addEventListener('click', async () => {
  try {
    const bundle = buildGeneratedBundle();
    setGenResult('<div class="report ok">Adding "' + esc(bundle.manifest.name) + '" to your library…</div>');
    const { status, body } = await api('/v1/templates', { method: 'POST', body: bundle });
    if (status < 300) {
      $('#importGenBtn')?.classList.remove('glow');
      setGenResult('<div class="card gen-done"><div class="done-badge" style="background:var(--good-soft);color:var(--good)">✓ Added to your templates</div>' +
        '<p style="font-size:0.9rem;color:var(--body);margin:0.6rem 0 0">"' + esc(bundle.manifest.name) + '" is ready. Head to <b>Step 2 · Sites</b> to build a client site from it.' +
        (body.warnings?.length ? ' <span style="color:var(--muted)">(' + body.warnings.length + ' minor lint note(s), see Templates.)</span>' : '') + '</p></div>');
    } else {
      const errs = (body.errors || [body.error?.message || 'rejected']).join('\n- ');
      // Queue the fix for the model; the operator sends it with Refine.
      $('#chatText').value = 'The import gate rejected the template with these errors, fix them and re-send only the affected files:\n- ' + errs;
      const rw = $('#refineWrap'); if (rw) rw.hidden = false;
      setGenResult('<div class="report err">The template needs a fix before it can be added:<br>- ' + esc(errs).replace(/\n- /g, '<br>- ') + '<br><br>Press <b>Refine</b> below (the fix request is filled in) and the AI will correct it.</div>');
    }
  } catch (err) {
    setGenResult('<div class="report err">' + esc(err.message) + '</div>');
  }
});

$('#downloadGenBtn').addEventListener('click', () => {
  try {
    const bundle = buildGeneratedBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (bundle.manifest.name || 'template') + '.bundle.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    addMsg('systemnote', err.message);
  }
});

$('#clearChatBtn').addEventListener('click', async () => {
  if (chat.messages.length && !confirm('Start over?\n\nThis design and everything you asked for is discarded.')) return;
  chat.messages = [];
  $('#chatlog').innerHTML = '';
  setGenResult('');
  $('#importGenBtn')?.classList.remove('glow');
  const rw = $('#refineWrap'); if (rw) rw.hidden = true;
  ['#brBusiness', '#brColors', '#brAudience', '#brExtra', '#brVibeCustom', '#chatText'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
  currentVibe = ''; renderVibes();
  studioPreviewSiteId = null;
  await clearStudioDraft();
});

// The brief is part of the saved draft too, so a half-filled form survives.
for (const sel of ['#brBusiness', '#brColors', '#brAudience', '#brExtra', '#brVibeCustom']) {
  $(sel)?.addEventListener('input', saveStudioDraft);
}

/* ══════════════ Sites ══════════════ */
const templateSource = {}; // name -> 'bundled' | 'imported'
// The base templates a site (or a batch build) can start from, cached so the
// Batch rows can offer them without a fetch per row.
let siteTemplateOptions = [];
async function loadSiteTemplateOptions() {
  const sel = $('#siteTemplateSel');
  if (!getApiKey()) return;
  const { status, body } = await api('/v1/templates');
  if (status !== 200) return;
  const bases = body.templates.filter((t) => t.kind === 'site');
  siteTemplateOptions = bases.map((t) => ({ name: t.name, source: t.source }));
  for (const t of bases) templateSource[t.name] = t.source;
  if (sel) {
    sel.innerHTML = bases.map((t) => '<option value="' + esc(t.name) + '">' + esc(t.name) + ' (' + esc(t.source) + ')</option>').join('');
    renderAssembleFeatures();
    renderTemplatePeek();
  }
}

/** Show the selected base template's own screenshot, so picking a design is
 *  not a guess from a slug. Absent (QA off, never built) simply hides. */
function renderTemplatePeek() {
  const host = $('#templatePeek');
  const name = $('#siteTemplateSel')?.value;
  if (!host) return;
  // No screenshot simply means no peek, not an empty frame.
  host.innerHTML = name ? '<img class="tmpl-shot" src="/v1/templates/' + encodeURIComponent(name) + '/thumbnail" alt="">' : '';
  host.querySelector('img')?.addEventListener('error', () => { host.innerHTML = ''; }, { once: true });
}

/** Module-backed feature toggles. Catalog base: default from the Studio
 *  selection (carry-over). Your own template: default OFF, its features are
 *  already in the design, and modules are opt-in CMS-backed extras. */
function renderAssembleFeatures() {
  const root = $('#assembleFeatures');
  if (!root) return;
  const src = templateSource[$('#siteTemplateSel').value];
  root.innerHTML = FEATURES.filter((f) => f.module).map((f) => {
    const on = src !== 'imported' && enabledFeatures.has(f.id);
    return '<label class="feature' + (on ? ' on' : '') + '"><input type="checkbox" ' + (on ? 'checked' : '') + ' data-assemblefeat="' + f.id + '"> ' + esc(f.label) + '</label>';
  }).join('');
  updateAssembleNote();
}
function updateAssembleNote() {
  const src = templateSource[$('#siteTemplateSel').value];
  const note = $('#assembleFeatureNote');
  const mods = [...document.querySelectorAll('#assembleFeatures input:checked')].map((c) => FEATURE_BY_ID[c.dataset.assemblefeat]?.label).filter(Boolean);
  if (src === 'imported') {
    note.innerHTML = mods.length
      ? 'Layers CMS-backed engine modules onto your template: <b>' + mods.map(esc).join('</b>, <b>') + '</b>. Your template keeps whatever features the AI built into its design.'
      : 'Your template ships with its built-in design. Optionally layer CMS-backed engine modules on top by ticking any above.';
  } else {
    note.innerHTML = mods.length
      ? 'Adds real engine features to this catalog template: <b>' + mods.map(esc).join('</b>, <b>') + '</b>.'
      : 'No add-on features selected, the base template ships as-is.';
  }
}
$('#assembleFeatures').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-assemblefeat]');
  if (cb) cb.closest('.feature').classList.toggle('on', cb.checked);
  updateAssembleNote();
});
$('#siteTemplateSel').addEventListener('change', () => { renderAssembleFeatures(); renderTemplatePeek(); });

async function loadSites() {
  const tbody = $('#sitesTable tbody');
  if (!getApiKey()) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Save an API key to load your sites.</td></tr>';
    return;
  }
  const { status, body } = await api('/v1/sites');
  if (status !== 200) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--bad)">' + (status === 403 ? 'This key lacks the sites scope.' : 'Could not load sites (' + status + ').') + '</td></tr>';
    return;
  }
  if (!body.sites.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No sites yet, assemble your first one above.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const s of body.sites) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="color:var(--ink);font-weight:600">' + esc(s.siteName) + '</td>' +
      '<td><code>' + esc(s.templateId) + '</code></td>' +
      '<td>' + esc(s.lastJobStatus || 'not built') + '</td>' +
      '<td style="color:var(--muted)">' + esc((s.updatedAt || '').slice(0, 16).replace('T', ' ')) + '</td>' +
      '<td><button class="ghost" data-site="' + esc(s.id) + '">View</button></td>';
    tbody.appendChild(tr);
  }
}

$('#sitesTable').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-site]');
  if (btn) openSiteDetail(btn.dataset.site);
});

let detailCms = false; // does the open site include the CMS/admin module?

async function openSiteDetail(siteId) {
  const { status, body } = await api('/v1/sites/' + siteId);
  if (status !== 200) return;
  const built = body.jobs.some((j) => j.status === 'done');
  detailCms = Array.isArray(body.config.modules) && body.config.modules.includes('d4-cms-core');
  const jobsHtml = body.jobs.map((j) =>
    '<tr><td><code>' + esc(j.id.slice(0, 8)) + '</code></td><td>' + esc(j.kind) + '</td><td>' + esc(j.status) + '</td><td style="color:var(--muted)">' + esc((j.finishedAt || j.createdAt || '').slice(0, 19).replace('T', ' ')) + '</td></tr>').join('');
  // One "going live" card: what to set on the host to turn on delivery
  // features. Everything here is OPTIONAL, the site works as-is, but this is
  // where the operator learns they CAN wire up email + the admin.
  const goLiveCard = built
    ? '<details class="card" style="margin-top:0.9rem"><summary style="cursor:pointer;font-weight:600;color:var(--ink)">Optional delivery settings (email, admin, database)</summary>' +
        '<p style="font-size:0.84rem;color:var(--body);margin:0.6rem 0 0.55rem">The site works the moment it publishes. These optional environment variables switch on delivery features; they are also listed in the site\'s <code>.env.example</code>. Whoever owns that client\'s hosting sets them there.</p>' +
        '<ul style="font-size:0.83rem;color:var(--body);margin:0;padding-left:1.1rem;display:grid;gap:0.4rem">' +
          '<li><b>Contact-form email.</b> Messages are always saved to the site\'s inbox. To also email the owner on every submission, set <code>RESEND_API_KEY</code> and <code>CONTACT_TO_EMAIL</code> (a <a href="https://resend.com" target="_blank" rel="noopener">Resend</a> key is free to start). This is per-site, set by whoever owns that client\'s hosting.</li>' +
          (detailCms
            ? '<li><b>Admin login.</b> This site has a private admin at <code>/admin</code>. In the live preview the password is <code>preview</code>; on your host set <code>ADMIN_PASSWORD</code> for the real one, plus <code>TOTP_SECRET</code> for two-factor.</li>' +
              '<li><b>Editable content.</b> Use the "Connect the database" step above (any libSQL-compatible endpoint, not just one vendor) so admin edits save; publishing to Vercel wires it in automatically. Other hosts need <code>TURSO_DATABASE_URL</code> + <code>TURSO_AUTH_TOKEN</code> set manually, plus <code>BLOB_READ_WRITE_TOKEN</code> for image uploads.</li>'
            : '') +
        '</ul></details>'
    : '';
  const id = body.id;
  // One step at a time: locked steps hide their body, the active step is open,
  // completed steps show a check. State is reactive (refreshSiteSteps).
  const step = (n, title, bodyHtml, lockedMsg) =>
    '<section class="sstep" data-step="' + n + '">' +
      '<div class="sstep-head"><span class="sstep-num">' + n + '</span>' +
        '<h3>' + title + '</h3><span class="sstep-status" data-role="status"></span></div>' +
      '<div class="sstep-body">' + bodyHtml + '</div>' +
      '<div class="sstep-locked">' + lockedMsg + '</div>' +
    '</section>';
  const buildRow =
    '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center">' +
    '<button class="primary" data-siteact="build" data-id="' + esc(id) + '">' + (built ? 'Rebuild site' : 'Build site') + '</button>' +
    (built ? '<button class="primary" data-siteact="live" data-id="' + esc(id) + '">▶ Open live preview</button>' +
             '<button class="ghost" data-siteact="export" data-id="' + esc(id) + '">Download site (.tar.gz)</button>' : '') +
    '</div>' +
    '<div id="livePreview" style="margin-top:0.6rem"></div>' +
    '<div id="siteActOut" style="margin-top:0.6rem"></div>';
  $('#siteDetail').innerHTML =
    '<h3 style="margin-top:1.2rem;color:var(--ink)">' + esc(body.config.siteName || body.id) + '</h3>' +
    '<div id="siteStepper" class="stepper"></div>' +
    '<div id="sitePreview"></div>' +
    // Step 1 — the intake (answer questions → AI writes the copy)
    step(1, 'The essentials',
      '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 0.2rem">Answer these and the AI writes finished copy for every page, no placeholders.</p>' +
      '<div id="siteContent" data-id="' + esc(id) + '"></div>', '') +
    // Step 2 — photos (encouraged, but skippable)
    step(2, 'Photos &amp; logo',
      '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 0.6rem">Drop each file into the right compartment and it lands in its exact place, no paths to think about. All optional: a hero image sits behind that page&rsquo;s designed hero text (leave it blank to keep the designed hero), and the logo can come later.</p>' +
      '<div id="siteAssets" data-id="' + esc(id) + '" class="grid2"></div>' +
      '<div style="margin-top:0.7rem"><button class="ghost" data-siteact="photos-skip" data-id="' + esc(id) + '">Continue without photos</button></div>',
      'Answer the essentials first, then add photos.') +
    // Step 3 — build
    step(3, built ? 'Rebuild the site' : 'Build the site',
      '<p style="font-size:0.85rem;color:var(--muted);margin:0 0 0.6rem">' + (built ? 'Rebuild to pick up edits or newly added photos.' : 'This assembles the finished, shippable site with real copy and images.') + '</p>' + buildRow,
      'Answer the essentials to unlock the build.') +
    // Step 4 — publish. A design that came out of a batch and has not been
    // looked at yet cannot go to a client; the gate is enforced server-side,
    // so say why here rather than letting the publish button fail.
    step(4, 'Publish',
      (built
        ? (body.review?.state === 'pending'
            ? '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' +
              '<b>This design is waiting for your review.</b> It was generated in a batch, so nobody has seen it yet. ' +
              'Look it over (the live preview above is the real thing), then approve it to unlock publishing.' +
              '<div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap">' +
              '<button class="primary" data-siteact="review-approve" data-id="' + esc(id) + '" data-batch="' + esc(body.review.batchId || '') + '" data-cid="' + esc(body.review.customId || '') + '">Approve this design</button>' +
              '<a class="ghost btnlink" href="#/batch" style="padding:0.35rem 0.7rem">Review the whole batch →</a>' +
              '</div></div>'
            : '<div id="launchPanel"></div>' + goLiveCard)
        : ''),
      'Build the site first, then publish it live.') +
    // reference material, kept out of the main flow
    '<details style="margin-top:1.2rem"><summary style="cursor:pointer;color:var(--muted);font-size:0.85rem">Build history &amp; checks</summary>' +
    (jobsHtml ? '<div class="tscroll"><table class="list"><thead><tr><th>Job</th><th>Kind</th><th>Status</th><th>When</th></tr></thead><tbody>' + jobsHtml + '</tbody></table></div>' : '<p style="font-size:0.82rem;color:var(--muted)">No builds yet.</p>') +
    '<div id="siteQa"></div></details>' +
    '<details style="margin-top:0.5rem"><summary style="cursor:pointer;color:var(--muted);font-size:0.85rem">Config (' + Object.keys(body.config).length + ' slots, ' + body.configHistory.length + ' prior versions)</summary>' +
    '<div class="codeblock"><pre>' + esc(JSON.stringify(body.config, null, 2)) + '</pre><button class="copybtn" type="button">Copy</button></div></details>' +
    // Danger zone: delete this site (with typed confirmation).
    '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--line)">' +
    '<button class="ghost danger" data-siteact="delete" data-id="' + esc(id) + '" data-name="' + esc(body.config.siteName || body.id) + '">Delete this site…</button>' +
    '<div id="deleteConfirm" style="margin-top:0.6rem"></div></div>';
  // A built site has already cleared essentials + moved past photos.
  stepState = { siteId: id, ready: built, hasPhotos: false, photosAck: built, built };
  refreshSiteSteps();
  loadSiteAssets(body.id);
  loadSiteContent(body.id);
  loadSitePreviewAndQa(body);
  if (built && body.review?.state !== 'pending') loadLaunchPanel(body.id);
}

/** Approve a batch design from the site itself, so the operator does not have
 *  to go hunting for it in Batch Building to unblock one publish. */
async function approveFromSite(siteId, batchId, customId) {
  if (!batchId || !customId) return;
  const { status, body } = await api('/v1/batches/' + batchId + '/builds/' + customId + '/approve', { method: 'POST' });
  if (status !== 200) { alert(body.error?.message || 'Could not approve this design.'); return; }
  openSiteDetail(siteId);
}

// The 4-step gated flow state for the open site, and its reactive render.
let stepState = null;
function stepStatus(n, s) {
  if (n === 1) return s.ready ? 'done' : 'active';
  if (n === 2) return !s.ready ? 'locked' : (s.hasPhotos || s.photosAck) ? 'done' : 'active';
  if (n === 3) return !s.ready ? 'locked' : s.built ? 'done' : 'active';
  return !s.built ? 'locked' : 'active'; // step 4, publish
}
function refreshSiteSteps() {
  const s = stepState;
  if (!s) return;
  document.querySelectorAll('#siteDetail .sstep').forEach((sec) => {
    const st = stepStatus(Number(sec.dataset.step), s);
    sec.classList.remove('done', 'active', 'locked');
    sec.classList.add(st);
    const pill = sec.querySelector('[data-role="status"]');
    if (pill) pill.textContent = st === 'done' ? '✓ Done' : st === 'active' ? 'Now' : 'Locked';
  });
  const bar = document.getElementById('siteStepper');
  if (bar) bar.innerHTML = ['The essentials', 'Photos & logo', 'Build', 'Publish'].map((label, i) => {
    const st = stepStatus(i + 1, s);
    return '<div class="stepchip ' + st + '"><span class="stepchip-n">' + (st === 'done' ? '✓' : (i + 1)) + '</span><span>' + esc(label) + '</span></div>';
  }).join('');
}

/* ══════════════ Content intake (DFY: facts in → AI writes the site) ══════════════ */
const FACT_SEP = /\s+[—–-]\s+|\s*[|]\s*/; // "Name - Role" / "A | B" splitters

/** Column keys for a `rows` field, from the field or from its data attribute. */
const colKeys = (f) => (Array.isArray(f?.columns) ? f.columns.map((c) => c.key) : String(f || '').split(',').filter(Boolean));

function parseFact(kind, raw, cols) {
  const text = raw || '';
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  switch (kind) {
    case 'list': case 'topics': return lines;
    case 'people': return lines.map((l) => { const [name, role] = l.split(FACT_SEP); return { name: (name || '').trim(), role: (role || '').trim() }; });
    case 'roles': return lines.map((l) => { const [title, ...rest] = l.split(FACT_SEP); return { title: (title || '').trim(), summary: rest.join(' - ').trim() }; });
    case 'products': return lines.map((l) => { const [name, price, ...rest] = l.split(FACT_SEP); return { name: (name || '').trim(), price: (price || '').trim(), note: rest.join(' - ').trim() }; });
    // Generic N-column rows. One kind serves every module that needs a small
    // table, so a new module adds a field and touches no UI code. Anything
    // past the last column folds back into it rather than being dropped.
    case 'rows': {
      const keys = colKeys(cols);
      if (!keys.length) return lines;
      return lines.map((l) => {
        const parts = l.split(FACT_SEP).map((p) => p.trim());
        const row = {};
        keys.forEach((k, i) => {
          row[k] = i === keys.length - 1 ? parts.slice(i).join(' - ').trim() : (parts[i] || '');
        });
        return row;
      });
    }
    default: return text.trim();
  }
}

function serializeFact(kind, val, cols) {
  if (val == null) return '';
  switch (kind) {
    case 'list': case 'topics': return Array.isArray(val) ? val.join('\n') : '';
    case 'people': return Array.isArray(val) ? val.map((p) => [p.name, p.role].filter(Boolean).join(' - ')).join('\n') : '';
    case 'roles': return Array.isArray(val) ? val.map((r) => [r.title, r.summary].filter(Boolean).join(' - ')).join('\n') : '';
    case 'products': return Array.isArray(val) ? val.map((p) => [p.name, p.price, p.note].filter(Boolean).join(' - ')).join('\n') : '';
    case 'rows': {
      const keys = colKeys(cols);
      return Array.isArray(val) ? val.map((r) => keys.map((k) => r?.[k]).filter(Boolean).join(' - ')).join('\n') : '';
    }
    default: return String(val);
  }
}

function factInput(f, val) {
  const req = f.required ? ' <span style="color:var(--bad)">*</span>' : '';
  const help = f.help ? '<p style="font-size:0.76rem;color:var(--muted);margin:0.15rem 0 0.35rem">' + esc(f.help) + '</p>' : '';
  const cols = colKeys(f).join(',');
  const v = esc(serializeFact(f.kind, val, f));
  const multiline = ['facts', 'list', 'topics', 'people', 'roles', 'products', 'rows'].includes(f.kind);
  const ph = f.kind === 'people' ? 'One per line:  Name - Role'
    : f.kind === 'roles' ? 'One per line:  Title - one-line summary'
    : f.kind === 'products' ? 'One per line:  Name - Price - note'
    : f.kind === 'rows' ? 'One per line:  ' + (f.columns || []).map((c) => c.label).join(' - ')
    : (f.kind === 'list' || f.kind === 'topics') ? 'One per line'
    : f.kind === 'facts' ? 'Notes are fine, the AI turns them into polished copy' : '';
  const colAttr = cols ? ' data-cols="' + esc(cols) + '"' : '';
  const control = multiline
    ? '<textarea data-fact="' + f.id + '" data-kind="' + f.kind + '"' + colAttr + ' rows="' + (f.kind === 'facts' ? 4 : 3) + '" placeholder="' + esc(ph) + '" style="width:100%;font-size:0.85rem">' + v + '</textarea>'
    : '<input data-fact="' + f.id + '" data-kind="' + f.kind + '"' + colAttr + ' type="' + (f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : 'text') + '" value="' + v + '" style="width:100%">';
  return '<div class="field"><label>' + esc(f.label) + req + '</label>' + help + control + '</div>';
}

function readyBadge(r) {
  if (r.ready) return '<div class="report ok">✓ All essentials answered, this will build a finished, shippable site.</div>';
  return '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + r.answeredCount + ' of ' + r.requiredCount +
    ' essentials answered. Still needed: <b>' + r.missing.map((m) => esc(m.label)).join(', ') + '</b></div>';
}

async function loadSiteContent(siteId) {
  const root = $('#siteContent');
  if (!root) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/content');
  if (status !== 200) { root.innerHTML = ''; return; }
  const byGroup = {};
  for (const f of body.fields) (byGroup[f.group] = byGroup[f.group] || []).push(f);
  let html = '<h3 style="margin-top:1.4rem;color:var(--ink)">Tell us about the business</h3>' +
    '<p style="font-size:0.85rem;color:var(--muted);margin:0.3rem 0 0.7rem">Answer the essentials (<span style="color:var(--bad)">*</span>) and the AI writes finished copy for every page, no placeholders, nothing left blank. Optional fields add more when you have them.</p>' +
    '<div id="contentReady">' + readyBadge(body.readiness) + '</div>';
  for (const [g, fields] of Object.entries(byGroup)) {
    html += '<div class="card" style="margin-top:0.6rem"><h3 style="margin-top:0">' + esc(body.groups[g] || g) + '</h3>' +
      fields.map((f) => factInput(f, body.facts[f.id])).join('') + '</div>';
  }
  html += '<div style="display:flex;gap:0.6rem;margin-top:0.7rem;flex-wrap:wrap;align-items:center">' +
    '<button class="primary" data-contentact="generate" data-id="' + esc(siteId) + '">✍ Write the copy with AI</button>' +
    '<span style="font-size:0.8rem;color:var(--muted)">Preview the words before you build.</span></div>' +
    '<div id="copyPreview" style="margin-top:0.6rem"></div>';
  root.innerHTML = html;
  if (body.copy) renderCopyPreview(body.copy, 'saved');
  if (stepState && stepState.siteId === siteId) { stepState.ready = Boolean(body.readiness?.ready); refreshSiteSteps(); }
}

let contentSaveTimer = null;
async function saveSiteContent() {
  const siteId = $('#siteContent')?.dataset.id;
  if (!siteId) return;
  const facts = {};
  document.querySelectorAll('#siteContent [data-fact]').forEach((el) => {
    facts[el.dataset.fact] = parseFact(el.dataset.kind, el.value, el.dataset.cols);
  });
  const { status, body } = await api('/v1/sites/' + siteId + '/content', { method: 'PATCH', body: { facts } });
  if (status === 200 && $('#contentReady')) $('#contentReady').innerHTML = readyBadge(body.readiness);
  if (status === 200 && stepState && stepState.siteId === siteId) { stepState.ready = Boolean(body.readiness?.ready); refreshSiteSteps(); }
}

async function generateSiteCopy(siteId) {
  const box = $('#copyPreview');
  box.innerHTML = '<div class="report ok">Writing your copy… the AI is drafting every page from your answers.</div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/content/generate', { method: 'POST' });
  if (status !== 200) { box.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not write the copy.') + '</div>'; return; }
  renderCopyPreview(body.copy, body.source);
}

function renderCopyPreview(copy, source) {
  const box = $('#copyPreview');
  if (!box) return;
  const P = (t) => '<p style="margin:0.2rem 0;font-size:0.86rem">' + esc(t) + '</p>';
  const sec = (title, inner) => inner ? '<div style="margin-top:0.55rem"><div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted)">' + esc(title) + '</div>' + inner + '</div>' : '';
  let html = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem"><h3 style="margin:0">The copy the AI wrote</h3>' +
    '<span style="font-size:0.72rem;color:var(--muted)">' + (source === 'ai' ? 'written by AI' : source === 'saved' ? 'saved draft' : 'auto-composed') + '</span></div>';
  html += sec('Tagline', P(copy.tagline));
  html += sec('Description', P(copy.description));
  if (copy.services?.length) html += sec('Services', '<ul style="margin:0.2rem 0;padding-left:1.1rem;font-size:0.84rem">' + copy.services.map((s) => '<li><b>' + esc(s.name) + '</b>' + (s.description ? ', ' + esc(s.description) : '') + '</li>').join('') + '</ul>');
  if (copy.about?.paragraphs?.length) html += sec('About', copy.about.paragraphs.map(P).join(''));
  if (copy.faq?.length) html += sec('FAQ', copy.faq.map((f) => '<p style="margin:0.3rem 0;font-size:0.84rem"><b>' + esc(f.question) + '</b><br>' + esc(f.answer) + '</p>').join(''));
  if (copy.careers?.roles?.length) html += sec('Roles', '<ul style="margin:0.2rem 0;padding-left:1.1rem;font-size:0.84rem">' + copy.careers.roles.map((r) => '<li><b>' + esc(r.title) + '</b>' + (r.summary ? ', ' + esc(r.summary) : '') + '</li>').join('') + '</ul>');
  html += '<p style="font-size:0.78rem;color:var(--muted);margin-top:0.5rem">This lands on the site when you build. Change any answer above and write it again to update.</p></div>';
  box.innerHTML = html;
}

/** Delete a site, but only after the operator types its name to confirm. */
function showDeleteConfirm(siteId, name) {
  const el = $('#deleteConfirm');
  if (!el) return;
  el.innerHTML =
    '<div class="card" style="margin:0;border-color:var(--bad)">' +
    '<p style="margin:0 0 0.6rem;font-size:0.86rem">This permanently deletes <b>' + esc(name) + '</b> and its build, photos, and history. It cannot be undone.</p>' +
    '<div class="field"><label>Type the site name to confirm</label><input id="delName" placeholder="' + esc(name) + '" spellcheck="false" autocomplete="off"></div>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.3rem">' +
    '<button class="ghost danger" data-siteact="delete-go" data-id="' + esc(siteId) + '" data-name="' + esc(name) + '">Delete permanently</button>' +
    '<button class="ghost" data-siteact="delete-cancel">Cancel</button></div>' +
    '<div id="delOut" style="margin-top:0.5rem"></div></div>';
  setTimeout(() => $('#delName')?.focus(), 50);
}

async function deleteSiteNow(siteId, name) {
  const typed = $('#delName')?.value.trim();
  if (typed !== name) { $('#delOut').innerHTML = '<div class="report err">The name does not match, so nothing was deleted.</div>'; return; }
  const { status, body } = await api('/v1/sites/' + siteId, { method: 'DELETE' });
  if (status !== 200) { $('#delOut').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not delete the site.') + '</div>'; return; }
  $('#siteDetail').innerHTML = '<div class="report ok">Deleted "' + esc(name) + '".</div>';
  loadSites();
}

/** Build (assemble + QA) with visible progress, then refresh the detail. */
async function buildSite(siteId) {
  const out = $('#siteActOut');
  // Nudge: don't let a first build go out with no logo or photos by accident.
  const alreadyBuilt = document.querySelector('[data-siteact="build"]')?.textContent.includes('Rebuild');
  if (!alreadyBuilt) {
    const st = await api('/v1/sites/' + siteId + '/assets');
    const anyAssets = st.status === 200 && Object.values(st.body.assets || {}).some((a) => a && a.length);
    if (!anyAssets) {
      const go = confirm('This site has no logo or photos yet.\n\nOK = build without them\nCancel = go add photos first');
      if (!go) { $('#siteAssets')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    }
  }
  out.innerHTML = '<div class="report ok" style="display:flex;align-items:center;gap:0.5rem"><span class="spin"></span><span>Preparing the site (writing any missing copy)…</span></div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/assemble', { method: 'POST', body: {} });
  if (status !== 202) {
    out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Build failed to start (' + status + ').') + '</div>';
    if (body.error?.code === 'content_incomplete') $('#siteContent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const started = Date.now();
  out.innerHTML = '<div class="report ok">Building… full checks take a few minutes.</div>';
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    let j;
    // The heavy build steps briefly block the server, ride through
    // dropped polls instead of silently stopping.
    try { j = await api('/v1/jobs/' + body.jobId); } catch { continue; }
    if (j.status !== 200) continue;
    if (j.body.status === 'done' || j.body.status === 'failed') {
      openSiteDetail(siteId);
      loadSites();
      const failDetail = j.body.status === 'failed' ? buildFailureDetail(j.body) : '';
      setTimeout(() => {
        $('#siteActOut').innerHTML = j.body.status === 'done'
          ? '<div class="report ok">✓ Built and checked, the preview above is the real site' + (j.body.result?.preview ? ', photos included' : '') + '.</div>'
          : '<div class="report err"><b>Build failed.</b> What the build reported:<br><pre style="white-space:pre-wrap;margin:0.4rem 0;font-size:0.78rem;max-height:14rem;overflow:auto">' + esc(failDetail).slice(0, 6000) + '</pre></div>';
      }, 400);
      return;
    }
    const last = j.body.logs?.at(-1)?.line || 'working…';
    const mins = Math.round((Date.now() - started) / 6000) / 10;
    out.innerHTML = '<div class="report ok">Building (' + mins + ' min): ' + esc(last.slice(0, 120)) + '</div>';
  }
}

/** Start (or reuse) a clickable live preview and embed it. `reopenTab` also
 *  pops it in a new browser tab. Runs `next start` on the operator's machine. */
async function openLivePreview(siteId, reopenTab) {
  const box = $('#livePreview');
  if (!reopenTab) box.innerHTML = '<div class="report ok">Starting a live preview server on your machine… the first start takes a few seconds.</div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/preview/live', { method: 'POST' });
  if (status !== 200) {
    box.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not start the live preview.') + '</div>';
    return;
  }
  const url = body.url;
  window.open(url, '_blank', 'noopener');
  box.innerHTML =
    '<div class="card" style="margin-top:0.4rem">' +
    '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.5rem">' +
    '<span style="color:var(--good);font-weight:600">● Live at <a href="' + esc(url) + '" target="_blank" rel="noopener"><code>' + esc(url) + '</code></a></span>' +
    '<button class="ghost" data-siteact="live-open" data-id="' + esc(siteId) + '">Open in new tab</button>' +
    (detailCms ? '<a class="ghost btnlink" href="' + esc(url) + '/admin" target="_blank" rel="noopener">Open admin (/admin)</a>' : '') +
    '<button class="ghost danger" data-siteact="live-stop" data-id="' + esc(siteId) + '">Stop preview</button>' +
    '</div>' +
    '<p style="font-size:0.8rem;color:var(--muted);margin:0 0 0.5rem">Click through the whole site, every page, with the client\'s real photos. It runs locally and stops on its own after 30 minutes idle.' +
      (detailCms ? ' The admin dashboard is at <code>/admin</code>, sign in with password <code>preview</code>.' : '') + '</p>' +
    '<iframe src="' + esc(url) + '" title="Live preview" style="width:100%;height:70vh;border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>' +
    '</div>';
}

async function stopLivePreview(siteId) {
  await api('/v1/sites/' + siteId + '/preview/live', { method: 'DELETE' });
  const box = $('#livePreview');
  if (box) box.innerHTML = '<div class="report">Live preview stopped.</div>';
}

/**
 * The "Publish this site" panel. One click to a live Vercel URL, or push to
 * GitHub. An agency that hosts every client on its OWN account sets a token
 * once (saved as the default) and never re-enters it: when a default exists we
 * show a ready-to-launch button, and the per-client override is tucked away for
 * the rarer case where the client owns their own hosting.
 */
async function loadLaunchPanel(siteId) {
  const host = document.getElementById('launchPanel');
  if (!host) return;
  let dt = {};
  try { const r = await api('/v1/sites/' + siteId + '/deploy-target'); dt = r.body || {}; } catch { /* fall through to entry fields */ }
  let dbInfo = {};
  if (detailCms) {
    try { const r = await api('/v1/sites/' + siteId + '/database'); dbInfo = r.body || {}; } catch { /* fall through to entry fields */ }
  }
  const vc = dt.vercel || {}; const gh = dt.github || {};
  const vcReady = Boolean(vc.site?.connected || vc.accountDefault);
  const vcVia = vc.site?.connected ? 'this client\'s own Vercel token'
    : vc.accountDefault ? 'your saved Vercel default' : null;
  const ghOwner = gh.site?.owner || gh.accountDefault?.owner || '';
  const ghReady = Boolean(gh.site?.connected || gh.accountDefault);
  const ghVia = gh.site?.connected ? 'this client\'s own GitHub token' : gh.accountDefault ? 'your saved GitHub default' : null;
  const info = (id, text) => '<button class="infoBtn" type="button" data-info="' + id + '" aria-label="What is this?">i</button>' +
    '<div class="tip" id="' + id + '" hidden>' + text + '</div>';

  // ── Vercel: the recommended one-click-to-live path ──
  const vercelBlock =
    '<div class="launchProv">' +
      '<div class="lpHead"><b>Publish to Vercel</b> ' + info('tipVc',
        'A Vercel token lets Stardrive upload the finished site and give you a live URL in about a minute. Create one at <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener">vercel.com/account/tokens</a> (the free Hobby tier works). Save it once as your default and every client site you build reuses it, no re-entering.') +
        ' <span class="lpTag">one click to a live URL</span></div>' +
      (vcReady
        ? '<p class="lpReady">Ready to go using <b>' + esc(vcVia) + '</b>. Publish and this client\'s site goes live under that account.</p>' +
          '<button class="primary" data-siteact="vercel-go" data-id="' + esc(siteId) + '">Publish to Vercel</button>' +
          '<details class="lpOverride"><summary>This client hosts on their own Vercel</summary>' +
            '<div class="field"><label>Their Vercel token</label><input id="vcToken" class="mono" type="password" autocomplete="off"></div>' +
            '<label class="checkline"><input type="checkbox" id="vcSaveSite"> Remember this token for this client only</label>' +
          '</details>'
        : '<div class="field"><label>Vercel token</label><input id="vcToken" class="mono" type="password" placeholder="paste your Vercel token" autocomplete="off"></div>' +
          '<label class="checkline"><input type="checkbox" id="vcSaveDefault" checked> Save as my Vercel default, reuse it for every site I build</label>' +
          '<button class="primary" data-siteact="vercel-go" data-id="' + esc(siteId) + '">Publish to Vercel</button>') +
    '</div>';

  // ── Database: vendor-neutral libSQL connection (CMS sites only) ──
  const dbSite = dbInfo.site; const dbDef = dbInfo.accountDefault;
  const dbReady = Boolean(dbSite?.connected || dbDef);
  const dbVia = dbSite?.connected ? 'this client\'s own database' : dbDef ? 'your saved database default' : null;
  const dbBlock = detailCms
    ? '<div class="launchProv">' +
        '<div class="lpHead"><b>Connect the database</b> ' + info('tipDb',
          'This site\'s admin needs a database to save edits. Any libSQL-compatible endpoint works, this is not locked to one vendor: <a href="https://turso.tech" target="_blank" rel="noopener">Turso</a> is the easiest hosted option (free tier), self-hosted libSQL/SQLite works too. Paste the database URL and its auth token (leave the token blank if your endpoint needs none). Publishing to Vercel wires it in automatically, no manual env vars to copy.') + '</div>' +
        (dbReady
          ? '<p class="lpReady">Using <b>' + esc(dbVia) + '</b>' + (dbSite?.url || dbDef?.url ? ' (' + esc(dbSite?.url || dbDef?.url) + ')' : '') + '. Publishing to Vercel wires it in automatically.</p>' +
            '<details class="lpOverride"><summary>Use a different database for this client</summary>' +
              '<div class="field"><label>Database URL</label><input id="dbUrl" class="mono" placeholder="libsql://your-db.turso.io" spellcheck="false"></div>' +
              '<div class="field"><label>Auth token (leave blank if none needed)</label><input id="dbToken" class="mono" type="password" autocomplete="off"></div>' +
              '<label class="checkline"><input type="checkbox" id="dbSaveSite" checked> Remember this database for this client only</label>' +
              '<div><button class="ghost" data-siteact="db-go" data-id="' + esc(siteId) + '">Save database</button></div>' +
            '</details>'
          : '<div class="field"><label>Database URL</label><input id="dbUrl" class="mono" placeholder="libsql://your-db.turso.io" spellcheck="false"></div>' +
            '<div class="field"><label>Auth token (leave blank if none needed)</label><input id="dbToken" class="mono" type="password" autocomplete="off"></div>' +
            '<label class="checkline"><input type="checkbox" id="dbSaveDefault" checked> Save as my database default, reuse it for every site I build</label>' +
            '<div><button class="ghost" data-siteact="db-go" data-id="' + esc(siteId) + '">Save database</button></div>') +
      '</div>'
    : '';

  // ── GitHub: push the code to any account, connect to any host ──
  const githubBlock =
    '<div class="launchProv">' +
      '<div class="lpHead"><b>Or push to GitHub</b> ' + info('tipGh',
        'Pushes the finished site (a standard Next.js repo, the engine is never included) to a GitHub account you choose. From there connect it to Vercel, Netlify, Cloudflare, or any host. Create a token at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a> with repo scope. Save it once and reuse it for every site.') + '</div>' +
      '<div class="grid2">' +
        '<div class="field"><label>GitHub owner (user or org)</label><input id="ghOwner" class="mono" value="' + esc(ghOwner) + '" placeholder="e.g. ada-web-co" spellcheck="false"></div>' +
        '<div class="field"><label>Repository name</label><input id="ghRepo" class="mono" placeholder="defaults to the site name" spellcheck="false"></div>' +
      '</div>' +
      (ghReady
        ? '<p class="lpReady">Using <b>' + esc(ghVia) + '</b>' + (ghOwner ? ' (' + esc(ghOwner) + ')' : '') + '. Leave the token blank to reuse it.</p>' +
          '<details class="lpOverride"><summary>Use a different GitHub token for this client</summary>' +
            '<div class="field"><label>Their GitHub token</label><input id="ghToken" class="mono" type="password" autocomplete="off"></div>' +
            '<label class="checkline"><input type="checkbox" id="ghSaveSite"> Remember this token for this client only</label>' +
          '</details>'
        : '<div class="field"><label>GitHub token</label><input id="ghToken" class="mono" type="password" placeholder="paste your GitHub token" autocomplete="off"></div>' +
          '<label class="checkline"><input type="checkbox" id="ghSaveDefault" checked> Save as my GitHub default, reuse it for every site I build</label>') +
      '<div style="margin-top:0.5rem"><button class="ghost" data-siteact="github-go" data-id="' + esc(siteId) + '">Push to GitHub</button></div>' +
    '</div>';

  host.innerHTML =
    '<div class="card launch">' +
      '<h3 style="margin:0 0 0.2rem">🚀 Publish this site</h3>' +
      '<p style="font-size:0.84rem;color:var(--body);margin:0 0 0.9rem">Take this finished site live. Set a token once and it becomes your default for every client, so you never enter it twice. Override per client only when they host it themselves. ' +
        '<a href="#/going-live">How all of this works</a>.</p>' +
      vercelBlock + dbBlock + githubBlock +
      '<div id="domainBlock"></div>' +
      '<div id="envBlock"></div>' +
      '<div id="handoffBlock"></div>' +
      '<div id="launchOut" style="margin-top:0.7rem"></div>' +
    '</div>';
  loadDomainPanel(siteId);
  loadEnvPanel(siteId);
  renderHandoffBlock(siteId);
}

/* ══════════════ Site settings (keys the built site needs) ══════════════ */
// The distinction this panel exists to make: some settings Stardrive fills in
// on its own, and some only the licensee has. Showing both, clearly separated,
// is what stops someone hunting for a value nobody ever needed from them.

async function loadEnvPanel(siteId) {
  const host = $('#envBlock');
  if (!host) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/env');
  if (status !== 200) { host.innerHTML = ''; return; }
  host.innerHTML = envPanelHtml(siteId, body);
}

function envPanelHtml(siteId, d) {
  const info = (id, text) => '<button class="infoBtn" type="button" data-info="' + id + '" aria-label="What is this?">i</button>' +
    '<div class="tip" id="' + id + '" hidden>' + text + '</div>';

  const supplied = (d.spec || []).filter((v) => v.source === 'supplied');
  const managed = (d.spec || []).filter((v) => v.source === 'managed');

  const fields = supplied.map((v) => {
    const set = d.set?.[v.name];
    const value = set?.value ? esc(set.value) : '';
    const state = set?.set
      ? '<span style="color:var(--ok);font-size:0.78rem">✓ saved</span>'
      : '<span style="color:var(--muted);font-size:0.78rem">not set</span>';
    return '<div class="field">' +
      '<label>' + esc(v.label || v.name) + ' ' + state + '</label>' +
      '<p style="font-size:0.76rem;color:var(--muted);margin:0.1rem 0 0.35rem">' + esc(v.why || '') +
        (v.where ? ' Get it from <b>' + esc(v.where) + '</b>.' : '') + '</p>' +
      '<input data-env="' + esc(v.name) + '" class="mono" type="' + (v.secret ? 'password' : 'text') + '"' +
        ' value="' + value + '" placeholder="' + (set?.set && v.secret ? 'saved, type to replace' : esc(v.name)) + '"' +
        ' autocomplete="off" style="width:100%">' +
    '</div>';
  }).join('');

  const managedList = managed.map((v) =>
    '<li><code>' + esc(v.name) + '</code> ' + esc(v.managedBy || '') + '</li>').join('');

  const missing = (d.missing || []).length
    ? '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' +
        esc(d.missing.length === 1 ? 'One setting is still missing: ' : d.missing.length + ' settings are still missing: ') +
        esc(d.missing.map((m) => m.label).join(', ')) +
        '. The site will publish and work, but those features stay switched off.</div>'
    : '<div class="report ok">✓ Everything this site needs is set.</div>';

  return '<div class="launchPart">' +
    '<div class="lpHead"><b>Site settings</b> ' + info('tipEnv',
      'The settings this site needs on whatever host it runs on. Stardrive fills in the ones it knows (the admin password it generated for your client, the database, the domain) and pushes them automatically when you publish. The ones below are the only things it cannot know: your own keys. Enter them once per site and every future publish reuses them.') + '</div>' +
    missing +
    fields +
    '<div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap">' +
      '<button class="primary" data-siteact="env-save" data-id="' + esc(siteId) + '">Save settings</button>' +
      '<button class="ghost" data-siteact="env-download" data-id="' + esc(siteId) + '">Download .env</button>' +
    '</div>' +
    '<p style="font-size:0.78rem;color:var(--muted);margin:0.5rem 0 0">Publishing from here wires all of these in for you. Download the .env file only if you are deploying somewhere Stardrive cannot reach, and never commit it.</p>' +
    (managedList ? '<details style="margin-top:0.6rem"><summary style="font-size:0.82rem;cursor:pointer">Handled for you (' + managed.length + ')</summary>' +
      '<ul style="font-size:0.78rem;color:var(--muted);margin:0.4rem 0 0;padding-left:1.1rem">' + managedList + '</ul></details>' : '') +
  '</div>';
}

async function saveEnv(siteId) {
  const values = {};
  document.querySelectorAll('[data-env]').forEach((el) => {
    // An untouched secret field is blank on purpose; sending that blank would
    // erase a key the licensee saved earlier and never meant to change.
    if (el.type === 'password' && !el.value) return;
    values[el.dataset.env] = el.value;
  });
  const out = $('#launchOut');
  if (!Object.keys(values).length) {
    if (out) out.innerHTML = '<div class="report">Nothing to save.</div>';
    return;
  }
  const { status, body } = await api('/v1/sites/' + siteId + '/env', { method: 'PUT', body: { values } });
  if (out) {
    out.innerHTML = status === 200
      ? '<div class="report ok">✓ Saved. Publish again to push these to the host.</div>'
      : '<div class="report err">' + esc(body.error?.message || 'Could not save (' + status + ').') + '</div>';
  }
  loadEnvPanel(siteId);
}

/* ══════════════ Client handoff ══════════════ */

function renderHandoffBlock(siteId) {
  const host = $('#handoffBlock');
  if (!host) return;
  host.innerHTML = '<div class="launchPart">' +
    '<div class="lpHead"><b>Hand over to your client</b></div>' +
    '<p style="font-size:0.84rem;color:var(--body);margin:0 0 0.6rem">A printable page with their sign-in details, what they can change themselves, and anything still worth knowing. Written for them, not for a developer. Read it first, then send it on.</p>' +
    '<div style="display:flex;gap:0.5rem;flex-wrap:wrap">' +
      '<button class="primary" data-siteact="handoff-open" data-id="' + esc(siteId) + '">Preview handoff</button>' +
      '<button class="ghost" data-siteact="handoff-download" data-id="' + esc(siteId) + '">Download</button>' +
      '<button class="ghost" data-siteact="handoff-rotate" data-id="' + esc(siteId) + '">New password</button>' +
    '</div>' +
    '<p style="font-size:0.78rem;color:var(--muted);margin:0.5rem 0 0">The page shows the client\'s password in full, so treat it like one.</p>' +
  '</div>';
}

/** Fetch an authenticated file and hand it to the browser as a download. The
 *  API key lives in a header, so a plain link would come back unauthorised. */
async function downloadAuthed(path, filename) {
  const res = await apiRaw(path);
  if (!res.ok) {
    const out = $('#launchOut');
    if (out) out.innerHTML = '<div class="report err">Could not prepare that download (' + res.status + ').</div>';
    return;
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function openHandoff(siteId) {
  const res = await apiRaw('/v1/sites/' + siteId + '/handoff');
  if (!res.ok) {
    const out = $('#launchOut');
    if (out) out.innerHTML = '<div class="report err">Could not build the handoff (' + res.status + ').</div>';
    return;
  }
  // Opened as a blob so the credentials never travel through a URL that a
  // browser would keep in its history.
  const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function rotateAdminPassword(siteId) {
  const out = $('#launchOut');
  if (!window.confirm('Give this site a new admin password?\n\nThe current one keeps working until you publish again. Anything you have already sent your client will be out of date.')) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/env/rotate-admin', { method: 'POST', body: {} });
  if (out) {
    out.innerHTML = status === 200
      ? '<div class="report ok">✓ New password: <code class="mono">' + esc(body.password) + '</code><br>' + esc(body.note) + '</div>'
      : '<div class="report err">' + esc(body.error?.message || 'Could not rotate (' + status + ').') + '</div>';
  }
}

/* ══════════════ Custom domain ══════════════ */
// Host-agnostic on purpose. Where Stardrive holds a token for the host it
// attaches and verifies for real; everywhere else it records the domain and
// shows what to set, without pretending to have checked a host it cannot see.

const DOMAIN_STATE = {
  live: { cls: 'ok', label: '✓ Live' },
  pending: { cls: 'warn', label: 'Waiting on DNS' },
  error: { cls: 'err', label: 'Needs attention' },
};

async function loadDomainPanel(siteId) {
  const host = $('#domainBlock');
  if (!host) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/domain');
  if (status !== 200) { host.innerHTML = ''; return; }
  host.innerHTML = domainPanelHtml(siteId, body);
}

function domainPanelHtml(siteId, d) {
  const info = (id, text) => '<button class="infoBtn" type="button" data-info="' + id + '" aria-label="What is this?">i</button>' +
    '<div class="tip" id="' + id + '" hidden>' + text + '</div>';
  const head = '<div class="lpHead"><b>Custom domain</b> ' + info('tipDom',
    'Point the client\'s own address at this site. Where you have connected the host (Vercel today) Stardrive attaches the domain and checks it for you. On any other host Stardrive records the domain and shows what to set, because it has no credentials there and will not guess DNS values on your behalf.') +
    ' <span class="lpTag">the last mile</span></div>';

  if (!d.domain) {
    return '<div class="launchProv">' + head +
      '<p style="font-size:0.84rem;color:var(--body);margin:0 0 0.6rem">Publishing gives you a working URL straight away. Add the client\'s own domain whenever you are ready, before or after the first publish.</p>' +
      '<div class="field"><label>Domain</label><input id="domInput" class="mono" placeholder="theclient.com" spellcheck="false" autocomplete="off"></div>' +
      '<label class="checkline"><input type="checkbox" id="domWww" checked> Also serve www.</label>' +
      '<div><button class="ghost" data-siteact="domain-save" data-id="' + esc(siteId) + '">Save domain</button></div>' +
    '</div>';
  }

  const st = DOMAIN_STATE[d.domain.state] || DOMAIN_STATE.pending;
  const rows = (d.records || []).map((r) =>
    '<tr><td><code>' + esc(r.type) + '</code></td><td><code>' + esc(r.host) + '</code></td>' +
    '<td>' + (r.value
      ? '<code>' + esc(r.value) + '</code>'
      : '<span style="color:var(--muted);font-size:0.8rem">' + esc(r.note || 'the value your host gives you') + '</span>') + '</td></tr>').join('');

  // What the studio can hand its client verbatim.
  const handoff = 'Domain: ' + d.domain.name + '\n'
    + (d.records || []).map((r) => `${r.type}  ${r.host}  ${r.value || '<the value your host gives you>'}`).join('\n')
    + '\n\nOn the host, set:\n' + d.siteUrlEnv + '=' + d.siteUrlValue;

  return '<div class="launchProv">' + head +
    '<p style="font-size:0.86rem;margin:0 0 0.5rem"><code>' + esc(d.domain.name) + '</code> ' +
      '<span class="brow-state ' + st.cls + '">' + st.label + '</span>' +
      (d.domain.attachedTo ? ' <span style="font-size:0.78rem;color:var(--muted)">attached on ' + esc(d.domain.attachedTo) + '</span>' : '') + '</p>' +
    (d.domain.message ? '<p style="font-size:0.82rem;color:var(--body);margin:0 0 0.6rem">' + esc(d.domain.message) + '</p>' : '') +
    (d.manageable
      ? '<p class="bhint">Stardrive manages this domain on your connected host: publish the site and it is attached and checked automatically.</p>'
      : '<p class="bhint">This site does not publish through a host Stardrive holds a token for, so add these records at your registrar yourself. The values come from your host, not from us.</p>') +
    (rows
      ? '<div class="tscroll"><table class="list"><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '') +
    '<p style="font-size:0.82rem;color:var(--body);margin:0.6rem 0 0.3rem">Set this on the host too, or the site keeps advertising the wrong address in <code>robots.txt</code> and <code>sitemap.xml</code>:</p>' +
    '<div class="codeblock"><pre>' + esc(d.siteUrlEnv + '=' + d.siteUrlValue) + '</pre><button class="copybtn" type="button">Copy</button></div>' +
    '<details style="margin-top:0.6rem"><summary style="cursor:pointer;font-size:0.82rem;color:var(--muted)">Send this to the client</summary>' +
      '<div class="codeblock"><pre>' + esc(handoff) + '</pre><button class="copybtn" type="button">Copy</button></div></details>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.7rem;flex-wrap:wrap">' +
      (d.manageable ? '<button class="ghost" data-siteact="domain-check" data-id="' + esc(siteId) + '">Check again</button>' : '') +
      '<button class="ghost danger" data-siteact="domain-remove" data-id="' + esc(siteId) + '">Remove domain</button>' +
    '</div>' +
    '<div id="domainOut" style="margin-top:0.5rem"></div>' +
  '</div>';
}

async function saveDomain(siteId) {
  const name = $('#domInput')?.value.trim();
  const out = $('#launchOut');
  if (!name) { $('#domInput')?.focus(); return; }
  const { status, body } = await api('/v1/sites/' + siteId + '/domain', {
    method: 'PUT', body: { name, addWww: $('#domWww')?.checked !== false },
  });
  if (status !== 200) { out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not save that domain.') + '</div>'; return; }
  $('#domainBlock').innerHTML = domainPanelHtml(siteId, body);
}

async function checkDomain(siteId) {
  const out = $('#domainOut');
  if (out) out.innerHTML = '<div class="report" style="background:var(--code-bg);color:var(--muted)">Checking with your host…</div>';
  const { status, body } = await api('/v1/sites/' + siteId + '/domain/verify', { method: 'POST' });
  if (status !== 200) {
    if (out) out.innerHTML = '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + esc(body.error?.message || 'Could not check right now.') + '</div>';
    return;
  }
  $('#domainBlock').innerHTML = domainPanelHtml(siteId, body);
}

async function removeDomain(siteId) {
  if (!confirm('Stop tracking this domain?\n\nAny DNS records you added stay at your registrar; Stardrive just forgets it.')) return;
  await api('/v1/sites/' + siteId + '/domain', { method: 'DELETE' });
  loadDomainPanel(siteId);
}

async function publishVercel(siteId) {
  const out = $('#launchOut');
  const token = $('#vcToken')?.value.trim() || '';
  const saveDefault = $('#vcSaveDefault')?.checked;
  const saveSite = $('#vcSaveSite')?.checked;
  out.innerHTML = '<div class="report ok">Publishing to Vercel, uploading and building. This can take a minute…</div>';
  // Saving as the account default (agency mode) stores it once for every site.
  if (token && saveDefault) {
    const s = await api('/v1/connections/vercel', { method: 'PUT', body: { token } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the Vercel token.') + '</div>'; return; }
  }
  const payload = {};
  if (token) payload.token = token;
  if (saveSite) payload.save = true;
  const { status, body } = await api('/v1/sites/' + siteId + '/deploy/vercel', { method: 'POST', body: payload });
  out.innerHTML = status === 200
    ? '<div class="report ok">✓ ' + esc(body.note || 'Published to Vercel.') + (body.url ? ' Live at <a href="' + esc(body.url) + '" target="_blank" rel="noopener">' + esc(body.url) + '</a>.' : '') + (body.inspectorUrl ? ' <a href="' + esc(body.inspectorUrl) + '" target="_blank" rel="noopener">Build logs</a>.' : '') + '</div>'
    : '<div class="report err">' + esc(body.error?.message || 'Publish failed (' + status + ').') + '</div>';
}

async function deployGithub(siteId) {
  const out = $('#launchOut');
  const owner = $('#ghOwner')?.value.trim() || '';
  const repo = $('#ghRepo')?.value.trim() || '';
  const token = $('#ghToken')?.value.trim() || '';
  const saveDefault = $('#ghSaveDefault')?.checked;
  const saveSite = $('#ghSaveSite')?.checked;
  out.innerHTML = '<div class="report ok">Pushing the site to GitHub…</div>';
  if (token && saveDefault) {
    const s = await api('/v1/connections/github', { method: 'PUT', body: { token, ...(owner ? { owner } : {}) } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the GitHub token.') + '</div>'; return; }
  }
  const payload = {};
  if (owner) payload.owner = owner;
  if (repo) payload.repo = repo;
  if (token) payload.token = token;
  if (saveSite) payload.save = true;
  const { status, body } = await api('/v1/sites/' + siteId + '/deploy', { method: 'POST', body: payload });
  out.innerHTML = status === 200
    ? '<div class="report ok">✓ Pushed to <a href="' + esc(body.url) + '" target="_blank" rel="noopener">' + esc(body.repo) + '</a> (' + body.files + ' files' + (body.createdRepo ? ', repo created' : '') + '). ' + esc(body.note) + '</div>'
    : '<div class="report err">' + esc(body.error?.message || 'Push failed (' + status + ').') + '</div>';
}

/** Save a database connection (vendor-neutral libSQL: url + optional auth
 *  token). Not a deploy itself, publishing to Vercel wires it in after. */
async function saveDatabase(siteId) {
  const out = $('#launchOut');
  const url = $('#dbUrl')?.value.trim() || '';
  const authToken = $('#dbToken')?.value.trim() || '';
  const saveDefault = $('#dbSaveDefault')?.checked;
  const saveSite = $('#dbSaveSite')?.checked;
  if (!url) { out.innerHTML = '<div class="report err">A database URL is required (libsql://… or https://…).</div>'; return; }
  out.innerHTML = '<div class="report ok">Saving the database connection…</div>';
  if (saveDefault) {
    const s = await api('/v1/connections/turso', { method: 'PUT', body: { token: authToken, url } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the database.') + '</div>'; return; }
  }
  if (saveSite) {
    const s = await api('/v1/sites/' + siteId + '/database', { method: 'POST', body: { url, authToken } });
    if (s.status !== 200) { out.innerHTML = '<div class="report err">' + esc(s.body.error?.message || 'Could not save the database.') + '</div>'; return; }
  }
  await loadLaunchPanel(siteId);
  const out2 = $('#launchOut');
  if (out2) out2.innerHTML = '<div class="report ok">✓ Database connected. Publishing to Vercel will wire it in automatically, no manual env vars.</div>';
}

/** Visual preview (full-QA screenshot) + the latest job's QA report. */
async function loadSitePreviewAndQa(site) {
  // Preview image, if the full QA tier captured one.
  try {
    const res = await fetch('/v1/sites/' + site.id + '/preview', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      $('#sitePreview').innerHTML =
        '<div style="margin:0.6rem 0 0.9rem"><img src="' + url + '" alt="Site preview" style="max-width:100%;border:1px solid var(--line);border-radius:10px"><div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem">Home-page snapshot from the last build. Press <b style="color:var(--ink)">Open live preview</b> to click through the whole site.</div></div>';
    }
  } catch { /* no preview, fine */ }
  // QA report of the most recent finished job.
  const last = [...(site.jobs || [])].reverse().find((j) => j.status === 'done' || j.status === 'failed');
  if (!last) return;
  const { status, body } = await api('/v1/jobs/' + last.id);
  const qa = status === 200 ? body.result?.qa : null;
  if (!qa?.checks?.length) return;
  $('#siteQa').innerHTML =
    '<details style="margin-top:0.8rem"' + (qa.verdict !== 'passed' ? ' open' : '') + '><summary style="cursor:pointer;font-size:0.85rem;color:' + (qa.verdict === 'passed' ? 'var(--good)' : 'var(--warn)') + '">QA (' + esc(qa.mode) + '): ' + esc(qa.verdict) + ', ' + qa.checks.filter((c) => c.status === 'pass').length + '/' + qa.checks.length + ' checks</summary>' +
    '<ul style="list-style:none;margin:0.5rem 0 0;padding:0;display:grid;gap:0.25rem;font-size:0.82rem">' +
    qa.checks.map((c) => '<li>' + (c.status === 'pass' ? '<span style="color:var(--good)">✓</span> ' : '<span style="color:var(--bad)">✗</span> ') + esc(c.name) + (c.detail ? ' <span style="color:var(--muted)">· ' + esc(c.detail) + '</span>' : '') + '</li>').join('') +
    '</ul></details>';
}

/** One upload compartment. Shared by the Sites photo step and the Batch
 *  Building row, which differ only in which endpoint the buttons talk to
 *  (`attrs` names the data-attributes each one's handlers listen for). */
function assetSlotCard(slot, items, attrs) {
  return '<div class="card">' +
    '<h3 style="margin-top:0">' + esc(slot.label) + ' <span style="color:var(--muted);font-weight:400;font-size:0.78rem">' + items.length + ' / ' + slot.max + (slot.declaredBy ? ' · from ' + esc(slot.declaredBy) : '') + '</span></h3>' +
    '<p style="font-size:0.8rem;color:var(--muted);margin:0.2rem 0 0.6rem">' + esc(slot.description) + ' <span style="font-family:var(--mono);font-size:0.72rem">→ ' + esc(slot.target) + '</span></p>' +
    (items.length ? '<ul style="list-style:none;margin:0 0 0.6rem;padding:0;display:grid;gap:0.35rem">' + items.map((a) =>
      '<li style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem"><code>' + esc(a.filename) + '</code>' +
      '<span style="color:var(--muted)">' + Math.max(1, Math.round(a.bytes / 1024)) + ' KB</span>' +
      '<button class="ghost danger" ' + attrs.del + '="' + esc(a.id) + '" data-slot="' + esc(slot.id) + '" style="margin-left:auto;padding:0.1rem 0.5rem;font-size:0.72rem">Remove</button></li>').join('') + '</ul>' : '') +
    (items.length < slot.max
      ? '<input type="file" ' + attrs.upload + '="' + esc(slot.id) + '" accept="' + slot.accept.map((e) => '.' + e).join(',') + '" style="font-size:0.78rem;max-width:100%">'
      : '<div style="font-size:0.78rem;color:var(--muted)">Compartment full.</div>') +
  '</div>';
}

/**
 * A design's screenshot, with a lettered plate when there is none (previews
 * are only captured by the full QA tier). Rendered as markup plus a wired-up
 * error handler rather than an inline onerror, because the fallback text is
 * user data and would break out of an HTML attribute.
 */
function thumbHtml(src, letter, cls) {
  return '<img class="' + cls + '" src="' + esc(src) + '" alt="" loading="lazy"' +
    ' data-thumb="' + esc(cls.replace('-shot', '-noshot')) + '" data-letter="' + esc(letter) + '">';
}

/** Swap any failed thumbnail for its plate. Call after inserting markup. */
function wireThumbFallbacks(root) {
  const scope = root || document;
  scope.querySelectorAll('img[data-thumb]').forEach((img) => {
    img.addEventListener('error', () => {
      const plate = document.createElement('div');
      plate.className = img.dataset.thumb;
      plate.textContent = img.dataset.letter;
      img.replaceWith(plate);
    }, { once: true });
  });
  // Images that should just disappear when there is nothing to show.
  scope.querySelectorAll('img[data-drop-on-error]').forEach((img) => {
    img.addEventListener('error', () => img.remove(), { once: true });
  });
}

const initialOf = (s) => String(s || '?').replace(/^d4-/, '').slice(0, 1).toUpperCase();

/** A picked file as base64, ready for an upload endpoint. */
function fileAsBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function loadSiteAssets(siteId) {
  const root = $('#siteAssets');
  if (!root) return;
  const { status, body } = await api('/v1/sites/' + siteId + '/assets');
  if (status !== 200) { root.innerHTML = '<div class="report err">Could not load assets (' + status + ').</div>'; return; }
  root.innerHTML = body.slots
    .map((slot) => assetSlotCard(slot, body.assets[slot.id] || [], { upload: 'data-upload', del: 'data-assetdel' }))
    .join('');
  if (stepState && stepState.siteId === siteId) {
    stepState.hasPhotos = body.slots.some((slot) => (body.assets[slot.id] || []).length > 0);
    refreshSiteSteps();
  }
}

$('#view-sites').addEventListener('change', async (e) => {
  const input = e.target.closest('input[data-upload]');
  if (!input || !input.files.length) return;
  const siteId = $('#siteAssets').dataset.id;
  const file = input.files[0];
  if (file.size > 8_000_000) { alert('Files must be at most 8 MB.'); input.value = ''; return; }
  const b64 = await fileAsBase64(file);
  const { status, body } = await api('/v1/sites/' + siteId + '/assets/' + input.dataset.upload, {
    method: 'POST', body: { filename: file.name, contentBase64: b64 },
  });
  if (status !== 201) alert(body.error?.message || 'Upload failed (' + status + ').');
  loadSiteAssets(siteId);
});

// Debounced auto-save of the content intake as the operator types.
$('#siteDetail').addEventListener('input', (e) => {
  if (!e.target.matches('[data-fact]')) return;
  clearTimeout(contentSaveTimer);
  contentSaveTimer = setTimeout(saveSiteContent, 700);
});

$('#siteDetail').addEventListener('click', async (e) => {
  const del = e.target.closest('button[data-assetdel]');
  if (del) {
    const siteId = $('#siteAssets').dataset.id;
    await api('/v1/sites/' + siteId + '/assets/' + del.dataset.slot + '/' + del.dataset.assetdel, { method: 'DELETE' });
    loadSiteAssets(siteId);
    return;
  }
  const cbtn = e.target.closest('button[data-contentact]');
  if (cbtn) {
    if (cbtn.dataset.contentact === 'generate') generateSiteCopy(cbtn.dataset.id);
    return;
  }
  const infoBtn = e.target.closest('button[data-info]');
  if (infoBtn) {
    const tip = document.getElementById(infoBtn.dataset.info);
    if (tip) tip.hidden = !tip.hidden;
    return;
  }
  const btn = e.target.closest('button[data-siteact]');
  if (!btn) return;
  if (btn.dataset.siteact === 'build') { buildSite(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'photos-skip') {
    if (stepState) { stepState.photosAck = true; refreshSiteSteps(); }
    document.querySelector('#siteDetail .sstep[data-step="3"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (btn.dataset.siteact === 'delete') { showDeleteConfirm(btn.dataset.id, btn.dataset.name); return; }
  if (btn.dataset.siteact === 'delete-cancel') { const el = $('#deleteConfirm'); if (el) el.innerHTML = ''; return; }
  if (btn.dataset.siteact === 'delete-go') { deleteSiteNow(btn.dataset.id, btn.dataset.name); return; }
  if (btn.dataset.siteact === 'live') { openLivePreview(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'live-stop') { stopLivePreview(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'live-open') { openLivePreview(btn.dataset.id, true); return; }
  if (btn.dataset.siteact === 'domain-save') { saveDomain(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'domain-check') { checkDomain(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'domain-remove') { removeDomain(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'review-approve') { approveFromSite(btn.dataset.id, btn.dataset.batch, btn.dataset.cid); return; }
  if (btn.dataset.siteact === 'env-save') { saveEnv(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'env-download') { downloadAuthed('/v1/sites/' + btn.dataset.id + '/env/file', 'site.env'); return; }
  if (btn.dataset.siteact === 'handoff-open') { openHandoff(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'handoff-download') { downloadAuthed('/v1/sites/' + btn.dataset.id + '/handoff?download=1', 'client-handoff.html'); return; }
  if (btn.dataset.siteact === 'handoff-rotate') { rotateAdminPassword(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'vercel-go') { publishVercel(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'github-go') { deployGithub(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'db-go') { saveDatabase(btn.dataset.id); return; }
  if (btn.dataset.siteact === 'export') {
    // Real export streams a .tar.gz, fetch with auth and trigger a download.
    const res = await fetch('/v1/sites/' + btn.dataset.id + '/export', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'site.tar.gz';
      a.click();
      URL.revokeObjectURL(a.href);
      $('#siteActOut').innerHTML = '<div class="report ok">Downloaded the assembled site, a standalone Next.js project (the engine is never included).</div>';
    } else {
      const body = await res.json().catch(() => ({}));
      $('#siteActOut').innerHTML = '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + esc(body.error?.message || 'Export unavailable.') + '</div>';
    }
    return;
  }
});

$('#assembleBtn').addEventListener('click', async () => {
  const out = $('#assembleOut');
  const templateId = $('#siteTemplateSel').value;
  const siteName = $('#siteNameInput').value.trim();
  if (!getApiKey()) { out.innerHTML = '<div class="report err">Save an API key first (top right).</div>'; return; }
  if (!templateId || !siteName) { out.innerHTML = '<div class="report err">Pick a base template and give the site a name.</div>'; return; }
  const config = { siteName };
  const tagline = $('#siteTaglineInput').value.trim();
  if (tagline) config.tagline = tagline;
  // Feature toggles → real engine modules, layered onto the base at assembly
  // (catalog templates AND your own imported templates alike).
  const mods = [...document.querySelectorAll('#assembleFeatures input:checked')]
    .map((c) => FEATURE_BY_ID[c.dataset.assemblefeat]?.module).filter(Boolean);
  if (mods.length) config.modules = mods;
  // Create WITHOUT building: photos go in first so the first build's
  // preview shows the client's real images.
  const { status, body } = await api('/v1/sites', { method: 'POST', body: { templateId, config, assemble: false } });
  if (status !== 201) {
    out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not create the site (' + status + ').') + '</div>';
    return;
  }
  out.innerHTML = '<div class="report ok">✓ Created, now add the client\'s photos below, then press <b>Build site</b>.</div>';
  $('#siteNameInput').value = ''; $('#siteTaglineInput').value = '';
  loadSites();
  openSiteDetail(body.siteId);
  setTimeout(() => $('#siteDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
});

/* ══════════════ Connections ══════════════ */
async function loadConnections() {
  if (!getApiKey()) { $('#connNote').innerHTML = '<div class="report err">Save an API key first (top right).</div>'; return; }
  const { status, body } = await api('/v1/connections');
  if (status !== 200) {
    $('#connNote').innerHTML = '<div class="report err">' + (status === 403 ? 'This key lacks the deploy scope, mint one with --scopes mappings,templates,sites,deploy.' : 'Could not load connections (' + status + ').') + '</div>';
    return;
  }
  $('#connNote').innerHTML = '';
  for (const card of document.querySelectorAll('#connGrid .card')) {
    const c = body.connections[card.dataset.provider];
    card.querySelector('[data-role="status"]').style.display = c.connected ? '' : 'none';
    card.querySelector('[data-act="disconnect"]').style.display = c.connected ? '' : 'none';
    card.querySelector('[data-role="state"]').textContent = c.connected
      ? 'Connected · ' + (c.url ? c.url + ' · ' : '') + (c.last4 ? 'ends in ' + c.last4 + ' · ' : '') + (c.owner ? c.owner + ' · ' : '') + 'saved ' + (c.updatedAt || '').slice(0, 10)
      : 'Not connected.';
  }
}

$('#connGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  const provider = card.dataset.provider;
  if (btn.dataset.act === 'save') {
    const token = card.querySelector('[data-role="token"]').value.trim();
    const owner = card.querySelector('[data-role="owner"]')?.value.trim();
    const url = card.querySelector('[data-role="url"]')?.value.trim();
    const { status, body } = await api('/v1/connections/' + provider, { method: 'PUT', body: { token, ...(owner ? { owner } : {}), ...(url ? { url } : {}) } });
    if (status === 200) {
      card.querySelector('[data-role="token"]').value = '';
      flash(btn, 'Saved ✓');
      loadConnections();
    } else {
      $('#connNote').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Save failed (' + status + ').') + '</div>';
    }
  }
  if (btn.dataset.act === 'disconnect') {
    if (!confirm('Disconnect ' + provider + '? Deploys will need it re-added.')) return;
    await api('/v1/connections/' + provider, { method: 'DELETE' });
    loadConnections();
  }
});

/* ══════════════ API Reference ══════════════ */
const REF = [
  { group: 'Getting oriented', items: [
    { m: 'GET', p: '/v1/health', d: 'Service status. No key needed.', curl: `curl {BASE}/v1/health` },
    { m: 'GET', p: '/v1', d: 'Lists the whole surface. No key needed.', curl: `curl {BASE}/v1` },
  ]},
  { group: 'Mappings, your questionnaire, declaratively', items: [
    { m: 'POST', p: '/v1/mappings/validate', d: 'Full-report validation of a mapping document.',
      curl: `curl -X POST {BASE}/v1/mappings/validate \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d @my-mapping.json` },
    { m: 'POST', p: '/v1/intake/parse', d: 'Run answers through a mapping (inline or stored) → proposed site config.',
      curl: `curl -X POST {BASE}/v1/intake/parse \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"mappingId":"my-intake","answers":{"Q1":"Acme Fixture Works"}}'` },
    { m: 'PUT', p: '/v1/mappings/{id}', d: 'Store a mapping by id (validated; private to your account).',
      curl: `curl -X PUT {BASE}/v1/mappings/my-intake \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d @my-mapping.json` },
    { m: 'GET', p: '/v1/mappings', d: 'List your stored mappings.', curl: `curl {BASE}/v1/mappings -H "Authorization: Bearer {KEY}"` },
    { m: 'DELETE', p: '/v1/mappings/{id}', d: 'Delete a stored mapping.', curl: `curl -X DELETE {BASE}/v1/mappings/my-intake -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Templates, the shared catalog + your private imports', items: [
    { m: 'GET', p: '/v1/templates', d: 'The bundled d4 catalog plus your imports.', curl: `curl {BASE}/v1/templates -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/templates/{name}', d: 'Full manifest (and import warnings, for yours).', curl: `curl {BASE}/v1/templates/d4-site-template -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/templates', d: 'Import a template bundle {manifest, files[]}. Errors reject; warnings import. Private to your account.',
      curl: `curl -X POST {BASE}/v1/templates \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d @my-template.bundle.json` },
    { m: 'POST', p: '/v1/templates/validate', d: 'Validate a manifest alone (no import).',
      curl: `curl -X POST {BASE}/v1/templates/validate \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"manifest":{"name":"my-template","version":"1.0.0","kind":"site","description":"…","provides":{"routes":["/"],"nav":[],"adminPanels":[],"collections":[]},"copy":[{"from":"files","to":"."}]}}'` },
    { m: 'DELETE', p: '/v1/templates/{name}', d: 'Delete one of YOUR imports (the shared catalog is protected).', curl: `curl -X DELETE {BASE}/v1/templates/my-template -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Sites & jobs, assemble, watch, change', items: [
    { m: 'POST', p: '/v1/sites', d: 'Assemble from explicit config, or mappingId+answers in one step. Returns an async job.',
      curl: `curl -X POST {BASE}/v1/sites \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"templateId":"d4-site-template","config":{"siteName":"Acme Fixture Works","modules":["d4-cms-core"]}}'` },
    { m: 'GET', p: '/v1/jobs/{id}', d: 'Job status + logs + the QA report.', curl: `curl {BASE}/v1/jobs/{jobId} -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/sites', d: 'List your sites (yours alone), newest first.', curl: `curl {BASE}/v1/sites -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/sites/{id}', d: 'Site record: config, history, job summaries.', curl: `curl {BASE}/v1/sites/{siteId} -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/change', d: 'Shallow config delta → re-assemble; history kept.',
      curl: `curl -X POST {BASE}/v1/sites/{siteId}/change \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"config":{"tagline":"A new line."}}'` },
    { m: 'GET', p: '/v1/sites/{id}/assets', d: 'The site’s asset compartments (standard, per-page hero backgrounds for the pages this site has, and template-declared) and what’s in them.', curl: `curl {BASE}/v1/sites/{siteId}/assets -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/assets/{slot}', d: 'Upload into a compartment (logo, favicon, hero, about, gallery, team, misc; per-page hero backgrounds hero-about, hero-contact, hero-gallery, hero-careers, …), slotted to its exact site path at the next assembly.',
      curl: `curl -X POST {BASE}/v1/sites/{siteId}/assets/logo \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"filename":"logo.svg","contentBase64":"…"}'` },
    { m: 'DELETE', p: '/v1/sites/{id}/assets/{slot}/{assetId}', d: 'Remove an uploaded asset.', curl: `curl -X DELETE {BASE}/v1/sites/{siteId}/assets/logo/{assetId} -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/assemble', d: 'Re-assemble with the current config + latest assets.', curl: `curl -X POST {BASE}/v1/sites/{siteId}/assemble -H "Authorization: Bearer {KEY}" -d '{}'` },
    { m: 'POST', p: '/v1/sites/{id}/deploy', d: 'Push the finished site to GitHub (this request > this site\'s saved target > your account default).', curl: `curl -X POST {BASE}/v1/sites/{siteId}/deploy -H "Authorization: Bearer {KEY}" -d '{}'` },
    { m: 'POST', p: '/v1/sites/{id}/deploy/vercel', d: 'One-click publish to Vercel and get a live URL (token: request > site > account default). Auto-wires a connected database as Vercel env vars.', curl: `curl -X POST {BASE}/v1/sites/{siteId}/deploy/vercel -H "Authorization: Bearer {KEY}" -d '{}'` },
    { m: 'GET', p: '/v1/content/fields', d: 'The intake questions a build with these features would have to answer, before any site exists. ?features=blog,careers or ?modules=d4-insights-blog.',
      curl: `curl "{BASE}/v1/content/fields?features=careers" -H "Authorization: Bearer {KEY}"` },
    { m: 'PUT', p: '/v1/sites/{id}/domain', d: 'Set the client\'s own domain. Host-agnostic: on a host you have connected it is attached and verified for real; on any other host the DNS shape and the NEXT_PUBLIC_SITE_URL value are handed to you rather than guessed.',
      curl: `curl -X PUT {BASE}/v1/sites/{siteId}/domain \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"name":"theclient.com","addWww":true}'` },
    { m: 'GET', p: '/v1/sites/{id}/domain', d: 'The domain, its state, the DNS records to set, and whether Stardrive can manage it on this site\'s host.', curl: `curl {BASE}/v1/sites/{siteId}/domain -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/domain/verify', d: 'Re-check the domain with the host. DNS is never instant, so this is meant to be run again.', curl: `curl -X POST {BASE}/v1/sites/{siteId}/domain/verify -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/templates/{name}/thumbnail', d: 'The design\'s own screenshot (PNG), captured by the full QA tier when a site is built from it. 404 when there is none.', curl: `curl {BASE}/v1/templates/{name}/thumbnail -H "Authorization: Bearer {KEY}" -o design.png` },
    { m: 'GET', p: '/v1/studio/draft', d: 'The saved Studio design: brief, features, and the refine conversation, so work survives a reload.', curl: `curl {BASE}/v1/studio/draft -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches', d: 'Batch Building (Agency): queue up to 20 builds in one overnight run on the provider Batch API — each build gets a template design + AI copy, then assembles to a ready site. Send { builds: [ … ] }, or an empty body to submit your saved draft. Every build is readiness-checked FIRST: if any is missing required answers, nothing is submitted and 422 lists them per build.',
      curl: `curl -X POST {BASE}/v1/batches \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"builds":[{"name":"Solstice Bakery","siteName":"Solstice Bakery","prompt":"A warm bakery site.","features":["contact-form"],"facts":{"whatYouDo":"We bake bread","aboutFacts":"Family run since 2019","services":["Sourdough"],"contactEmail":"hi@solstice.example"}}]}'` },
    { m: 'GET', p: '/v1/batches', d: 'Your batches (newest first) plus the backlog of builds queued for the next cycle.', curl: `curl {BASE}/v1/batches -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/batches/draft', d: 'The saved build list: every row with its modules, staged photo count, and what it still needs before it can be submitted.', curl: `curl {BASE}/v1/batches/draft -H "Authorization: Bearer {KEY}"` },
    { m: 'PUT', p: '/v1/batches/draft', d: 'Save the build list. Rows keep their rowId; a dropped row takes its staged photos with it.',
      curl: `curl -X PUT {BASE}/v1/batches/draft \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"rows":[{"name":"Solstice Bakery","siteName":"Solstice Bakery","prompt":"A warm bakery site.","features":["contact-form"],"facts":{}}]}'` },
    { m: 'POST', p: '/v1/batches/draft/rows/{rowId}/assets/{slot}', d: 'Stage a photo or logo for a queued build. Adopted onto that build\'s site the moment the batch creates it, so the overnight build already has it.',
      curl: `curl -X POST {BASE}/v1/batches/draft/rows/{rowId}/assets/logo \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"filename":"logo.svg","contentBase64":"…"}'` },
    { m: 'GET', p: '/v1/batches/{id}', d: 'One batch with per-build status (generating/assembling/ready/failed + stage and reason).', curl: `curl {BASE}/v1/batches/{id} -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches/{id}/builds/{cid}/generate-now', d: 'Rerun one FAILED build immediately on the live model.', curl: `curl -X POST {BASE}/v1/batches/{id}/builds/b0/generate-now -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches/{id}/builds/{cid}/requeue', d: 'Move one FAILED build\'s spec into the backlog for your next batch.', curl: `curl -X POST {BASE}/v1/batches/{id}/builds/b0/requeue -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches/{id}/builds/{cid}/approve', d: 'Approve one batch-generated design. Until this, that site cannot be published (409 review_pending on either deploy route). A build made from a template you already own skips review entirely.', curl: `curl -X POST {BASE}/v1/batches/{id}/builds/b0/approve -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches/{id}/builds/{cid}/discard', d: 'Reject one design: the site and the template that build generated are both deleted. A template you already owned is never touched.', curl: `curl -X POST {BASE}/v1/batches/{id}/builds/b0/discard -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches/{id}/approve-all', d: 'Approve every design still waiting in this batch.', curl: `curl -X POST {BASE}/v1/batches/{id}/approve-all -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/batches/{id}/publish', d: 'Publish every approved site in one run. Returns 202 and reports progress on the batch (publishRun); one site failing never stops the rest.', curl: `curl -X POST {BASE}/v1/batches/{id}/publish -H "Authorization: Bearer {KEY}"` },
    { m: 'GET', p: '/v1/batches/{id}/export', d: 'Every finished site in the batch as one .tar.gz, a directory per site.', curl: `curl {BASE}/v1/batches/{id}/export -H "Authorization: Bearer {KEY}" -o batch.tar.gz` },
    { m: 'GET', p: '/v1/sites/{id}/database', d: 'This site\'s database target (masked) and your account default.', curl: `curl {BASE}/v1/sites/{siteId}/database -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/v1/sites/{id}/database', d: 'Connect this site to a libSQL database (vendor-neutral: any libsql://, https://, or file: endpoint — Turso is just the recommended hosted one).',
      curl: `curl -X POST {BASE}/v1/sites/{siteId}/database \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"url":"libsql://your-db.turso.io","authToken":"YOUR_TOKEN"}'` },
    { m: 'GET', p: '/v1/sites/{id}/export', d: 'Export the assembled repo as a .tar.gz (a standalone Next.js project; the engine is never included).', curl: `curl {BASE}/v1/sites/{siteId}/export -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Connections, your hosting, your site', items: [
    { m: 'GET', p: '/v1/connections', d: 'Which providers are connected (masked, tokens are never returned).', curl: `curl {BASE}/v1/connections -H "Authorization: Bearer {KEY}"` },
    { m: 'PUT', p: '/v1/connections/{provider}', d: 'Save your own vercel | turso | github credentials as your account default (encrypted at rest; deploys receive only the assembled site, never the engine). "turso" is a generic libSQL database connection, not vendor-exclusive — pass {url, token} for any libsql/https/file endpoint.',
      curl: `curl -X PUT {BASE}/v1/connections/vercel \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"token":"YOUR_VERCEL_TOKEN"}'` },
    { m: 'DELETE', p: '/v1/connections/{provider}', d: 'Disconnect a provider.', curl: `curl -X DELETE {BASE}/v1/connections/vercel -H "Authorization: Bearer {KEY}"` },
  ]},
  { group: 'Account', items: [
    { m: 'GET', p: '/v1/usage', d: 'This key’s monthly counters (failed calls are never metered).', curl: `curl {BASE}/v1/usage -H "Authorization: Bearer {KEY}"` },
    { m: 'POST', p: '/workbench/chat', d: 'The Template Studio relay, runs on Stardrive’s own model (included; no model key from you). Send { system, messages }.',
      curl: `curl -X POST {BASE}/workbench/chat \\\n  -H "Authorization: Bearer {KEY}" -H "Content-Type: application/json" \\\n  -d '{"messages":[{"role":"user","content":"hi"}]}'` },
  ]},
];

function renderReference() {
  const root = $('#refRoot');
  const key = getApiKey() || 'sk_live_YOUR_KEY';
  root.innerHTML = '';
  for (const g of REF) {
    const h = document.createElement('div');
    h.className = 'refgroup';
    h.textContent = g.group;
    root.appendChild(h);
    for (const ep of g.items) {
      const d = document.createElement('details');
      d.className = 'endpoint';
      d.innerHTML =
        '<summary><span class="badge method ' + ep.m.toLowerCase() + '">' + ep.m + '</span> ' + esc(ep.p) +
        '<span class="desc">' + esc(ep.d) + '</span></summary>' +
        '<div class="body"><div class="codeblock"><pre>' +
        esc(ep.curl.replaceAll('{BASE}', location.origin).replaceAll('{KEY}', key)) +
        '</pre><button class="copybtn" type="button">Copy</button></div></div>';
      root.appendChild(d);
    }
  }
}
renderReference();
$('#saveKeyBtn').addEventListener('click', renderReference);

/* ══════════════ Going live ══════════════ */
// Served from the API rather than written here, so this page and the deploy
// path can never disagree. A guide maintained separately from the code it
// describes is wrong within a month, and wrong instructions cost the reader
// twice: once following them, once discovering they lied.

let guideLoaded = false;

async function renderGoingLive() {
  const root = $('#goingLiveRoot');
  if (!root || guideLoaded) return;
  const { status, body } = await api('/v1/guide/deploy');
  if (status !== 200) {
    root.innerHTML = '<div class="report err">Could not load the guide (' + status + '). Save a valid API key up top.</div>';
    return;
  }
  guideLoaded = true;

  const steps = (body.steps || []).map((s, i) =>
    '<li style="margin:0 0 0.7rem"><b>' + esc(s.title) + '</b><br>' +
    '<span style="color:var(--body)">' + esc(s.detail) + '</span></li>').join('');

  const supplied = (body.environment?.supplied || []).map((v) =>
    '<tr><td><b>' + esc(v.label) + '</b><br><code style="font-size:0.76rem">' + esc(v.name) + '</code></td>' +
    '<td>' + esc(v.why) + (v.where ? '<br><span style="color:var(--muted)">Get it from ' + esc(v.where) + '</span>' : '') + '</td></tr>').join('');

  const managed = (body.environment?.managed || []).map((v) =>
    '<tr><td><code style="font-size:0.76rem">' + esc(v.name) + '</code></td><td>' + esc(v.why) + '</td></tr>').join('');

  const byHow = {};
  for (const h of body.hosts || []) (byHow[h.how] ||= []).push(h);
  const hosts = Object.entries(byHow).map(([how, list]) =>
    '<div style="margin:0 0 0.9rem">' +
      '<div style="font-size:0.82rem;font-weight:600;margin-bottom:0.3rem">' + esc(body.howLabels?.[how] || how) + '</div>' +
      '<ul style="margin:0;padding-left:1.1rem;font-size:0.86rem">' +
      list.map((h) => '<li><b>' + esc(h.name) + '</b> · <span style="color:var(--muted)">' + esc(h.note) + '</span></li>').join('') +
      '</ul>' +
    '</div>').join('');

  const faq = (body.faq || []).map((f) =>
    '<details class="endpoint"><summary>' + esc(f.q) + '</summary>' +
    '<div class="body" style="font-size:0.88rem;line-height:1.55">' + esc(f.a) + '</div></details>').join('');

  root.innerHTML =
    '<div class="card">' +
      '<h2>How a job runs, start to finish</h2>' +
      '<ol style="margin:0.6rem 0 0;padding-left:1.2rem;font-size:0.9rem">' + steps + '</ol>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Settings you supply</h2>' +
      '<p style="font-size:0.86rem;color:var(--body);margin:0 0 0.7rem">Only these. Add them on the site itself, under <b>Site settings</b>, once per client. Every publish after that reuses them.</p>' +
      '<div class="tscroll"><table class="list"><thead><tr><th>Setting</th><th>What it is for</th></tr></thead><tbody>' +
      supplied + '</tbody></table></div>' +
      '<h2 style="margin-top:1.2rem">Handled for you</h2>' +
      '<p style="font-size:0.86rem;color:var(--body);margin:0 0 0.7rem">You never enter these. Stardrive fills them in and pushes them with every publish.</p>' +
      '<div class="tscroll"><table class="list"><thead><tr><th>Setting</th><th>Where it comes from</th></tr></thead><tbody>' +
      managed + '</tbody></table></div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Where a site can be hosted</h2>' +
      '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + esc(body.constraint || '') + '</div>' +
      hosts +
      '<p style="font-size:0.82rem;color:var(--muted);margin:0.4rem 0 0">Every site you build also ships its own <code>Dockerfile</code> and <code>DEPLOY.md</code>, so whoever opens it later has these instructions too.</p>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Handing over to your client</h2>' +
      '<p style="font-size:0.9rem;margin:0 0 0.5rem">' + esc(body.handoff?.what || '') + '</p>' +
      '<p style="font-size:0.9rem;margin:0 0 0.5rem">' + esc(body.handoff?.how || '') + '</p>' +
      '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + esc(body.handoff?.note || '') + '</div>' +
    '</div>' +

    '<div class="card">' +
      '<h2>Questions</h2>' + faq +
    '</div>';
}


/* ══════════════ Keys & usage ══════════════ */
$('#testKeyBtn').addEventListener('click', async () => {
  const out = $('#usageOut');
  if (!getApiKey()) { out.innerHTML = '<div class="report err">Save a key first (top right).</div>'; return; }
  const { status, body } = await api('/v1/usage');
  if (status !== 200) { out.innerHTML = '<div class="report err">Key rejected (' + status + ').</div>'; return; }
  const rows = Object.entries(body.counters || {}).sort()
    .map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + v + '</td></tr>').join('');
  out.innerHTML =
    '<div class="report ok">✓ Key valid, <b>' + esc(body.name) + '</b> · account <code>' + esc(body.account) + '</code> · period ' + esc(body.period) + '</div>' +
    '<div class="tscroll"><table class="list"><thead><tr><th>Counter</th><th style="text-align:right">This period</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="2" style="color:var(--muted)">No usage yet this period.</td></tr>') + '</tbody></table></div>';
});

/* ══════════════ Self-service keys ══════════════ */
async function loadKeys() {
  const tbody = $('#keysTable tbody');
  const res = await fetch('/v1/keys');
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--bad)">Log in to manage keys.</td></tr>'; return; }
  const { keys } = await res.json();
  if (!keys.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">No keys yet, create one above.</td></tr>'; return; }
  tbody.innerHTML = '';
  for (const k of keys) {
    const tr = document.createElement('tr');
    const status = k.revoked ? '<span style="color:var(--bad)">revoked</span>' : '<span style="color:var(--good)">active</span>';
    tr.innerHTML =
      '<td style="color:var(--ink)">' + esc(k.name) + '</td>' +
      '<td style="font-size:0.78rem">' + esc((k.scopes || []).join(', ')) + '</td>' +
      '<td style="color:var(--muted)">' + esc((k.createdAt || '').slice(0, 10)) + '</td>' +
      '<td>' + status + '</td>' +
      '<td style="white-space:nowrap">' + (k.revoked ? '' :
        '<button class="ghost" data-keyact="rotate" data-id="' + esc(k.id) + '">Rotate</button> ' +
        '<button class="ghost danger" data-keyact="revoke" data-id="' + esc(k.id) + '">Revoke</button>') + '</td>';
    tbody.appendChild(tr);
  }
}

$('#createKeyBtn').addEventListener('click', async () => {
  const name = $('#newKeyName').value.trim() || 'key';
  const scopes = [...document.querySelectorAll('#scopeChecks input:checked')].map((c) => c.value);
  const res = await fetch('/v1/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, scopes }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { $('#newKeyOut').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Failed.') + '</div>'; return; }
  $('#newKeyName').value = '';
  $('#newKeyOut').innerHTML = '<div class="keyreveal">Key <b>' + esc(body.name) + '</b> created, copy it now, it will not be shown again.<code>' + esc(body.secret) + '</code></div>';
  loadKeys();
});

$('#keysTable').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-keyact]');
  if (!btn) return;
  if (btn.dataset.keyact === 'rotate') {
    const res = await fetch('/v1/keys/' + btn.dataset.id + '/rotate', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      $('#newKeyOut').innerHTML = '<div class="keyreveal">Rotated <b>' + esc(body.name) + '</b>, the old secret is now dead. New secret (shown once):<code>' + esc(body.secret) + '</code></div>';
      if (getApiKey() && confirm('Use this rotated key as the active console key too?')) {
        localStorage.setItem('sd.apiKey', body.secret); $('#apiKeyInput').value = body.secret; renderMaskedKey();
      }
    }
    loadKeys();
  }
  if (btn.dataset.keyact === 'revoke') {
    if (!confirm('Revoke this key? Anything using it will stop working.')) return;
    await fetch('/v1/keys/' + btn.dataset.id, { method: 'DELETE' });
    loadKeys();
  }
});

/* ══════════════ Keys & usage (product-key test) ══════════════ */
$('#testKeyBtn').addEventListener('click', async () => {
  const out = $('#usageOut');
  if (!getApiKey()) { out.innerHTML = '<div class="report err">No key active, create one below or paste one up top.</div>'; return; }
  const { status, body } = await api('/v1/usage');
  if (status !== 200) { out.innerHTML = '<div class="report err">Key rejected (' + status + ').</div>'; return; }
  const rows = Object.entries(body.counters || {}).sort()
    .map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + v + '</td></tr>').join('');
  out.innerHTML =
    '<div class="report ok">✓ Key valid, <b>' + esc(body.name) + '</b> · period ' + esc(body.period) + '</div>' +
    '<div class="tscroll"><table class="list"><thead><tr><th>Counter</th><th style="text-align:right">This period</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="2" style="color:var(--muted)">No usage yet this period.</td></tr>') + '</tbody></table></div>';
});

/* ══════════════ Billing ══════════════ */
const fmtTokens = (n) => n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);

async function loadBilling() {
  const res = await fetch('/v1/billing');
  if (!res.ok) { $('#planName').textContent = 'log in to view'; return; }
  const b = await res.json();
  const q = b.quota;
  $('#planName').textContent = b.planLabel + (b.plan === 'beta' ? ' · founding beta (free)' : '');

  // Usage meter.
  const pct = q.includedTokens ? Math.min(100, Math.round((q.usedTokens / q.includedTokens) * 100)) : 0;
  $('#usageBar').innerHTML =
    '<div class="meterlabel"><span>Template-generation tokens</span><span class="used">' + fmtTokens(q.usedTokens) + ' / ' + fmtTokens(q.includedTokens) + '</span></div>' +
    '<div class="meter' + (q.over ? ' over' : '') + '"><span style="width:' + pct + '%"></span></div>' +
    '<p style="font-size:0.78rem;color:var(--muted);margin:0.4rem 0 0">' +
      (q.over ? 'Included tokens used up. ' + (q.overageActive ? 'Extra usage is on, you can keep generating.' : 'Turn on extra usage or upgrade to keep generating.')
              : fmtTokens(q.remainingTokens) + ' tokens left this period.') +
    (q.includedAssemblies != null ? ' · ' + q.usedAssemblies + ' / ' + q.includedAssemblies + ' assemblies' : ' · assemblies included') + '</p>';

  // Overage toggle (only meaningful when the plan offers it).
  $('#overageArea').innerHTML = q.overageOffered
    ? '<label class="toggle"><input type="checkbox" id="overageToggle"' + (q.overageEnabled ? ' checked' : '') + '> Keep generating past my tokens (extra usage billed to my card at $' + q.overagePer1kUsd.toFixed(3) + '/1k)</label>' +
      '<p id="overageNote" style="font-size:0.78rem;color:var(--muted);margin:0.4rem 0 0">' + (b.checkoutConfigured ? '' : 'Saved as a preference now; activates once a card is on file.') + '</p>'
    : '<p style="font-size:0.8rem;color:var(--muted);margin:0">This plan has no extra-usage option, upgrade for overage and more tokens.</p>';
  const tog = $('#overageToggle');
  if (tog) tog.addEventListener('change', async () => {
    const r = await fetch('/v1/billing/overage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: tog.checked }) });
    const body = await r.json().catch(() => ({}));
    $('#overageNote').textContent = body.note || '';
  });

  $('#checkoutArea').innerHTML = b.checkoutConfigured ? ''
    : '<div class="report" style="background:var(--code-bg);color:var(--muted);margin-top:0.9rem">Checkout isn\'t live yet, founding beta is free. When Stripe is connected, the buttons below start real subscriptions and extra-usage billing.</div>';

  // Plan grid.
  $('#planGrid').innerHTML = b.plans.map((p) => {
    const isNow = p.id === b.plan;
    const perBuild = p.priceUsd > 0 ? '$' + p.effectivePerBuildUsd.toFixed(2) + '/site' : 'free';
    const overBuild = p.overagePer1kUsd != null ? ' · then $' + (p.overagePer1kUsd * 20).toFixed(2) + '/site' : '';
    return '<div class="plan' + (isNow ? ' current' : '') + (p.popular ? ' popular' : '') + '">' +
      (p.popular ? '<span class="pop">Popular</span>' : '') +
      '<h3>' + esc(p.label) + '</h3>' +
      '<div class="price">' + (p.priceUsd > 0 ? '$' + p.priceUsd + '<small>/mo</small>' : '$0') + '</div>' +
      '<div class="rate">' + perBuild + overBuild + '</div>' +
      '<ul>' +
        '<li>~' + p.approxBuilds + ' finished sites/mo</li>' +
        '<li>Designed hero on every page (upload your own to use as the background)</li>' +
        '<li>Unlimited builds, previews &amp; deploys</li>' +
        '<li>' + (p.overagePer1kUsd != null ? 'Extra sites available (opt-in)' : 'Hard cap (no surprise charges)') + '</li>' +
      '</ul>' +
      '<div class="blurb">' + esc(p.blurb) + '</div>' +
      (isNow ? '<div class="isnow">Your plan</div>'
             : (p.priceUsd > 0 ? '<button class="primary" data-upgrade="' + p.id + '" type="button">Choose ' + esc(p.label) + '</button>' : '')) +
      '</div>';
  }).join('');

  const tbody = $('#usageTable tbody');
  const totals = Object.entries(b.usage?.totals || {}).sort();
  tbody.innerHTML = totals.length
    ? totals.map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + v + '</td></tr>').join('')
    : '<tr><td colspan="2" style="color:var(--muted)">No usage yet' + (b.usage?.period ? ' for ' + esc(b.usage.period) : '') + '.</td></tr>';
}

$('#planGrid').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-upgrade]');
  if (!btn) return;
  const r = await fetch('/v1/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: btn.dataset.upgrade }) });
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.url) { location.href = body.url; return; }
  $('#checkoutArea').innerHTML = '<div class="report" style="background:var(--code-bg);color:var(--muted);margin-top:0.9rem">' + esc(body.error?.message || 'Checkout unavailable.') + '</div>';
});

/* ══════════════ Your data: export and account closure ══════════════ */
// The privacy policy promises both of these in the Workbench, so they live
// here rather than being a support email.

$('#exportAccountBtn')?.addEventListener('click', async () => {
  const out = $('#exportOut');
  out.innerHTML = '<div class="report" style="background:var(--code-bg);color:var(--muted)">Gathering everything…</div>';
  const res = await fetch('/v1/account/export');
  if (!res.ok) {
    out.innerHTML = '<div class="report err">Could not build the export (' + res.status + ').</div>';
    return;
  }
  const data = await res.json();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'stardrive-account-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  out.innerHTML = '<div class="report ok">Downloaded: ' + data.templates.length + ' template(s), ' +
    data.sites.length + ' site(s), ' + data.apiKeys.length + ' key(s). ' +
    'Secrets are not included, because they are stored hashed or encrypted and cannot be read back.</div>';
});

$('#closeAccountBtn')?.addEventListener('click', () => {
  const area = $('#closeAccountArea');
  if (!area) return;
  area.innerHTML =
    '<div class="report" style="background:var(--bad-soft);color:var(--bad)">' +
      '<b>This deletes everything you own and cannot be undone.</b>' +
      '<div class="field" style="margin:0.7rem 0 0.4rem"><label>Type your account email to confirm</label>' +
        '<input id="closeConfirm" autocomplete="off" spellcheck="false" placeholder="' + esc($('#acctEmail')?.textContent || '') + '"></div>' +
      '<div class="field"><label>Your password</label><input id="closePassword" type="password" autocomplete="current-password"></div>' +
      '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">' +
        '<button class="ghost danger" id="closeAccountGo" type="button">Delete my account for good</button>' +
        '<button class="ghost" id="closeAccountCancel" type="button">Keep my account</button>' +
      '</div>' +
    '</div>';
});

document.addEventListener('click', async (e) => {
  if (e.target.closest('#closeAccountCancel')) { $('#closeAccountArea').innerHTML = ''; return; }
  if (!e.target.closest('#closeAccountGo')) return;
  const btn = e.target.closest('#closeAccountGo');
  btn.disabled = true;
  const res = await fetch('/v1/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: $('#closeConfirm')?.value || '', password: $('#closePassword')?.value || '' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    btn.disabled = false;
    $('#closeAccountArea').insertAdjacentHTML('beforeend',
      '<div class="report err" style="margin-top:0.5rem">' + esc(body.error?.message || 'Could not close the account.') + '</div>');
    return;
  }
  localStorage.removeItem('sd.apiKey');
  document.body.innerHTML = '<div style="max-width:34rem;margin:6rem auto;padding:0 1.5rem;font-family:var(--sans)">' +
    '<h1 style="font-size:1.3rem">Your account is closed.</h1>' +
    '<p style="color:#666;line-height:1.6">Everything you owned here has been deleted: ' +
    body.sites + ' site(s), ' + body.templates + ' template(s), and ' + body.keys + ' key(s). ' +
    'Your email address is free to use again if you ever come back.</p></div>';
});

/* ══════════════ Batch Building (Agency perk) ══════════════ */
// The nav item stays hidden until the account's plan includes `batch`.
async function revealBatchNav() {
  try {
    const res = await fetch('/v1/billing');
    if (res.ok && (await res.json()).batch) $('#navBatch').hidden = false;
  } catch { /* nav stays hidden */ }
}

const BATCH_STATUS_LABEL = {
  generating: 'Generating…', assembling: 'Assembling…', review: 'Waiting for your review',
  ready: '✓ Approved', failed: '✗ Needs attention', requeued: 'Queued for next batch',
  discarded: 'Discarded',
};

/* ── The build list ──────────────────────────────────────────────────── */
// One row per client site, carrying everything an interactive build carries:
// the design brief the Studio would ask for, the feature set, the full fact
// intake Sites gates on, and the client's photos. The list is a server-saved
// DRAFT, so a stack of twenty can be filled in over a day from any machine,
// and so every row has a stable id its photos can be staged against before
// the site it belongs to exists.

let batchDraft = { rows: [], backlog: [], max: 20 };
const batchFieldCache = new Map(); // modules key → the intake schema for them
let batchOpenRow = null;           // only one row is expanded at a time
let batchSaveTimer = null;
let batchDirty = false;            // edits not yet written to the saved draft

const uuid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
  }));

const batchRow = (id) => batchDraft.rows.find((r) => r.rowId === id);
const rowModules = (row) => modulesForFeatures(row.features || []);
const fieldsKey = (mods) => [...mods].sort().join(',') || 'base';

/** The questions a build with these features has to answer — the same schema
 *  the per-site intake renders from (content.mjs), fetched once per mix. */
async function ensureRowFields(row) {
  const mods = rowModules(row);
  const key = fieldsKey(mods);
  if (!batchFieldCache.has(key)) {
    const { status, body } = await api('/v1/content/fields?modules=' + encodeURIComponent(mods.join(',')));
    batchFieldCache.set(key, status === 200 ? body : { groups: {}, fields: [] });
  }
  return batchFieldCache.get(key);
}
const rowFields = (row) => batchFieldCache.get(fieldsKey(rowModules(row))) || { groups: {}, fields: [] };

/** Mirrors content.mjs hasValue, for instant per-row feedback. The server
 *  re-checks every row at submit, so this is a hint and never the gate. */
function factAnswered(kind, v, field) {
  const filled = (x) => typeof x === 'string' && x.trim().length > 0;
  switch (kind) {
    case 'list': case 'topics': return Array.isArray(v) && v.some(filled);
    case 'people': return Array.isArray(v) && v.some((x) => x && filled(x.name));
    case 'roles': return Array.isArray(v) && v.some((x) => x && filled(x.title));
    case 'products': return Array.isArray(v) && v.some((x) => x && filled(x.name));
    case 'rows': {
      const first = field?.columns?.[0]?.key || 'name';
      return Array.isArray(v) && v.some((x) => x && filled(x[first]));
    }
    default: return filled(v);
  }
}

/** What this row still needs before it can go into a batch. */
function rowState(row) {
  const required = rowFields(row).fields.filter((f) => f.required);
  const missing = required.filter((f) => !factAnswered(f.kind, row.facts?.[f.id], f));
  const blocked = [];
  if (!String(row.siteName || '').trim()) blocked.push('a business name');
  // A row reusing a template is not designing anything, so it needs neither a
  // new template name nor a brief. Mirrors the gate in batches.mjs.
  if (row.templateId) {
    if (!siteTemplateOptions.some((t) => t.name === row.templateId)) blocked.push('a template that still exists');
  } else {
    if (!String(row.name || '').trim()) blocked.push('a template name');
    if (!String(row.prompt || '').trim()) blocked.push('a design brief');
  }
  return {
    required: required.length, answered: required.length - missing.length,
    missing, blocked, ok: !missing.length && !blocked.length,
  };
}

const newBatchRow = (seed = {}) => ({
  rowId: uuid(), name: '', siteName: '', tagline: '', prompt: '', brief: {}, templateId: null,
  // Carry the Studio's current feature selection, the same way the Sites
  // assemble form does, so a stack of similar sites starts from one choice.
  features: [...enabledFeatures], facts: {}, photos: 0, ...seed,
});

/* ── saving ──────────────────────────────────────────────────────────── */

function setSaveState(text) {
  const el = $('#batchSaveState');
  if (el) el.textContent = text;
}

async function saveBatchDraft({ now = false } = {}) {
  clearTimeout(batchSaveTimer);
  const put = async () => {
    const { status, body } = await api('/v1/batches/draft', { method: 'PUT', body: { rows: batchDraft.rows } });
    if (status !== 200) { setSaveState('Could not save the list (' + status + ').'); return false; }
    batchDirty = false;
    batchDraft.backlog = body.backlog || [];
    batchDraft.max = body.max || batchDraft.max;
    for (const saved of body.rows || []) {
      const r = batchRow(saved.rowId);
      if (r) r.photos = saved.photos;
    }
    setSaveState('Saved');
    renderBatchSummary();
    return true;
  };
  if (now) return put();
  batchDirty = true;
  setSaveState('Saving…');
  batchSaveTimer = setTimeout(put, 700);
  return true;
}

/* ── rendering ───────────────────────────────────────────────────────── */

function renderBatchSummary() {
  const total = batchDraft.rows.length;
  const ready = batchDraft.rows.filter((r) => rowState(r).ok).length;
  const note = $('#batchHeadNote');
  if (note) {
    note.innerHTML = total
      ? '<b>' + ready + ' of ' + total + '</b> build' + (total === 1 ? '' : 's') + ' ready to submit' +
        (ready < total ? ', the rest still need answers.' : '. Submit whenever you are ready.')
      : 'Add one row per client site. Each gets its own design, its own written copy, and its own photos.';
  }
  const btn = $('#batchSubmitBtn');
  if (btn) btn.textContent = total ? 'Submit batch (' + total + ')' : 'Submit batch';
  const backlog = $('#batchBacklogNote');
  if (backlog) {
    backlog.innerHTML = batchDraft.backlog.length
      ? '<div class="report" style="background:var(--code-bg);color:var(--body)">' +
        '<b>' + batchDraft.backlog.length + ' build(s)</b> from a previous batch are waiting to be retried. ' +
        '<button class="ghost" id="batchBacklogAdd" type="button" style="font-size:0.78rem;padding:0.2rem 0.6rem">Add them to this list</button></div>'
      : '';
  }
}

function rowPillHtml(st) {
  const tag = (cls, text) => '<span data-role="pill" class="brow-state ' + cls + '">' + text + '</span>';
  if (st.ok) return tag('ok', '✓ Ready');
  if (st.blocked.length) return tag('warn', 'Needs ' + esc(st.blocked[0]));
  return tag('warn', st.answered + ' of ' + st.required + ' essentials');
}

function updateRowPill(rowId) {
  const row = batchRow(rowId);
  const card = document.querySelector('[data-batchrow="' + rowId + '"]');
  if (!row || !card) return;
  const st = rowState(row);
  card.querySelector('[data-role="pill"]').outerHTML = rowPillHtml(st);
  card.classList.toggle('incomplete', !st.ok);
  const title = card.querySelector('[data-role="title"]');
  if (title) title.textContent = row.name || row.siteName || 'Untitled build';
  const sub = card.querySelector('[data-role="sub"]');
  if (sub) sub.textContent = rowSubtitle(row);
  const tab = card.querySelector('[data-btab="content"]');
  if (tab) tab.textContent = 'The essentials (' + st.answered + '/' + st.required + ')';
  renderBatchSummary();
}

function rowSubtitle(row) {
  const bits = [];
  if (row.siteName && row.name && row.siteName !== row.name) bits.push(row.siteName);
  const feats = (row.features || []).length;
  bits.push(feats + ' feature' + (feats === 1 ? '' : 's'));
  if (row.photos) bits.push(row.photos + ' photo' + (row.photos === 1 ? '' : 's'));
  return bits.join(' · ');
}

const VIBE_CHIPS = (selected) => VIBES.map((v) =>
  '<button type="button" class="chip-btn' + (v === selected ? ' on' : '') + '" data-bvibe="' + esc(v) + '">' + esc(v) + '</button>').join('');

function rowDesignPane(row) {
  const b = row.brief || {};
  const reusing = Boolean(row.templateId);
  // Reusing a template skips the design generation entirely: cheaper, faster,
  // and ten franchise sites come out looking like one brand.
  const source = '<div class="chips" style="margin-bottom:0.8rem">' +
    '<button type="button" class="chip-btn' + (reusing ? '' : ' on') + '" data-bsource="new">Generate a new design</button>' +
    '<button type="button" class="chip-btn' + (reusing ? ' on' : '') + '" data-bsource="reuse">Use one of my templates</button>' +
  '</div>';

  const reuseBlock = '<div class="field"><label>Template</label>' +
    '<select data-bf="templateId">' +
      '<option value="">Pick a template…</option>' +
      siteTemplateOptions.map((t) => '<option value="' + esc(t.name) + '"' + (t.name === row.templateId ? ' selected' : '') + '>' + esc(t.name) + ' (' + esc(t.source) + ')</option>').join('') +
    '</select>' +
    '<p class="bhint">No design is generated for this build, so it costs less and finishes sooner. It also skips the review step: you already approved this design when it went into your library.</p>' +
    (row.templateId ? '<img class="tmpl-shot" data-drop-on-error src="/v1/templates/' + encodeURIComponent(row.templateId) + '/thumbnail" alt="">' : '') +
  '</div>';

  const briefBlock = '<div class="field"><label>Template name <span style="color:var(--bad)">*</span></label>' +
      '<input data-bf="name" value="' + esc(row.name || '') + '" placeholder="e.g. Solstice Bakery"></div>' +
    '<h4 class="bsub">The design brief</h4>' +
    '<p class="bhint">The same questions the Studio asks. They become the instruction the model designs from.</p>' +
    '<div class="field"><label>What kind of business is it? <span style="color:var(--bad)">*</span></label>' +
      '<textarea data-bbrief="business" rows="2" placeholder="e.g. a family bakery in Portland known for sourdough">' + esc(b.business || '') + '</textarea></div>' +
    '<div class="field"><label>Overall vibe</label><div class="chips" data-role="vibes">' + VIBE_CHIPS(b.vibe) + '</div></div>' +
    '<div class="grid2">' +
      '<div class="field"><label>Colors</label><input data-bbrief="colors" value="' + esc(b.colors || '') + '" placeholder="e.g. warm cream and deep green"></div>' +
      '<div class="field"><label>Audience</label><input data-bbrief="audience" value="' + esc(b.audience || '') + '" placeholder="e.g. local families"></div>' +
    '</div>' +
    '<div class="field"><label>Anything else</label>' +
      '<textarea data-bbrief="extra" rows="2" placeholder="Anything else that should shape the design.">' + esc(b.extra || '') + '</textarea></div>' +
    '<details class="bpreview"><summary>What the model will be asked</summary>' +
      '<p data-role="prompt">' + esc(row.prompt || 'Answer "what kind of business is it" above.') + '</p></details>';

  return source +
    '<div class="field"><label>Business / site name <span style="color:var(--bad)">*</span></label>' +
      '<input data-bf="siteName" value="' + esc(row.siteName || '') + '" placeholder="e.g. Solstice Bakery"></div>' +
    '<div class="field"><label>Tagline <span style="color:var(--muted);font-weight:400">(optional)</span></label>' +
      '<input data-bf="tagline" value="' + esc(row.tagline || '') + '" placeholder="A short line under the name"></div>' +
    '<div data-role="sourceReuse"' + (reusing ? '' : ' hidden') + '>' + reuseBlock + '</div>' +
    '<div data-role="sourceNew"' + (reusing ? ' hidden' : '') + '>' + briefBlock + '</div>';
}

function rowFeaturePane(row) {
  const on = new Set(row.features || []);
  const mods = rowModules(row);
  return '<p class="bhint">Ticked features are built into the design. The ones marked with a dot also add a real engine module (a database-backed page the owner can edit), and they decide which questions the essentials ask for.</p>' +
    '<div class="featurelist">' + FEATURES.map((f) =>
      '<label class="feature' + (on.has(f.id) ? ' on' : '') + '"><input type="checkbox" data-bfeat="' + f.id + '"' + (on.has(f.id) ? ' checked' : '') + '> ' +
      esc(f.label) + (f.module ? ' <span class="fdot" title="Adds an engine module">•</span>' : '') + '</label>').join('') + '</div>' +
    '<p class="bhint" data-role="modnote">' + (mods.length
      ? 'Engine modules for this build: <b>' + mods.map(esc).join('</b>, <b>') + '</b>.'
      : 'No engine modules, this build ships as a designed site.') + '</p>' +
    '<button class="ghost" data-bact="featuresToAll" type="button" style="font-size:0.78rem">Apply these features to every build</button>';
}

function rowContentPane(row) {
  const schema = rowFields(row);
  if (!schema.fields.length) return '<p class="bhint">Loading the questions…</p>';
  const byGroup = {};
  for (const f of schema.fields) (byGroup[f.group] = byGroup[f.group] || []).push(f);
  return '<p class="bhint">Answer the starred questions and the AI writes finished copy for every page of this site, no placeholders. Exactly the intake a site built one at a time gets.</p>' +
    Object.entries(byGroup).map(([g, fields]) =>
      '<div class="card" style="margin-top:0.6rem"><h3 style="margin-top:0">' + esc(schema.groups[g] || g) + '</h3>' +
      fields.map((f) => factInput(f, row.facts?.[f.id])).join('') + '</div>').join('');
}

function rowPhotosPane() {
  return '<p class="bhint">Optional, and the reason a batched site ships as finished as a hand-built one: drop each file into its compartment now and it is already in place when the build runs overnight. Leave a compartment empty to keep the designed look.</p>' +
    '<div class="grid2" data-role="photos"><p class="bhint">Loading…</p></div>';
}

function batchRowCardHtml(row, i) {
  const st = rowState(row);
  const open = batchOpenRow === row.rowId;
  return '<div class="brow' + (open ? ' open' : '') + (st.ok ? '' : ' incomplete') + '" data-batchrow="' + esc(row.rowId) + '">' +
    '<button class="brow-head" type="button" data-bact="toggle" aria-expanded="' + (open ? 'true' : 'false') + '">' +
      '<span class="brow-n">' + (i + 1) + '</span>' +
      '<span class="brow-titles"><span class="brow-title" data-role="title">' + esc(row.name || row.siteName || 'Untitled build') + '</span>' +
      '<span class="brow-sub" data-role="sub">' + esc(rowSubtitle(row)) + '</span></span>' +
      rowPillHtml(st) +
      '<span class="brow-caret">' + (open ? '▾' : '▸') + '</span>' +
    '</button>' +
    (open
      ? '<div class="brow-body">' +
          '<div class="btabs">' +
            '<button type="button" class="on" data-btab="design">Design</button>' +
            '<button type="button" data-btab="features">Features</button>' +
            '<button type="button" data-btab="content">The essentials (' + st.answered + '/' + st.required + ')</button>' +
            '<button type="button" data-btab="photos">Photos &amp; logo</button>' +
          '</div>' +
          '<div data-bpane="design">' + rowDesignPane(row) + '</div>' +
          '<div data-bpane="features" hidden>' + rowFeaturePane(row) + '</div>' +
          '<div data-bpane="content" hidden>' + rowContentPane(row) + '</div>' +
          '<div data-bpane="photos" hidden>' + rowPhotosPane() + '</div>' +
          '<div class="brow-foot">' +
            '<button class="ghost" data-bact="duplicate" type="button">Duplicate this build</button>' +
            '<button class="ghost danger" data-bact="removerow" type="button">Remove this build</button>' +
          '</div>' +
        '</div>'
      : '') +
  '</div>';
}

function renderBatchRows() {
  const root = $('#batchBuildRows');
  if (!root) return;
  root.innerHTML = batchDraft.rows.length
    ? batchDraft.rows.map(batchRowCardHtml).join('')
    : '<p class="bhint" style="margin:0.4rem 0">No builds queued yet. Add one, or paste a list from your spreadsheet.</p>';
  renderBatchSummary();
  wireThumbFallbacks(root);
  if (batchOpenRow) loadRowPhotos(batchOpenRow);
}

/** The open row's photo compartments (its own staging bucket, keyed by row).
 *  Which compartments exist depends on the row's features, so any unsaved edit
 *  is flushed first — otherwise a just-toggled module's page-hero slot would be
 *  missing from the list the operator is looking at. */
const photoLoadSeq = new Map(); // rowId → the newest in-flight load

async function loadRowPhotos(rowId) {
  const pane = document.querySelector('[data-batchrow="' + rowId + '"] [data-role="photos"]');
  if (!pane) return;
  // Toggling a feature and then opening Photos fires two loads at once. Both
  // repaint the pane, so a late first response can replace the file input
  // mid-upload and silently swallow the file. Only the newest load paints.
  const seq = (photoLoadSeq.get(rowId) || 0) + 1;
  photoLoadSeq.set(rowId, seq);
  const stale = () => photoLoadSeq.get(rowId) !== seq;

  if (batchDirty) await saveBatchDraft({ now: true });
  if (stale()) return;
  const { status, body } = await api('/v1/batches/draft/rows/' + rowId + '/assets');
  if (stale()) return;
  if (status !== 200) {
    pane.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not load the compartments (' + status + ').') + '</div>';
    return;
  }
  const html = body.slots
    .map((slot) => assetSlotCard(slot, body.assets[slot.id] || [], { upload: 'data-brupload', del: 'data-brassetdel' }))
    .join('');
  // Repaint ONLY on a real change. Opening the Photos tab can legitimately
  // trigger a second load; replacing identical markup would rip the file
  // input out from under whoever is mid-drop, and flicker for no reason.
  if (pane.innerHTML !== html) pane.innerHTML = html;
  const row = batchRow(rowId);
  if (row) {
    row.photos = Object.values(body.assets).reduce((n, items) => n + items.length, 0);
    updateRowPill(rowId);
  }
}

/* ── loading the view ────────────────────────────────────────────────── */

let batchPollTimer = null;
async function loadBatchView() {
  // Rows can build from an existing template, so the library has to be known.
  if (!siteTemplateOptions.length) await loadSiteTemplateOptions();
  const { status, body } = await api('/v1/batches/draft');
  if (status !== 200) {
    $('#batchBuildRows').innerHTML = '<div class="report err">' + esc(body.error?.message || 'Save an API key (top right) to use Batch Building.') + '</div>';
    return;
  }
  batchDraft = { rows: body.rows || [], backlog: body.backlog || [], max: body.max || 20 };
  await Promise.all(batchDraft.rows.map(ensureRowFields));
  renderBatchRows();
  setSaveState(batchDraft.rows.length ? 'Saved' : '');
  await loadBatchList();
}

async function loadBatchList() {
  const { status, body } = await api('/v1/batches');
  if (status !== 200) return;
  renderBatchList(body.batches || []);
  clearInterval(batchPollTimer);
  if ((body.batches || []).some((b) => b.status === 'in_progress')) {
    batchPollTimer = setInterval(async () => {
      if (!document.getElementById('view-batch')?.classList.contains('active')) { clearInterval(batchPollTimer); return; }
      const r = await api('/v1/batches');
      if (r.status === 200) {
        renderBatchList(r.body.batches || []);
        if (!(r.body.batches || []).some((b) => b.status === 'in_progress')) clearInterval(batchPollTimer);
      }
    }, 20_000);
  }
}

function renderBatchList(list) {
  if (!list.length) {
    $('#batchList').innerHTML = '<p style="color:var(--muted);font-size:0.85rem">No batches submitted yet. Queue a few builds above and submit them in one go.</p>';
    return;
  }
  $('#batchList').innerHTML = list.map((b) => {
    const c = b.counts;
    const bits = [c.total + ' build(s)'];
    if (c.review) bits.push('<b style="color:var(--warn)">' + c.review + ' to review</b>');
    if (c.ready) bits.push(c.ready + ' approved');
    if (c.failed) bits.push('<span style="color:var(--bad)">' + c.failed + ' need attention</span>');
    if (c.discarded) bits.push(c.discarded + ' discarded');
    const run = b.publishRun;
    return '<div class="card" style="margin-top:0.7rem">' +
      '<div style="display:flex;gap:0.8rem;flex-wrap:wrap;align-items:baseline">' +
        '<b>' + new Date(b.createdAt).toLocaleString() + '</b>' +
        '<span style="font-size:0.82rem;color:var(--muted)">' + bits.join(' · ') + '</span>' +
        '<span class="badge ' + (b.status === 'ready' ? 'imported' : '') + '">' + (b.status === 'in_progress' ? 'Running…' : 'Finished') + '</span>' +
      '</div>' +
      (run ? '<div style="margin-top:0.5rem;font-size:0.82rem;color:' + (run.finishedAt ? 'var(--muted)' : 'var(--accent)') + '">' +
        (run.finishedAt ? 'Publish run finished: ' : 'Publishing… ') + run.done + ' of ' + run.total +
        (run.results.some((r) => !r.ok) ? ' · <span style="color:var(--bad)">' + run.results.filter((r) => !r.ok).length + ' failed</span>' : '') +
        '</div>' : '') +
      '<div data-batchdetail="' + esc(b.id) + '" style="margin-top:0.6rem"><button class="ghost" data-bact="expand" data-id="' + esc(b.id) + '" type="button" style="font-size:0.8rem">Show builds</button></div>' +
    '</div>';
  }).join('');
}

/**
 * The contact sheet: every design in a batch side by side, so twenty AI
 * designs can be judged in one look instead of opened one at a time. Nothing
 * here is published until it is approved.
 */
async function expandBatch(id) {
  const { status, body } = await api('/v1/batches/' + id);
  const root = document.querySelector('[data-batchdetail="' + id + '"]');
  if (!root) return;
  if (status !== 200) { root.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Could not load.') + '</div>'; return; }
  const pending = body.builds.filter((b) => b.status === 'review').length;
  const approved = body.builds.filter((b) => b.status === 'ready').length;
  const run = body.publishRun;

  const bar = '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;padding:0.6rem 0;border-top:1px solid var(--line)">' +
    (pending ? '<button class="primary" data-bact="approve-all" data-id="' + esc(id) + '" type="button" style="font-size:0.78rem">Approve all ' + pending + '</button>' : '') +
    (approved ? '<button class="primary" data-bact="publish-all" data-id="' + esc(id) + '" type="button" style="font-size:0.78rem">Publish ' + approved + ' approved</button>' : '') +
    '<a class="ghost btnlink" href="/v1/batches/' + esc(id) + '/export" data-bact="export-all" data-id="' + esc(id) + '" style="font-size:0.78rem;padding:0.3rem 0.7rem">Download all</a>' +
    (pending ? '<span class="bhint" style="margin:0">Nothing publishes until you approve it.</span>' : '') +
  '</div>';

  const cards = body.builds.map((x) => {
    const label = BATCH_STATUS_LABEL[x.status] || x.status;
    const tone = x.status === 'failed' ? 'err' : x.status === 'ready' ? 'ok' : x.status === 'review' ? 'warn' : '';
    // The screenshot is the point of the contact sheet; it exists only when
    // the full QA tier captured one, so the tile degrades instead of breaking.
    const shot = x.siteId && ['review', 'ready'].includes(x.status)
      ? thumbHtml('/v1/sites/' + x.siteId + '/preview', initialOf(x.siteName), 'sheet-shot')
      : '<div class="sheet-noshot">' + esc(initialOf(x.siteName)) + '</div>';
    const actions = x.status === 'review'
      ? '<button class="primary" data-bact="approve" data-id="' + esc(id) + '" data-cid="' + esc(x.customId) + '" type="button">Approve</button>' +
        '<button class="ghost danger" data-bact="discard" data-id="' + esc(id) + '" data-cid="' + esc(x.customId) + '" type="button">Discard</button>'
      : x.status === 'failed'
        ? '<button class="primary" data-bact="now" data-id="' + esc(id) + '" data-cid="' + esc(x.customId) + '" type="button">Generate now</button>' +
          '<button class="ghost" data-bact="requeue" data-id="' + esc(id) + '" data-cid="' + esc(x.customId) + '" type="button">Next batch</button>'
        : x.status === 'ready' && x.siteId
          ? '<a class="ghost btnlink" href="#/sites?site=' + esc(x.siteId) + '">Open in Sites →</a>'
          : '';
    return '<div class="sheet-card' + (x.status === 'discarded' ? ' gone' : '') + '">' +
      (x.siteId && ['review', 'ready'].includes(x.status)
        ? '<a href="#/sites?site=' + esc(x.siteId) + '" title="Open this site">' + shot + '</a>' : shot) +
      '<div class="sheet-body">' +
        '<b>' + esc(x.siteName || x.name) + '</b>' +
        '<span class="sheet-meta">' + esc(x.name) + (x.reusedTemplate ? ' · from your ' + esc(x.reusedTemplate) : '') + (x.photos ? ' · ' + x.photos + ' photo(s)' : '') + '</span>' +
        '<span class="brow-state ' + tone + '">' + esc(label) + '</span>' +
        (x.status === 'failed' ? '<span class="sheet-err">' + esc((x.stage ? x.stage + ': ' : '') + (x.error || '')) + '</span>' : '') +
        (actions ? '<div class="sheet-actions">' + actions + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  root.innerHTML = bar +
    (run && run.results.some((r) => !r.ok)
      ? '<div class="report" style="background:var(--warn-soft);color:var(--warn)">Some sites did not publish:<ul style="margin:0.4rem 0 0;padding-left:1.1rem">' +
        run.results.filter((r) => !r.ok).map((r) => '<li>' + esc(r.siteName) + ': ' + esc(r.error) + '</li>').join('') + '</ul></div>'
      : '') +
    '<div class="sheet">' + cards + '</div>' +
    '<div data-bulkout="' + esc(id) + '" style="margin-top:0.5rem"></div>';
  wireThumbFallbacks(root);
}

/* ── bulk import from a spreadsheet ──────────────────────────────────── */
// An agency onboarding ten clients already has them in a sheet. Paste the
// rows and each line becomes a build, pre-filled; open any row to finish it.

const PASTE_FIELDS = {
  name: 'name', templatename: 'name', template: 'name',
  sitename: 'siteName', business: 'siteName', businessname: 'siteName', client: 'siteName',
  tagline: 'tagline', brief: 'brief', designbrief: 'brief',
  whatyoudo: 'whatYouDo', services: 'services', contactemail: 'contactEmail', email: 'contactEmail',
  aboutfacts: 'aboutFacts', about: 'aboutFacts', phone: 'phone', address: 'address', hours: 'hours',
  mission: 'mission', whoyouserve: 'whoYouServe', differentiator: 'differentiator',
  faqtopics: 'faqTopics', socials: 'socials',
};
const PASTE_DEFAULT_ORDER = ['name', 'siteName', 'brief', 'whatYouDo', 'services', 'contactEmail', 'aboutFacts'];
const LIST_FACTS = new Set(['services', 'faqTopics', 'socials']);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

function parsePastedBuilds(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], error: 'Nothing to import.' };
  const cells = (line) => (line.includes('\t') ? line.split('\t') : line.split('|')).map((c) => c.trim());
  let order = PASTE_DEFAULT_ORDER;
  let start = 0;
  const first = cells(lines[0]);
  if (first.every((c) => PASTE_FIELDS[norm(c)])) { order = first.map((c) => PASTE_FIELDS[norm(c)]); start = 1; }
  const rows = [];
  for (const line of lines.slice(start)) {
    const cs = cells(line);
    const row = newBatchRow();
    order.forEach((key, i) => {
      const v = (cs[i] || '').trim();
      if (!v) return;
      if (key === 'name' || key === 'siteName' || key === 'tagline') row[key] = v;
      else if (key === 'brief') row.brief.business = v;
      else if (LIST_FACTS.has(key)) row.facts[key] = v.split(';').map((s) => s.trim()).filter(Boolean);
      else row.facts[key] = v;
    });
    if (!row.name && !row.siteName) continue;
    if (!row.name) row.name = row.siteName;
    if (!row.siteName) row.siteName = row.name;
    row.prompt = composeBrief(row.brief);
    rows.push(row);
  }
  return rows.length ? { rows } : { rows: [], error: 'No usable rows found — every line needs at least a name.' };
}

/* ── events ──────────────────────────────────────────────────────────── */

async function addBatchRows(rows, { open = true } = {}) {
  const room = batchDraft.max - batchDraft.rows.length;
  if (room <= 0) {
    $('#batchSubmitOut').innerHTML = '<div class="report err">A batch holds at most ' + batchDraft.max + ' builds. Submit this list first.</div>';
    return;
  }
  const added = rows.slice(0, room);
  batchDraft.rows.push(...added);
  // A single new build opens ready to fill in; a pasted stack stays collapsed
  // so the whole list is visible at once.
  if (open) batchOpenRow = added[added.length - 1].rowId;
  await Promise.all(added.map(ensureRowFields));
  await saveBatchDraft({ now: true }); // the rows must exist before photos can stage against them
  renderBatchRows();
  if (rows.length > room) {
    $('#batchSubmitOut').innerHTML = '<div class="report" style="background:var(--warn-soft);color:var(--warn)">Added ' + room + ' build(s); a batch holds at most ' + batchDraft.max + '.</div>';
  }
}

$('#batchAddRow')?.addEventListener('click', () => addBatchRows([newBatchRow()]));

$('#batchPasteToggle')?.addEventListener('click', () => {
  const box = $('#batchPaste');
  box.hidden = !box.hidden;
  if (!box.hidden) $('#batchPasteText').focus();
});

$('#batchPasteGo')?.addEventListener('click', async () => {
  const { rows, error } = parsePastedBuilds($('#batchPasteText').value);
  const out = $('#batchPasteOut');
  if (error) { out.innerHTML = '<div class="report err">' + esc(error) + '</div>'; return; }
  out.innerHTML = '<div class="report ok">✓ Added ' + rows.length + ' build(s). Open each one to add photos and anything still missing.</div>';
  $('#batchPasteText').value = '';
  await addBatchRows(rows, { open: false });
});

$('#batchClear')?.addEventListener('click', async () => {
  if (!batchDraft.rows.length) return;
  if (!confirm('Clear all ' + batchDraft.rows.length + ' queued build(s), including any photos uploaded for them?')) return;
  batchDraft.rows = [];
  batchOpenRow = null;
  await saveBatchDraft({ now: true });
  renderBatchRows();
});

// Typing: update the row in memory, keep the summary honest, save on a pause.
$('#batchBuildRows')?.addEventListener('input', (e) => {
  const card = e.target.closest('[data-batchrow]');
  if (!card) return;
  const row = batchRow(card.dataset.batchrow);
  if (!row) return;
  const el = e.target;
  if (el.dataset.bf) {
    row[el.dataset.bf] = el.value;
  } else if (el.dataset.bbrief) {
    row.brief = row.brief || {};
    row.brief[el.dataset.bbrief] = el.value;
    row.prompt = composeBrief(row.brief);
    const pv = card.querySelector('[data-role="prompt"]');
    if (pv) pv.textContent = row.prompt || 'Answer "what kind of business is it" above.';
  } else if (el.dataset.fact) {
    row.facts = row.facts || {};
    row.facts[el.dataset.fact] = parseFact(el.dataset.kind, el.value, el.dataset.cols);
  } else return;
  updateRowPill(row.rowId);
  saveBatchDraft();
});

// Feature toggles change which questions the essentials ask, so that pane is
// rebuilt (answers already given are kept).
$('#batchBuildRows')?.addEventListener('change', async (e) => {
  const card = e.target.closest('[data-batchrow]');
  if (!card) return;
  const row = batchRow(card.dataset.batchrow);
  if (!row) return;
  const tmpl = e.target.closest('select[data-bf="templateId"]');
  if (tmpl) {
    row.templateId = tmpl.value || null;
    // Re-render the pane so the chosen design's screenshot follows the pick.
    card.querySelector('[data-bpane="design"]').innerHTML = rowDesignPane(row);
    wireThumbFallbacks(card);
    updateRowPill(row.rowId);
    saveBatchDraft();
    return;
  }

  const cb = e.target.closest('input[data-bfeat]');
  if (cb) {
    const set = new Set(row.features || []);
    if (cb.checked) set.add(cb.dataset.bfeat); else set.delete(cb.dataset.bfeat);
    row.features = [...set];
    cb.closest('.feature').classList.toggle('on', cb.checked);
    await ensureRowFields(row);
    card.querySelector('[data-bpane="content"]').innerHTML = rowContentPane(row);
    const mods = rowModules(row);
    card.querySelector('[data-role="modnote"]').innerHTML = mods.length
      ? 'Engine modules for this build: <b>' + mods.map(esc).join('</b>, <b>') + '</b>.'
      : 'No engine modules, this build ships as a designed site.';
    updateRowPill(row.rowId);
    saveBatchDraft();
    loadRowPhotos(row.rowId); // module-gated compartments (per-page heroes) change too
    return;
  }
  const upload = e.target.closest('input[data-brupload]');
  if (upload && upload.files.length) {
    const file = upload.files[0];
    if (file.size > 8_000_000) { alert('Files must be at most 8 MB.'); upload.value = ''; return; }
    const b64 = await fileAsBase64(file);
    const { status, body } = await api('/v1/batches/draft/rows/' + row.rowId + '/assets/' + upload.dataset.brupload, {
      method: 'POST', body: { filename: file.name, contentBase64: b64 },
    });
    if (status !== 201) alert(body.error?.message || 'Upload failed (' + status + ').');
    loadRowPhotos(row.rowId);
  }
});

$('#batchBuildRows')?.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-batchrow]');
  if (!card) return;
  const row = batchRow(card.dataset.batchrow);
  if (!row) return;

  const src = e.target.closest('[data-bsource]');
  if (src) {
    const reuse = src.dataset.bsource === 'reuse';
    row.templateId = reuse ? (row.templateId || siteTemplateOptions[0]?.name || '') : null;
    card.querySelectorAll('[data-bsource]').forEach((c) => c.classList.toggle('on', (c.dataset.bsource === 'reuse') === reuse));
    card.querySelector('[data-role="sourceReuse"]').hidden = !reuse;
    card.querySelector('[data-role="sourceNew"]').hidden = reuse;
    const sel = card.querySelector('[data-bf="templateId"]');
    if (sel && row.templateId) sel.value = row.templateId;
    updateRowPill(row.rowId);
    saveBatchDraft();
    return;
  }

  const vibe = e.target.closest('[data-bvibe]');
  if (vibe) {
    row.brief = row.brief || {};
    row.brief.vibe = row.brief.vibe === vibe.dataset.bvibe ? '' : vibe.dataset.bvibe;
    row.prompt = composeBrief(row.brief);
    card.querySelectorAll('[data-bvibe]').forEach((c) => c.classList.toggle('on', c.dataset.bvibe === row.brief.vibe));
    const pv = card.querySelector('[data-role="prompt"]');
    if (pv) pv.textContent = row.prompt || 'Answer "what kind of business is it" above.';
    updateRowPill(row.rowId);
    saveBatchDraft();
    return;
  }

  const tab = e.target.closest('[data-btab]');
  if (tab) {
    card.querySelectorAll('[data-btab]').forEach((t) => t.classList.toggle('on', t === tab));
    card.querySelectorAll('[data-bpane]').forEach((p) => { p.hidden = p.dataset.bpane !== tab.dataset.btab; });
    if (tab.dataset.btab === 'photos') loadRowPhotos(row.rowId);
    return;
  }

  const del = e.target.closest('button[data-brassetdel]');
  if (del) {
    await api('/v1/batches/draft/rows/' + row.rowId + '/assets/' + del.dataset.slot + '/' + del.dataset.brassetdel, { method: 'DELETE' });
    loadRowPhotos(row.rowId);
    return;
  }

  const btn = e.target.closest('button[data-bact]');
  if (!btn) return;
  if (btn.dataset.bact === 'toggle') {
    batchOpenRow = batchOpenRow === row.rowId ? null : row.rowId;
    renderBatchRows();
    return;
  }
  if (btn.dataset.bact === 'removerow') {
    batchDraft.rows = batchDraft.rows.filter((r) => r.rowId !== row.rowId);
    if (batchOpenRow === row.rowId) batchOpenRow = null;
    await saveBatchDraft({ now: true });
    renderBatchRows();
    return;
  }
  if (btn.dataset.bact === 'duplicate') {
    // Everything but the identity: the common case is a run of similar sites.
    await addBatchRows([newBatchRow({
      name: '', siteName: '', tagline: row.tagline,
      brief: { ...(row.brief || {}) }, prompt: row.prompt,
      features: [...(row.features || [])], facts: JSON.parse(JSON.stringify(row.facts || {})),
    })]);
    return;
  }
  if (btn.dataset.bact === 'featuresToAll') {
    for (const r of batchDraft.rows) r.features = [...(row.features || [])];
    await Promise.all(batchDraft.rows.map(ensureRowFields));
    await saveBatchDraft({ now: true });
    renderBatchRows();
  }
});

$('#batchBacklogNote')?.addEventListener('click', async (e) => {
  if (!e.target.closest('#batchBacklogAdd')) return;
  await addBatchRows(batchDraft.backlog.map((spec) => newBatchRow({
    name: spec.name || '', siteName: spec.siteName || '', tagline: spec.tagline || '',
    prompt: spec.prompt || '', brief: spec.brief || {},
    features: Array.isArray(spec.features) ? spec.features : [], facts: spec.facts || {},
    // Keep the original row id so photos staged for the failed attempt come with it.
    ...(spec.rowId ? { rowId: spec.rowId } : {}),
  })));
});

$('#batchSubmitBtn')?.addEventListener('click', async () => {
  const out = $('#batchSubmitOut');
  if (!batchDraft.rows.length) { out.innerHTML = '<div class="report err">Add at least one build.</div>'; return; }
  if (!(await saveBatchDraft({ now: true }))) { out.innerHTML = '<div class="report err">Could not save the list, so nothing was submitted.</div>'; return; }
  // Mirror the server's gate before spending a whole overnight run on a site
  // that would ship half-finished.
  const short = batchDraft.rows
    .map((r, i) => ({ i, r, st: rowState(r) }))
    .filter((x) => !x.st.ok);
  if (short.length) {
    out.innerHTML = '<div class="report err"><b>' + short.length + ' build(s) still need answers</b>, so nothing was submitted. ' +
      'A batch run costs real tokens and takes hours, so every build is checked first.<ul style="margin:0.5rem 0 0;padding-left:1.1rem">' +
      short.map((x) => '<li>' + (x.i + 1) + '. ' + esc(x.r.name || x.r.siteName || 'Untitled build') + ' — ' +
        esc([...x.st.blocked.map((b) => 'needs ' + b), ...x.st.missing.map((m) => m.label)].join(', ')) + '</li>').join('') +
      '</ul></div>';
    document.querySelector('[data-batchrow="' + short[0].r.rowId + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // Same nudge the interactive build gives: a batch runs for hours, so a build
  // with no logo or photos is worth one question before it goes.
  const bare = batchDraft.rows.filter((r) => !r.photos);
  if (bare.length && !confirm(
    bare.length + ' of ' + batchDraft.rows.length + ' build(s) have no logo or photos yet: ' +
    bare.map((r) => r.name || r.siteName).join(', ') +
    '.\n\nOK = submit without them\nCancel = go add photos first')) {
    document.querySelector('[data-batchrow="' + bare[0].rowId + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  out.innerHTML = '<div class="report" style="background:var(--code-bg);color:var(--muted)">Submitting ' + batchDraft.rows.length + ' build(s)…</div>';
  const { status, body } = await api('/v1/batches', { method: 'POST', body: {} });
  if (status === 202) {
    batchDraft.rows = [];
    batchOpenRow = null;
    setSaveState('');
    renderBatchRows();
    out.innerHTML = '<div class="report ok">✓ Batch submitted: ' + body.count + ' build(s). It runs in the background (up to 24h, usually much less); we email you when it\'s done. Progress shows below.</div>';
    loadBatchView();
    return;
  }
  if (status === 422 && Array.isArray(body.builds)) {
    out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Some builds were rejected.') +
      '<ul style="margin:0.5rem 0 0;padding-left:1.1rem">' +
      body.builds.map((p) => '<li>' + (p.index + 1) + '. ' + esc(p.name || 'Untitled build') + ' — ' + esc(p.message) + '</li>').join('') +
      '</ul></div>';
    return;
  }
  out.innerHTML = '<div class="report err">' + esc(body.error?.message || 'Submit failed (' + status + ').') + '</div>';
});

$('#batchList')?.addEventListener('click', async (e) => {
  // "Download all" streams an archive and needs the auth header, so it is
  // fetched rather than followed as a plain link.
  const dl = e.target.closest('a[data-bact="export-all"]');
  if (dl) {
    e.preventDefault();
    const out = document.querySelector('[data-bulkout="' + dl.dataset.id + '"]');
    const res = await fetch('/v1/batches/' + dl.dataset.id + '/export', { headers: { Authorization: 'Bearer ' + getApiKey() } });
    if (res.ok) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'batch.tar.gz';
      a.click();
      URL.revokeObjectURL(a.href);
      if (out) out.innerHTML = '<div class="report ok">Downloaded every finished site, one folder each.</div>';
    } else if (out) {
      const b = await res.json().catch(() => ({}));
      out.innerHTML = '<div class="report" style="background:var(--warn-soft);color:var(--warn)">' + esc(b.error?.message || 'Nothing to download yet.') + '</div>';
    }
    return;
  }

  const btn = e.target.closest('button[data-bact]');
  if (!btn) return;
  const id = btn.dataset.id;
  const out = () => document.querySelector('[data-bulkout="' + id + '"]');
  if (btn.dataset.bact === 'expand') { expandBatch(id); return; }

  if (btn.dataset.bact === 'discard') {
    if (!confirm('Discard this design?\n\nThe site and the template this build generated are both deleted. This cannot be undone.')) return;
  }
  if (btn.dataset.bact === 'publish-all') {
    if (!confirm('Publish every approved site in this batch?\n\nThey go live on your connected hosting, one after another.')) return;
  }

  const ROUTE = {
    now: (cid) => '/builds/' + cid + '/generate-now',
    requeue: (cid) => '/builds/' + cid + '/requeue',
    approve: (cid) => '/builds/' + cid + '/approve',
    discard: (cid) => '/builds/' + cid + '/discard',
    'approve-all': () => '/approve-all',
    'publish-all': () => '/publish',
  };
  const suffix = ROUTE[btn.dataset.bact];
  if (!suffix) return;
  btn.disabled = true;
  const { status, body } = await api('/v1/batches/' + id + suffix(btn.dataset.cid), { method: 'POST' });
  if (status >= 300) {
    const o = out();
    if (o) o.innerHTML = '<div class="report err">' + esc(body.error?.message || 'That did not work (' + status + ').') + '</div>';
    btn.disabled = false;
    return;
  }
  if (btn.dataset.bact === 'publish-all') {
    const o = out();
    if (o) o.innerHTML = '<div class="report ok">Publishing ' + body.total + ' site(s). Progress updates here as each one lands.</div>';
  }
  await loadBatchView();
  expandBatch(id);
});

/* ══════════════ Rulebook ══════════════ */
$('#rulebookPre').textContent = RULEBOOK_PROMPT;

/* ══════════════ Boot: gate on session ══════════════ */
(async () => {
  const account = await whoami();
  if (account) { showApp(account); renderMaskedKey(); revealBatchNav(); route(); }
  else { showGate(); }
})();
