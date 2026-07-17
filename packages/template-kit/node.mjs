/**
 * Node-only conveniences for template-kit: turn a directory into a bundle
 * and write a validated bundle back to disk. Kept out of index.mjs so the
 * core stays browser-safe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isSafeBundlePath } from './index.mjs';

const TEXT_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|svg|txt|html|yml|yaml)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'out']);

/**
 * Build a bundle from a template repo directory: reads manifest.json at the
 * root and packs the files/ payload (paths in the bundle are relative to
 * files/). Binary files go base64.
 */
export function bundleFromDir(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json in ${dir}.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filesRoot = path.join(dir, 'files');
  if (!fs.existsSync(filesRoot)) throw new Error(`No files/ payload directory in ${dir}.`);

  const files = [];
  const walk = (sub) => {
    for (const entry of fs.readdirSync(path.join(filesRoot, sub), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.posix.join(sub, entry.name));
        continue;
      }
      const rel = path.posix.join(sub, entry.name);
      const abs = path.join(filesRoot, rel);
      if (TEXT_EXT_RE.test(rel)) files.push({ path: rel, content: fs.readFileSync(abs, 'utf-8') });
      else files.push({ path: rel, contentBase64: fs.readFileSync(abs).toString('base64') });
    }
  };
  walk('');
  return { manifest, files };
}

/**
 * Write a bundle to disk as a template repo: manifest.json at the root,
 * payload under files/. Refuses unsafe paths even if the caller skipped
 * validateBundle.
 */
export function writeBundleToDir(bundle, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2) + '\n');
  for (const file of bundle.files) {
    if (!isSafeBundlePath(file.path)) throw new Error(`Unsafe bundle path: ${JSON.stringify(file.path)}`);
    const abs = path.join(destDir, 'files', ...file.path.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (typeof file.content === 'string') fs.writeFileSync(abs, file.content);
    else fs.writeFileSync(abs, Buffer.from(file.contentBase64, 'base64'));
  }
}
