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

// Make sure `localFile` exists, fetching it from the bucket (`key`) if needed.
export async function ensureLocal(localFile, key) {
  if (fs.existsSync(localFile) || !storageEnabled()) return fs.existsSync(localFile);
  const buf = await getObject(key);
  if (!buf) return false;
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  fs.writeFileSync(localFile, buf);
  return true;
}
