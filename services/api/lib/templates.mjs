/**
 * Template catalog + manifest validation.
 *
 * The bundled catalog is the d4 first-party set: the six manifests in
 * data/catalog/ are verbatim copies from the public d4 engine repos
 * (canonical schema: data/schema/manifest.schema.json, vendored from
 * d4-site-builder). The validator below implements that schema's rules
 * with ONE deliberate product relaxation: third-party template names may
 * be any lowercase slug — the `d4-` prefix rule applies to the first-party
 * catalog, not to licensees. Every problem is reported, not just the first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

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

/** Load and self-validate the bundled catalog at boot. Throws on a bad bundle. */
export function loadCatalog() {
  const dir = path.join(DATA, 'catalog');
  const catalog = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
    const v = validateManifest(manifest);
    if (!v.ok) {
      throw new Error(`Bundled catalog manifest ${file} is invalid: ${v.errors.join(' | ')}`);
    }
    catalog.set(manifest.name, { manifest, source: 'bundled' });
  }
  return catalog;
}

export function summarize({ manifest, source }) {
  return {
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    description: manifest.description,
    clientFacingSummary: manifest.clientFacingSummary ?? null,
    routes: manifest.provides?.routes ?? [],
    requires: manifest.requires ?? {},
    source,
  };
}
