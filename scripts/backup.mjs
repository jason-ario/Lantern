// Database backup: writes a gzipped JSON snapshot of every table.
//   node scripts/backup.mjs              → backups/vibe-games-<timestamp>.json.gz
// Uses the same settings as the server (DATABASE_URL or DATA_DIR/db.json). When
// object storage is configured (S3_BUCKET …) the snapshot is also uploaded to
// backups/<file> in the bucket, so it survives losing the server. Run it daily
// (render.yaml defines a cron job) and keep your provider's own backups on too.
//
// Restore: stop the server, then `node scripts/backup.mjs --restore <file>` imports a
// snapshot into the configured database (it replaces everything).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as db from '../server/db.js';
import { DB_FILE, DATABASE_URL } from '../server/config.js';
import { putObject, storageEnabled, getObject } from '../server/storage.js';

const args = process.argv.slice(2);
if (args[0] === '--restore') {
  const file = args[1] ?? '';
  const raw = fs.existsSync(file) ? fs.readFileSync(file) : await getObject(`backups/${path.basename(file)}`);
  if (!raw) { console.error(`Backup not found: ${file}`); process.exit(1); }
  const snap = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
  await db.open(DB_FILE, null, { databaseUrl: DATABASE_URL });
  db.reset(() => { db.remove('settings', () => true); for (const [t, rows] of Object.entries(snap.tables)) for (const r of rows) db.insert(t, r); });
  await db.close();
  console.log(`Restored ${Object.values(snap.tables).reduce((n, r) => n + r.length, 0)} rows from ${snap.createdAt}`);
  process.exit(0);
}

await db.open(DB_FILE, null, { databaseUrl: DATABASE_URL });
const tables = db.snapshot();
const createdAt = new Date().toISOString();
const buf = zlib.gzipSync(JSON.stringify({ createdAt, backend: db.backend(), tables }));
const name = `vibe-games-${createdAt.replace(/[:.]/g, '-')}.json.gz`;
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync(path.join('backups', name), buf);
console.log(`Wrote backups/${name} (${(buf.length / 1024).toFixed(1)} KB, ${Object.values(tables).reduce((n, r) => n + r.length, 0)} rows)`);
if (storageEnabled()) { await putObject(`backups/${name}`, buf, 'application/gzip'); console.log(`Uploaded to object storage: backups/${name}`); }
await db.close();
