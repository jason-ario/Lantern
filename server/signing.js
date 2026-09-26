// PACKAGE SIGNING
// Every game build gets a signed manifest: the list of files with their sha256
// hashes, signed with the platform's ECDSA P-256 key. Clients (the web offline
// cache today, the desktop app later) verify the signature and every file hash
// before running a locally stored build, so a tampered or corrupted package is
// never executed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, PACKAGE_SIGNING_KEY } from './config.js';

let privateKey = null;
let publicJwk = null;
let keyId = null;

export function initSigning() {
  if (PACKAGE_SIGNING_KEY) {
    privateKey = crypto.createPrivateKey(PACKAGE_SIGNING_KEY.replace(/\\n/g, '\n'));
  } else {
    const file = path.join(DATA_DIR, 'keys', 'package-signing.pem');
    if (fs.existsSync(file)) privateKey = crypto.createPrivateKey(fs.readFileSync(file, 'utf8'));
    else {
      const { privateKey: k } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, k.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      privateKey = k;
    }
  }
  const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
  if (jwk.crv !== 'P-256') throw new Error('PACKAGE_SIGNING_KEY must be an ECDSA P-256 key');
  publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  keyId = crypto.createHash('sha256').update(`${jwk.x}.${jwk.y}`).digest('hex').slice(0, 16);
}

export const currentKeyId = () => keyId;
export const publicKey = () => ({ keyId, alg: 'ES256', jwk: publicJwk });

// Deterministic JSON (sorted keys). The browser implements the same function.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export function signBuild({ gameId, version, entry, buildHash, files }) {
  const manifest = {
    v: 1, gameId, version, entry, buildHash, keyId,
    files: files.map(({ path: p, size, sha256 }) => ({ path: p, size, sha256 })),
  };
  const signature = crypto.sign('sha256', Buffer.from(canonical(manifest)), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { manifest, signature };
}

export function verifyBuild(manifest, signature) {
  const pub = crypto.createPublicKey(privateKey);
  return crypto.verify('sha256', Buffer.from(canonical(manifest)), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
}
