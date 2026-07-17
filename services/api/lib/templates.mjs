/**
 * Template catalog + imported templates.
 *
 * Two sources:
 *   bundled  — the first-party d4 set: six manifests in data/catalog/,
 *              verbatim from the public engine repos (provenance in
 *              data/README.md). Boot-time self-validated; not deletable or
 *              overridable through the API.
 *   imported — licensee templates accepted through POST /v1/templates as
 *              template BUNDLES ({ manifest, files }), validated + linted
 *              by @stardrive/template-kit (the same gate Deneb4's own
 *              no-code upload uses), stored under var/templates/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateBundle } from '../../../packages/template-kit/index.mjs';

export { validateManifest, validateBundle };

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

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

/** Imported-template store over the var dir. */
export function createImportedStore(store) {
  const rel = (name) => `templates/${name}.json`;

  function get(name) {
    const rec = store.readJson(rel(name));
    return rec ? { manifest: rec.bundle.manifest, source: 'imported', record: rec } : null;
  }

  function list() {
    return store.listIds('templates').map((name) => get(name)).filter(Boolean);
  }

  function put(bundle, warnings) {
    const name = bundle.manifest.name;
    const existed = Boolean(store.readJson(rel(name)));
    store.writeJson(rel(name), {
      name,
      bundle,
      warnings,
      importedAt: new Date().toISOString(),
      source: 'imported',
    });
    return { name, existed };
  }

  function remove(name) {
    return store.deleteJson(rel(name));
  }

  return { get, list, put, remove };
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
