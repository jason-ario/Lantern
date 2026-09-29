// Sample-content toggle + player reviews. Starts its own server with a creator
// password so "admins only" can be told apart from "everyone".
//   node scripts/test-content.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-content-'));
const PORT = 5321, BASE = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, ADMIN_PASSWORD: 'letmein', DEMO_CONTENT: 'everyone' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 50 && !log.includes('running'); i++) await new Promise((r) => setTimeout(r, 100));

const b = await chromium.launch();
async function player() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const api = (m, p, d) => page.request.fetch(BASE + p, { method: m, headers: { 'X-Vibe-Client': 'platform', 'Content-Type': 'application/json' }, data: d, failOnStatusCode: false }).then(async (r) => ({ status: r.status(), body: await r.json().catch(() => null) }));
  return { ctx, page, api, errors };
}
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nameBuf = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

try {
  const admin = await player();
  const visitor = await player();

  // ---------- toggle ----------
  let cat = (await visitor.api('GET', '/api/catalog')).body;
  check('Everyone: sample games are in the catalog', cat.games.some((g) => g.id === 'voidrunner' && g.sample));
  const sampleRevs = (await visitor.api('GET', '/api/games/voidrunner/reviews')).body;
  check('Sample games come with sample written reviews', sampleRevs.reviews.length >= 2 && sampleRevs.reviews.every((r) => r.sample));

  check('Non-admins cannot change the setting', (await visitor.api('PUT', '/api/admin/settings', { demoContent: 'off' })).status === 403);
  await admin.api('POST', '/api/admin/login', { password: 'letmein' });
  check('Admin switches sample content to "admins only"', (await admin.api('PUT', '/api/admin/settings', { demoContent: 'admins' })).body?.demoContent === 'admins');
  cat = (await visitor.api('GET', '/api/catalog')).body;
  check('Admins only: players see no sample games', !cat.games.some((g) => g.sample), `${cat.games.length} games`);
  check('Admins only: sample game pages 404 for players', (await visitor.api('GET', '/api/games/voidrunner')).status === 404);
  check('Admins only: sample shelves are empty for players', Object.values(cat.shelves).every((ids) => ids.length === 0));
  const adminCat = (await admin.api('GET', '/api/catalog')).body;
  check('Admins only: admins still see sample games', adminCat.games.some((g) => g.id === 'voidrunner'));
  await admin.api('PUT', '/api/admin/settings', { demoContent: 'off' });
  check('Off: admins no longer see sample games either', !(await admin.api('GET', '/api/catalog')).body.games.some((g) => g.sample));
  check('Setting is reported to clients', (await visitor.api('GET', '/api/state')).body.site?.demoContent === 'off');

  await visitor.page.goto(`${BASE}/store`); await visitor.page.waitForSelector('.vg-hero');
  check('Empty store shows the launch state', (await visitor.page.textContent('.vg-hero')).includes('being stocked'));

  // ---------- a real game + real reviews ----------
  const pkg = zip({ 'manifest.json': JSON.stringify({ name: 'Real Game', version: '1.0.0', entry: 'index.html', sdk: '1' }), 'index.html': '<!doctype html><script src="/sdk/v1/platform-sdk.js"></script><p>hi</p>' });
  const pub = await admin.api('POST', '/api/publish', { title: 'Real Game', priceCents: 0, tags: ['Puzzle'], builtWith: ['claude-code'], package: { filename: 'real.zip', dataBase64: pkg.toString('base64') } });
  check('Admin publishes a real game', pub.status === 200, pub.body?.error);
  const id = pub.body.gameId;
  cat = (await visitor.api('GET', '/api/catalog')).body;
  check('Real game shows while sample content is off', cat.games.length === 1 && cat.games[0].id === id && cat.games[0].rating === null);

  let r = (await visitor.api('GET', `/api/games/${id}/reviews`)).body;
  check('Guests cannot review', r.eligibility.reason === 'guest');
  const reviewer = await player();
  await reviewer.api('POST', '/api/auth/signup', { email: `r${Date.now()}@example.com`, password: 'password123', displayName: 'Reviewer' });
  check('Signed-in non-owners cannot review', (await reviewer.api('PUT', `/api/games/${id}/review`, { up: true, text: 'x' })).status === 403);
  await reviewer.api('POST', `/api/games/${id}/purchase`, { paymentMethod: 'demo-wallet' });
  const saved = await reviewer.api('PUT', `/api/games/${id}/review`, { up: true, text: 'Loved it.' });
  check('Signed-in owner posts a review', saved.status === 200 && saved.body.rating.pct === 100 && saved.body.rating.count === 1);
  const edited = await reviewer.api('PUT', `/api/games/${id}/review`, { up: false, text: 'Changed my mind.' });
  check('Editing replaces the review (one per player)', edited.body.rating.count === 1 && edited.body.rating.pct === 0);
  check('The developer cannot review their own game', (await admin.api('GET', `/api/games/${id}/reviews`)).body.eligibility.reason === 'developer');
  check('Catalog rating comes from real reviews', (await visitor.api('GET', '/api/catalog')).body.games[0].rating?.count === 1);

  await reviewer.page.goto(`${BASE}/app/${id}`); await reviewer.page.waitForSelector('.review.mine');
  check('Game page shows the player’s review', (await reviewer.page.textContent('#reviews')).includes('Changed my mind.'));

  const rid = (await visitor.api('GET', `/api/games/${id}/reviews`)).body.reviews[0].id;
  check('Players cannot moderate', (await visitor.api('DELETE', `/api/reviews/${rid}`)).status === 403);
  check('Admins can remove a review', (await admin.api('DELETE', `/api/reviews/${rid}`)).status === 200 && (await visitor.api('GET', `/api/games/${id}/reviews`)).body.total === 0);

  await admin.api('PUT', '/api/admin/settings', { demoContent: 'everyone' });
  check('Everyone again: sample games return alongside the real one', (await visitor.api('GET', '/api/catalog')).body.games.length > 1);
  check('No page errors', ![admin, visitor, reviewer].some((p) => p.errors.length), [admin, visitor, reviewer].flatMap((p) => p.errors).join('; '));
} catch (e) {
  console.error(e); results.push(false);
} finally {
  await b.close();
  await new Promise((r) => { child.once('exit', r); child.kill(); });
  fs.rmSync(tmp, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
