/**
 * Static serving for the Workbench (app/workbench). Path-guarded: only
 * files inside the workbench directory, no traversal, known extensions
 * only, "/" serves index.html.
 */
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function createStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  return function serve(req, res, pathname) {
    if (req.method !== 'GET') return false;
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (rel.includes('..') || rel.includes('\\')) return false;
    const ext = path.extname(rel).toLowerCase();
    if (!MIME[ext]) return false;
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep) && abs !== path.join(root, 'index.html')) return false;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
    const body = fs.readFileSync(abs);
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(body);
    return true;
  };
}
