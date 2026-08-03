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
  'npmDependencies', 'npmDevDependencies', 'copy', 'postAssemble', 'assetSlots',
]);
const PROVIDES_KEYS = new Set(['routes', 'nav', 'adminPanels', 'collections', 'lib']);

// Asset compartments. Every kind:"site" template gets the STANDARD slots for
// free (defined by the engine); a template may declare EXTRA slots via the
// optional manifest `assetSlots` — but never redefine a standard id.
export const RESERVED_ASSET_SLOT_IDS = ['logo', 'favicon', 'hero', 'about', 'gallery', 'team', 'misc'];
/** True for any id the engine owns: a standard compartment, or the whole
 *  `hero-` prefix (per-page hero backgrounds like hero-about the engine adds
 *  from the site's selected pages). Templates declare only OTHER extra slots. */
export const isReservedSlotId = (id) =>
  RESERVED_ASSET_SLOT_IDS.includes(id) || (typeof id === 'string' && id.startsWith('hero-'));
export const ASSET_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico'];
const ASSET_SLOT_KEYS = ['id', 'label', 'description', 'accept', 'max'];

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

  if ('assetSlots' in manifest) {
    if (!Array.isArray(manifest.assetSlots)) err('assetSlots must be an array.');
    else {
      const seen = new Set();
      manifest.assetSlots.forEach((s, i) => {
        if (s == null || typeof s !== 'object' || Array.isArray(s)) {
          err(`assetSlots[${i}] must be an object { id, label, description?, accept?, max? }.`);
          return;
        }
        for (const k of Object.keys(s)) {
          if (!ASSET_SLOT_KEYS.includes(k)) err(`assetSlots[${i}]: unknown key "${k}".`);
        }
        if (!isStr(s.id) || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) {
          err(`assetSlots[${i}].id must be a lowercase slug.`);
        } else {
          if (isReservedSlotId(s.id)) {
            err(`assetSlots[${i}].id "${s.id}" is a compartment the engine already provides (standard slots, or any "hero-" per-page hero background) — declare only EXTRA slots.`);
          }
          if (seen.has(s.id)) err(`assetSlots[${i}].id "${s.id}" is declared twice.`);
          seen.add(s.id);
        }
        if (!isStr(s.label) || !s.label.trim()) err(`assetSlots[${i}].label is required (shown to the person uploading).`);
        if ('description' in s && !isStr(s.description)) err(`assetSlots[${i}].description must be a string.`);
        if ('accept' in s) {
          if (!isStrArray(s.accept) || !s.accept.length || !s.accept.every((e) => ASSET_EXTS.includes(e))) {
            err(`assetSlots[${i}].accept must be a non-empty subset of: ${ASSET_EXTS.join(', ')}.`);
          }
        }
        if ('max' in s && (!Number.isInteger(s.max) || s.max < 1 || s.max > 50)) {
          err(`assetSlots[${i}].max must be an integer 1–50.`);
        }
      });
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

// Global-flag variants of the diluted-text patterns, for repair.
const DILUTED_TW_FIX = /\btext-(muted|body|heading)\/\d+/g;
const DILUTED_CSS_FIX = /(var\(\s*--text-[a-z-]+\s*\))\s*\/\s*[\d.]+%?/g;
const USE_CLIENT_RE = /^\s*['"]use client['"]\s*;?/m;
// A JSX event-handler prop (onClick={…}) forces a Client Component.
const EVENT_HANDLER_RE = /\bon(?:Click|Change|Submit|Input|Focus|Blur|MouseEnter|MouseLeave|MouseDown|MouseUp|KeyDown|KeyUp|KeyPress|Scroll|Toggle|Drag|Drop|Wheel|TouchStart|TouchEnd)\s*=\s*\{/;
// Signals a file cannot simply become a Client Component (a different conflict,
// left for the Refine loop rather than risk a wrong auto-fix).
const SERVER_ONLY_RE = /from\s+['"]server-only['"]|export\s+default\s+async\s+function/;
const JS_PATH_RE = /\.(tsx?|jsx?|mjs)$/;

// A line that is only a comment. Comments never reach a visitor, so the dash
// rule does not apply to them: rewriting them would churn first-party engine
// files (nine of them say things like "the baked copy — pages never…") for no
// reader's benefit, and would bury the real repairs in a wall of noise.
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/;

// A dash inside a regex literal is CODE, not copy: `.replace(/–|—/g, "-")` is
// a dash-normalizing helper, and rewriting it to `.replace(/, |, /g, "-")`
// would quietly break the file. seed.mjs has exactly that line, so a generated
// template writing one is not far-fetched. Detecting regex literals properly
// needs a parser, so the rule is conservative: leave the whole line alone. A
// missed dash in a slug helper costs nothing; corrupted code costs a build.
const REGEX_LITERAL_DASH_RE = /\/[^/\n]*[—–][^/\n]*\/[gimsuyd]*/;

/**
 * House style, applied to text a visitor will actually read: no em-dashes, no
 * en-dashes. Line by line, so indentation survives — the copy generator can
 * collapse runs of whitespace because it handles prose, and doing that to
 * source would reformat the file.
 *
 * En-dashes become a hyphen rather than a comma, which is the one deliberate
 * difference from copy-gen.mjs: in a template they are nearly always a range,
 * and "Mon, Fri" for "Mon – Fri" is worse than wrong, it is misleading.
 */
export function stripDisplayDashes(text) {
  let lines = 0;
  const out = String(text).split('\n').map((line) => {
    if (!/[—–]/.test(line)) return line;
    if (COMMENT_LINE_RE.test(line) || REGEX_LITERAL_DASH_RE.test(line)) return line;
    const fixed = line
      .replace(/\s*—\s*/g, ', ')  // em-dash as punctuation
      .replace(/\s*–\s*/g, '-')   // en-dash, almost always a range
      .replace(/,\s*,/g, ',');    // tidy a doubled comma the above can create
    if (fixed !== line) lines += 1;
    return fixed;
  }).join('\n');
  return { text: out, lines };
}

/**
 * Deterministically repair the mechanical, build-breaking mistakes an LLM
 * template generator reliably makes, so a good generation is never bounced for
 * a fix we can safely apply. Each only ever makes the site MORE correct:
 *   1. Text tokens at reduced opacity (text-muted/80, rgb(var(--text-…)/…)) —
 *      set to full strength (exactly what the rulebook prescribes; only raises
 *      contrast). Decorative alpha on ACCENT/BG tokens is untouched.
 *   2. A file using JSX event handlers (onClick=…) that is NOT "use client" —
 *      fails next build ("Event handlers cannot be passed to Client Component
 *      props"). Add the directive (skipped for async/server-only files, a
 *      different conflict).
 *   3. A "use client" component exporting `metadata`/`generateMetadata` —
 *      disallowed by the Next.js App Router (a webpack error TypeScript's
 *      ignoreBuildErrors does NOT catch). De-exported; the now-local
 *      const/function is harmless.
 *   4. Em-dashes and en-dashes in text a visitor will read — house style, and
 *      the one repair here that is about taste rather than compiling. The copy
 *      generator has forbidden them in prompt and scrubbed them in code since
 *      it was written; template generation had neither, so the first real
 *      Studio run shipped "Thanks — your message has reached the workshop."
 * Steps 2→3 are ordered so a file that gains "use client" also drops any
 * server-only metadata. Returns { text, fixes }. `opts.path` gates the
 * JS-only repairs.
 */
export function repairTemplateSource(text, { path = '' } = {}) {
  const fixes = [];
  let out = String(text);
  const isJs = JS_PATH_RE.test(path);

  const dashed = stripDisplayDashes(out);
  if (dashed.lines) {
    out = dashed.text;
    fixes.push(`removed em/en dashes from ${dashed.lines} line${dashed.lines > 1 ? 's' : ''} of visible text (house style)`);
  }

  let dil = 0;
  out = out.replace(DILUTED_TW_FIX, (_m, g) => { dil += 1; return 'text-' + g; })
    .replace(DILUTED_CSS_FIX, (_m, g) => { dil += 1; return g; });
  if (dil) fixes.push(`set ${dil} reduced-opacity text token${dil > 1 ? 's' : ''} to full strength for contrast`);

  if (isJs && !USE_CLIENT_RE.test(out) && EVENT_HANDLER_RE.test(out) && !SERVER_ONLY_RE.test(out)) {
    out = '"use client";\n' + out;
    fixes.push('added "use client" (the file uses event handlers, which require a Client Component)');
  }

  if (USE_CLIENT_RE.test(out)) {
    let m = 0;
    out = out
      .replace(/\bexport\s+const\s+(metadata|generateMetadata)\b/g, (_x, g) => { m += 1; return 'const ' + g; })
      .replace(/\bexport\s+(async\s+)?function\s+generateMetadata\b/g, (_x, a) => { m += 1; return (a || '') + 'function generateMetadata'; });
    if (m) fixes.push(`removed ${m} server-only metadata export${m > 1 ? 's' : ''} from a "use client" component`);
  }
  return { text: out, fixes };
}

/**
 * Normalize a GENERATED manifest into a valid shape, so a good template is
 * never rejected for a mechanical metadata mistake (the manifest is boilerplate
 * the model fills in; the template's real value is its files). Required fields
 * get safe defaults; malformed OPTIONAL fields are dropped; provides sub-lists
 * keep only their valid entries (a Studio template's admin comes from the CMS
 * module, so a stray/malformed adminPanel is safe to drop). Returns
 * { manifest, fixes }. An entirely non-object manifest is returned untouched
 * for the validator to report.
 */
export function autofixManifest(manifest) {
  const fixes = [];
  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) return { manifest, fixes };
  const m = { ...manifest };

  for (const k of Object.keys(m)) {
    if (!TOP_KEYS.has(k)) { delete m[k]; fixes.push(`dropped unknown manifest key "${k}"`); }
  }
  if (!isStr(m.name) || !/^[a-z0-9][a-z0-9-]*$/.test(m.name)) {
    const slug = String(m.name || 'template').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    m.name = slug || 'template'; fixes.push('normalized manifest.name to a valid slug');
  }
  if (!isStr(m.version) || !/^\d+\.\d+\.\d+$/.test(m.version)) { m.version = '1.0.0'; fixes.push('set manifest.version to 1.0.0'); }
  if (!KINDS.includes(m.kind)) { m.kind = 'site'; fixes.push('set manifest.kind to "site"'); }
  if (!isStr(m.description)) { m.description = 'A website template.'; fixes.push('set a default manifest.description'); }
  if (!Array.isArray(m.copy) || !m.copy.length ||
      !m.copy.every((c) => c && isStr(c.from) && isStr(c.to) && Object.keys(c).every((k) => k === 'from' || k === 'to'))) {
    m.copy = [{ from: 'files', to: '.' }]; fixes.push('reset manifest.copy to [{from:"files",to:"."}]');
  }

  // provides — the field the reported error lives in.
  const p = (m.provides && typeof m.provides === 'object' && !Array.isArray(m.provides)) ? { ...m.provides } : {};
  for (const k of Object.keys(p)) if (!PROVIDES_KEYS.has(k)) { delete p[k]; fixes.push(`dropped unknown provides key "${k}"`); }
  p.routes = Array.isArray(p.routes) ? p.routes.filter(isStr) : [];
  p.collections = Array.isArray(p.collections) ? p.collections.filter(isStr) : [];
  if ('lib' in p) p.lib = Array.isArray(p.lib) ? p.lib.filter(isStr) : [];
  const navBefore = Array.isArray(p.nav) ? p.nav.length : -1;
  p.nav = (Array.isArray(p.nav) ? p.nav : []).filter((it) => it && isStr(it.label) && isStr(it.href)).map((it) => ({ label: it.label, href: it.href }));
  if (navBefore >= 0 && navBefore !== p.nav.length) fixes.push(`normalized provides.nav (kept ${p.nav.length} of ${navBefore})`);
  const apBefore = Array.isArray(p.adminPanels) ? p.adminPanels.length : -1;
  p.adminPanels = (Array.isArray(p.adminPanels) ? p.adminPanels : []).filter((it) => it && isStr(it.id) && isStr(it.label) && isStr(it.importPath)).map((it) => ({ id: it.id, label: it.label, importPath: it.importPath }));
  if (apBefore >= 0 && apBefore !== p.adminPanels.length) fixes.push(`normalized provides.adminPanels (kept ${p.adminPanels.length} of ${apBefore})`);
  m.provides = p;

  // Malformed OPTIONAL fields are simply dropped (they are all optional).
  for (const k of ['keywords', 'optionalIntegrations']) if (k in m && !isStrArray(m[k])) { delete m[k]; fixes.push(`dropped malformed manifest.${k}`); }
  for (const k of ['requires', 'npmDependencies', 'npmDevDependencies']) if (k in m && !isStrMap(m[k])) { delete m[k]; fixes.push(`dropped malformed manifest.${k}`); }
  if ('clientFacingSummary' in m && !isStr(m.clientFacingSummary)) { delete m.clientFacingSummary; fixes.push('dropped malformed manifest.clientFacingSummary'); }
  if ('env' in m) {
    if (!Array.isArray(m.env)) { delete m.env; fixes.push('dropped malformed manifest.env'); }
    else {
      const before = m.env.length;
      m.env = m.env.filter((e) => e && isStr(e.name) && typeof e.required === 'boolean' && isStr(e.description) && Object.keys(e).every((k) => ['name', 'required', 'description'].includes(k)));
      if (m.env.length !== before) fixes.push(`normalized manifest.env (kept ${m.env.length} of ${before})`);
    }
  }
  if ('postAssemble' in m && (m.postAssemble == null || typeof m.postAssemble !== 'object' || Array.isArray(m.postAssemble))) {
    delete m.postAssemble; fixes.push('dropped malformed manifest.postAssemble');
  }
  if ('assetSlots' in m) {
    if (!Array.isArray(m.assetSlots)) { delete m.assetSlots; fixes.push('dropped malformed manifest.assetSlots'); }
    else {
      const before = m.assetSlots.length;
      m.assetSlots = m.assetSlots.filter((s) => s && typeof s === 'object' && !Array.isArray(s)
        && isStr(s.id) && /^[a-z0-9][a-z0-9-]*$/.test(s.id) && !isReservedSlotId(s.id)
        && Object.keys(s).every((k) => ASSET_SLOT_KEYS.includes(k)));
      if (m.assetSlots.length !== before) fixes.push(`normalized manifest.assetSlots (kept ${m.assetSlots.length} of ${before})`);
      if (!m.assetSlots.length) delete m.assetSlots;
    }
  }
  return { manifest: m, fixes };
}

/**
 * Apply repairTemplateSource across a bundle's text files. Returns
 * { files, fixes } — callers auto-apply this at import so the stored template
 * is already correct.
 */
export function autofixTemplateFiles(files) {
  const fixes = [];
  const out = (files || []).map((file) => {
    if (!file || typeof file.path !== 'string' || !TEXT_EXT_RE.test(file.path)) return file;
    const text = decodeFileContent(file);
    const r = repairTemplateSource(text, { path: file.path });
    if (!r.fixes.length || r.text === text) return file;
    for (const f of r.fixes) fixes.push(`${file.path}: ${f}`);
    const { contentBase64, ...rest } = file;
    return { ...rest, content: r.text };
  });
  return { files: out, fixes };
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
