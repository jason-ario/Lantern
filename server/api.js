// PLATFORM SERVICES (REST API)
// Handlers are grouped by the service they'd become in production:
// identity, catalog, commerce, library/entitlements, runtime sessions,
// cloud saves, achievements, publishing. All authorization lives here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as db from './db.js';
import { seed, seedDemoUser, createVersion, DEFAULT_USER_ID } from './seed.js';
import { inspectPackage, installPackage, PUBLISHED_PACKAGES_DIR } from './packages.js';
import { art, paletteFromSeed } from './art.js';
import { USER_MEDIA_DIR, ADMIN_PASSWORD, ADMIN_OPEN, ACCOUNT_MODE } from './config.js';

export { USER_MEDIA_DIR };
const MAX_SAVE_BYTES = 256 * 1024;
const MAX_SAVE_KEYS = 64;
const SAVE_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ---------------- rate limiting (in-memory, per IP) ----------------
const buckets = new Map();
function limit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) { buckets.set(key, { start: now, n: 1 }); return; }
  if (++b.n > max) fail(429, 'Too many requests — please wait a few minutes');
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.start > 3600e3) buckets.delete(k); }, 600e3).unref();

// ---------------- identity ----------------
// Guest accounts: the first visit from a browser creates a guest user. The
// session token lives in an HttpOnly, SameSite=Strict cookie scoped to /api, so
// neither platform JS nor game code can read it. (Real sign-in comes later.)
const ADJ = ['Amber', 'Quiet', 'Lucky', 'Velvet', 'Ember', 'Misty', 'Brave', 'Hollow', 'Silver', 'Crimson', 'Mossy', 'Starlit', 'Wandering', 'Sleepy', 'Clever', 'Midnight'];
const NOUN = ['Moth', 'Heron', 'Fox', 'Lantern', 'Otter', 'Raven', 'Comet', 'Wisp', 'Badger', 'Kestrel', 'Sparrow', 'Tide', 'Pine', 'Owl', 'Cat', 'Ember'];
function createGuest() {
  const n = crypto.randomInt(ADJ.length * NOUN.length);
  return db.insert('users', {
    id: db.id('usr'), username: `guest-${crypto.randomBytes(3).toString('hex')}`,
    displayName: `${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length)]}`,
    avatarHue: crypto.randomInt(360), memberSince: db.now(), guest: true,
  });
}

export function authenticate(req, res, ctx) {
  const sid = /(?:^|;\s*)lantern_sid=([a-f0-9]{48})/.exec(req.headers.cookie ?? '')?.[1];
  const sess = sid && db.find('authSessions', (s) => s.id === sid);
  const existing = sess && db.get('users', sess.userId);
  if (existing) return { user: existing, session: sess };
  let user;
  if (ACCOUNT_MODE === 'single') {
    user = db.get('users', DEFAULT_USER_ID);
    if (!user) { seedDemoUser(); user = db.get('users', DEFAULT_USER_ID); }
  } else {
    limit(`guest:${ctx.ip}`, 30, 10 * 60e3);
    user = createGuest();
  }
  const newSid = crypto.randomBytes(24).toString('hex');
  const session = db.insert('authSessions', { id: newSid, userId: user.id, admin: false, createdAt: db.now() });
  res.setHeader('Set-Cookie', `lantern_sid=${newSid}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000${ctx.secure ? '; Secure' : ''}`);
  return { user, session };
}

const isAdmin = (session) => ADMIN_OPEN || !!session?.admin;
function requireAdmin(session) {
  if (isAdmin(session)) return;
  fail(403, ADMIN_PASSWORD ? 'Creator access required — enter the creator password on the Publish page' : 'Publishing is disabled on this server (no ADMIN_PASSWORD configured)');
}

// ---------------- helpers ----------------
const owns = (userId, gameId) => !!db.find('ownerships', (o) => o.userId === userId && o.gameId === gameId);
const scopedPlayerId = (userId, gameId) => `p_${crypto.createHash('sha256').update(`${userId}:${gameId}:lantern-pepper`).digest('hex').slice(0, 16)}`;

function requireGame(id) {
  return db.get('games', id) ?? fail(404, 'Game not found');
}

function canUseGame(user, game) {
  return owns(user.id, game.id) || !!game.demo;
}

function publicGame(g) {
  const dev = db.get('developers', g.developerId);
  const ver = g.currentVersionId ? db.get('gameVersions', g.currentVersionId) : null;
  return {
    id: g.id, title: g.title, developer: dev ? { id: dev.id, name: dev.name, location: dev.location } : null,
    priceCents: g.priceCents, tags: g.tags, features: g.features, shortDescription: g.shortDescription,
    description: g.description, releaseDate: g.releaseDate, status: g.status, rating: g.rating, stats: g.stats,
    featured: g.featured, demo: g.demo, logo: g.logo, media: g.media, blurb: g.blurb, source: g.source,
    achievementCount: db.filter('achievements', (a) => a.gameId === g.id).length,
    version: ver ? {
      version: ver.version, sizeBytes: ver.sizeBytes, fileCount: ver.files.length, buildHash: ver.buildHash,
      sdk: ver.sdk, runtime: ver.runtime, input: ver.input, releasedAt: ver.releasedAt, placeholder: ver.placeholder,
    } : null,
  };
}

function playStats(userId, gameId) {
  const sessions = db.filter('playSessions', (s) => s.userId === userId && s.gameId === gameId);
  const seconds = sessions.reduce((t, s) => t + (s.seconds || 0), 0);
  const last = sessions.reduce((m, s) => (!m || s.startedAt > m ? s.startedAt : m), null);
  const total = db.filter('achievements', (a) => a.gameId === gameId).length;
  const unlocked = db.filter('userAchievements', (u) => u.userId === userId && u.gameId === gameId).length;
  return { playtimeSeconds: seconds, lastPlayedAt: last, sessions: sessions.length, achievements: { unlocked, total } };
}

function userState(user, session) {
  return {
    user: { id: user.id, username: user.username, displayName: user.displayName, avatarHue: user.avatarHue, memberSince: user.memberSince, guest: !!user.guest },
    creator: { admin: isAdmin(session), passwordRequired: !ADMIN_OPEN, enabled: ADMIN_OPEN || !!ADMIN_PASSWORD },
    owned: db.filter('ownerships', (o) => o.userId === user.id).map((o) => o.gameId),
    wishlist: db.filter('wishlists', (w) => w.userId === user.id).map((w) => w.gameId),
  };
}

// ---------------- handlers ----------------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/state', ({ user, session }) => userState(user, session));

route('GET', '/api/catalog', () => {
  const games = db.all('games').map(publicGame);
  const counts = {};
  games.forEach((g) => g.tags.forEach((t) => { counts[t] = (counts[t] ?? 0) + 1; }));
  return { games, tags: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) };
});

route('GET', '/api/games/:id', ({ user, session, params }) => {
  const g = requireGame(params.id);
  const unlocked = new Map(db.filter('userAchievements', (u) => u.userId === user.id && u.gameId === g.id).map((u) => [u.achievementId, u.unlockedAt]));
  return {
    ...publicGame(g),
    achievements: db.filter('achievements', (a) => a.gameId === g.id).map((a) => ({ id: a.key, name: a.name, description: a.description, unlockedAt: unlocked.get(a.id) ?? null })),
    versions: db.filter('gameVersions', (v) => v.gameId === g.id).map((v) => ({ version: v.version, releasedAt: v.releasedAt, sizeBytes: v.sizeBytes, notes: v.notes, buildHash: v.buildHash })),
    owned: owns(user.id, g.id),
    play: playStats(user.id, g.id),
  };
});

// ----- commerce (mocked payment) -----
route('POST', '/api/games/:id/purchase', ({ user, session, params, body }) => {
  const g = requireGame(params.id);
  if (g.status !== 'released' || !g.currentVersionId) fail(409, 'This game is not available for purchase yet');
  if (owns(user.id, g.id)) fail(409, 'You already own this game');
  if (body?.paymentMethod !== 'demo-wallet') fail(400, 'Unsupported payment method');
  const ownership = db.insert('ownerships', { id: db.id('own'), userId: user.id, gameId: g.id, source: 'purchase', pricePaidCents: g.priceCents, orderId: db.id('ord'), acquiredAt: db.now() });
  db.remove('wishlists', (w) => w.userId === user.id && w.gameId === g.id);
  db.update(g, { stats: { ...g.stats, sales: (g.stats?.sales ?? 0) + 1 } });
  return { ownership, state: userState(user, session) };
});

// ----- wishlist -----
route('PUT', '/api/wishlist/:id', ({ user, session, params }) => {
  const g = requireGame(params.id);
  if (!db.find('wishlists', (w) => w.userId === user.id && w.gameId === g.id)) db.insert('wishlists', { userId: user.id, gameId: g.id, addedAt: db.now() });
  return userState(user, session);
});
route('DELETE', '/api/wishlist/:id', ({ user, session, params }) => {
  db.remove('wishlists', (w) => w.userId === user.id && w.gameId === params.id);
  return userState(user, session);
});
route('GET', '/api/wishlist', ({ user, session }) => db.filter('wishlists', (w) => w.userId === user.id));

// ----- library -----
route('GET', '/api/library', ({ user, session }) => db.filter('ownerships', (o) => o.userId === user.id).map((o) => ({
  gameId: o.gameId, acquiredAt: o.acquiredAt, source: o.source, ...playStats(user.id, o.gameId),
})));

// ----- runtime sessions -----
route('POST', '/api/games/:id/launch', ({ user, session, params, body }) => {
  const g = requireGame(params.id);
  const mode = body?.mode === 'demo' ? 'demo' : 'full';
  const owned = owns(user.id, g.id);
  if (!g.currentVersionId) fail(409, 'No playable build available');
  if (mode === 'full' && !owned) fail(403, 'You do not own this game');
  if (mode === 'demo' && !g.demo) fail(403, 'This game has no demo');
  const ver = db.get('gameVersions', g.currentVersionId);
  // Close any dangling session for this game (e.g. tab was killed).
  db.filter('playSessions', (s) => s.userId === user.id && s.gameId === g.id && !s.endedAt).forEach((s) => db.update(s, { endedAt: s.lastHeartbeatAt }));
  const play = db.insert('playSessions', { id: db.id('ses'), userId: user.id, gameId: g.id, versionId: ver.id, mode: owned ? 'full' : mode, startedAt: db.now(), lastHeartbeatAt: db.now(), endedAt: null, seconds: 0 });
  return {
    session: { id: play.id, mode: play.mode, startedAt: play.startedAt, demoSeconds: play.mode === 'demo' ? g.demo.minutes * 60 : null },
    build: { url: `/games/${ver.packagePath}/${ver.entry}`, version: ver.version, buildHash: ver.buildHash, sizeBytes: ver.sizeBytes, fileCount: ver.files.length, sdk: ver.sdk },
    // Games only ever see a per-game pseudonymous player id — never the account id.
    player: { id: scopedPlayerId(user.id, g.id), displayName: user.displayName, avatarHue: user.avatarHue },
    game: { id: g.id, title: g.title },
  };
});

function updateSession(user, sid, activeSeconds, end) {
  const s = db.get('playSessions', sid);
  if (!s || s.userId !== user.id) fail(404, 'Session not found');
  if (s.endedAt) return { ok: true, seconds: s.seconds };
  const wall = (Date.now() - Date.parse(s.startedAt)) / 1000;
  const secs = Math.max(s.seconds, Math.min(Math.floor(Number(activeSeconds) || 0), Math.ceil(wall) + 5));
  db.update(s, { seconds: secs, lastHeartbeatAt: db.now(), ...(end ? { endedAt: db.now() } : {}) });
  return { ok: true, seconds: secs };
}
route('POST', '/api/sessions/:sid/heartbeat', ({ user, session, params, body }) => updateSession(user, params.sid, body?.activeSeconds, false));
route('POST', '/api/sessions/:sid/end', ({ user, session, params, body }) => updateSession(user, params.sid, body?.activeSeconds, true));

// ----- cloud saves -----
function saveGuard(user, gameId) {
  const g = requireGame(gameId);
  if (!canUseGame(user, g)) fail(403, 'No access to this game\'s saves');
  return g;
}
route('GET', '/api/games/:id/saves', ({ user, session, params }) => {
  saveGuard(user, params.id);
  return db.filter('saves', (s) => s.userId === user.id && s.gameId === params.id).map(({ key, revision, sizeBytes, updatedAt }) => ({ key, revision, sizeBytes, updatedAt }));
});
route('GET', '/api/games/:id/saves/:key', ({ user, session, params }) => {
  saveGuard(user, params.id);
  const s = db.find('saves', (x) => x.userId === user.id && x.gameId === params.id && x.key === params.key);
  if (!s) return null; // missing key is a normal state, not an error
  return { key: s.key, value: s.value, revision: s.revision, updatedAt: s.updatedAt };
});
route('PUT', '/api/games/:id/saves/:key', ({ user, session, params, body }) => {
  saveGuard(user, params.id);
  if (!SAVE_KEY_RE.test(params.key)) fail(400, 'Invalid save key');
  const json = JSON.stringify(body?.value ?? null);
  if (json.length > MAX_SAVE_BYTES) fail(413, 'Save value too large (256 KB max)');
  let s = db.find('saves', (x) => x.userId === user.id && x.gameId === params.id && x.key === params.key);
  if (!s) {
    if (db.filter('saves', (x) => x.userId === user.id && x.gameId === params.id).length >= MAX_SAVE_KEYS) fail(413, 'Too many save keys');
    s = db.insert('saves', { userId: user.id, gameId: params.id, key: params.key, value: null, revision: 0, sizeBytes: 0, updatedAt: null });
  }
  // `revision` enables optimistic concurrency when saves become multi-device cloud saves.
  db.update(s, { value: JSON.parse(json), revision: s.revision + 1, sizeBytes: json.length, updatedAt: db.now() });
  return { key: s.key, revision: s.revision, updatedAt: s.updatedAt };
});
route('DELETE', '/api/games/:id/saves/:key', ({ user, session, params }) => {
  saveGuard(user, params.id);
  db.remove('saves', (x) => x.userId === user.id && x.gameId === params.id && x.key === params.key);
  return { ok: true };
});

// ----- achievements -----
route('GET', '/api/games/:id/achievements', ({ user, session, params }) => {
  requireGame(params.id);
  return db.filter('achievements', (a) => a.gameId === params.id).map((a) => ({
    id: a.key, name: a.name, description: a.description,
    unlockedAt: db.find('userAchievements', (u) => u.userId === user.id && u.achievementId === a.id)?.unlockedAt ?? null,
  }));
});
route('POST', '/api/games/:id/achievements/:key', ({ user, session, params }) => {
  const g = saveGuard(user, params.id);
  const a = db.get('achievements', `${g.id}:${params.key}`) ?? fail(404, 'Unknown achievement');
  const existing = db.find('userAchievements', (u) => u.userId === user.id && u.achievementId === a.id);
  if (existing) return { newlyUnlocked: false, achievement: { id: a.key, name: a.name, description: a.description, unlockedAt: existing.unlockedAt } };
  const row = db.insert('userAchievements', { userId: user.id, gameId: g.id, achievementId: a.id, unlockedAt: db.now() });
  return { newlyUnlocked: true, achievement: { id: a.key, name: a.name, description: a.description, unlockedAt: row.unlockedAt } };
});

// ----- profile -----
route('GET', '/api/profile', ({ user, session }) => {
  const owned = db.filter('ownerships', (o) => o.userId === user.id);
  const perGame = owned.map((o) => ({ gameId: o.gameId, ...playStats(user.id, o.gameId) }));
  const played = perGame.filter((p) => p.playtimeSeconds > 0);
  const recentAch = db.filter('userAchievements', (u) => u.userId === user.id)
    .sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt)).slice(0, 8)
    .map((u) => { const a = db.get('achievements', u.achievementId); return { gameId: u.gameId, id: a?.key, name: a?.name, description: a?.description, unlockedAt: u.unlockedAt }; });
  return {
    ...userState(user, session),
    stats: {
      owned: owned.length, played: played.length,
      totalSeconds: perGame.reduce((t, p) => t + p.playtimeSeconds, 0),
      achievements: db.filter('userAchievements', (u) => u.userId === user.id).length,
      wishlist: db.filter('wishlists', (w) => w.userId === user.id).length,
    },
    games: perGame.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '')),
    recentAchievements: recentAch,
  };
});

// ----- publishing -----
function decodeB64(b64, max) {
  const buf = Buffer.from(String(b64 ?? ''), 'base64');
  if (!buf.length) fail(400, 'Empty upload');
  if (buf.length > max) fail(413, 'Upload too large');
  return buf;
}
function publicReport(r) {
  return { ok: r.ok, errors: r.errors, warnings: r.warnings, manifest: r.manifest, files: r.files.slice(0, 200), fileCount: r.files.length, sizeBytes: r.sizeBytes, usesSdk: r.usesSdk };
}
route('POST', '/api/packages/inspect', ({ session, body }) => {
  requireAdmin(session);
  try { return publicReport(inspectPackage(body.filename ?? 'package.zip', decodeB64(body.dataBase64, 50e6))); }
  catch (e) { if (e instanceof HttpError) throw e; fail(400, e.message); }
});

const IMG_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
function saveImage(gameId, name, dataUrl) {
  const m = IMG_RE.exec(dataUrl ?? '');
  if (!m) fail(400, 'Images must be PNG, JPEG or WebP');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = decodeB64(m[2], 8e6);
  fs.mkdirSync(path.join(USER_MEDIA_DIR, gameId), { recursive: true });
  fs.writeFileSync(path.join(USER_MEDIA_DIR, gameId, `${name}.${ext}`), buf);
  return `/user-media/${gameId}/${name}.${ext}`;
}
function saveSvg(gameId, name, svg) {
  fs.mkdirSync(path.join(USER_MEDIA_DIR, gameId), { recursive: true });
  fs.writeFileSync(path.join(USER_MEDIA_DIR, gameId, `${name}.svg`), svg);
  return `/user-media/${gameId}/${name}.svg`;
}
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'game';

route('POST', '/api/publish', ({ user, session, body }) => {
  requireAdmin(session);
  const title = String(body.title ?? '').trim();
  if (title.length < 2 || title.length > 60) fail(400, 'Title must be 2–60 characters');
  const priceCents = Math.round(Number(body.priceCents));
  if (!Number.isFinite(priceCents) || priceCents < 0 || priceCents > 9999) fail(400, 'Price must be between $0 and $99.99');
  const tags = (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  const version = String(body.version ?? '1.0.0');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(400, 'Version must look like 1.0.0');
  const pkg = body.package ?? fail(400, 'A game package is required');
  let report;
  try { report = inspectPackage(pkg.filename ?? 'package.zip', decodeB64(pkg.dataBase64, 50e6)); }
  catch (e) { fail(400, e.message); }
  if (!report.ok) fail(422, `Package invalid: ${report.errors.join('; ')}`);

  let gameId = slugify(title);
  while (db.get('games', gameId)) gameId = `${slugify(title)}-${crypto.randomBytes(2).toString('hex')}`;

  const devName = String(body.developerName ?? '').trim() || `${user.displayName} Games`;
  let dev = db.find('developers', (d) => d.name.toLowerCase() === devName.toLowerCase());
  if (!dev) dev = db.insert('developers', { id: db.id('dev'), name: devName, location: 'Independent', userId: user.id, createdAt: db.now() });
  else if (dev.userId && dev.userId !== user.id) fail(403, 'That developer name belongs to another account');
  else if (!dev.userId && db.all('games').some((g) => g.developerId === dev.id)) fail(403, 'That developer name is taken');

  const manifest = { ...report.manifest, name: title, version };
  installPackage(gameId, version, report.entries, manifest);

  // Media: uploaded images, or generated key art as a stand-in.
  const motif = ['mountains', 'city', 'sea', 'space', 'forest', 'dungeon', 'desert', 'synth', 'crystal'][parseInt(crypto.createHash('md5').update(title).digest('hex').slice(0, 6), 16) % 9];
  const palette = paletteFromSeed(title);
  const cover = body.cover ? saveImage(gameId, 'cover', body.cover) : saveSvg(gameId, 'cover', art('cover', { seed: title, motif, palette }));
  const header = body.cover ? cover : saveSvg(gameId, 'header', art('header', { seed: title, motif, palette }));
  const hero = body.cover ? cover : saveSvg(gameId, 'hero', art('hero', { seed: title, motif, palette }));
  const shots = (Array.isArray(body.screenshots) ? body.screenshots : []).slice(0, 6).map((s, i) => saveImage(gameId, `shot${i + 1}`, s));
  if (!shots.length) for (let i = 1; i <= 3; i++) shots.push(saveSvg(gameId, `shot${i}`, art('shot', { seed: `${title}${i}`, motif, palette })));

  const game = db.insert('games', {
    id: gameId, title, developerId: dev.id, priceCents, tags: tags.length ? tags : ['Indie'],
    features: ['Single-player', 'Instant Play', ...(report.usesSdk ? ['Cloud Saves'] : []), ...((manifest.achievements ?? []).length ? ['Achievements'] : [])],
    shortDescription: String(body.shortDescription ?? '').slice(0, 300) || `${title} — a new game on Lantern.`,
    description: String(body.description ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 12),
    releaseDate: db.now().slice(0, 10), status: 'released', rating: null, stats: { sales: 0, trend: 100 },
    featured: false, demo: body.demo ? { minutes: 5 } : null,
    logo: { font: 'Barlow Condensed', weight: 700, color: '#ffffff', case: 'upper', spacing: '.06em' },
    media: { cover, header, hero, screenshots: shots }, blurb: 'New on Lantern', currentVersionId: null,
    source: 'published', publishedBy: user.id, createdAt: db.now(),
  });
  const ver = createVersion({ gameId, pkgDir: gameId, pkgVersion: version, notes: String(body.releaseNotes ?? 'Initial release.') });
  db.update(game, { currentVersionId: ver.id });
  (manifest.achievements ?? []).forEach((a) => db.insert('achievements', { id: `${gameId}:${a.id}`, gameId, key: a.id, name: String(a.name ?? a.id).slice(0, 60), description: String(a.description ?? '').slice(0, 140) }));
  db.insert('ownerships', { id: db.id('own'), userId: user.id, gameId, source: 'developer', pricePaidCents: 0, orderId: null, acquiredAt: db.now() });
  return { gameId, version: ver.version, buildHash: ver.buildHash, state: userState(user, session) };
});

// ----- account -----
route('PATCH', '/api/me', ({ user, session, body }) => {
  const name = String(body?.displayName ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (name.length < 2 || name.length > 24) fail(400, 'Display name must be 2–24 characters');
  db.update(user, { displayName: name });
  return userState(user, session);
});
// Wipe this account's progress (library, saves, playtime, achievements, wishlist).
route('POST', '/api/me/reset', ({ user, session }) => {
  for (const t of ['ownerships', 'wishlists', 'saves', 'userAchievements', 'playSessions']) db.remove(t, (r) => r.userId === user.id);
  return userState(user, session);
});

// ----- creator / admin access -----
route('POST', '/api/admin/login', ({ user, session, body, ctx }) => {
  limit(`login:${ctx.ip}`, 10, 15 * 60e3);
  if (!ADMIN_PASSWORD) { if (ADMIN_OPEN) return userState(user, session); fail(403, 'Publishing is disabled on this server (no ADMIN_PASSWORD configured)'); }
  const a = crypto.createHash('sha256').update(String(body?.password ?? '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) fail(401, 'Wrong password');
  db.update(session, { admin: true });
  return userState(user, session);
});
route('POST', '/api/admin/logout', ({ user, session }) => { db.update(session, { admin: false }); return userState(user, session); });

// Reset the whole site back to the seeded catalog (admin only).
function resetSite() {
  for (const g of db.all('games').filter((x) => x.source === 'published')) {
    fs.rmSync(path.join(PUBLISHED_PACKAGES_DIR, g.id), { recursive: true, force: true });
    fs.rmSync(path.join(USER_MEDIA_DIR, g.id), { recursive: true, force: true });
  }
  db.reset(seed);
  return { ok: true };
}
function resetKeepingAdmin({ user, session }) {
  requireAdmin(session);
  resetSite();
  // keep the person who pressed reset signed in
  if (!db.get('users', user.id)) db.insert('users', user);
  db.insert('authSessions', session);
  return { ok: true };
}
route('POST', '/api/admin/reset', resetKeepingAdmin);
route('POST', '/api/dev/reset', resetKeepingAdmin); // legacy alias used by test scripts

export async function handleApi(req, res, url, body, ctx) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const { user, session } = authenticate(req, res, ctx);
    const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    return r.handler({ user, session, params, body, url, ctx });
  }
  fail(404, 'No such endpoint');
}
