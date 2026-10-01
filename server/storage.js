// OBJECT STORAGE for creator uploads (game packages, store media) and backups.
// Works with any S3-compatible service: Cloudflare R2, AWS S3, Backblaze B2…
// When S3_BUCKET is not set, everything stays on the local disk (DATA_DIR) as before.
//
// Uploads are written to local disk first (the server serves from there) and
// copied to the bucket. A fresh server with an empty disk (new deploy, lost disk)
// pulls files back from the bucket on first request.
//
// No SDK: requests are signed with AWS Signature V4 using node:crypto.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } from './config.js';

export const storageEnabled = () => !!(S3_BUCKET && S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const encKey = (key) => key.split('/').map((s) => encodeURIComponent(s)).join('/');

async function s3(method, key, body = null, contentType = '') {
  const url = new URL(`${S3_ENDPOINT.replace(/\/+$/, '')}/${S3_BUCKET}/${encKey(key)}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body ?? '');
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${S3_REGION}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${S3_SECRET_ACCESS_KEY}`, day), S3_REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  const { host, ...send } = headers;
  return fetch(url, { method, headers: { ...send, Authorization: auth }, body: body ?? undefined });
}

export async function putObject(key, buf, contentType = 'application/octet-stream') {
  if (!storageEnabled()) return false;
  const res = await s3('PUT', key, buf, contentType);
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}) for ${key}`);
  return true;
}

export async function getObject(key) {
  if (!storageEnabled()) return null;
  const res = await s3('GET', key);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Storage download failed (${res.status}) for ${key}`);
  return Buffer.from(await res.arrayBuffer());
}

// Upload every file under a local directory, keyed by `${prefix}/${relative path}`.
export async function putDir(localDir, prefix, { skip } = {}) {
  if (!storageEnabled()) return 0;
  let n = 0;
  const walk = async (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.startsWith('.') || skip?.(p)) continue;
      else { await putObject(`${prefix}/${path.relative(localDir, p).split(path.sep).join('/')}`, fs.readFileSync(p)); n++; }
    }
  };
  await walk(localDir);
  return n;
}

// Upload one local file (e.g. a store-page trailer).
export async function putFile(localFile, key, contentType) {
  if (!storageEnabled()) return false;
  return putObject(key, fs.readFileSync(localFile), contentType);
}

export async function hasObject(key) {
  if (!storageEnabled()) return false;
  const res = await s3('HEAD', key);
  if (res.status === 404 || res.status === 403) return false;
  if (!res.ok) throw new Error(`Storage check failed (${res.status}) for ${key}`);
  return true;
}

// Make sure `localFile` exists, fetching it from the bucket (`key`) if needed.
// The download streams to disk (a 200 MB trailer never sits in memory), and
// simultaneous requests for the same missing file share one download, e.g. the
// several Range requests a browser makes when a video starts.
const restoring = new Map();
export async function ensureLocal(localFile, key) {
  if (fs.existsSync(localFile) || !storageEnabled()) return fs.existsSync(localFile);
  if (restoring.has(localFile)) return restoring.get(localFile);
  const job = (async () => {
    const res = await s3('GET', key);
    if (res.status === 404 || res.status === 403) { await res.body?.cancel(); return false; }
    if (!res.ok || !res.body) throw new Error(`Storage download failed (${res.status}) for ${key}`);
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    const part = `${localFile}.${process.pid}.${Date.now()}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
      fs.renameSync(part, localFile);
    } catch (err) { fs.rmSync(part, { force: true }); throw err; }
    return true;
  })().finally(() => restoring.delete(localFile));
  restoring.set(localFile, job);
  return job;
}

// Upload every local file under `localDir` that the bucket doesn't have yet.
// Run at startup, so anything saved while storage was off (or while an upload to
// it failed) still ends up backed up. Returns { checked, uploaded, failed }.
export async function backfillDir(localDir, prefix, { concurrency = 6 } = {}) {
  const out = { checked: 0, uploaded: 0, failed: 0 };
  if (!storageEnabled() || !fs.existsSync(localDir)) return out;
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!e.name.startsWith('.') && !e.name.endsWith('.part')) files.push(p);
    }
  };
  walk(localDir);
  let i = 0;
  const worker = async () => {
    while (i < files.length) {
      const file = files[i++];
      const key = `${prefix}/${path.relative(localDir, file).split(path.sep).join('/')}`;
      out.checked++;
      try {
        if (await hasObject(key)) continue;
        await putObject(key, fs.readFileSync(file));
        out.uploaded++;
      } catch { out.failed++; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
