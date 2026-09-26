// Lantern prototype server. Zero dependencies (Node >= 20).
//   /            platform SPA (public/)
//   /api/*       platform services (server/api.js)
//   /games/*     immutable game packages (packages/) — untrusted content
//   /sdk/*       Lantern Platform SDK for games
//   /user-media  developer-uploaded store media — untrusted content
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { seed } from './seed.js';
import { handleApi, HttpError, USER_MEDIA_DIR } from './api.js';
import { PACKAGES_DIR } from './packages.js';

const PORT = Number(process.env.PORT ?? 5173);
const ROOT = path.resolve('.');
const PUBLIC = path.join(ROOT, 'public');
const SDK = path.join(ROOT, 'sdk');

db.open(path.join(ROOT, 'data/db.json'), seed);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.zip': 'application/zip',
};

const PLATFORM_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:", "frame-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
].join('; ');

// Games are untrusted. Even if a game URL is opened directly (not in our iframe),
// the CSP `sandbox` directive gives it an opaque origin, so it can never act as
// the platform origin. Network access is limited to the game's own package path.
function gameCsp(origin, pkgPath) {
  const own = `${origin}/games/${pkgPath}/`;
  const sdk = `${origin}/sdk/v1/`;
  return [
    'sandbox allow-scripts allow-pointer-lock',
    "default-src 'none'",
    `script-src ${own} ${sdk} 'unsafe-inline' 'wasm-unsafe-eval'`,
    `style-src ${own} 'unsafe-inline'`,
    `img-src ${own} ${origin}/media/ data: blob:`,
    `media-src ${own} data: blob:`, `font-src ${own} data:`,
    `connect-src ${own} data: blob:`, `worker-src ${own} blob:`,
    "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
    `frame-ancestors ${origin}`,
  ].join('; ');
}

function sendFile(res, file, headers = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', ...headers,
    });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) ? p : null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = `http://${req.headers.host}`;
  const url = new URL(req.url, origin);
  const p = decodeURIComponent(url.pathname);

  try {
    // ---------- API ----------
    if (p.startsWith('/api/')) {
      // CSRF / untrusted-frame defence: API calls must come from platform JS
      // (custom header forces CORS preflight, which we never grant) and, when an
      // Origin is present, from our own origin. Sandboxed games send Origin: null.
      const reqOrigin = req.headers.origin;
      if (req.headers['x-lantern-client'] !== 'platform' || (reqOrigin && reqOrigin !== origin)) {
        throw new HttpError(403, 'Forbidden');
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, 80e6) : null;
      const result = await handleApi(req, res, url, body);
      const json = JSON.stringify(result ?? null);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(json);
      return;
    }

    // ---------- Game packages (untrusted, immutable, versioned) ----------
    if (p.startsWith('/games/')) {
      const rel = p.slice('/games/'.length);
      const [gameId, version] = rel.split('/');
      const file = safeJoin(PACKAGES_DIR, rel);
      if (!file || !gameId || !version) { res.writeHead(404); res.end(); return; }
      sendFile(res, file, {
        'Content-Security-Policy': gameCsp(origin, `${gameId}/${version}`),
        // Versioned URLs never change → cache forever. This is what makes relaunches instant on web.
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*', // opaque-origin game may fetch() its own assets (no credentials)
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Referrer-Policy': 'no-referrer',
      });
      return;
    }

    // ---------- SDK ----------
    if (p.startsWith('/sdk/')) {
      const file = safeJoin(SDK, p.slice('/sdk/'.length));
      if (!file) { res.writeHead(404); res.end(); return; }
      sendFile(res, file, { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' });
      return;
    }

    // ---------- Uploaded media (untrusted) ----------
    if (p.startsWith('/user-media/')) {
      const file = safeJoin(USER_MEDIA_DIR, p.slice('/user-media/'.length));
      if (!file) { res.writeHead(404); res.end(); return; }
      sendFile(res, file, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'public, max-age=3600' });
      return;
    }

    // ---------- Platform static files + SPA fallback ----------
    const file = p === '/' ? null : safeJoin(PUBLIC, p);
    const isAsset = file && path.extname(file) && fs.existsSync(file);
    const headers = {
      'Cache-Control': p.startsWith('/media/') ? 'public, max-age=86400' : 'no-cache',
      'Cross-Origin-Resource-Policy': p.startsWith('/media/') ? 'cross-origin' : 'same-origin',
    };
    if (isAsset) { sendFile(res, file, headers); return; }
    if (path.extname(p) && p !== '/') { res.writeHead(404); res.end('Not found'); return; }
    sendFile(res, path.join(PUBLIC, 'index.html'), {
      ...headers, 'Content-Security-Policy': PLATFORM_CSP, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message ?? 'Server error' }));
  }
});

server.listen(PORT, () => console.log(`Lantern running at http://localhost:${PORT}`));
const shutdown = () => { db.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
