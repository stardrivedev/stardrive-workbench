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
import { specFor, missingFrom, SUPPLIED, SUPPLIED_GROUPS, MANAGED, deployEnv } from '../lib/site-env.mjs';
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

check('the catalog is byte-identical to the manifests actually built from', () => {
  // data/README.md calls these "verbatim copies", and nothing enforced it. If
  // they drift, the API asks the licensee for one set of variables while the
  // engine builds a site that reads another — the same bug class as the three
  // this file already guards, in a new place.
  const drifted = [];
  for (const name of catalog.keys()) {
    const vendorPath = path.join(HERE, '..', '..', '..', 'vendor', 'd4', name, 'manifest.json');
    if (!fs.existsSync(vendorPath)) { drifted.push(`${name}: no vendored manifest`); continue; }
    const a = fs.readFileSync(path.join(HERE, '..', 'data', 'catalog', `${name}.json`), 'utf-8').replace(/\r\n/g, '\n');
    const b = fs.readFileSync(vendorPath, 'utf-8').replace(/\r\n/g, '\n');
    if (a !== b) drifted.push(name);
  }
  assert.deepStrictEqual(drifted, [], `catalog and vendor manifests differ: ${drifted.join(', ')}`);
});

// ── 6. Either/or requirements ────────────────────────────────────────────
check('every grouped variable belongs to a group that exists and can be satisfied', () => {
  const problems = [];
  for (const [name, def] of Object.entries(SUPPLIED)) {
    if (!def.group) continue;
    const group = SUPPLIED_GROUPS[def.group];
    if (!group) { problems.push(`${name} claims group "${def.group}", which is not defined`); continue; }
    // A variable in a group must either be part of an option or be marked
    // optional within it. Anything else can never be asked for coherently.
    const inAnOption = group.options.some((o) => o.vars.includes(name));
    if (!inAnOption && !def.optionalWithin) {
      problems.push(`${name} is in group "${def.group}" but in none of its options`);
    }
  }
  for (const [key, group] of Object.entries(SUPPLIED_GROUPS)) {
    assert.ok(group.options.length >= 2, `group "${key}" with fewer than two options is not a choice`);
    for (const opt of group.options) {
      assert.ok(opt.vars.length, `group "${key}" option "${opt.id}" requires nothing`);
      for (const v of opt.vars) {
        if (!SUPPLIED[v]) problems.push(`group "${key}" option "${opt.id}" wants ${v}, which is not a supplied variable`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], `\n        ${problems.join('\n        ')}`);
});

check('one complete option satisfies the group, and a half-filled one does not', () => {
  const spec = specFor([BASE, 'd4-cms-core'], manifestOf);
  const missingNames = (env) => missingFrom(spec, env).map((m) => m.name);

  assert.ok(missingNames({}).includes('imageStorage'),
    'a site with no storage at all reports the requirement');
  assert.strictEqual(missingNames({}).filter((n) => n.startsWith('S3_') || n === 'BLOB_READ_WRITE_TOKEN').length, 0,
    'and reports it once, not once per variable');

  for (const env of [
    { BLOB_READ_WRITE_TOKEN: 'vercel_blob_token' },
    { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' },
  ]) {
    assert.strictEqual(missingNames(env).includes('imageStorage'), false,
      `${Object.keys(env).join('+')} should satisfy image storage on its own`);
  }

  // Half of one option is not an answer: uploads would fail at runtime.
  assert.ok(missingNames({ S3_BUCKET: 'b' }).includes('imageStorage'),
    'a bucket with no keys is not working storage');
  assert.ok(missingNames({ S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' }).includes('imageStorage'),
    'nor a bucket and half a key pair');
});

check('the optional S3 extras are never what stands between a site and being ready', () => {
  // Endpoint, region and public URL all have sane defaults. Treating them as
  // outstanding would leave an AWS-hosted site permanently "incomplete".
  const spec = specFor([BASE, 'd4-cms-core'], manifestOf);
  const env = { S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', RESEND_API_KEY: 'r', CONTACT_TO_EMAIL: 'e' };
  assert.deepStrictEqual(missingFrom(spec, env), [], 'a fully configured S3 site owes nothing');
});

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll module coverage checks passed.');
