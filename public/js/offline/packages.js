// LOCAL PACKAGE CACHE — offline play and delta updates.
// This is the same job the desktop client will do, implemented with browser APIs:
//  • Files are stored content-addressed (by sha256) in Cache Storage, so a new
//    version only downloads files whose hash changed (delta updates for free).
//  • Every build comes with a manifest signed by the platform (ECDSA P-256). We
//    verify the signature and every file hash before storing — and again before
//    running — so a corrupted or tampered package never executes.
import { api } from '../api.js';

const CACHE = 'vibe-packages-v1';
const INDEX_KEY = 'vibe.installs.v1';
const KEY_PIN = 'vibe.packageKey.v1';
const fileUrl = (sha) => `/__vibe/blob/${sha}`;

const MIME = {
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  wasm: 'application/wasm', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', txt: 'text/plain', glb: 'model/gltf-binary',
};
export const mimeFor = (p) => MIME[p.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

export const supported = () => typeof caches !== 'undefined' && !!crypto?.subtle;

// ---------- index (small, synchronous reads for the UI) ----------
function readIndex() { try { return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '{}'); } catch { return {}; } }
function writeIndex(ix) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch { /* storage full/blocked */ } }
export const installed = (gameId) => readIndex()[gameId] ?? null;
export const allInstalled = () => readIndex();

// 'none' | 'ready' | 'update' (installed build differs from the store's current version)
export function status(game) {
  const i = installed(game.id);
  if (!i) return 'none';
  if (game.version && i.version !== game.version.version) return 'update';
  return 'ready';
}

// ---------- crypto ----------
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (buf) => hex(await crypto.subtle.digest('SHA-256', buf));
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

// The platform's public key is pinned on first use; a changed key is refused.
async function platformKey(expectedKeyId) {
  let pinned = null;
  try { pinned = JSON.parse(localStorage.getItem(KEY_PIN) ?? 'null'); } catch { /* ignore */ }
  if (!pinned || pinned.keyId !== expectedKeyId) {
    const k = await api.packageKey();
    if (pinned && pinned.keyId !== k.keyId) throw new Error('The store\'s package signing key changed, so new builds are not trusted automatically. If you expected this, go to Profile → Remove all downloads, then download again.');
    pinned = k;
    try { localStorage.setItem(KEY_PIN, JSON.stringify(k)); } catch { /* ignore */ }
  }
  if (pinned.keyId !== expectedKeyId) throw new Error('Build is signed with an unknown key');
  return crypto.subtle.importKey('jwk', { ...pinned.jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

export async function verifySignature(manifest, signature) {
  const key = await platformKey(manifest.keyId);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url(signature), new TextEncoder().encode(canonical(manifest)));
}

// ---------- install / update ----------
const inFlight = new Map();
export function install(gameId, { onProgress } = {}) {
  if (inFlight.has(gameId)) return inFlight.get(gameId);
  const p = doInstall(gameId, onProgress).finally(() => inFlight.delete(gameId));
  inFlight.set(gameId, p);
  return p;
}
export const installing = (gameId) => inFlight.has(gameId);

async function doInstall(gameId, onProgress = () => {}) {
  if (!supported()) throw new Error('This browser cannot store games for offline play');
  const build = await api.build(gameId);
  const { manifest, signature } = build;
  if (manifest.gameId !== gameId) throw new Error('Build manifest does not match this game');
  if (!(await verifySignature(manifest, signature))) throw new Error('Signature check failed — build rejected');

  const cache = await caches.open(CACHE);
  const total = manifest.files.reduce((t, f) => t + f.size, 0);
  let done = 0, downloaded = 0, reused = 0;
  onProgress({ done, total, phase: 'verifying' });
  for (const f of manifest.files) {
    if (await cache.match(fileUrl(f.sha256))) { reused++; done += f.size; onProgress({ done, total, phase: 'downloading' }); continue; }
    const res = await fetch(build.baseUrl + f.path.split('/').map(encodeURIComponent).join('/'), { credentials: 'omit' });
    if (!res.ok) throw new Error(`Download failed: ${f.path} (${res.status})`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== f.size || (await sha256(buf)) !== f.sha256) throw new Error(`Integrity check failed for ${f.path}`);
    await cache.put(fileUrl(f.sha256), new Response(buf, { headers: { 'Content-Type': mimeFor(f.path) } }));
    downloaded += buf.byteLength; done += f.size;
    onProgress({ done, total, phase: 'downloading' });
  }
  const ix = readIndex();
  const previous = ix[gameId]?.version ?? null;
  ix[gameId] = {
    version: manifest.version, buildHash: manifest.buildHash, entry: manifest.entry, files: manifest.files,
    manifest, signature, notes: build.notes ?? '', installedAt: new Date().toISOString(), sizeBytes: total,
  };
  writeIndex(ix);
  await collectGarbage();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  onProgress({ done: total, total, phase: 'done' });
  return { version: manifest.version, previous, downloadedBytes: downloaded, reusedFiles: reused, totalBytes: total, fileCount: manifest.files.length };
}

export async function remove(gameId) {
  const ix = readIndex();
  delete ix[gameId];
  writeIndex(ix);
  await collectGarbage();
}

// Delete stored files no installed build references any more.
async function collectGarbage() {
  const keep = new Set(Object.values(readIndex()).flatMap((i) => i.files.map((f) => fileUrl(f.sha256))));
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
}

export async function clearAll() {
  writeIndex({});
  try { localStorage.removeItem(KEY_PIN); } catch { /* ignore */ }
  await caches.delete(CACHE);
}

// Load an installed build for the runtime, re-verifying signature and hashes.
export async function loadFiles(gameId) {
  const i = installed(gameId);
  if (!i) throw new Error('Not installed');
  if (!(await verifySignature(i.manifest, i.signature))) throw new Error('Signature check failed');
  const cache = await caches.open(CACHE);
  const files = [];
  for (const f of i.files) {
    const hit = await cache.match(fileUrl(f.sha256));
    if (!hit) throw new Error(`Missing file ${f.path} — reinstall the game`);
    const buf = await hit.arrayBuffer();
    if ((await sha256(buf)) !== f.sha256) throw new Error(`Corrupted file ${f.path} — reinstall the game`);
    files.push({ path: f.path, type: mimeFor(f.path), buf });
  }
  return { version: i.version, buildHash: i.buildHash, entry: i.entry, files, sizeBytes: i.sizeBytes };
}

export async function usage() {
  const ix = readIndex();
  return { games: Object.keys(ix).length, bytes: Object.values(ix).reduce((t, i) => t + i.sizeBytes, 0) };
}
