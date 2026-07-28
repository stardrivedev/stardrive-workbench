/**
 * Minimal HTTP plumbing for the Stardrive API: a method+pattern router with
 * :params, a JSON body reader with a size cap, and a uniform response
 * envelope. Deliberately dependency-free — node:http is the whole stack.
 */
import http from 'node:http';

const DEFAULT_MAX_BODY_BYTES = 1_000_000; // 1 MB — mappings and configs are small.

export function json(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function fail(res, status, code, message, extraHeaders = {}) {
  const body = JSON.stringify({ error: { code, message } }, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/** Raw request body as a string — for signature-verified webhooks. */
export function readRawBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413, code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function readBody(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413, code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(Object.assign(new Error('Body is not valid JSON.'), { status: 400, code: 'bad_json' }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Route table entry: { method, pattern, scope, handler }.
 * pattern "/v1/mappings/:id" — :segments become ctx.params.
 * scope: "public" (no key) or an API-key scope name.
 */
export function matchRoute(routes, method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const patSegs = r.pattern.split('/').filter(Boolean);
    const segs = pathname.split('/').filter(Boolean);
    if (patSegs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(':')) params[patSegs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (patSegs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

/**
 * `onFinish` and `onError` are the telemetry seam (see lib/ops.mjs): every
 * completed response and every thrown error, offered to an observer that the
 * transport itself knows nothing about. Both are wrapped, because a monitor
 * that can take the service down with it is worse than no monitor.
 */
export function createServer(handler, { onFinish = null, onError = null } = {}) {
  const safely = (fn, ...args) => { if (fn) { try { fn(...args); } catch { /* never fail a request over telemetry */ } } };
  return http.createServer((req, res) => {
    if (onFinish) res.on('finish', () => safely(onFinish, req, res));
    handler(req, res).catch((err) => {
      const status = err.status || 500;
      if (!res.headersSent) {
        fail(res, status, err.code || 'internal', status === 500 ? 'Internal error.' : err.message);
      }
      safely(onError, err, req);
      if (status === 500) console.error('[stardrive-api]', err);
    });
  });
}
