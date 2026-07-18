/**
 * Minimal, dependency-free tar.gz writer — for exporting an assembled site
 * as a standard .tar.gz a developer can unpack anywhere. Node built-ins only
 * (ustar tar format + zlib gzip). The exported archive contains the
 * assembled site ONLY — never any part of the engine.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BLOCK = 512;

function octal(n, width) {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name, size, mtime, type = '0') {
  const buf = Buffer.alloc(BLOCK);
  let prefix = '';
  let nm = name;
  if (Buffer.byteLength(nm) > 100) {
    // ustar split: prefix (<=155) + name (<=100) at a path separator.
    const i = nm.lastIndexOf('/', nm.length - 1);
    const cut = nm.lastIndexOf('/', 100);
    const at = cut > 0 ? cut : i;
    if (at > 0) { prefix = nm.slice(0, at); nm = nm.slice(at + 1); }
  }
  buf.write(nm.slice(0, 100), 0, 'utf8');
  buf.write(octal(0o644, 8), 100);        // mode
  buf.write(octal(0, 8), 108);            // uid
  buf.write(octal(0, 8), 116);            // gid
  buf.write(octal(size, 12), 124);        // size
  buf.write(octal(Math.floor(mtime / 1000), 12), 136); // mtime
  buf.write('        ', 148);             // checksum placeholder (8 spaces)
  buf.write(type, 156);                   // typeflag
  buf.write('ustar\0', 257);              // magic
  buf.write('00', 263);                   // version
  if (prefix) buf.write(prefix.slice(0, 155), 345, 'utf8');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(octal(sum, 7).slice(0, 6) + '\0 ', 148); // 6-digit octal + NUL + space
  return buf;
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(abs, rel, out);
    else if (entry.isFile()) out.push({ rel, abs, stat: fs.statSync(abs) });
  }
}

/** tar.gz of a directory tree; paths are relative to `dir`. */
export function tarGzDir(dir, rootName = '') {
  const files = [];
  walk(dir, rootName, files);
  const parts = [];
  for (const f of files) {
    const content = fs.readFileSync(f.abs);
    parts.push(header(f.rel, content.length, f.stat.mtimeMs));
    parts.push(content);
    const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // two zero blocks = end of archive
  return zlib.gzipSync(Buffer.concat(parts));
}
