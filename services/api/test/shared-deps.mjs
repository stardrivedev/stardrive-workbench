/**
 * What the engine supplies to a template that a module needs and it lacks.
 *
 * The bug this closes: 13 of the 14 module-backed Studio features import a
 * shared component library (`@/components/ui/PageHeader`, `@/components/seo/
 * JsonLd`, `@/lib/seo`) that only d4-site-template ships, so layering any of
 * them onto a generated template failed at `next build`. Proven by the first
 * real Studio generation ever run: the template alone passed 7/7 QA, and the
 * same template with gallery + testimonials failed to compile.
 *
 * The half of this worth testing hard is the part that could silently do the
 * WRONG thing: overwriting a design the customer generated with the reference
 * one. Backfill must only ever ADD.
 *
 * The last two checks run against the real vendor/d4 tree, so a module added
 * later that imports something new is caught here rather than by a customer.
 *
 * Run: node services/api/test/shared-deps.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { aliasSpecifiers, aliasToStem, resolveAlias, planBackfill } from '../lib/shared-deps.mjs';
import { resolveModules } from '../lib/modules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(HERE, '..', '..', '..', 'vendor', 'd4');
const REFERENCE = path.join(ENGINE, 'd4-site-template', 'files');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); }
  catch (e) { failures++; console.error(`  FAIL  ${name}\n        ${e.message}`); }
};

/** A reference template made of plain strings, for the unit checks. */
const refOf = (files) => ({
  has: (rel) => Object.prototype.hasOwnProperty.call(files, rel),
  read: (rel) => files[rel],
});

console.log('shared dependency backfill:');

check('finds the specifiers a module imports', () => {
  const src = 'import PageHeader from "@/components/ui/PageHeader";\n'
    + "import { absoluteUrl } from '@/lib/seo';\n"
    + 'const lazy = await import("@/components/seo/JsonLd");\n'
    + 'import Local from "./Local";\nimport React from "react";';
  const found = [...aliasSpecifiers(src)].sort();
  assert.deepStrictEqual(found, ['@/components/seo/JsonLd', '@/components/ui/PageHeader', '@/lib/seo']);
});

check('maps the alias the way both tsconfigs do', () => {
  assert.strictEqual(aliasToStem('@/components/ui/PageHeader'), 'src/components/ui/PageHeader');
  assert.strictEqual(aliasToStem('@/lib/seo'), 'src/lib/seo');
});

check('resolves through the extensions a bundler would try', () => {
  const has = (p) => ['src/lib/seo.ts', 'src/components/ui/PageHeader.tsx', 'src/x/index.ts'].includes(p);
  assert.strictEqual(resolveAlias('@/lib/seo', has), 'src/lib/seo.ts');
  assert.strictEqual(resolveAlias('@/components/ui/PageHeader', has), 'src/components/ui/PageHeader.tsx');
  assert.strictEqual(resolveAlias('@/x', has), 'src/x/index.ts');
  assert.strictEqual(resolveAlias('@/nope', has), null);
});

check('supplies only what the template lacks', () => {
  const add = planBackfill({
    moduleSources: ['import PageHeader from "@/components/ui/PageHeader"; import { absoluteUrl } from "@/lib/seo";'],
    templateHas: (p) => p === 'src/lib/seo.ts',
    reference: refOf({
      'src/components/ui/PageHeader.tsx': 'REFERENCE HEADER',
      'src/lib/seo.ts': 'REFERENCE SEO',
    }),
  });
  assert.deepStrictEqual(add.map((f) => f.path), ['src/components/ui/PageHeader.tsx']);
});

check("NEVER overwrites the customer's own version", () => {
  // The whole design is theirs. A template that ships its own PageHeader must
  // keep it, even though the reference has one by the same name.
  const add = planBackfill({
    moduleSources: ['import PageHeader from "@/components/ui/PageHeader";'],
    templateHas: (p) => p === 'src/components/ui/PageHeader.tsx',
    reference: refOf({ 'src/components/ui/PageHeader.tsx': 'REFERENCE HEADER' }),
  });
  assert.deepStrictEqual(add, [], 'nothing may be written over a generated design');
});

check('follows what a backfilled file itself imports', () => {
  const add = planBackfill({
    moduleSources: ['import { absoluteUrl } from "@/lib/seo";'],
    templateHas: () => false,
    reference: refOf({
      'src/lib/seo.ts': 'import { helper } from "@/lib/urls";',
      'src/lib/urls.ts': 'import { deep } from "@/lib/deep";',
      'src/lib/deep.ts': 'export const deep = 1;',
    }),
  });
  assert.deepStrictEqual(add.map((f) => f.path).sort(), ['src/lib/deep.ts', 'src/lib/seo.ts', 'src/lib/urls.ts'],
    'a supplied file with imports of its own would not compile alone');
});

check('stops at the template even when the chain continues', () => {
  // seo.ts needs @/config/site, which every generated template writes itself.
  // Taking the reference copy would overwrite the customer's site identity.
  const add = planBackfill({
    moduleSources: ['import { absoluteUrl } from "@/lib/seo";'],
    templateHas: (p) => p === 'src/config/site.ts',
    reference: refOf({
      'src/lib/seo.ts': 'import { siteConfig } from "@/config/site";',
      'src/config/site.ts': 'REFERENCE IDENTITY',
    }),
  });
  assert.deepStrictEqual(add.map((f) => f.path), ['src/lib/seo.ts']);
});

check('says nothing about an import nobody can supply', () => {
  // A module importing something neither side has is that module's bug. Let
  // the compiler report it: a guess here would be a worse message.
  const add = planBackfill({
    moduleSources: ['import x from "@/does/not/exist";'],
    templateHas: () => false,
    reference: refOf({}),
  });
  assert.deepStrictEqual(add, []);
});

check('a cycle between two supplied files terminates', () => {
  const add = planBackfill({
    moduleSources: ['import a from "@/lib/a";'],
    templateHas: () => false,
    reference: refOf({
      'src/lib/a.ts': 'import b from "@/lib/b";',
      'src/lib/b.ts': 'import a from "@/lib/a";',
    }),
  });
  assert.deepStrictEqual(add.map((f) => f.path).sort(), ['src/lib/a.ts', 'src/lib/b.ts']);
});

// ── Against the real engine ────────────────────────────────────────────────

const walk = (dir) => {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
};

const moduleNames = fs.existsSync(ENGINE)
  ? fs.readdirSync(ENGINE).filter((n) =>
    n !== 'd4-site-builder' && n !== 'd4-site-template'
      && fs.existsSync(path.join(ENGINE, n, 'manifest.json')))
  : [];

const readManifest = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(ENGINE, name, 'manifest.json'), 'utf-8')); }
  catch { return null; }
};

const sourcesOf = (names) => {
  const out = [];
  for (const name of names) {
    for (const abs of walk(path.join(ENGINE, name, 'files'))) {
      if (!/\.(tsx?|jsx?|mjs)$/.test(abs)) continue;
      out.push(fs.readFileSync(abs, 'utf-8'));
    }
  }
  return out;
};

/** The relative paths a set of modules brings into the assembled tree. A
 *  module's own files satisfy its own imports: `@/lib/cms/auth` belongs to
 *  d4-cms-core, and no template ever has to supply it. */
const providedBy = (names) => {
  const out = new Set();
  for (const name of names) {
    const dir = path.join(ENGINE, name, 'files');
    for (const abs of walk(dir)) out.add(path.relative(dir, abs).replace(/\\/g, '/'));
  }
  return out;
};

const realReference = {
  // isFile, not exists: `@/components/ui` names a real directory here.
  has: (rel) => { try { return fs.statSync(path.join(REFERENCE, rel)).isFile(); } catch { return false; } },
  read: (rel) => fs.readFileSync(path.join(REFERENCE, rel), 'utf-8'),
};

check('EVERY real module can be satisfied from the reference template', () => {
  assert.ok(moduleNames.length >= 10, `expected the engine's modules, found ${moduleNames.length}`);
  const unsatisfied = [];
  for (const name of moduleNames) {
    const resolvedNames = resolveModules([name], readManifest);
    const sources = sourcesOf(resolvedNames);
    const fromModules = providedBy(resolvedNames);

    // The worst case a customer can present: a template that provides nothing
    // beyond its own per-client config. If the engine can satisfy a module
    // here, it can satisfy it anywhere.
    const supplied = new Set(planBackfill({
      moduleSources: sources,
      templateHas: (rel) => fromModules.has(rel),
      reference: realReference,
    }).map((f) => f.path));

    const specs = new Set();
    for (const src of sources) for (const s of aliasSpecifiers(src)) specs.add(s);

    for (const spec of specs) {
      // Per-client config is written by the assembler into every site, and
      // every generated template ships its own; never backfilled.
      if (spec.startsWith('@/config/')) continue;
      const answered = (p) => supplied.has(p) || fromModules.has(p);
      if (!resolveAlias(spec, answered)) unsatisfied.push(`${name} -> ${spec}`);
    }
  }
  assert.deepStrictEqual(unsatisfied, [],
    'a module imports something neither it nor d4-site-template provides, so no generated template can build it');
});

check('the exact failure that started this is covered', () => {
  // gallery + testimonials on a template with none of the shared library: the
  // real build failed on precisely these three.
  const supplied = planBackfill({
    moduleSources: sourcesOf(resolveModules(['d4-gallery-editor', 'd4-testimonials'], readManifest)),
    templateHas: () => false,
    reference: realReference,
  }).map((f) => f.path);
  for (const needed of ['src/components/ui/PageHeader.tsx', 'src/components/seo/JsonLd.tsx', 'src/lib/seo.ts']) {
    assert.ok(supplied.includes(needed), `${needed} is what "Module not found" was about; got ${supplied.join(', ')}`);
  }
});

if (failures) { console.error(`\n${failures} check(s) FAILED.`); process.exit(1); }
console.log('\nAll shared dependency checks passed.');
