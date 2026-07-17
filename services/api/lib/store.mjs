/**
 * File-backed JSON state under one var directory. Deliberately boring: every
 * record is a file, every collection is a folder — inspectable, diffable,
 * and trivially swappable for Turso later (the interface is four verbs).
 * The var dir is runtime state and is never committed.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Guard every externally supplied id that becomes part of a file path. */
export function assertSafeSlug(id, what = 'id') {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(id))) {
    throw Object.assign(
      new Error(`${what} must be 1-64 chars of lowercase a-z, 0-9, hyphens (got ${JSON.stringify(id)}).`),
      { status: 400, code: 'bad_id' }
    );
  }
  return id;
}

export class VarStore {
  constructor(varDir) {
    this.dir = varDir;
    fs.mkdirSync(varDir, { recursive: true });
  }

  path(...segs) {
    return path.join(this.dir, ...segs);
  }

  readJson(rel, fallback = null) {
    const fp = this.path(rel);
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  }

  writeJson(rel, obj) {
    const fp = this.path(rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, fp);
  }

  deleteJson(rel) {
    const fp = this.path(rel);
    if (!fs.existsSync(fp)) return false;
    fs.rmSync(fp);
    return true;
  }

  /** Ids (basenames sans .json) in a collection folder, sorted. */
  listIds(relDir) {
    const dir = this.path(relDir);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
  }
}
