#!/usr/bin/env node
/** Template-kit unit tests — generic, self-contained. Run: node test/run.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import {
  validateManifest,
  validateBundle,
  lintTemplateFiles,
  isSafeBundlePath,
  REQUIRED_SITE_FILES,
} from '../index.mjs';
import { bundleFromDir, writeBundleToDir } from '../node.mjs';

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL  ${name}`);
    console.error(String(err.message).split('\n').map((l) => `        ${l}`).join('\n'));
  }
};

const GOOD_MANIFEST = {
  name: 'aurora-template',
  version: '1.0.0',
  kind: 'site',
  description: 'A test template.',
  provides: { routes: ['/', '/about', '/contact'], nav: [{ label: 'About', href: '/about' }], adminPanels: [], collections: [] },
  copy: [{ from: 'files', to: '.' }],
};

const goodSiteFiles = () => [
  ...REQUIRED_SITE_FILES.map((p) => ({
    path: p,
    content: p.endsWith('theme.css')
      ? ':root { --accent: 67 56 202; }\n.dark { --accent: 159 153 255; }\n'
      : `// default ${p}\nexport {};\n`,
  })),
  { path: 'src/app/about/page.tsx', content: 'export default function About(){ return <main className="text-body"/>; }\n' },
  { path: 'public/hero.png', contentBase64: Buffer.from('png-bytes').toString('base64') },
];

console.log('manifest:');
check('a valid manifest passes; licensee names need no d4- prefix', () => {
  assert.deepStrictEqual(validateManifest(GOOD_MANIFEST).errors, []);
});
check('every problem reported', () => {
  const v = validateManifest({ name: 'Bad Name', version: 'v1', kind: 'zap', surprise: true });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.errors.length >= 6, true);
});

console.log('paths:');
check('traversal, absolute, backslash, node_modules, .env all rejected', () => {
  for (const bad of ['../x', '/etc/passwd', 'C:/x', 'a\\b', 'node_modules/x.js', 'src/.env.local', '.git/config', 'a//b']) {
    assert.strictEqual(isSafeBundlePath(bad), false, bad);
  }
  assert.strictEqual(isSafeBundlePath('src/app/page.tsx'), true);
});

console.log('lint:');
check('alpha-diluted text tokens are ERRORS (both Tailwind and CSS forms)', () => {
  const { errors } = lintTemplateFiles([
    { path: 'src/x.tsx', content: '<p className="text-muted/80">hi</p>' },
    { path: 'src/y.css', content: 'color: rgb(var(--text-muted) / 0.8);' },
  ]);
  assert.strictEqual(errors.length, 2);
});
check('hardcoded colors warn; token consumption does not; theme.css exempt', () => {
  const { errors, warnings } = lintTemplateFiles([
    { path: 'src/a.tsx', content: 'const c = "#ff0000";' },
    { path: 'src/b.css', content: 'background: rgb(var(--accent) / 0.4);' },
    { path: 'src/app/theme.css', content: ':root { --accent: 67 56 202; }' },
  ]);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].startsWith('src/a.tsx:1'), true);
});

console.log('bundle:');
check('a complete site bundle validates (with no warnings)', () => {
  const v = validateBundle({ manifest: GOOD_MANIFEST, files: goodSiteFiles() });
  assert.deepStrictEqual(v.errors, []);
  assert.deepStrictEqual(v.warnings, []);
});
check('missing required site files are named individually', () => {
  const files = goodSiteFiles().filter((f) => f.path !== 'src/config/site.ts');
  const v = validateBundle({ manifest: GOOD_MANIFEST, files });
  assert.strictEqual(v.errors.some((e) => e.includes('src/config/site.ts')), true);
});
check('theme.css without a .dark block is a warning, not an error', () => {
  const files = goodSiteFiles().map((f) =>
    f.path === 'src/app/theme.css' ? { path: f.path, content: ':root { --accent: 1 2 3; }' } : f
  );
  const v = validateBundle({ manifest: GOOD_MANIFEST, files });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.warnings.some((w) => w.includes('.dark')), true);
});
check('duplicate paths, double content, unsafe paths all reported', () => {
  const v = validateBundle({
    manifest: GOOD_MANIFEST,
    files: [
      { path: 'a.ts', content: 'x', contentBase64: 'eA==' },
      { path: 'b.ts', content: 'x' },
      { path: 'b.ts', content: 'y' },
      { path: '../evil.ts', content: 'z' },
    ],
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.errors.some((e) => e.includes('exactly one of')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('duplicate path')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('unsafe or missing path')), true);
});
check('feature-module bundles skip the site-file requirement', () => {
  const v = validateBundle({
    manifest: { ...GOOD_MANIFEST, name: 'menu-module', kind: 'feature' },
    files: [{ path: 'src/modules/menu/page.tsx', content: 'export default () => null;' }],
  });
  assert.strictEqual(v.ok, true);
});

console.log('node helpers:');
check('bundleFromDir ↔ writeBundleToDir roundtrip preserves text and binary', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'template-kit-'));
  try {
    writeBundleToDir({ manifest: GOOD_MANIFEST, files: goodSiteFiles() }, path.join(tmp, 'aurora'));
    const back = bundleFromDir(path.join(tmp, 'aurora'));
    assert.strictEqual(back.manifest.name, 'aurora-template');
    assert.strictEqual(back.files.length, goodSiteFiles().length);
    const png = back.files.find((f) => f.path === 'public/hero.png');
    assert.strictEqual(Buffer.from(png.contentBase64, 'base64').toString(), 'png-bytes');
    assert.deepStrictEqual(validateBundle(back).errors, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
check('writeBundleToDir refuses unsafe paths outright', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'template-kit-'));
  try {
    assert.throws(() =>
      writeBundleToDir({ manifest: GOOD_MANIFEST, files: [{ path: '../evil.ts', content: 'x' }] }, path.join(tmp, 'z'))
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check('assetSlots: valid extra compartments pass; every bad shape is named', () => {
  const good = {
    ...GOOD_MANIFEST,
    assetSlots: [
      { id: 'menu-pages', label: 'Menu pages', description: 'One image per menu page.', accept: ['jpg', 'jpeg', 'png'], max: 8 },
      { id: 'press-logos', label: 'Press logos', accept: ['svg', 'png'] },
    ],
  };
  assert.deepStrictEqual(validateManifest(good).errors, []);

  const bad = {
    ...GOOD_MANIFEST,
    assetSlots: [
      { id: 'logo', label: 'Logo' },                      // reserved standard id
      { id: 'Menu Pages', label: 'Menu' },                // not a slug
      { id: 'ok-slot', label: '' },                       // empty label
      { id: 'ok-slot2', label: 'X', accept: ['exe'] },    // bad ext
      { id: 'ok-slot3', label: 'X', max: 0 },             // bad max
      { id: 'ok-slot4', label: 'X', mystery: true },      // unknown key
      { id: 'press-logos', label: 'A' },
      { id: 'press-logos', label: 'B' },                  // duplicate
    ],
  };
  const v = validateManifest(bad);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.errors.some((e) => e.includes('standard compartment')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('lowercase slug')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('label is required')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('subset of')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('integer 1–50')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('unknown key "mystery"')), true);
  assert.strictEqual(v.errors.some((e) => e.includes('declared twice')), true);
});

if (failures) {
  console.error(`\n${failures} test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll template-kit tests passed.');
