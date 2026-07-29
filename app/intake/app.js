/*
 * The client's intake form.
 *
 * One page, no framework, no build step, same as the console. The questions
 * come from the server (the same content model the build reads), so this file
 * knows how to render a KIND of question and nothing about any particular one:
 * add a field to content.mjs and it appears here.
 *
 * Two decisions worth stating:
 *  - Answers save as you type, debounced. A client fills this in between
 *    customers, on a phone, and losing twenty minutes to a closed tab is the
 *    kind of thing that ends with them never coming back to it.
 *  - Nothing here touches the real site. Submitting hands the answers to the
 *    designer, who adopts them deliberately. That is why this page can be open
 *    to anyone holding the link without being a way to damage finished work.
 */
const TOKEN = decodeURIComponent(location.pathname.replace(/^\/intake\//, '').replace(/\/$/, ''));
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let schema = null;   // { fields, groups, photoSlots, siteName, studio, note }
let facts = {};      // what is typed in right now
let photos = {};     // slot id -> [{ id, filename }]

/* ── Talking to the server ───────────────────────────────────────────────── */

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`/v1/public/intake/${encodeURIComponent(TOKEN)}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, body: { error: { message: 'We could not reach the server. Check your connection and try again.' } } };
  }
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

/* ── Question kinds ──────────────────────────────────────────────────────── */

/** One line of text, and the input type each kind wants. */
const TEXT_KINDS = { line: 'text', email: 'email', tel: 'tel', address: 'text', hours: 'text' };
/** A list of single values. */
const LIST_KINDS = new Set(['list', 'topics']);
/** A list of small records: the columns, in order. */
const ROW_KINDS = {
  people: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }],
  roles: [{ key: 'title', label: 'Job title' }, { key: 'summary', label: 'One line about it' }],
  products: [{ key: 'name', label: 'Item' }, { key: 'price', label: 'Price' }, { key: 'note', label: 'Note (optional)' }],
};

function questionHtml(field) {
  const id = `f-${field.id}`;
  const req = field.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const help = field.help ? `<p class="qhelp" id="${id}-help">${esc(field.help)}</p>` : '';
  const described = field.help ? ` aria-describedby="${id}-help"` : '';

  if (field.kind === 'facts') {
    return `<div class="q" data-field="${esc(field.id)}" data-kind="${esc(field.kind)}">
      <label for="${id}">${esc(field.label)}${req}</label>${help}
      <textarea id="${id}" data-single${described}></textarea>
    </div>`;
  }
  if (TEXT_KINDS[field.kind]) {
    return `<div class="q" data-field="${esc(field.id)}" data-kind="${esc(field.kind)}">
      <label for="${id}">${esc(field.label)}${req}</label>${help}
      <input id="${id}" type="${TEXT_KINDS[field.kind]}" data-single${described}>
    </div>`;
  }
  if (LIST_KINDS.has(field.kind) || ROW_KINDS[field.kind]) {
    // A group of inputs cannot use <label for>, so the visible label is tied to
    // the group with a role and aria-labelledby instead.
    return `<div class="q" data-field="${esc(field.id)}" data-kind="${esc(field.kind)}">
      <span class="qlabel" id="${id}-label">${esc(field.label)}${req}</span>${help}
      <div class="rows" role="group" aria-labelledby="${id}-label" data-rows></div>
      <button class="addrow" type="button" data-add>+ Add another</button>
    </div>`;
  }
  return ''; // 'photos' fields are satisfied by the pictures section
}

/** One row of a list or record question. */
function rowHtml(field, value) {
  const cols = ROW_KINDS[field.kind];
  const cell = (col) =>
    `<input type="text" data-col="${col.key}" placeholder="${esc(col.label)}" aria-label="${esc(col.label)}" value="${esc(value?.[col.key] ?? '')}">`;
  const inner = cols
    ? cols.map(cell).join('')
    : `<input type="text" data-col="one" aria-label="${esc(field.label)}" value="${esc(value ?? '')}">`;
  return `<div class="row">${inner}<button class="drop" type="button" data-drop aria-label="Remove this line">×</button></div>`;
}

function renderRows(q, field) {
  const host = $('[data-rows]', q);
  const cols = ROW_KINDS[field.kind];
  const current = Array.isArray(facts[field.id]) ? facts[field.id] : [];
  // Always one empty line to type into, so the form never needs "press add
  // first" as an instruction.
  const values = current.length ? current : [cols ? {} : ''];
  host.innerHTML = values.map((v) => rowHtml(field, v)).join('');
}

/** Read every row back out of the DOM into the shape the server expects. */
function readRows(q, field) {
  const cols = ROW_KINDS[field.kind];
  const out = [];
  for (const row of q.querySelectorAll('.row')) {
    if (cols) {
      const rec = {};
      let any = false;
      for (const col of cols) {
        const v = row.querySelector(`[data-col="${col.key}"]`)?.value.trim() ?? '';
        rec[col.key] = v;
        if (v) any = true;
      }
      if (any) out.push(rec);
    } else {
      const v = row.querySelector('[data-col="one"]')?.value.trim() ?? '';
      if (v) out.push(v);
    }
  }
  return out;
}

/* ── Building the form ───────────────────────────────────────────────────── */

function renderForm() {
  // Grouped the way the content model groups them, so a client answers one
  // subject at a time instead of hopping about.
  const byGroup = new Map();
  for (const field of schema.fields) {
    if (field.kind === 'photos') continue;
    if (!byGroup.has(field.group)) byGroup.set(field.group, []);
    byGroup.get(field.group).push(field);
  }
  $('#form').innerHTML = [...byGroup].map(([group, fields]) =>
    `<section class="card"><h2>${esc(schema.groups[group] || group)}</h2>${fields.map(questionHtml).join('')}</section>`
  ).join('');

  // Fill in what is already saved.
  for (const q of document.querySelectorAll('.q')) {
    const field = schema.fields.find((f) => f.id === q.dataset.field);
    if (!field) continue;
    const single = $('[data-single]', q);
    if (single) single.value = String(facts[field.id] ?? '');
    else renderRows(q, field);
  }
}

function renderPhotos() {
  $('#photosCard').hidden = !schema.photoSlots.length;
  $('#photos').innerHTML = schema.photoSlots.map((slot) => {
    const items = photos[slot.id] || [];
    return `<div class="slot" data-slot="${esc(slot.id)}">
      <h3>${esc(slot.label)}</h3>
      <p class="qhelp">${esc(slot.description || '')} Up to ${slot.max} ${slot.max === 1 ? 'file' : 'files'}.</p>
      <button class="pickbtn" type="button" data-pick${items.length >= slot.max ? ' disabled' : ''}>
        ${items.length >= slot.max ? 'That is the most we can take' : 'Choose ' + (slot.max === 1 ? 'a file' : 'files')}
      </button>
      <input type="file" accept="${slot.accept.map((e) => '.' + e).join(',')}"${slot.max > 1 ? ' multiple' : ''} hidden data-file>
      <div class="thumbs">${items.map((a) => `
        <div class="thumb" data-photo="${esc(a.id)}">
          <img src="/v1/public/intake/${encodeURIComponent(TOKEN)}/photos/${esc(slot.id)}/${esc(a.id)}" alt="">
          <button class="kill" type="button" data-kill aria-label="Remove ${esc(a.filename)}">×</button>
          <span class="name">${esc(a.filename)}</span>
        </div>`).join('')}</div>
    </div>`;
  }).join('');
}

function progress() {
  const required = schema.fields.filter((f) => f.required && f.kind !== 'photos');
  const done = required.filter((f) => filled(facts[f.id])).length;
  const pct = required.length ? Math.round((done / required.length) * 100) : 100;
  $('#bar').style.width = pct + '%';
  $('#progresstext').textContent = done === required.length
    ? 'Everything essential is answered. Anything else you add is a bonus.'
    : `${done} of ${required.length} essential questions answered.`;
  const submit = $('#submit');
  submit.disabled = done !== required.length;
  const note = $('#submitnote');
  note.className = 'submitnote';
  note.textContent = done === required.length
    ? 'You can still make changes after sending this.'
    : 'The starred questions are the ones a website cannot be built without.';
}

const filled = (v) => {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return String(v ?? '').trim().length > 0;
};

/* ── Saving ──────────────────────────────────────────────────────────────── */

let saveTimer = 0;
let pending = {};

function setSaveState(text, tone = '') {
  const el = $('#saveState');
  el.className = 'saved' + (tone ? ' ' + tone : '');
  el.textContent = text;
}

/** Queue one field. Debounced, and merged, so a fast typist sends one request
 *  rather than one per keystroke. */
function queueSave(fieldId, value) {
  facts[fieldId] = value;
  pending[fieldId] = value;
  progress();
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 800);
}

async function flushSave() {
  if (!Object.keys(pending).length) return;
  const sending = pending;
  pending = {};
  const { ok, body } = await call('PATCH', '', { facts: sending });
  if (ok) {
    setSaveState('Saved.', 'ok');
    return;
  }
  // Put it back so the next attempt carries it: losing a client's typing
  // silently is the one thing this page must never do.
  pending = { ...sending, ...pending };
  setSaveState(body.error?.message || 'We could not save that just now. It will retry.', 'err');
}

// A closing tab should not cost the last few seconds of typing.
window.addEventListener('beforeunload', () => {
  if (!Object.keys(pending).length) return;
  navigator.sendBeacon?.(
    `/v1/public/intake/${encodeURIComponent(TOKEN)}`,
    new Blob([JSON.stringify({ facts: pending })], { type: 'application/json' }),
  );
});

/* ── Events ──────────────────────────────────────────────────────────────── */

function wire() {
  const form = $('#form');

  form.addEventListener('input', (e) => {
    const q = e.target.closest('.q');
    if (!q) return;
    const field = schema.fields.find((f) => f.id === q.dataset.field);
    if (!field) return;
    if (e.target.matches('[data-single]')) queueSave(field.id, e.target.value);
    else if (e.target.matches('[data-col]')) queueSave(field.id, readRows(q, field));
  });

  form.addEventListener('click', (e) => {
    const q = e.target.closest('.q');
    if (!q) return;
    const field = schema.fields.find((f) => f.id === q.dataset.field);
    if (!field) return;
    if (e.target.closest('[data-add]')) {
      $('[data-rows]', q).insertAdjacentHTML('beforeend', rowHtml(field, ROW_KINDS[field.kind] ? {} : ''));
      $('[data-rows]', q).lastElementChild.querySelector('input')?.focus();
      return;
    }
    if (e.target.closest('[data-drop]')) {
      const rows = q.querySelectorAll('.row');
      // Never leave nothing to type into.
      if (rows.length === 1) rows[0].querySelectorAll('input').forEach((i) => { i.value = ''; });
      else e.target.closest('.row').remove();
      queueSave(field.id, readRows(q, field));
    }
  });

  $('#photos').addEventListener('click', async (e) => {
    const slotEl = e.target.closest('.slot');
    if (!slotEl) return;
    if (e.target.closest('[data-pick]')) { $('[data-file]', slotEl).click(); return; }
    const kill = e.target.closest('[data-kill]');
    if (!kill) return;
    const photoId = kill.closest('[data-photo]').dataset.photo;
    const { ok, body } = await call('DELETE', `/photos/${encodeURIComponent(slotEl.dataset.slot)}/${encodeURIComponent(photoId)}`);
    if (!ok) { setSaveState(body.error?.message || 'Could not remove that picture.', 'err'); return; }
    photos[slotEl.dataset.slot] = (photos[slotEl.dataset.slot] || []).filter((a) => a.id !== photoId);
    renderPhotos();
    setSaveState('Picture removed.', 'ok');
  });

  $('#photos').addEventListener('change', async (e) => {
    const input = e.target.closest('[data-file]');
    if (!input) return;
    const slotEl = input.closest('.slot');
    const slotId = slotEl.dataset.slot;
    const slot = schema.photoSlots.find((s) => s.id === slotId);
    const files = [...input.files];
    input.value = '';
    for (const file of files) {
      if ((photos[slotId] || []).length >= slot.max) {
        setSaveState(`That is the most pictures we can take for ${slot.label}.`, 'err');
        break;
      }
      if (file.size > 8_000_000) { setSaveState(`"${file.name}" is too big — 8 MB is the limit.`, 'err'); continue; }
      setSaveState(`Uploading ${file.name}…`);
      const contentBase64 = await toBase64(file);
      const { ok, body } = await call('POST', `/photos/${encodeURIComponent(slotId)}`, { filename: file.name, contentBase64 });
      if (!ok) { setSaveState(body.error?.message || `Could not upload ${file.name}.`, 'err'); continue; }
      photos[slotId] = [...(photos[slotId] || []), body.asset];
      renderPhotos();
      setSaveState('Picture added.', 'ok');
    }
  });

  $('#submit').addEventListener('click', async () => {
    const submit = $('#submit');
    submit.disabled = true;
    await flushSave();
    const { ok, body } = await call('POST', '/submit');
    if (!ok) {
      const note = $('#submitnote');
      note.className = 'submitnote err';
      note.textContent = body.error?.message || 'We could not send that just now. Try again in a moment.';
      submit.disabled = false;
      return;
    }
    showDone();
  });
}

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('read failed'));
  reader.readAsDataURL(file);
});

/* ── Screens ─────────────────────────────────────────────────────────────── */

function showDone({ closed = false } = {}) {
  const sheet = $('#sheet');
  const who = schema.studio || 'your designer';
  sheet.innerHTML = '';
  sheet.append($('#tpl-done').content.cloneNode(true));

  // Closed for good: the designer has already taken the answers onto the site,
  // so offering "change my answers" would be a button that cannot work.
  if (closed) {
    $('#donetext').textContent = `${who} has your answers and pictures, and is building the site with them.`;
    $('.donefine').textContent = `Spotted something wrong? Tell ${who} directly and they will change it.`;
    $('#reopen').hidden = true;
    return;
  }

  $('#donetext').textContent = `Your answers and pictures are with ${who}. They will be in touch when there is something to look at.`;
  $('#reopen').addEventListener('click', async () => {
    const { ok, body } = await call('POST', '/reopen');
    if (!ok) {
      $('#donetext').textContent = body.error?.message || 'That cannot be changed now.';
      $('#reopen').hidden = true;
      return;
    }
    boot();
  });
}

function showGone(message) {
  $('#sheet').innerHTML = `<div class="gone"><h1>This link is not open any more</h1><p>${esc(message)}</p></div>`;
}

async function boot() {
  const sheet = $('#sheet');
  sheet.setAttribute('aria-busy', 'true');
  const { ok, status, body } = await call('GET', '');
  if (!ok) {
    sheet.setAttribute('aria-busy', 'false');
    showGone(status === 0
      ? 'We could not reach the server. Check your connection and reload the page.'
      : (body.error?.message || 'Ask whoever sent it for a new one.'));
    return;
  }
  schema = body;
  facts = body.facts || {};
  photos = body.photos || {};

  if (body.closed || body.submitted) {
    sheet.setAttribute('aria-busy', 'false');
    showDone({ closed: Boolean(body.closed) });
    return;
  }

  sheet.innerHTML = '';
  sheet.append($('#tpl-form').content.cloneNode(true));
  sheet.setAttribute('aria-busy', 'false');

  $('#from').textContent = schema.studio ? `Sent to you by ${schema.studio}` : 'Sent to you by your designer';
  $('#title').textContent = `About ${schema.siteName}`;
  document.title = `About ${schema.siteName}`;
  if (schema.note) { $('#note').hidden = false; $('#note').textContent = schema.note; }

  renderForm();
  renderPhotos();
  progress();
  wire();
}

boot();
