// Vibe-Games prototype server. Zero dependencies (Node >= 20).
//   /            platform SPA (public/)
//   /api/*       platform services (server/api.js)
//   /games/*     immutable game packages (packages/) — untrusted content
//   /sdk/*       Vibe-Games Platform SDK for games
//   /user-media  developer-uploaded store media — untrusted content
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { seed, syncSeedCatalog } from './seed.js';
import crypto from 'node:crypto';
import { handleApi, HttpError, googleStart, googleCallback, stripeWebhook, settleAllCreators, missingUploads } from './api.js';
import { ensureLocal, storageEnabled, backfillDir } from './storage.js';
import { reportError, installProcessHandlers, monitoringEnabled } from './monitoring.js';
import { emailEnabled } from './email.js';
import { initSigning } from './signing.js';
import { packageDir } from './packages.js';
import { PORT, DB_FILE, DATA_DIR, USER_MEDIA_DIR, TRUST_PROXY, IS_PROD, ADMIN_OPEN, ADMIN_PASSWORD, ACCOUNT_MODE, GAMES_ORIGIN, PUBLIC_URL, DATABASE_URL, ADMIN_EMAILS } from './config.js';
import { PUBLISHED_PACKAGES_DIR, BUILTIN_PACKAGES_DIR } from './config.js';
import { stripeEnabled } from './payments.js';
import { googleEnabled } from './auth.js';

const ROOT = path.resolve('.');
const PUBLIC = path.join(ROOT, 'public');
const SDK = path.join(ROOT, 'sdk');

installProcessHandlers();
initSigning();
try {
  await db.open(DB_FILE, seed, { databaseUrl: DATABASE_URL });
} catch (err) {
  console.error(`Could not open the database${DATABASE_URL ? ' (check DATABASE_URL)' : ''}: ${err.message}`);
  process.exit(1);
}
if (IS_PROD && !process.env.PACKAGE_SIGNING_KEY) console.warn('  ! PACKAGE_SIGNING_KEY is not set: a new key is generated on each fresh disk, which breaks players’ offline downloads. Run `npm run gen:signing-key` and set it.');
if (IS_PROD && !ADMIN_EMAILS.length) console.warn('  ! ADMIN_EMAILS is not set: nobody can review games or use the admin console (ADMIN_PASSWORD still unlocks it per session).');
syncSeedCatalog();
const GAMES_HOST = GAMES_ORIGIN ? new URL(GAMES_ORIGIN).host : null;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.zip': 'application/zip',
};

// Platform CSP. The per-response nonce lets the runtime start games from the
// verified local package cache (offline play) inside a sandboxed srcdoc frame.
function platformCsp(nonce) {
  const g = GAMES_ORIGIN ? ` ${GAMES_ORIGIN}` : '';
  return [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data: blob:", `img-src 'self' data: blob:${g}`,
    "media-src 'self' data: blob:", `frame-src 'self'${g}`, `connect-src 'self' data: blob:${g}`,
    "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
  ].join('; ');
}
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

// Service worker: precache list + version derived from the actual shell files.
function listFiles(dir, prefix) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, `${prefix}${e.name}/`));
    else if (/\.(js|css|svg)$/.test(e.name)) out.push(`${prefix}${e.name}`);
  }
  return out;
}
const SW_SOURCE = (() => {
  const shell = ['/', '/favicon.svg', '/sdk/v1/platform-sdk.js', ...listFiles(path.join(PUBLIC, 'css'), '/css/'), ...listFiles(path.join(PUBLIC, 'js'), '/js/')];
  const h = crypto.createHash('sha256');
  h.update(INDEX_HTML);
  for (const f of shell.slice(1)) h.update(fs.readFileSync(f.startsWith('/sdk/') ? path.join(ROOT, f) : path.join(PUBLIC, f)));
  const tpl = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  h.update(tpl);
  return tpl.replace('__SW_VERSION__', h.digest('hex').slice(0, 12)).replace('__PRECACHE__', JSON.stringify(shell));
})();

// Games are untrusted. Even if a game URL is opened directly (not in our iframe),
// the CSP `sandbox` directive gives it an opaque origin, so it can never act as
// the platform origin. Network access is limited to the game's own package path.
function gameCsp(origin, pkgPath, parent) {
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
    `frame-ancestors ${parent || '*'}`,
  ].join('; ');
}

// Supports single byte ranges (`Range: bytes=a-b`), which browsers need to stream and seek video.
function sendFile(res, file, headers = {}, req = null) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    // Validators let browsers stitch cached pieces of a video together safely.
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const lastModified = st.mtime.toUTCString();
    const base = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', ETag: etag, 'Last-Modified': lastModified, ...headers,
    };
    const ifRange = req?.headers['if-range'];
    const rangeOk = !ifRange || ifRange === etag || ifRange === lastModified;
    const m = rangeOk ? /^bytes=(\d*)-(\d*)$/.exec(String(req?.headers.range ?? '').trim()) : null;
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { ...base, 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    if (req?.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) ? p : null;
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
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
  // Behind a hosting proxy the public scheme/IP arrive in X-Forwarded-* headers.
  const proto = TRUST_PROXY ? String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim() : 'http';
  const secure = proto === 'https';
  const ip = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
  const origin = `${secure ? 'https' : 'http'}://${req.headers.host}`;
  const url = new URL(req.url, origin);
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  const ctx = { ip, secure, origin };
  const isGamesHost = !!GAMES_HOST && req.headers.host === GAMES_HOST;

  try {
    if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');

    // The games origin serves ONLY untrusted game content — never the platform or its API.
    if (isGamesHost && !(p.startsWith('/games/') || p.startsWith('/sdk/') || p.startsWith('/media/'))) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return;
    }

    // Stripe webhook: authenticated by signature, needs the raw body.
    if (p === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await readRaw(req, 1e6);
      let out;
      try { out = await stripeWebhook(raw, req.headers['stripe-signature']); } catch (e) { if (e instanceof HttpError) throw e; if (/signature|Signature|STRIPE_WEBHOOK_SECRET/.test(e.message)) throw new HttpError(400, e.message); throw e; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); return;
    }
    // Google sign-in: top-level navigations (no platform header).
    if (p === '/api/auth/google/start' && req.method === 'GET') { googleStart(req, res, ctx); return; }
    if (p === '/api/auth/google/callback' && req.method === 'GET') { await googleCallback(req, res, ctx, url); return; }

    // ---------- API ----------
    if (p.startsWith('/api/')) {
      // CSRF / untrusted-frame defence: API calls must come from platform JS
      // (custom header forces CORS preflight, which we never grant) and, when an
      // Origin is present, from our own origin. Sandboxed games send Origin: null.
      const reqOrigin = req.headers.origin;
      if (req.headers['x-vibe-client'] !== 'platform' || (reqOrigin && reqOrigin !== origin)) {
        throw new HttpError(403, 'Forbidden');
      }
      // Trailer uploads stream the raw video to disk in the handler (see api.js).
      const rawUpload = req.method === 'PUT' && /^\/api\/creator\/games\/[^/]+\/trailer$/.test(p);
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && !rawUpload ? await readBody(req, 80e6) : null;
      const result = await handleApi(req, res, url, body, ctx);
      const json = JSON.stringify(result ?? null);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(json);
      return;
    }

    // ---------- Game packages (untrusted, immutable, versioned) ----------
    if (p.startsWith('/games/')) {
      if (GAMES_HOST && !isGamesHost) { res.writeHead(404); res.end(); return; } // games live on the games origin only
      const rel = p.slice('/games/'.length);
      const [gameId, version, ...rest] = rel.split('/');
      const okSeg = (x) => x && /^[A-Za-z0-9._-]+$/.test(x) && x !== '..' && x !== '.';
      let file = okSeg(gameId) && okSeg(version) ? safeJoin(packageDir(gameId, version), rest.join('/')) : null;
      if (!file) { res.writeHead(404); res.end(); return; }
      // Creator uploads live in object storage too: pull them back onto a fresh disk on demand.
      if (!fs.existsSync(file) && storageEnabled() && !fs.existsSync(path.join(BUILTIN_PACKAGES_DIR, gameId, version))) {
        const local = safeJoin(path.join(PUBLISHED_PACKAGES_DIR, gameId, version), rest.join('/'));
        if (local && await ensureLocal(local, `packages/${gameId}/${version}/${rest.join('/')}`)) file = local;
      }
      sendFile(res, file, {
        'Content-Security-Policy': gameCsp(origin, `${gameId}/${version}`, GAMES_HOST ? PUBLIC_URL : origin),
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
      await ensureLocal(file, `media/${p.slice('/user-media/'.length)}`);
      sendFile(res, file, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'public, max-age=3600' }, req);
      return;
    }

    // ---------- Platform static files + SPA fallback ----------
    const file = p === '/' ? null : safeJoin(PUBLIC, p);
    const isAsset = file && path.extname(file) && fs.existsSync(file);
    const headers = {
      'Cache-Control': p.startsWith('/media/') ? 'public, max-age=86400' : 'no-cache',
      'Cross-Origin-Resource-Policy': p.startsWith('/media/') ? 'cross-origin' : 'same-origin',
    };
    if (p === '/sw.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(SW_SOURCE); return;
    }
    if (isAsset && p !== '/index.html') { sendFile(res, file, headers); return; }
    if (path.extname(p) && p !== '/' && p !== '/index.html') { res.writeHead(404); res.end('Not found'); return; }
    const nonce = crypto.randomBytes(16).toString('base64');
    const html = INDEX_HTML.replace('<script type="module" src="/js/app.js">', `<script type="module" nonce="${nonce}" src="/js/app.js">`);
    res.writeHead(200, {
      ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': platformCsp(nonce),
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) { console.error(err); reportError(err, { path: p, method: req.method }); }
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message ?? 'Server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`Vibe-Games running at http://localhost:${PORT}`);
  console.log(`  payments: ${stripeEnabled() ? 'Stripe' : 'demo wallet'} · Google sign-in: ${googleEnabled() ? 'on' : 'off'} · games origin: ${GAMES_ORIGIN || 'same as platform'}`);
  if (GAMES_ORIGIN && !PUBLIC_URL) console.warn('  ! GAMES_ORIGIN is set without PUBLIC_URL — game frames can be embedded by any site');
  console.log(`  data: ${db.backend() === 'postgres' ? 'Postgres' : DATA_DIR} · uploads: ${storageEnabled() ? 'object storage + disk' : 'disk'} · accounts: ${ACCOUNT_MODE} · publishing: ${ADMIN_OPEN ? 'open (local dev)' : 'creator accounts'}${IS_PROD ? ' · production' : ''}`);
  if (IS_PROD && !storageEnabled()) console.warn('  ! Object storage (S3_BUCKET…) is not set: uploaded games, art and trailers live only on this disk. Without a persistent disk they vanish on every redeploy or restart.');
  const missing = missingUploads();
  if (missing.length) {
    const msg = `Uploaded files are missing from the disk for ${missing.length} game(s): ${missing.map((m) => `${m.title} (${m.missing.join(', ')})`).join('; ')}. Re-upload them, and set up a persistent disk or object storage.`;
    console.warn(`  ! ${msg}`);
    reportError(new Error(msg), { where: 'startup: missing uploads', silent: true });
  }
  console.log(`  email: ${emailEnabled() ? 'Resend' : 'logged only'} · errors: ${monitoringEnabled() ? 'Sentry' : 'console'} · admins: ${ADMIN_OPEN ? 'everyone (local dev)' : [ADMIN_EMAILS.length ? `${ADMIN_EMAILS.length} email(s)` : '', ADMIN_PASSWORD ? 'password' : ''].filter(Boolean).join(' + ') || 'none — set ADMIN_EMAILS'}`);
});
// Back up anything on disk that object storage doesn't have yet (uploads made before storage was
// configured, or whose copy failed). Runs in the background after startup.
if (storageEnabled()) {
  setTimeout(async () => {
    try {
      const pk = await backfillDir(PUBLISHED_PACKAGES_DIR, 'packages');
      const md = await backfillDir(USER_MEDIA_DIR, 'media');
      const up = pk.uploaded + md.uploaded, bad = pk.failed + md.failed;
      console.log(`[storage] backup check: ${pk.checked + md.checked} files, ${up} newly uploaded${bad ? `, ${bad} failed` : ''}`);
      if (bad) reportError(new Error(`${bad} uploaded file(s) could not be copied to object storage`), { where: 'storage backfill', silent: true });
    } catch (err) { reportError(err, { where: 'storage backfill' }); }
  }, 3000).unref();
}
// Creator payouts that couldn't be sent yet (account not ready, Stripe hiccup) are retried.
setInterval(() => { settleAllCreators().catch((err) => reportError(err, { where: 'settleAllCreators' })); }, 10 * 60e3).unref();
let closing = false;
const shutdown = async () => {
  if (closing) return; closing = true;
  server.close();
  try { await db.close(); } catch (err) { console.error(err); }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
