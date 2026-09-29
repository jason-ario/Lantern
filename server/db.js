// PERSISTENCE LAYER
// The only module that knows how data is stored. Callers use the small, synchronous
// repository API below (all/find/filter/get/insert/update/remove) against an
// in-memory copy of every table; writes are flushed in the background to:
//   • a JSON file (default; atomic temp-file + rename), or
//   • PostgreSQL when DATABASE_URL is set. Each row is stored as JSONB in one
//     table keyed by (table, row key). Only rows that changed since the last flush
//     are written, so it stays cheap as the data grows.
// On first start against an empty Postgres database, an existing JSON file (the
// local data/db.json) is imported so nothing is lost when switching.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TABLES = [
  'users', 'authSessions', 'developers', 'games', 'gameVersions', 'achievements',
  'ownerships', 'wishlists', 'saves', 'userAchievements', 'playSessions', 'orders',
  'reviews', 'settings', 'reports', 'tokens', 'earnings', 'outbox',
];

// Stable key per row (tables without an `id` use their natural composite key).
const KEY = {
  wishlists: (r) => `${r.userId}|${r.gameId}`,
  saves: (r) => `${r.userId}|${r.gameId}|${r.key}`,
  userAchievements: (r) => `${r.userId}|${r.achievementId}`,
  settings: (r) => r.key,
};
const keyOf = (table, r) => (KEY[table] ? KEY[table](r) : r.id);

let file = null;
let data = null;
let writeTimer = null;
let rev = 0; // bumps on every write; lets derived data (rankings) know when to recompute
export const revision = () => rev;

// ---------------- storage adapters ----------------
let pg = null;             // pg.Pool when using Postgres
const persisted = new Map(); // `${table}\u0000${key}` -> JSON last written to Postgres
let flushing = Promise.resolve();
export const backend = () => (pg ? 'postgres' : 'file');

async function pgOpen(url) {
  const { default: pgLib } = await import('pg');
  const ssl = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false };
  pg = new pgLib.Pool({ connectionString: url, ssl, max: 4 });
  await pg.query(`CREATE TABLE IF NOT EXISTS vg_rows (
    tbl text NOT NULL, k text NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tbl, k))`);
  const { rows } = await pg.query('SELECT tbl, k, data FROM vg_rows');
  if (!rows.length) return null;
  const loaded = Object.fromEntries(TABLES.map((t) => [t, []]));
  for (const r of rows) {
    (loaded[r.tbl] ??= []).push(r.data);
    persisted.set(`${r.tbl}\u0000${r.k}`, JSON.stringify(r.data));
  }
  return loaded;
}

async function pgFlush() {
  const seen = new Set();
  const upserts = [];
  for (const t of TABLES) {
    for (const row of data[t] ?? []) {
      const k = keyOf(t, row);
      if (k === undefined || k === null) continue;
      const id = `${t}\u0000${k}`;
      seen.add(id);
      const json = JSON.stringify(row);
      if (persisted.get(id) !== json) upserts.push([t, String(k), json, id]);
    }
  }
  const deletes = [...persisted.keys()].filter((id) => !seen.has(id));
  if (!upserts.length && !deletes.length) return;
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const vals = chunk.map((_, j) => `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}::jsonb, now())`).join(',');
      await client.query(`INSERT INTO vg_rows (tbl, k, data, updated_at) VALUES ${vals}
        ON CONFLICT (tbl, k) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, chunk.flatMap(([t, k, j]) => [t, k, j]));
    }
    for (const id of deletes) {
      const [t, k] = id.split('\u0000');
      await client.query('DELETE FROM vg_rows WHERE tbl = $1 AND k = $2', [t, k]);
    }
    await client.query('COMMIT');
    for (const [, , json, id] of upserts) persisted.set(id, json);
    for (const id of deletes) persisted.delete(id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------- open / reset ----------------
// open() is async because Postgres is; with the JSON file everything happens
// synchronously before the returned promise, so older callers still work.
export async function open(dbFile, seedFn, { databaseUrl = '' } = {}) {
  file = dbFile;
  if (databaseUrl) {
    const loaded = await pgOpen(databaseUrl);
    if (loaded) { data = loaded; normalise(); return; }
    if (dbFile && fs.existsSync(dbFile)) {
      console.log(`  importing ${dbFile} into Postgres…`);
      data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      normalise();
      await flushNow();
      return;
    }
    reset(seedFn);
    await flushNow();
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    normalise();
  } else {
    reset(seedFn);
  }
}
function normalise() { for (const t of TABLES) data[t] ??= []; }

export function reset(seedFn) {
  rev++;
  const keep = data?.settings ?? []; // site settings survive a site reset
  data = Object.fromEntries(TABLES.map((t) => [t, []]));
  data.settings = keep;
  seedFn?.();
  flush();
}

export const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
export const now = () => new Date().toISOString();

export function all(table) { return data[table]; }
export function find(table, pred) { return data[table].find(pred) ?? null; }
export function filter(table, pred) { return data[table].filter(pred); }
export function get(table, rowId) { return data[table].find((r) => r.id === rowId) ?? null; }

export function insert(table, row) {
  data[table].push(row);
  schedule();
  return row;
}

export function update(row, patch) {
  Object.assign(row, patch);
  schedule();
  return row;
}

export function remove(table, pred) {
  const before = data[table].length;
  data[table] = data[table].filter((r) => !pred(r));
  if (data[table].length !== before) schedule();
  return before - data[table].length;
}

// A full copy of every table (used by backups).
export const snapshot = () => JSON.parse(JSON.stringify(data));

// Debounced writes.
function schedule() {
  rev++;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 50);
}

export function flush() {
  clearTimeout(writeTimer);
  if (!data) return flushing;
  if (pg) {
    flushing = flushing.then(pgFlush).catch((err) => { console.error('[db] Postgres write failed, will retry:', err.message); setTimeout(flush, 2000); });
    return flushing;
  }
  if (!file) return flushing;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
  return flushing;
}
// Wait until everything written so far is durable (shutdown, tests, imports).
export async function flushNow() { await flush(); await flushing; }
export async function close() { await flushNow(); if (pg) { await pg.end(); pg = null; } }
