/**
 * Stardrive template-kit: everything needed to accept a template from
 * outside the trusted engine repos — manifest validation, the portable
 * "template bundle" JSON format, and the token-contract linter.
 *
 * Pure ESM, zero dependencies, no Node APIs (fs helpers live in node.mjs).
 * Developed in the Deneb4 repo, extracted to stardrive-workbench — one
 * direction only, same rule as packages/field-mapping.
 *
 * A template bundle is JSON:
 *   {
 *     "manifest": { …manifest.json contents… },
 *     "files": [ { "path": "src/app/page.tsx", "content": "…utf8…" }
 *              | { "path": "public/logo.png", "contentBase64": "…" } ]
 *   }
 * Paths are relative to the template's files/ payload root (the assembler
 * copies them onto the site root per the manifest's copy steps).
 */

// ── Manifest validation ──────────────────────────────────────────────────
// Implements schema/manifest.schema.json from d4-site-builder with ONE
// deliberate product relaxation: third-party template names may be any
// lowercase slug — the `d4-` prefix rule applies to the first-party
// catalog, not to licensees. Every problem is reported, not just the first.

const KINDS = ['site', 'core', 'feature'];
const TOP_KEYS = new Set([
  '$schema', 'name', 'version', 'kind', 'description', 'clientFacingSummary',
  'keywords', 'requires', 'optionalIntegrations', 'provides', 'env',
  'npmDependencies', 'npmDevDependencies', 'copy', 'postAssemble',
]);
const PROVIDES_KEYS = new Set(['routes', 'nav', 'adminPanels', 'collections', 'lib']);

const isStr = (v) => typeof v === 'string';
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);
const isStrMap = (v) =>
  v != null && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isStr);

export function validateManifest(manifest) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['Manifest must be a JSON object.'] };
  }

  for (const k of Object.keys(manifest)) {
    if (!TOP_KEYS.has(k)) err(`Unknown top-level key "${k}".`);
  }
  for (const k of ['name', 'version', 'kind', 'description', 'provides', 'copy']) {
    if (!(k in manifest)) err(`Missing required key "${k}".`);
  }

  if ('name' in manifest && !/^[a-z0-9][a-z0-9-]*$/.test(String(manifest.name))) {
    err('name must be a lowercase slug (a-z, 0-9, hyphens). First-party d4 modules additionally use the d4- prefix.');
  }
  if ('version' in manifest && !/^\d+\.\d+\.\d+$/.test(String(manifest.version))) {
    err('version must be semver (MAJOR.MINOR.PATCH).');
  }
  if ('kind' in manifest && !KINDS.includes(manifest.kind)) {
    err(`kind must be one of ${KINDS.join(', ')}.`);
  }
  if ('description' in manifest && !isStr(manifest.description)) err('description must be a string.');
  if ('clientFacingSummary' in manifest && !isStr(manifest.clientFacingSummary)) {
    err('clientFacingSummary must be a string.');
  }
  if ('keywords' in manifest && !isStrArray(manifest.keywords)) err('keywords must be an array of strings.');
  if ('requires' in manifest && !isStrMap(manifest.requires)) {
    err('requires must map module names to semver ranges (strings).');
  }
  if ('optionalIntegrations' in manifest && !isStrArray(manifest.optionalIntegrations)) {
    err('optionalIntegrations must be an array of strings.');
  }
  if ('npmDependencies' in manifest && !isStrMap(manifest.npmDependencies)) {
    err('npmDependencies must map package names to version ranges.');
  }
  if ('npmDevDependencies' in manifest && !isStrMap(manifest.npmDevDependencies)) {
    err('npmDevDependencies must map package names to version ranges.');
  }

  const p = manifest.provides;
  if (p != null) {
    if (typeof p !== 'object' || Array.isArray(p)) err('provides must be an object.');
    else {
      for (const k of Object.keys(p)) if (!PROVIDES_KEYS.has(k)) err(`provides: unknown key "${k}".`);
      for (const k of ['routes', 'nav', 'adminPanels', 'collections']) {
        if (!(k in p)) err(`provides: missing required key "${k}".`);
      }
      if ('routes' in p && !isStrArray(p.routes)) err('provides.routes must be an array of strings.');
      if ('collections' in p && !isStrArray(p.collections)) err('provides.collections must be an array of strings.');
      if ('lib' in p && !isStrArray(p.lib)) err('provides.lib must be an array of strings.');
      if ('nav' in p) {
        if (!Array.isArray(p.nav)) err('provides.nav must be an array.');
        else p.nav.forEach((item, i) => {
          if (item == null || typeof item !== 'object' || !isStr(item.label) || !isStr(item.href)) {
            err(`provides.nav[${i}] must be { label, href } strings.`);
          } else if (Object.keys(item).some((k) => k !== 'label' && k !== 'href')) {
            err(`provides.nav[${i}] has unknown keys.`);
          }
        });
      }
      if ('adminPanels' in p) {
        if (!Array.isArray(p.adminPanels)) err('provides.adminPanels must be an array.');
        else p.adminPanels.forEach((item, i) => {
          if (item == null || typeof item !== 'object' || !isStr(item.id) || !isStr(item.label) || !isStr(item.importPath)) {
            err(`provides.adminPanels[${i}] must be { id, label, importPath } strings.`);
          } else if (Object.keys(item).some((k) => !['id', 'label', 'importPath'].includes(k))) {
            err(`provides.adminPanels[${i}] has unknown keys.`);
          }
        });
      }
    }
  }

  if ('env' in manifest) {
    if (!Array.isArray(manifest.env)) err('env must be an array.');
    else manifest.env.forEach((item, i) => {
      if (item == null || typeof item !== 'object' || !isStr(item.name) || typeof item.required !== 'boolean' || !isStr(item.description)) {
        err(`env[${i}] must be { name: string, required: boolean, description: string }.`);
      } else if (Object.keys(item).some((k) => !['name', 'required', 'description'].includes(k))) {
        err(`env[${i}] has unknown keys.`);
      }
    });
  }

  if ('copy' in manifest) {
    if (!Array.isArray(manifest.copy) || manifest.copy.length < 1) err('copy must be a non-empty array.');
    else manifest.copy.forEach((item, i) => {
      if (item == null || typeof item !== 'object' || !isStr(item.from) || !isStr(item.to)) {
        err(`copy[${i}] must be { from, to } strings.`);
      } else if (Object.keys(item).some((k) => k !== 'from' && k !== 'to')) {
        err(`copy[${i}] has unknown keys.`);
      }
    });
  }

  if ('postAssemble' in manifest) {
    const pa = manifest.postAssemble;
    if (pa == null || typeof pa !== 'object' || Array.isArray(pa)) err('postAssemble must be an object.');
    else {
      for (const k of Object.keys(pa)) {
        if (!['generatedFiles', 'notes'].includes(k)) err(`postAssemble: unknown key "${k}".`);
      }
      if ('generatedFiles' in pa && !isStrArray(pa.generatedFiles)) {
        err('postAssemble.generatedFiles must be an array of strings.');
      }
      if ('notes' in pa && !isStr(pa.notes)) err('postAssemble.notes must be a string.');
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── The bundle contract ──────────────────────────────────────────────────

/** Files the assembler rewrites or replaces per client — a kind:"site"
 *  template must ship a WORKING DEFAULT of every one of these so it also
 *  runs standalone. */
export const REQUIRED_SITE_FILES = [
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/theme.css',
  'src/config/site.ts',
  'src/config/fonts.generated.ts',
  'src/config/design.generated.ts',
  'src/config/nav.generated.ts',
  'src/config/admin-panels.generated.tsx',
];

const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 25_000_000;
const FORBIDDEN_PATH_RE = /(^|\/)(node_modules|\.git|\.next)(\/|$)|(^|\/)\.env/;
const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|svg|txt|html|yml|yaml)$/i;

export function isSafeBundlePath(p) {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length <= 300 &&
    !p.startsWith('/') &&
    !/^[a-zA-Z]:/.test(p) &&
    !p.includes('\\') &&
    !p.split('/').some((seg) => seg === '..' || seg === '') &&
    !FORBIDDEN_PATH_RE.test(p)
  );
}

export function decodeFileContent(file) {
  if (typeof file.content === 'string') return file.content;
  if (typeof file.contentBase64 === 'string') {
    // atob-compatible decode without Buffer so this stays browser-safe.
    if (typeof Buffer !== 'undefined') return Buffer.from(file.contentBase64, 'base64').toString('utf-8');
    return decodeURIComponent(escape(atob(file.contentBase64)));
  }
  return '';
}

function byteLength(file) {
  if (typeof file.content === 'string') return file.content.length;
  if (typeof file.contentBase64 === 'string') return Math.floor(file.contentBase64.length * 0.75);
  return 0;
}

// ── The token-contract linter ────────────────────────────────────────────
// The two visual contracts the QA battery WILL enforce later, caught at
// import time instead:
//   error   — alpha-diluted text tokens (text-muted/80, rgb(var(--text-…)/…)):
//             guaranteed WCAG contrast failures against the validated palettes.
//   warning — hardcoded color literals outside theme.css: legal, but they
//             won't retheme per client; flagged for a human decision.

const DILUTED_TW_RE = /\btext-(muted|body|heading)\/\d+/;
const DILUTED_CSS_RE = /var\(\s*--text-[a-z-]+\s*\)\s*\/\s*[\d.]/;
const HARDCODED_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*(?!var\()|\bhsla?\(\s*(?!var\()/;

export function lintTemplateFiles(files) {
  const errors = [];
  const warnings = [];
  for (const file of files) {
    if (!TEXT_EXT_RE.test(file.path)) continue;
    const isThemeCss = /(^|\/)theme\.css$/.test(file.path);
    const text = decodeFileContent(file);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const where = `${file.path}:${i + 1}`;
      if (DILUTED_TW_RE.test(line) || DILUTED_CSS_RE.test(line)) {
        errors.push(`${where}: text token used at reduced opacity — this breaks the 4.5:1 contrast floor the QA battery enforces. Use --text-muted at full strength instead.`);
      }
      if (!isThemeCss && HARDCODED_RE.test(line) && !/^\s*(\/\/|\/\*|\*)/.test(line)) {
        warnings.push(`${where}: hardcoded color literal — it will not retheme per client. Use the theme tokens (rgb(var(--token) / <alpha>)) unless this is deliberate (e.g. a brand-exact logo).`);
      }
    });
  }
  return { errors, warnings };
}

// ── Bundle validation (the import gate) ──────────────────────────────────

export function validateBundle(bundle) {
  const errors = [];
  const warnings = [];

  if (bundle == null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { ok: false, errors: ['Bundle must be a JSON object { manifest, files }.'], warnings };
  }
  const mv = validateManifest(bundle.manifest);
  errors.push(...mv.errors.map((e) => `manifest: ${e}`));

  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    errors.push('files must be a non-empty array of { path, content | contentBase64 }.');
    return { ok: false, errors, warnings };
  }

  const seen = new Set();
  let total = 0;
  for (const [i, file] of bundle.files.entries()) {
    if (file == null || typeof file !== 'object' || !isSafeBundlePath(file.path)) {
      errors.push(`files[${i}]: unsafe or missing path ${JSON.stringify(file?.path)} — relative forward-slash paths only, no "..", no node_modules/.git/.env.`);
      continue;
    }
    if (seen.has(file.path)) errors.push(`files[${i}]: duplicate path "${file.path}".`);
    seen.add(file.path);
    const hasText = typeof file.content === 'string';
    const hasB64 = typeof file.contentBase64 === 'string';
    if (hasText === hasB64) {
      errors.push(`files[${i}] (${file.path}): exactly one of content or contentBase64 is required.`);
    }
    const bytes = byteLength(file);
    total += bytes;
    if (bytes > MAX_FILE_BYTES) errors.push(`files[${i}] (${file.path}): exceeds the ${MAX_FILE_BYTES / 1_000_000} MB per-file cap.`);
  }
  if (total > MAX_TOTAL_BYTES) errors.push(`Bundle exceeds the ${MAX_TOTAL_BYTES / 1_000_000} MB total cap.`);

  if (bundle.manifest?.kind === 'site') {
    for (const required of REQUIRED_SITE_FILES) {
      if (!seen.has(required)) {
        errors.push(`kind:"site" template is missing required file ${required} — the assembler rewrites it per client, and the template must run standalone with its default.`);
      }
    }
    const theme = bundle.files.find((f) => f.path === 'src/app/theme.css');
    if (theme && !decodeFileContent(theme).includes('.dark')) {
      warnings.push('src/app/theme.css has no .dark block — the site will be light-only until a validated dark palette ships (allowed, but deliberate).');
    }
  }

  const lint = lintTemplateFiles(bundle.files.filter((f) => seen.has(f.path)));
  errors.push(...lint.errors);
  warnings.push(...lint.warnings);

  return { ok: errors.length === 0, errors, warnings };
}
