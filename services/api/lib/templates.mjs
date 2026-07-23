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
 *              no-code upload uses), stored under var/templates/<account>/.
 *              PRIVATE to the importing account: a licensee's templates are
 *              theirs alone — only the bundled catalog is shared.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateBundle, autofixTemplateFiles } from '../../../packages/template-kit/index.mjs';

export { validateManifest, validateBundle, autofixTemplateFiles };

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

/** Per-account imported-template store over the var dir. */
export function createImportedStore(store) {
  const rel = (account, name) => `templates/${account}/${name}.json`;

  function get(account, name) {
    const rec = store.readJson(rel(account, name));
    return rec ? { manifest: rec.bundle.manifest, source: 'imported', record: rec } : null;
  }

  function list(account) {
    return store.listIds(`templates/${account}`).map((name) => get(account, name)).filter(Boolean);
  }

  function put(account, bundle, warnings) {
    const name = bundle.manifest.name;
    const existed = Boolean(store.readJson(rel(account, name)));
    store.writeJson(rel(account, name), {
      name,
      account,
      bundle,
      warnings,
      importedAt: new Date().toISOString(),
      source: 'imported',
    });
    return { name, existed };
  }

  function remove(account, name) {
    return store.deleteJson(rel(account, name));
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
