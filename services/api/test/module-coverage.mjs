/**
 * The bug class this file exists to close.
 *
 * Three times now, something a built site needs at runtime was never asked
 * for, because the code asking was working from a shorter list than the
 * assembler was building from:
 *
 *   1. ADMIN_PASSWORD was "managed", and nothing generated it, so every
 *      published site arrived with its /admin unusable.
 *   2. specFor() was given config.modules and never the base template, which
 *      declares RESEND_API_KEY itself, so a CMS site with no booking module
 *      was never asked for it and its contact form quietly filed enquiries in
 *      a table instead of emailing them.
 *   3. config.modules holds what the licensee TICKED. The assembler pulls in
 *      what those require, so every one of the thirteen feature modules ended
 *      up with d4-cms-core in the build and nowhere in the questions: no
 *      BLOB_READ_WRITE_TOKEN asked for (client's CMS uploads land on local
 *      disk, which a redeploy wipes), and no Pages or Inbox in the handoff.
 *
 * Each was found by accident, months apart, in the same shape. So rather than
 * a fourth fix, this asserts the invariant directly, for every module and for
 * combinations of them:
 *
 *   Everything the ASSEMBLED site declares must be accounted for by the code
 *   that asks the licensee and the client for things.
 *
 * Run: node services/api/test/module-coverage.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { specFor, missingFrom, SUPPLIED, MANAGED, deployEnv } from '../lib/site-env.mjs';
import { resolveModules } from '../lib/modules.mjs';
import { guideFor } from '../lib/handoff.mjs';
import { loadCatalog } from '../lib/templates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'd4-site-template';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

const catalog = loadCatalog();
const manifestOf = (name) => catalog.get(name)?.manifest ?? null;
const features = [...catalog.values()].map((e) => e.manifest).filter((m) => m.kind !== 'site');

console.log('module coverage:');

check('the catalog is what the rest of this file assumes', () => {
  assert.ok(catalog.get(BASE), 'the base site template is in the catalog');
  assert.ok(features.length >= 13, `at least thirteen non-base modules (got ${features.length})`);
});

// ── 1. Resolution matches the assembler's ────────────────────────────────
check('resolveModules pulls in what the assembler would, transitively', () => {
  for (const m of features) {
    const deps = Object.keys(m.requires ?? {});
    const got = resolveModules([m.name], manifestOf);
    for (const dep of deps) {
      assert.ok(got.includes(dep), `${m.name} requires ${dep}, resolution missed it`);
    }
    assert.strictEqual(got[0], m.name, 'the chosen module comes first');
    assert.strictEqual(new Set(got).size, got.length, `${m.name}: resolution repeated a module`);
  }
});

check('a module requiring itself, or a cycle, terminates instead of hanging', () => {
  const cyclic = {
    'a': { name: 'a', requires: { b: '*' } },
    'b': { name: 'b', requires: { a: '*' } },
    'self': { name: 'self', requires: { self: '*' } },
  };
  const resolve = (n) => cyclic[n] ?? null;
  assert.deepStrictEqual(resolveModules(['a'], resolve).sort(), ['a', 'b']);
  assert.deepStrictEqual(resolveModules(['self'], resolve), ['self']);
});

check('an unknown module does not take the request down with it', () => {
  // An imported template may name something that is not there. The assembler
  // refuses it later, with a better message than this layer could give.
  assert.deepStrictEqual(resolveModules(['d4-gallery-editor', 'not-a-real-module'], manifestOf).sort(),
    ['d4-cms-core', 'd4-gallery-editor', 'not-a-real-module']);
});

// ── 2. Every declared variable reaches the spec ──────────────────────────
check('every env var any assembled module declares appears in that site\'s spec', () => {
  const gaps = [];
  for (const m of features) {
    const resolvedList = resolveModules([m.name], manifestOf);
    const spec = specFor([BASE, ...resolvedList], manifestOf);
    const known = new Set(spec.map((v) => v.name));
    // Everything declared by the base template AND by every module that ends
    // up in the build, not merely the one that was ticked.
    for (const name of [BASE, ...resolvedList]) {
      for (const v of manifestOf(name)?.env ?? []) {
        if (!known.has(v.name)) gaps.push(`${m.name}: ${v.name} (declared by ${name})`);
      }
    }
  }
  assert.deepStrictEqual(gaps, [], `\n        ${gaps.join('\n        ')}`);
});

check('and the same holds for combinations, not just one module at a time', () => {
  // Pairs, since that is where a dependency shared by two modules could be
  // dropped by whichever resolution ran second.
  const gaps = [];
  for (let i = 0; i < features.length; i += 1) {
    for (let j = i + 1; j < features.length; j += 1) {
      const chosen = [features[i].name, features[j].name];
      const resolvedList = resolveModules(chosen, manifestOf);
      const known = new Set(specFor([BASE, ...resolvedList], manifestOf).map((v) => v.name));
      for (const name of [BASE, ...resolvedList]) {
        for (const v of manifestOf(name)?.env ?? []) {
          if (!known.has(v.name)) gaps.push(`${chosen.join('+')}: ${v.name}`);
        }
      }
    }
  }
  assert.deepStrictEqual(gaps, [], `\n        ${[...new Set(gaps)].join('\n        ')}`);
});

// ── 3. Every variable has an owner who can actually produce it ───────────
check('every variable is either generated for the licensee or asked of somebody', () => {
  const orphans = [];
  for (const m of features) {
    const spec = specFor([BASE, ...resolveModules([m.name], manifestOf)], manifestOf);
    for (const v of spec) {
      // 'optional' is a real answer (the site works without it). What must not
      // happen is a REQUIRED variable that nobody is responsible for.
      if (v.required && v.source === 'optional') orphans.push(`${m.name}: ${v.name}`);
      if (v.source === 'managed' && !MANAGED[v.name]) orphans.push(`${m.name}: ${v.name} claims managed but nothing manages it`);
      if (v.source === 'supplied' && !SUPPLIED[v.name]) orphans.push(`${m.name}: ${v.name} claims supplied but nobody is asked`);
    }
  }
  assert.deepStrictEqual(orphans, [], `\n        ${orphans.join('\n        ')}`);
});

check('everything we call managed is actually produced, not merely promised', () => {
  // The ADMIN_PASSWORD bug in one assertion: a variable marked as ours to
  // handle must come out of deployEnv with a value.
  const env = deployEnv({
    supplied: {},
    adminPassword: 'generated-here',
    databaseUrl: 'libsql://example',
    databaseToken: 'token',
    siteUrl: 'https://example.com',
  });
  const unproduced = [];
  for (const m of features) {
    const spec = specFor([BASE, ...resolveModules([m.name], manifestOf)], manifestOf);
    for (const v of spec) {
      if (v.source !== 'managed') continue;
      if (!String(env[v.name] ?? '').trim()) unproduced.push(`${m.name}: ${v.name}`);
    }
  }
  assert.deepStrictEqual([...new Set(unproduced)], [], `\n        ${[...new Set(unproduced)].join('\n        ')}`);
});

check('what is still owed is stated for a site with nothing filled in', () => {
  for (const m of features) {
    const spec = specFor([BASE, ...resolveModules([m.name], manifestOf)], manifestOf);
    const missing = missingFrom(spec, {});
    assert.ok(missing.length > 0, `${m.name}: a site with nothing supplied owes nothing, which cannot be right`);
    for (const item of missing) {
      assert.ok(item.label && item.label !== item.name, `${m.name}: ${item.name} has no human label`);
      assert.ok(item.why && item.why.length > 10, `${m.name}: ${item.name} does not say what happens if it is left blank`);
    }
  }
});

// ── 4. The handoff describes the site the client actually got ────────────
check('the client handoff covers every module in the assembled site', () => {
  // An editor the client was never told about may as well not exist. The
  // manifest names panels as slugs and the guide writes them for a person, so
  // the invariant is per MODULE, not per string: any module that ships an
  // admin panel must have something written about it.
  const gaps = [];
  for (const m of features) {
    for (const name of resolveModules([m.name], manifestOf)) {
      const panels = manifestOf(name)?.provides?.adminPanels ?? [];
      if (!panels.length) continue;
      const rows = guideFor([name]);
      if (!rows.length) gaps.push(`${name} ships ${panels.length} admin panel(s) and the handoff says nothing about it`);
      for (const row of rows) {
        assert.ok(row.panel && row.can, `${name}: a guide row without a panel name or an explanation`);
        assert.ok(row.can.length > 20, `${name}: "${row.panel}" is not actually explained`);
      }
    }
  }
  assert.deepStrictEqual(gaps, [], `\n        ${[...new Set(gaps)].join('\n        ')}`);
});

check('picking one feature tells the client about the admin it drags in with it', () => {
  // The regression in full: ticking "Photo gallery" alone builds a site with
  // the CMS in it, and the client used to be handed a page that never
  // mentioned the Pages editor or the Inbox they had just been given.
  const rows = guideFor(resolveModules(['d4-gallery-editor'], manifestOf));
  const panels = rows.map((r) => r.panel);
  assert.ok(panels.includes('Galleries'), 'the gallery they asked for');
  assert.ok(panels.includes('Pages'), 'and the page editor that came with it');
  assert.ok(panels.includes('Inbox'), 'and the inbox their contact form fills');
});

// ── 5. Nothing in the engine is invisible to the catalog ─────────────────
check('every vendored module is in the catalog, so none can be built but unlisted', () => {
  const vendored = fs.readdirSync(path.join(HERE, '..', '..', '..', 'vendor', 'd4'))
    .filter((d) => d.startsWith('d4-') && d !== 'd4-site-builder');
  const missing = vendored.filter((name) => !catalog.get(name));
  assert.deepStrictEqual(missing, [], `vendored but not in the catalog: ${missing.join(', ')}`);
});

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll module coverage checks passed.');
