// GAME PACKAGES
// A game build is an immutable, versioned directory:
//   packages/{gameId}/{version}/manifest.json, index.html, game.js, assets/...
// served at /games/{gameId}/{version}/...
// Every file is hashed at ingest time and the list is stored on the GameVersion.
// That file list is what a future desktop client uses to cache a build locally,
// verify it, launch offline and apply delta updates (download only changed hashes).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const PACKAGES_DIR = path.resolve('packages');
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 2000;
const SAFE_PATH = /^[A-Za-z0-9._\-/ ]+$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export function packageDir(gameId, version) {
  return path.join(PACKAGES_DIR, gameId, version);
}

export function hashDir(dir) {
  const files = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        const buf = fs.readFileSync(p);
        files.push({
          path: path.relative(dir, p).split(path.sep).join('/'),
          size: buf.length,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(dir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const sizeBytes = files.reduce((s, f) => s + f.size, 0);
  // Build hash = hash of the file list; identifies a build independent of version label.
  const buildHash = crypto.createHash('sha256').update(files.map((f) => `${f.path}:${f.sha256}`).join('\n')).digest('hex');
  return { files, sizeBytes, buildHash };
}

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest.json is missing or not valid JSON'];
  if (typeof m.name !== 'string' || !m.name.trim()) errors.push('manifest.name is required');
  if (!VERSION_RE.test(m.version ?? '')) errors.push('manifest.version must look like 1.0.0');
  if (typeof m.entry !== 'string' || !SAFE_PATH.test(m.entry) || m.entry.includes('..')) errors.push('manifest.entry must be a relative path such as index.html');
  if (String(m.sdk ?? '') !== '1') errors.push('manifest.sdk must be "1" (Lantern SDK v1)');
  if (m.achievements && !Array.isArray(m.achievements)) errors.push('manifest.achievements must be an array');
  for (const a of m.achievements ?? []) {
    if (!/^[a-z0-9_]{1,40}$/.test(a.id ?? '')) errors.push(`achievement id "${a.id}" must be lowercase snake_case`);
  }
  return errors;
}

// ---- Minimal ZIP reader (stored + deflate), no dependencies. ----
export function readZip(buf) {
  if (buf.length > MAX_PACKAGE_BYTES) throw new Error('Package exceeds 50 MB limit');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count > MAX_FILES) throw new Error('Too many files in package');
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_PACKAGE_BYTES });
    else throw new Error(`Unsupported compression in ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

// Normalise zip entries: strip a single top-level folder, reject unsafe paths.
function normaliseEntries(entries) {
  const clean = entries.filter((e) => !e.name.startsWith('__MACOSX/') && !e.name.endsWith('.DS_Store'));
  const tops = new Set(clean.map((e) => e.name.split('/')[0]));
  const hasRootManifest = clean.some((e) => e.name === 'manifest.json' || e.name === 'index.html');
  const strip = !hasRootManifest && tops.size === 1 && clean.every((e) => e.name.includes('/'));
  return clean.map((e) => {
    const name = strip ? e.name.split('/').slice(1).join('/') : e.name;
    if (!SAFE_PATH.test(name) || name.split('/').some((s) => s === '..' || s === '') || name.startsWith('/')) {
      throw new Error(`Unsafe file path in package: ${e.name}`);
    }
    return { name, data: e.data };
  });
}

// Inspect a package (zip or single html) without installing it.
export function inspectPackage(filename, buf) {
  let entries;
  if (/\.html?$/i.test(filename)) {
    entries = [{ name: 'index.html', data: buf }];
  } else {
    entries = normaliseEntries(readZip(buf));
  }
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  let manifest = null;
  if (manifestEntry) {
    try { manifest = JSON.parse(manifestEntry.data.toString('utf8')); } catch { manifest = null; }
  }
  const warnings = [];
  if (!manifest) {
    // Allow a bare HTML game: synthesise a manifest.
    if (entries.some((e) => e.name === 'index.html')) {
      warnings.push('No manifest.json found — a default manifest was generated.');
      manifest = { name: 'Untitled', version: '1.0.0', entry: 'index.html', sdk: '1', achievements: [] };
    }
  }
  const errors = validateManifest(manifest);
  if (manifest && !entries.some((e) => e.name === manifest.entry)) errors.push(`Entry file ${manifest.entry} not found in package`);
  const html = entries.find((e) => e.name === manifest?.entry)?.data.toString('utf8') ?? '';
  const usesSdk = /platform-sdk\.js/.test(html);
  if (!usesSdk) warnings.push('Entry does not load /sdk/v1/platform-sdk.js — saves and achievements will be unavailable.');
  const sizeBytes = entries.reduce((s, e) => s + e.data.length, 0);
  return { ok: errors.length === 0, errors, warnings, manifest, files: entries.map((e) => ({ path: e.name, size: e.data.length })), sizeBytes, usesSdk, entries };
}

export function installPackage(gameId, version, entries, manifest) {
  const dir = packageDir(gameId, version);
  if (fs.existsSync(dir)) throw new Error(`Version ${version} already exists — versions are immutable, bump the version`);
  for (const e of entries) {
    const target = path.join(dir, e.name);
    if (!target.startsWith(dir + path.sep)) throw new Error('Path traversal rejected');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
  }
  // Always store the effective manifest alongside the build.
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, id: gameId, version }, null, 2));
  return hashDir(dir);
}

export function readManifest(gameId, version) {
  return JSON.parse(fs.readFileSync(path.join(packageDir(gameId, version), 'manifest.json'), 'utf8'));
}
