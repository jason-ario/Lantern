// PERSISTENCE LAYER
// The only module that knows how data is stored. Today it's a JSON file with
// atomic writes; in production each table becomes a real database table (or a
// separate service, e.g. saves → cloud-save service). Callers use the small
// repository API below and never touch the file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TABLES = [
  'users', 'authSessions', 'developers', 'games', 'gameVersions', 'achievements',
  'ownerships', 'wishlists', 'saves', 'userAchievements', 'playSessions', 'orders',
];

let file = null;
let data = null;
let writeTimer = null;

export function open(dbFile, seedFn) {
  file = dbFile;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const t of TABLES) data[t] ??= [];
  } else {
    reset(seedFn);
  }
}

export function reset(seedFn) {
  data = Object.fromEntries(TABLES.map((t) => [t, []]));
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

// Debounced atomic write: write temp file then rename, so a crash never leaves
// a half-written database.
function schedule() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 50);
}

export function flush() {
  clearTimeout(writeTimer);
  if (!file || !data) return;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}
