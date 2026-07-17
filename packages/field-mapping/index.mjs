/**
 * Stardrive field-mapping engine (M1).
 *
 * Turns a filled-out intake questionnaire (a flat object of answers keyed by
 * stable question codes) into a build config, a contact record, decision
 * flags, review notes, and a mapping report — driven ENTIRELY by a
 * declarative mapping file a non-engineer can author. This replaces
 * hand-written per-form parsers: change the questionnaire, edit the mapping
 * JSON, done.
 *
 * Pure ESM, zero dependencies, no Node APIs — runs identically in a Next.js
 * server route, a CLI script, or a browser. The caller loads the mapping and
 * the answers; this module only computes.
 *
 * Mapping format: see README.md in this package. The format is versioned via
 * the mapping's `format` field ("stardrive-field-mapping/v1").
 */

// ── Shared text helpers (exported: consumers + mappings rely on the exact
//    same semantics the engine uses internally) ──────────────────────────

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const isYes = (v) => /^yes\b/i.test(String(v).trim());
export const isUnsure = (v) => /not sure|unsure|maybe/i.test(String(v).trim());
export const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(v).trim());
export const looksLikeUrl = (v) =>
  /^https?:\/\/\S+$/i.test(String(v).trim()) || /^www\.\S+\.\S+/i.test(String(v).trim());

/** Comma/semicolon/newline list → trimmed entries, "no/n\/a/none" dropped. */
export function splitList(raw) {
  return String(raw || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(no|n\/a|none)$/i.test(s));
}

/**
 * Free-text FAQ answer → {q, a} pairs (max 12). Accepts "Q: ... A: ..."
 * blocks or alternating lines where the question line ends with "?".
 * Anything that doesn't pair up cleanly is dropped, never guessed.
 */
export function parseFaqPairs(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const pairs = [];
  const qaBlocks = [...text.matchAll(/Q[:.]\s*([^\n]+)\n+\s*A[:.]\s*([^\n]+)/gi)];
  if (qaBlocks.length) {
    for (const m of qaBlocks) pairs.push({ q: m[1].trim(), a: m[2].trim() });
  } else {
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      if (lines[i].endsWith('?')) pairs.push({ q: lines[i], a: lines[i + 1] });
    }
  }
  return pairs.slice(0, 12);
}

/** Answer values may be string | string[] | undefined; normalize to string. */
export function flattenAnswer(v) {
  if (v == null) return '';
  return (Array.isArray(v) ? v.join(', ') : String(v)).trim();
}

// ── Internals ────────────────────────────────────────────────────────────

const VALIDATORS = { email: looksLikeEmail, url: looksLikeUrl };

/** Case-insensitive regex from a mapping string; bad patterns throw at
 *  validate time, not silently misbehave at run time. */
function re(pattern) {
  return new RegExp(pattern, 'i');
}

/**
 * Answer lookup by stable question code. A code matches a key that IS the
 * code or STARTS with it followed by punctuation/space (so "Q3-1" matches
 * "Q3-1. What is your business name?" but never "Q3-10"). Falls back to the
 * `hint` keyword regex against the keys when the code is missing (a survey
 * tool that drops codes, a reworded export), and reports HOW each field
 * resolved so a form change is never silently missed.
 */
function makeReader(answers) {
  const keys = Object.keys(answers);
  return (code, hint) => {
    const codeRe = new RegExp(
      '^' + String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[.\\s:)\\-]|$)',
      'i'
    );
    let key = keys.find((k) => codeRe.test(k));
    if (key) return { value: flattenAnswer(answers[key]), how: 'code' };
    if (hint) {
      const hintRe = re(hint);
      key = keys.find((k) => hintRe.test(k));
      if (key) return { value: flattenAnswer(answers[key]), how: 'fuzzy' };
    }
    return { value: '', how: 'none' };
  };
}

function getPath(root, dotted) {
  let cur = root;
  for (const seg of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setPath(root, dotted, value) {
  const segs = dotted.split('.');
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (typeof cur[segs[i]] !== 'object' || cur[segs[i]] == null) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}

const TRANSFORMS = {
  splitList: (v) => splitList(v),
  faqPairs: (v) => parseFaqPairs(v),
  asNames: (v) => (Array.isArray(v) ? v.map((name) => ({ name })) : v),
  limit: (v, n) => (Array.isArray(v) ? v.slice(0, n) : String(v).slice(0, n)),
  truncate: (v, n) => String(v).slice(0, n),
};

function applyTransforms(value, transforms) {
  let v = value;
  for (const t of transforms || []) {
    const [name, arg] = String(t).split(':');
    const fn = TRANSFORMS[name];
    if (!fn) throw new Error(`Unknown transform "${name}"`);
    v = fn(v, arg == null ? undefined : Number(arg));
  }
  return v;
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// ── Templates ────────────────────────────────────────────────────────────
// Notes and set-values are template strings:
//   {name}            substitute (empty string when absent)
//   {name|fallback}   substitute, or the literal fallback when empty
//   {name#N}          substitute, sliced to the first N characters
//   {?name:text}      include text only when name resolves truthy/non-empty
//   {!name:text}      include text only when name resolves falsy/empty
// Names: value (the field's answer), result/in0/in1... (table entries),
// items (array-policy entries), fields.<id> (another field's answer),
// out.<path> (anything already written to the output), or a derived id.

function stringifyTemplateValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'true' : '';
  return String(v);
}

function renderTemplate(text, ctx, state) {
  const resolve = (name) => {
    if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name];
    if (name.startsWith('out.')) return getPath(state.out, name.slice(4));
    if (name.startsWith('fields.')) return state.values[name.slice(7)];
    if (state.derived && name in state.derived) return state.derived[name]();
    return undefined;
  };
  // Conditional segments first (their bodies may contain substitutions).
  let s = String(text).replace(
    /\{([?!])([\w.$-]+):((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_, op, name, body) => {
      const truthy = !isEmptyValue(resolve(name)) && resolve(name) !== false;
      return (op === '?') === truthy ? body : '';
    }
  );
  // Then plain substitutions with optional fallback / slice.
  s = s.replace(/\{([\w.$-]+)(?:\|([^{}#]*))?(?:#(\d+))?\}/g, (_, name, fallback, slice) => {
    let v = stringifyTemplateValue(resolve(name));
    if (!v && fallback != null) v = fallback;
    if (slice) v = v.slice(0, Number(slice));
    return v;
  });
  return s;
}

// ── Conditions ───────────────────────────────────────────────────────────
// Entry-level `when` / `writeWhen` and object-form note/set conditions:
//   { answerYes: "Q11A-1" }                    the raw answer is a Yes
//   { answerMatches: { code, match } }         raw answer matches the regex
//   { fieldYes: "customFunc" }                 a previously read field is Yes
//   { fieldPresent: "primaryAction" }          a previously read field is non-empty
//   { anyFieldPresent: [ids] }                 any of them is non-empty
//   { outputIncludes: { path, value } }        an output array contains value
// String-form note/set conditions are relative to the entry's own answer:
//   "always" | "present" | "yes" | "unsure" | "written" | { match: regex }

function evalCondition(cond, state, read) {
  if (cond == null) return true;
  if (cond.answerYes) return isYes(read(cond.answerYes).value);
  if (cond.answerMatches) return re(cond.answerMatches.match).test(read(cond.answerMatches.code).value);
  if (cond.fieldYes) return isYes(state.values[cond.fieldYes] || '');
  if (cond.fieldPresent) return Boolean(state.values[cond.fieldPresent]);
  if (cond.anyFieldPresent) return cond.anyFieldPresent.some((id) => Boolean(state.values[id]));
  if (cond.outputIncludes) {
    const arr = getPath(state.out, cond.outputIncludes.path);
    return Array.isArray(arr) && arr.includes(cond.outputIncludes.value);
  }
  throw new Error(`Unknown condition ${JSON.stringify(cond)}`);
}

function evalValueCondition(when, value, written, state, read) {
  if (when == null || when === 'always') return true;
  if (when === 'present') return Boolean(value);
  if (when === 'yes') return isYes(value);
  if (when === 'unsure') return isUnsure(value);
  if (when === 'written') return written;
  if (typeof when === 'object' && when.match) return re(when.match).test(value);
  return evalCondition(when, state, read);
}

// ── The engine ───────────────────────────────────────────────────────────

/**
 * Run a mapping over a set of answers.
 *
 * @param {object} mapping  A stardrive-field-mapping/v1 document.
 * @param {object} answers  Flat answers: { "Q3-1": "Acme", ... } (values may
 *                          be string or string[]; keys may be bare codes or
 *                          full question titles that START with the code).
 * @returns {{ config: object, contact: object, flags: object, notes: string[],
 *            unmapped: string[], context: object,
 *            mapReport: { field: string, code: string, how: 'code'|'fuzzy'|'none' }[],
 *            values: Record<string, string> }}
 */
export function runMapping(mapping, answers) {
  if (!mapping || mapping.format !== 'stardrive-field-mapping/v1') {
    throw new Error('Not a stardrive-field-mapping/v1 mapping.');
  }
  const read = makeReader(answers);
  const state = {
    out: { config: {}, contact: {}, flags: {} },
    values: {},
    notes: [],
    unmapped: [],
    mapReport: [],
    derived: {},
  };
  for (const d of mapping.derived || []) {
    state.derived[d.id] = () =>
      (d.anyOf || []).some((c) =>
        c.match != null ? re(c.match).test(state.values[c.field] || '') : Boolean(state.values[c.field])
      );
  }

  const applySets = (sets, ctx, value, written) => {
    for (const s of sets || []) {
      if (!evalValueCondition(s.when, value, written, state, read)) continue;
      const v =
        typeof s.value === 'string' && s.value.includes('{')
          ? renderTemplate(s.value, ctx, state)
          : s.value;
      if (s.append) {
        const arr = getPath(state.out, s.append);
        if (Array.isArray(arr)) arr.push(v);
        else setPath(state.out, s.append, [v]);
      } else {
        setPath(state.out, s.target, v);
      }
    }
  };
  const applyNotes = (notes, ctx, value, written) => {
    for (const n of notes || []) {
      if (!evalValueCondition(n.when, value, written, state, read)) continue;
      state.notes.push(renderTemplate(n.text, ctx, state));
    }
  };

  for (const entry of mapping.fields || []) {
    if (entry.when && !evalCondition(entry.when, state, read)) continue;

    // Set-only entry: unconditional (or gated) literal writes.
    if (!entry.source && !entry.links && !entry.chain && !entry.table && !entry.array) {
      applySets(entry.set, {}, '', false);
      applyNotes(entry.notes, {}, '', false);
      continue;
    }

    // Labeled-links entry: N codes → [{label, href}] kept only when valid.
    if (entry.links) {
      const validate = VALIDATORS[entry.links.validate] || (() => true);
      const items = [];
      for (const item of entry.links.items) {
        const { value, how } = read(item.code);
        state.mapReport.push({ field: `${entry.id}:${item.label}`, code: item.code, how });
        if (validate(value)) items.push({ label: item.label, href: value });
      }
      if (items.length || entry.writeEmpty) setPath(state.out, entry.links.target, items);
      continue;
    }

    // Chain entry: first matching rule wins (an else-if ladder over a
    // previously read field, lowercased).
    if (entry.chain) {
      const input = String(state.values[entry.chain.input] || '').toLowerCase();
      for (const rule of entry.chain.rules) {
        if (!new RegExp(rule.match).test(input)) continue;
        const ctx = { value: state.values[entry.chain.input] || '' };
        applySets(rule.set, ctx, ctx.value, false);
        if (rule.note) state.notes.push(renderTemplate(rule.note, ctx, state));
        break;
      }
      continue;
    }

    // Table entry: keyword rules over the joined inputs; first match wins,
    // with a declared default. in0/in1/... expose the raw input values.
    if (entry.table) {
      const raws = entry.table.inputs.map((id) => state.values[id] || '');
      const joined = raws.join(' ').toLowerCase();
      const hit = entry.table.rules.find((rule) => new RegExp(rule.match).test(joined));
      const result = hit ? hit.value : entry.table.default;
      setPath(state.out, entry.table.target, result);
      const ctx = { result };
      raws.forEach((v, i) => (ctx[`in${i}`] = v));
      const noteText = hit ? entry.table.noteOnMatch : entry.table.noteOnDefault;
      if (noteText) state.notes.push(renderTemplate(noteText, ctx, state));
      continue;
    }

    // Array-policy entry: finalize an appended-to array (prepend a base
    // dependency when non-empty, write [] when empty, note either way).
    if (entry.array) {
      const a = entry.array;
      const appended = getPath(state.out, a.path);
      const items = Array.isArray(appended) ? appended : [];
      const ctx = { items };
      if (items.length) {
        setPath(state.out, a.path, [...(a.prependIfAny || []), ...items]);
        if (a.noteIfAny) state.notes.push(renderTemplate(a.noteIfAny, ctx, state));
      } else {
        if (a.writeEmpty) setPath(state.out, a.path, []);
        if (a.noteIfEmpty) state.notes.push(renderTemplate(a.noteIfEmpty, ctx, state));
      }
      continue;
    }

    // Ordinary source entry.
    const { code, hint } = entry.source;
    let { value, how } = read(code, hint);

    // Fallback scan across ALL answer values (e.g. recover an email/URL the
    // client typed into the wrong box), optionally excluding codes whose
    // values are legitimately that shape (social links are URLs by design).
    const fb = entry.fallback;
    if (fb && fb.scan === 'values') {
      const validator = VALIDATORS[fb.validate];
      const trigger = fb.trigger === 'invalid' ? !validator(value) : value === '';
      if (trigger) {
        const exclude = fb.excludeCodes ? re(fb.excludeCodes) : null;
        const found = Object.entries(answers)
          .filter(([key]) => !exclude || !exclude.test(key))
          .map(([, v]) => flattenAnswer(v))
          .find(validator);
        if (found) value = found;
      }
    }

    if (entry.validate && !VALIDATORS[entry.validate](value)) value = '';
    if (entry.skipIf && value && re(entry.skipIf).test(value)) value = '';

    state.values[entry.id] = value;
    state.mapReport.push({ field: entry.id, code, how });

    if (entry.required && !value) state.unmapped.push(`${entry.id} (${code})`);

    let written = false;
    if (entry.target) {
      const gate = entry.writeWhen ? evalCondition(entry.writeWhen, state, read) : true;
      if (gate) {
        const transformed = applyTransforms(value, entry.transform);
        if (!isEmptyValue(transformed) || entry.writeEmpty) {
          setPath(state.out, entry.target, transformed);
          written = true;
        }
      }
    }

    const ctx = { value };
    applySets(entry.set, ctx, value, written);
    applyNotes(entry.notes, ctx, value, written);
  }

  // Context bundle: rich answers preserved verbatim for a human reviewer —
  // never config, never invented. Exact-code match only.
  const context = {};
  for (const c of mapping.context || []) {
    const { value } = read(c.code);
    if (value) context[c.label] = value;
  }

  return {
    config: state.out.config,
    contact: state.out.contact,
    flags: state.out.flags,
    notes: state.notes,
    unmapped: state.unmapped,
    context,
    mapReport: state.mapReport,
    values: state.values,
  };
}

// ── Mapping validation (for authoring UIs and CI) ────────────────────────

const TARGET_ROOTS = /^(config|contact|flags)(\.|$)/;

/**
 * Statically validate a mapping document: shape, regex syntax, transform
 * names, target roots, and forward references. Returns every problem found,
 * not just the first.
 */
export function validateMapping(mapping) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!mapping || typeof mapping !== 'object') {
    return { ok: false, errors: ['Mapping is not an object.'] };
  }
  if (mapping.format !== 'stardrive-field-mapping/v1') {
    err(`format must be "stardrive-field-mapping/v1" (got ${JSON.stringify(mapping.format)}).`);
  }
  const checkRe = (pattern, where) => {
    try {
      new RegExp(pattern);
    } catch {
      err(`${where}: invalid regex ${JSON.stringify(pattern)}.`);
    }
  };
  const checkTarget = (t, where) => {
    if (!TARGET_ROOTS.test(t)) err(`${where}: target "${t}" must start with config, contact, or flags.`);
  };
  const seen = new Set();
  for (const [i, entry] of (mapping.fields || []).entries()) {
    const where = `fields[${i}]${entry.id ? ` (${entry.id})` : ''}`;
    if (!entry.id) err(`${where}: missing id.`);
    if (entry.id && seen.has(entry.id)) err(`${where}: duplicate id.`);
    seen.add(entry.id);
    if (entry.source?.hint) checkRe(entry.source.hint, where);
    if (entry.skipIf) checkRe(entry.skipIf, where);
    if (entry.validate && !VALIDATORS[entry.validate]) err(`${where}: unknown validate "${entry.validate}".`);
    if (entry.fallback?.validate && !VALIDATORS[entry.fallback.validate]) {
      err(`${where}: unknown fallback validator "${entry.fallback.validate}".`);
    }
    if (entry.fallback?.excludeCodes) checkRe(entry.fallback.excludeCodes, where);
    if (entry.target) checkTarget(entry.target, where);
    for (const t of entry.transform || []) {
      const name = String(t).split(':')[0];
      if (!TRANSFORMS[name]) err(`${where}: unknown transform "${name}".`);
    }
    for (const s of entry.set || []) {
      if (s.target) checkTarget(s.target, where);
      if (s.append) checkTarget(s.append, where);
      if (!s.target && !s.append) err(`${where}: a set needs a target or an append path.`);
    }
    for (const rule of entry.chain?.rules || []) {
      checkRe(rule.match, where);
      for (const s of rule.set || []) if (s.target) checkTarget(s.target, where);
    }
    if (entry.chain && !seen.has(entry.chain.input)) {
      err(`${where}: chain.input "${entry.chain.input}" is not a previously defined field.`);
    }
    for (const rule of entry.table?.rules || []) checkRe(rule.match, where);
    if (entry.table) {
      checkTarget(entry.table.target, where);
      for (const id of entry.table.inputs) {
        if (!seen.has(id)) err(`${where}: table input "${id}" is not a previously defined field.`);
      }
    }
    if (entry.array) checkTarget(entry.array.path, where);
    if (entry.links) {
      checkTarget(entry.links.target, where);
      if (entry.links.validate && !VALIDATORS[entry.links.validate]) {
        err(`${where}: unknown links validator "${entry.links.validate}".`);
      }
    }
  }
  for (const [i, d] of (mapping.derived || []).entries()) {
    if (!d.id) err(`derived[${i}]: missing id.`);
    for (const c of d.anyOf || []) if (c.match != null) checkRe(c.match, `derived[${i}] (${d.id})`);
  }
  for (const [i, c] of (mapping.context || []).entries()) {
    if (!c.code || !c.label) err(`context[${i}]: needs code and label.`);
  }
  return { ok: errors.length === 0, errors };
}
