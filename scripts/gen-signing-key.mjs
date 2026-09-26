// Prints a new ECDSA P-256 private key for PACKAGE_SIGNING_KEY (one line, \n-escaped,
// ready to paste into Render's environment variables). Keep it secret; keep it stable —
// players' devices pin the matching public key.
import crypto from 'node:crypto';
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }).trim().replace(/\n/g, '\\n'));
