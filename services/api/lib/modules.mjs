/**
 * What a site is ACTUALLY built from.
 *
 * A licensee ticks "Photo gallery". The gallery module requires the CMS core,
 * so the assembler quietly includes it — that resolution is the assembler's,
 * and `config.modules` keeps only what was ticked. Everything downstream that
 * asked `config.modules` what the site contains therefore got a short answer,
 * and each one was wrong in its own way:
 *
 *   - the settings panel never asked for BLOB_READ_WRITE_TOKEN, so the client's
 *     CMS uploads went to local disk in production, where a redeploy wipes them
 *   - the client handoff never mentioned the Pages editor or the Inbox, two of
 *     the things they were promised they could do themselves
 *   - asset compartments and content questions were resolved against the short
 *     list too
 *
 * This is the third bug of that shape (after ADMIN_PASSWORD never being
 * generated, and the base template's own env never being asked for), so the
 * answer is one function that everything uses rather than three more fixes:
 * ask here what a site contains, never `config.modules` directly.
 *
 * Resolution mirrors vendor/d4/d4-site-builder/bin/assemble.mjs: transitive,
 * fixed-point, and tolerant of a module that cannot be resolved (an imported
 * template naming something unknown must not take the whole request down —
 * the assembler will refuse it later, with a better message than this could).
 */

/**
 * @param {string[]} chosen           what the licensee picked
 * @param {(name: string) => object|null} resolveManifest
 * @returns {string[]} chosen plus everything they require, transitively
 */
export function resolveModules(chosen = [], resolveManifest = () => null) {
  const out = [];
  const seen = new Set();
  const queue = [...(Array.isArray(chosen) ? chosen : [])].filter((n) => typeof n === 'string' && n);

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    const manifest = resolveManifest(name);
    for (const dep of Object.keys(manifest?.requires ?? {})) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return out;
}

/** The same thing for a stored site record, which is how callers usually want
 *  it. The base template is deliberately NOT included: it is passed separately
 *  where it matters, because most callers want the module list alone. */
export function modulesForSite(site, resolveManifest) {
  return resolveModules(
    Array.isArray(site?.config?.modules) ? site.config.modules : [],
    resolveManifest,
  );
}
