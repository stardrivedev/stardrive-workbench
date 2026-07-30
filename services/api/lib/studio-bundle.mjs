/**
 * Server-side Studio output handling — the same parsing the Workbench browser
 * does interactively, for Batch Building's server-side generations.
 *
 * The Studio contract (app/workbench/studio-prompt.js, loaded verbatim here
 * via createRequire — one source of truth) makes the model deliver files as:
 *
 *   === FILE: <path> ===
 *   <raw content>
 *   === END FILE ===
 *
 * `parseGeneratedBundle(text, name)` turns one generation into the exact
 * bundle shape `POST /v1/templates` accepts: { manifest, files } with the
 * files/ prefix stripped and the operator's chosen name slugged in.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './templates.mjs';
import { resolveModules } from './modules.mjs';

const require = createRequire(import.meta.url);
const PROMPTS = require(path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'app', 'workbench', 'studio-prompt.js'
));

export const RULEBOOK_PROMPT = PROMPTS.RULEBOOK_PROMPT;
export const STUDIO_FORMAT = PROMPTS.STUDIO_FORMAT;
export const FEATURES = PROMPTS.FEATURES;
export const featureBlockFor = PROMPTS.featureBlockFor;
/**
 * Feature ids → the modules the site will ACTUALLY be built from.
 *
 * The mapping itself lives in studio-prompt.js because the console needs it in
 * the browser, where the catalog does not exist. It returns only the modules a
 * feature names directly, and the assembler then pulls in whatever those
 * require — so on this side of the wire the answer has to be resolved, or
 * everything downstream is asked about a shorter site than the one being
 * built. See lib/modules.mjs for what that cost.
 */
export function modulesForFeatures(ids) {
  const direct = PROMPTS.modulesForFeatures(ids);
  return resolveModules(direct, (name) => catalog().get(name)?.manifest ?? null);
}

/** The bundled catalog, read once. Lazily, because loading it at import time
 *  would make every consumer of this file pay for it. */
let CATALOG = null;
const catalog = () => (CATALOG ??= loadCatalog());

/** The full system prompt for one design generation with these feature ids. */
export function designSystemPrompt(featureIds = []) {
  return RULEBOOK_PROMPT + STUDIO_FORMAT + featureBlockFor(featureIds);
}

/** Every FILE block in a generation, path → content (later blocks win). */
export function collectFiles(text) {
  const out = {};
  const re = /^===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n?^===\s*END FILE\s*===/gm;
  let hit;
  while ((hit = re.exec(String(text || ''))) !== null) out[hit[1].trim()] = hit[2];
  return out;
}

/**
 * One generation's text → the import bundle { manifest, files }.
 * `name` (optional) overrides manifest.name, slugged like the Workbench does.
 * Throws with a human-readable reason on a malformed generation.
 */
export function parseGeneratedBundle(text, name) {
  const files = collectFiles(text);
  const manifestSrc = files['manifest.json'];
  if (!manifestSrc) throw new Error('The generation has no manifest.json block.');
  let manifest;
  try { manifest = JSON.parse(manifestSrc); } catch { throw new Error('The generated manifest.json is not valid JSON.'); }
  if (name) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug) manifest.name = slug;
  }
  const payload = Object.entries(files)
    .filter(([p]) => p !== 'manifest.json')
    .map(([p, content]) => ({ path: p.replace(/^files\//, ''), content }));
  if (!payload.length) throw new Error('The generation has no payload files.');
  return { manifest, files: payload };
}
