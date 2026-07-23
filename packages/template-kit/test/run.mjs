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
  autofixTemplateFiles,
  autofixManifest,
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

console.log('manifest autofix:');
check('autofixManifest normalizes a malformed generated manifest to pass validation', () => {
  const broken = {
    name: 'Signal Forge', version: 'v1', kind: 'website', description: 42,
    surprise: true, // unknown top-level key
    provides: {
      routes: ['/', '/about', 5], // non-string filtered
      nav: [{ label: 'About', href: '/about' }, { label: 'NoHref' }], // second dropped
      adminPanels: [{ id: 'x', label: 'X', importPath: './x' }, { id: 'bad' }, 'nope'], // last two dropped
      collections: [], mystery: 1, // unknown provides key dropped
    },
    copy: [{ from: 'files', to: '.', extra: 1 }], // bad shape -> reset
    keywords: 'not-an-array', // dropped
    env: [{ name: 'A', required: true, description: 'ok' }, { name: 'B' }], // second dropped
  };
  const { manifest, fixes } = autofixManifest(broken);
  assert.ok(fixes.length > 0);
  // The normalized manifest must now pass the real validator.
  assert.deepStrictEqual(validateManifest(manifest).errors, [], 'normalized manifest is valid');
  assert.strictEqual(manifest.name, 'signal-forge');
  assert.strictEqual(manifest.version, '1.0.0');
  assert.strictEqual(manifest.kind, 'site');
  assert.strictEqual(manifest.provides.adminPanels.length, 1);
  assert.strictEqual(manifest.provides.nav.length, 1);
  assert.strictEqual('surprise' in manifest, false);
  assert.strictEqual('mystery' in manifest.provides, false);
  assert.deepStrictEqual(manifest.copy, [{ from: 'files', to: '.' }]);
  assert.strictEqual('keywords' in manifest, false);
  assert.strictEqual(manifest.env.length, 1);
});
check('autofixManifest leaves a valid manifest unchanged (no needless fixes)', () => {
  const good = { name: 'ok-template', version: '1.0.0', kind: 'site', description: 'x',
    provides: { routes: ['/'], nav: [], adminPanels: [], collections: [] }, copy: [{ from: 'files', to: '.' }] };
  const { manifest, fixes } = autofixManifest(good);
  assert.deepStrictEqual(fixes, []);
  assert.deepStrictEqual(validateManifest(manifest).errors, []);
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
check('autofix repairs diluted TEXT tokens to full strength; a fixed bundle lints clean', () => {
  const files = [
    { path: 'src/x.tsx', content: '<p className="text-muted/80">a</p><span className="text-body/70">b</span>' },
    { path: 'src/app/globals.css', content: '.a{color:rgb(var(--text-muted) / 0.7)} .b{color:hsl(var(--text-heading)/.5)}' },
    { path: 'src/keep.css', content: 'background: rgb(var(--accent) / 0.1);' }, // decorative accent alpha: untouched
    { path: 'public/logo.png', contentBase64: Buffer.from('x').toString('base64') },
  ];
  const { files: fixed, fixes } = autofixTemplateFiles(files);
  assert.strictEqual(fixes.length, 2, 'two text files were repaired');
  const byPath = Object.fromEntries(fixed.map((f) => [f.path, f]));
  assert.strictEqual(byPath['src/x.tsx'].content.includes('text-muted/80'), false);
  assert.strictEqual(byPath['src/x.tsx'].content.includes('text-body/70'), false);
  assert.strictEqual(byPath['src/x.tsx'].content.includes('text-muted'), true);
  assert.strictEqual(byPath['src/app/globals.css'].content.includes('rgb(var(--text-muted))'), true);
  assert.strictEqual(byPath['src/keep.css'].content, 'background: rgb(var(--accent) / 0.1);', 'accent alpha untouched');
  // The repaired files no longer trip the linter.
  assert.deepStrictEqual(lintTemplateFiles(fixed).errors, []);
});
check('autofix adds "use client" to a server file that uses event handlers (skips async/server-only)', () => {
  const serverWithHandler = 'import Link from "next/link";\nexport default function Home(){ return <button onClick={() => {}} className="hidden" />; }\n';
  const asyncServer = 'export default async function Page(){ const d = await fetch("x"); return <button onClick={() => {}} />; }\n';
  const cssWithText = '.b{ content: "onClick={" }';
  const { files: fixed, fixes } = autofixTemplateFiles([
    { path: 'src/app/page.tsx', content: serverWithHandler },
    { path: 'src/app/data/page.tsx', content: asyncServer },
    { path: 'src/x.css', content: cssWithText },
  ]);
  const byPath = Object.fromEntries(fixed.map((f) => [f.path, f]));
  assert.strictEqual(byPath['src/app/page.tsx'].content.startsWith('"use client";\n'), true, 'sync server file gets the directive');
  assert.strictEqual(byPath['src/app/data/page.tsx'].content, asyncServer, 'async server component is left for Refine');
  assert.strictEqual(byPath['src/x.css'].content, cssWithText, 'non-JS files never get "use client"');
  assert.strictEqual(fixes.some((f) => /added "use client"/.test(f)), true);
});
check('autofix de-exports metadata from a "use client" component; server metadata is left alone', () => {
  const clientPage = '"use client";\nimport { useState } from "react";\nexport const metadata = { title: "X" };\nexport async function generateMetadata(){ return {}; }\nexport default function P(){ const [s] = useState(0); return null; }\n';
  const serverPage = 'import type { Metadata } from "next";\nexport const metadata: Metadata = { title: "Home" };\nexport default function H(){ return null; }\n';
  const { files: fixed, fixes } = autofixTemplateFiles([
    { path: 'src/app/studio/page.tsx', content: clientPage },
    { path: 'src/app/page.tsx', content: serverPage },
  ]);
  const byPath = Object.fromEntries(fixed.map((f) => [f.path, f]));
  // client file: both server-only exports de-exported
  assert.strictEqual(/export\s+const\s+metadata/.test(byPath['src/app/studio/page.tsx'].content), false);
  assert.strictEqual(/export\s+(async\s+)?function\s+generateMetadata/.test(byPath['src/app/studio/page.tsx'].content), false);
  assert.strictEqual(byPath['src/app/studio/page.tsx'].content.includes('const metadata'), true);
  // server file: untouched (valid metadata export stays)
  assert.strictEqual(byPath['src/app/page.tsx'].content, serverPage);
  assert.strictEqual(fixes.some((f) => /server-only metadata/.test(f)), true);
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
