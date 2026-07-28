#!/usr/bin/env node
/**
 * Snapshot and restore the var directory — which IS the business. It holds
 * every account, API key, template, site, and (encrypted) hosting token. Lose
 * the volume and every licensee loses their work at once.
 *
 * A snapshot deliberately EXCLUDES `workspaces/`: those are build output,
 * regenerable by rebuilding, and they are the overwhelming majority of the
 * bytes. What it keeps is the irreplaceable part, which is small.
 *
 *   node services/api/scripts/backup.mjs create <dest-dir> [--var-dir DIR]
 *   node services/api/scripts/backup.mjs restore <archive> <var-dir> [--force]
 *   node services/api/scripts/backup.mjs verify  <archive>
 *
 * IMPORTANT: hosting tokens are encrypted with STARDRIVE_SECRET. A snapshot
 * restored WITHOUT the same secret gives you accounts and sites but dead
 * tokens, so back the secret up separately, in a password manager, not beside
 * the data. `verify` warns when a snapshot was taken from a var dir whose
 * secret lives in the file (dev) rather than the environment (prod).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { tarGzDir } from '../lib/archive.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const has = (name) => args.includes(name);

// Build output is regenerable and is most of the size; the rest is not.
const SKIP_TOP = new Set(['workspaces']);

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }

/** Everything worth keeping, copied to a staging dir, then tarred. */
function stage(varDir, stagingDir) {
  let files = 0;
  const walk = (from, to, depth) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (depth === 0 && SKIP_TOP.has(e.name)) continue;
      const src = path.join(from, e.name);
      const dst = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); walk(src, dst, depth + 1); }
      else if (e.isFile()) { fs.copyFileSync(src, dst); files += 1; }
    }
  };
  fs.mkdirSync(stagingDir, { recursive: true });
  walk(varDir, stagingDir, 0);
  return files;
}

function create() {
  const dest = args[1] || die('usage: backup.mjs create <dest-dir> [--var-dir DIR]');
  const varDir = path.resolve(flag('--var-dir') || process.env.STARDRIVE_VAR_DIR || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', 'var'));
  if (!fs.existsSync(varDir)) die(`no var directory at ${varDir}`);
  fs.mkdirSync(dest, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(dest, `.staging-${stamp}`);
  const files = stage(varDir, staging);
  const buf = tarGzDir(staging, '');
  fs.rmSync(staging, { recursive: true, force: true });

  const out = path.join(dest, `stardrive-${stamp}.tar.gz`);
  fs.writeFileSync(out, buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(out + '.sha256', `${sha}  ${path.basename(out)}\n`);

  const secretInVarDir = fs.existsSync(path.join(varDir, 'secret.key'));
  console.log(`snapshot: ${out}`);
  console.log(`  ${files} file(s), ${(buf.length / 1e6).toFixed(2)} MB, sha256 ${sha.slice(0, 16)}…`);
  console.log('  workspaces/ excluded (build output; rebuild to regenerate)');
  if (secretInVarDir) {
    console.log('  NOTE: this deployment keeps its encryption key in var/secret.key, so it is INSIDE');
    console.log('        this snapshot. In production set STARDRIVE_SECRET from a secret store instead,');
    console.log('        and keep it somewhere other than the backup.');
  } else {
    console.log('  Hosting tokens are encrypted with STARDRIVE_SECRET, which is NOT in this file.');
    console.log('  Back that secret up separately or the restored tokens will be unreadable.');
  }
}

/** Minimal ustar reader — the counterpart to lib/archive.mjs's writer. */
function* entries(buf) {
  const tar = zlib.gunzipSync(buf);
  const str = (b) => b.toString('utf8').replace(/\0.*$/, '');
  for (let off = 0; off + 512 <= tar.length;) {
    const head = tar.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    const name = str(head.subarray(0, 100));
    const prefix = str(head.subarray(345, 500));
    const size = parseInt(str(head.subarray(124, 136)).trim() || '0', 8);
    const body = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (name) yield { path: prefix ? `${prefix}/${name}` : name, body };
  }
}

function readArchive(file) {
  if (!fs.existsSync(file)) die(`no archive at ${file}`);
  const buf = fs.readFileSync(file);
  const sidecar = file + '.sha256';
  if (fs.existsSync(sidecar)) {
    const want = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (want !== got) die('checksum mismatch — this archive is corrupt, do not restore it');
  }
  return buf;
}

function verify() {
  const buf = readArchive(args[1] || die('usage: backup.mjs verify <archive>'));
  let files = 0;
  const tops = new Set();
  for (const e of entries(buf)) { files += 1; tops.add(e.path.split('/')[0]); }
  console.log(`archive is readable: ${files} file(s)`);
  console.log(`  contains: ${[...tops].sort().join(', ') || '(nothing)'}`);
  for (const need of ['accounts', 'keys.json']) {
    console.log(`  ${tops.has(need) ? 'ok  ' : 'MISSING'} ${need}`);
  }
}

function restore() {
  const file = args[1] || die('usage: backup.mjs restore <archive> <var-dir> [--force]');
  const target = args[2] || die('usage: backup.mjs restore <archive> <var-dir> [--force]');
  const buf = readArchive(file);
  if (fs.existsSync(target) && fs.readdirSync(target).length && !has('--force')) {
    die(`${target} is not empty. Restoring would overwrite a live deployment; pass --force if that is what you mean.`);
  }
  let files = 0;
  for (const e of entries(buf)) {
    const dest = path.resolve(target, e.path);
    if (!dest.startsWith(path.resolve(target) + path.sep)) die(`unsafe path in archive: ${e.path}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, e.body);
    files += 1;
  }
  console.log(`restored ${files} file(s) into ${target}`);
  console.log('  workspaces/ was not in the snapshot: rebuild any site you need to publish again.');
  console.log('  Set the SAME STARDRIVE_SECRET as the source deployment, or stored hosting tokens will not decrypt.');
}

if (cmd === 'create') create();
else if (cmd === 'restore') restore();
else if (cmd === 'verify') verify();
else {
  console.log('usage:');
  console.log('  backup.mjs create  <dest-dir> [--var-dir DIR]');
  console.log('  backup.mjs restore <archive> <var-dir> [--force]');
  console.log('  backup.mjs verify  <archive>');
  process.exit(cmd ? 1 : 0);
}
