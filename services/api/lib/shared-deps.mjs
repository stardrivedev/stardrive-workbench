/**
 * What an engine module needs its BASE TEMPLATE to provide.
 *
 * Thirteen of the fourteen module-backed features import a small shared
 * component library — `@/components/ui/PageHeader`, `@/components/seo/JsonLd`,
 * `@/lib/seo` — and only `d4-site-template` ships those files. Layering any of
 * them onto a template the Studio generated therefore failed at `next build`
 * with "Module not found", because nothing ever required an imported template
 * to provide them: the Studio rulebook does not mention them and
 * REQUIRED_SITE_FILES does not check for them.
 *
 * This is the fourth bug of the shape "something the built thing needs was
 * never asked for" (after ADMIN_PASSWORD, the base template's own env, and
 * config.modules being shorter than what the assembler builds), so it gets the
 * same answer: the ENGINE supplies it, deterministically, rather than a prompt
 * asking a model to get three more files right on every generation.
 *
 * The set is DERIVED, not listed. A hand-maintained allowlist is wrong the
 * moment somebody adds a module that imports one more thing, and that wrongness
 * shows up as a failed customer build rather than a failed test. So: read what
 * the modules actually import, keep whatever the template already answers, and
 * backfill only the remainder from the reference template — transitively, since
 * a backfilled file has imports of its own.
 *
 * Over-approximating is deliberate. Matching every `"@/…"` string catches a
 * little more than the real import graph; the cost is an unused file, while the
 * cost of missing one is a build the customer cannot fix.
 */

/** Any `"@/…"` specifier appearing in a source file. */
const ALIAS_RE = /["'](@\/[^"'\s]+)["']/g;

/** How `@/x` is resolved to a file, in the order a bundler would try. */
const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '/index.tsx', '/index.ts'];

export function aliasSpecifiers(source) {
  const out = new Set();
  for (const m of String(source ?? '').matchAll(ALIAS_RE)) out.add(m[1]);
  return out;
}

/** `@/components/ui/PageHeader` -> `src/components/ui/PageHeader`.
 *  Both templates map `@/*` to `./src/*` in tsconfig; that is the contract. */
export function aliasToStem(spec) {
  return `src/${String(spec).slice(2).replace(/^\/+/, '')}`;
}

/** The concrete relative path `spec` names, or null if `has` knows of none. */
export function resolveAlias(spec, has) {
  const stem = aliasToStem(spec);
  for (const ext of EXTENSIONS) {
    const candidate = stem + ext;
    if (has(candidate)) return candidate;
  }
  return null;
}

/**
 * The files a template must GAIN for the given module sources to compile.
 *
 * @param {object} o
 * @param {string[]} o.moduleSources  contents of every file the modules ship
 * @param {(relPath: string) => boolean} o.templateHas  what the template provides
 * @param {{ has: (relPath: string) => boolean, read: (relPath: string) => string }} o.reference
 *        the first-party template, which is where a missing shared file comes from.
 *        `has` must mean "there is a FILE here": `@/components/ui` matches the
 *        directory of that name under the empty extension, and answering true
 *        for it makes `read` throw EISDIR.
 * @returns {{path: string, content: string}[]} files to write, none of which the template already has
 */
export function planBackfill({ moduleSources = [], templateHas = () => false, reference }) {
  const chosen = new Map();
  const seenSpec = new Set();
  const queue = [];

  const enqueue = (source) => { for (const spec of aliasSpecifiers(source)) queue.push(spec); };
  for (const source of moduleSources) enqueue(source);

  while (queue.length) {
    const spec = queue.shift();
    if (seenSpec.has(spec)) continue;
    seenSpec.add(spec);

    // The template answers it already. Leave its own version alone: a design
    // the customer generated must win over the reference one, always.
    if (resolveAlias(spec, templateHas)) continue;

    const from = resolveAlias(spec, reference.has);
    // Not ours to supply. Say nothing: the compiler reports it better than a
    // guess here would, and a module importing something nobody has is a bug
    // in that module rather than in this template.
    if (!from || chosen.has(from)) continue;

    const content = reference.read(from);
    chosen.set(from, content);
    enqueue(content); // a backfilled file has imports of its own
  }

  return [...chosen].map(([path, content]) => ({ path, content }));
}
