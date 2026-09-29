// PLATFORM SERVICES (REST API)
// Handlers are grouped by the service they'd become in production:
// identity, catalog, commerce, library/entitlements, runtime sessions,
// cloud saves, achievements, publishing. All authorization lives here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as db from './db.js';
import { seed, seedDemoUser, createVersion, DEFAULT_USER_ID } from './seed.js';
import { inspectPackage, installPackage, PUBLISHED_PACKAGES_DIR } from './packages.js';
import { art, paletteFromSeed } from './art.js';
import { rankings, publicRank, creatorRank } from './ranking.js';
import { USER_MEDIA_DIR, ADMIN_PASSWORD, ADMIN_OPEN, ACCOUNT_MODE, PUBLIC_URL, GAMES_ORIGIN, CURRENCY, CREATOR_SHARE, DEMO_CONTENT_DEFAULT, DEMO_CONTENT_MODES, ADMIN_EMAILS, REQUIRE_APPROVAL_DEFAULT, REFUND_WINDOW_DAYS, REFUND_MAX_PLAY_MINUTES } from './config.js';
import { putDir, putObject } from './storage.js';
import { emails } from './email.js';
import { reportError } from './monitoring.js';
import { LEGAL_VERSIONS } from '../public/js/legal.js';
import { hashPassword, verifyPassword, EMAIL_RE, uniqueUsername, mergeUsers, googleEnabled, googleStartUrl, googleFinish } from './auth.js';
import { stripeEnabled, createCheckoutSession, retrieveCheckoutSession, verifyWebhook, saleDetails, createConnectAccount, retrieveAccount, createAccountLink, createLoginLink, payoutsReady, createTransfer, reverseTransfer, createRefund, PLATFORM_COUNTRY } from './payments.js';
import { signBuild, currentKeyId, publicKey } from './signing.js';
import { cleanVibe } from '../public/js/vibe.js';

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
const ADJ = ['Neon', 'Cosmic', 'Chill', 'Glitchy', 'Turbo', 'Lucky', 'Velvet', 'Midnight', 'Electric', 'Sunny', 'Hyper', 'Sleepy', 'Clever', 'Retro', 'Dreamy', 'Starlit'];
const NOUN = ['Prompt', 'Sprite', 'Pixel', 'Comet', 'Otter', 'Fox', 'Byte', 'Wizard', 'Cat', 'Robot', 'Moth', 'Synth', 'Rocket', 'Owl', 'Glitch', 'Wave'];
function createGuest() {
  const n = crypto.randomInt(ADJ.length * NOUN.length);
  return db.insert('users', {
    id: db.id('usr'), username: `guest-${crypto.randomBytes(3).toString('hex')}`,
    displayName: `${ADJ[n % ADJ.length]} ${NOUN[Math.floor(n / ADJ.length)]}`,
    avatarHue: crypto.randomInt(360), memberSince: db.now(), guest: true,
  });
}

export function authenticate(req, res, ctx) {
  const cookie = req.headers.cookie ?? '';
  const sid = /(?:^|;\s*)vibe_sid=([a-f0-9]{48})/.exec(cookie)?.[1];
  // Pre-rebrand sessions (Lantern) used a different cookie name; carry them over once.
  const legacySid = !sid && /(?:^|;\s*)lantern_sid=([a-f0-9]{48})/.exec(cookie)?.[1];
  const sess = (sid || legacySid) && db.find('authSessions', (s) => s.id === (sid || legacySid));
  const existing = sess && db.get('users', sess.userId);
  if (existing) {
    if (legacySid) res.setHeader('Set-Cookie', [
      `vibe_sid=${legacySid}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000${ctx.secure ? '; Secure' : ''}`,
      `lantern_sid=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${ctx.secure ? '; Secure' : ''}`,
    ]);
    return { user: existing, session: sess };
  }
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
  res.setHeader('Set-Cookie', `vibe_sid=${newSid}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000${ctx.secure ? '; Secure' : ''}`);
  return { user, session };
}

function startSession(res, userId, ctx) {
  const sid = crypto.randomBytes(24).toString('hex');
  const session = db.insert('authSessions', { id: sid, userId, admin: false, createdAt: db.now() });
  res.setHeader('Set-Cookie', `vibe_sid=${sid}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=31536000${ctx.secure ? '; Secure' : ''}`);
  return session;
}
function clearSessionCookie(res, ctx) {
  res.setHeader('Set-Cookie', `vibe_sid=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${ctx.secure ? '; Secure' : ''}`);
}
const baseUrl = (ctx) => PUBLIC_URL || ctx.origin;

// ---------------- roles ----------------
// Admin: accounts whose verified email is in ADMIN_EMAILS, or a session unlocked
// with ADMIN_PASSWORD (bootstrap / break-glass). Everything is open in local dev.
// Creator: any verified account that accepted the creator agreement.
const sessionUser = (session) => (session ? db.get('users', session.userId) : null);
const emailVerified = (u) => !!u && !u.guest && (!!u.emailVerified || !!u.googleId);
const isAdminUser = (u) => emailVerified(u) && ADMIN_EMAILS.includes(String(u.email ?? '').toLowerCase());
const isAdmin = (session) => ADMIN_OPEN || !!session?.admin || isAdminUser(sessionUser(session));
const isCreator = (u) => u?.creator?.status === 'active';
function requireAdmin(session) {
  if (isAdmin(session)) return;
  fail(403, 'Admin access required');
}
// Why a user can't publish yet (null = they can).
function publishBlocker(user, session) {
  if (ADMIN_OPEN || isAdmin(session)) return null;
  if (user.guest) return 'account';
  if (!emailVerified(user)) return 'verify';
  if (user.creator?.status === 'suspended') return 'suspended';
  if (!isCreator(user)) return 'join';
  return null;
}
function requireCreator(user, session) {
  const b = publishBlocker(user, session);
  if (!b) return;
  fail(b === 'account' ? 401 : 403, {
    account: 'Create an account to publish games',
    verify: 'Confirm your email address before publishing',
    join: 'Join as a creator first (Publish → Become a creator)',
    suspended: 'Your creator account is suspended. Contact support.',
  }[b]);
}

// ---------------- helpers ----------------
const owns = (userId, gameId) => !!db.find('ownerships', (o) => o.userId === userId && o.gameId === gameId);
// NB: the 'lantern-*' salts below predate the rebrand. Changing them would change every
// player's per-game id and every ranking fingerprint, so they stay as they are.
const scopedPlayerId = (userId, gameId) => `p_${crypto.createHash('sha256').update(`${userId}:${gameId}:lantern-pepper`).digest('hex').slice(0, 16)}`;

// ---------------- site settings + sample content ----------------
// The fictional seed catalog (source 'seed') and its written reviews are "sample
// content". Whether it is shown is a site setting: off | admins | everyone.
const reqCtx = new AsyncLocalStorage(); // { session, user } for the request being handled
function getSetting(key, fallback) { return db.find('settings', (s) => s.key === key)?.value ?? fallback; }
function setSetting(key, value) {
  const row = db.find('settings', (s) => s.key === key);
  if (row) db.update(row, { value, updatedAt: db.now() }); else db.insert('settings', { key, value, updatedAt: db.now() });
}
const demoMode = () => getSetting('demoContent', DEMO_CONTENT_DEFAULT);
function demoVisible(session = reqCtx.getStore()?.session) {
  const mode = demoMode();
  return mode === 'everyone' || (mode === 'admins' && isAdmin(session));
}
const isSample = (g) => g?.source === 'seed';
const hiddenGame = (g) => isSample(g) && !demoVisible();
const visibleRankings = () => rankings({ includeDemo: demoVisible() });
const requireApproval = () => getSetting('requireApproval', REQUIRE_APPROVAL_DEFAULT);

// Moderation state of a game's store listing: pending (awaiting review), live,
// rejected, removed (taken down). Seed/legacy games without one are live.
const listingOf = (g) => g?.listing ?? 'live';
const storeListed = (g) => !!g && !hiddenGame(g) && listingOf(g) === 'live';
// Who may open a game that isn't publicly listed: admins, its creator, and
// players who already own it (bought games never vanish from a library).
function canAccess(g, user, session) {
  if (!g || hiddenGame(g)) return false;
  if (listingOf(g) === 'live') return true;
  return isAdmin(session) || (!!user && (g.publishedBy === user.id || owns(user.id, g.id)));
}
function requireGame(id) {
  const g = db.get('games', id);
  const { user, session } = reqCtx.getStore() ?? {};
  if (!canAccess(g, user, session)) fail(404, 'Game not found');
  return g;
}
function requireListed(g) {
  if (listingOf(g) !== 'live') fail(409, 'This game is not available for purchase');
}

// Review score. Real reviews always count. Sample games start from their fictional
// aggregate (catalog rating) and real reviews are added on top of it.
function ratingFor(g) {
  const real = db.filter('reviews', (r) => r.gameId === g.id && !r.demo);
  const up = real.filter((r) => r.up).length;
  if (isSample(g) && g.rating) {
    const count = g.rating.count + real.length;
    return { pct: Math.round((g.rating.pct * g.rating.count + up * 100) / count), count };
  }
  return real.length ? { pct: Math.round((up / real.length) * 100), count: real.length } : null;
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
    description: g.description, releaseDate: g.releaseDate, status: g.status, rating: ratingFor(g), sample: isSample(g),
    featured: g.featured, demo: g.demo, logo: g.logo, media: g.media, blurb: g.blurb, source: g.source,
    builtWith: g.builtWith ?? [], vibe: g.vibe ?? null, listing: listingOf(g),
    achievementCount: db.filter('achievements', (a) => a.gameId === g.id).length,
    version: ver ? {
      version: ver.version, sizeBytes: ver.sizeBytes, fileCount: ver.files.length, buildHash: ver.buildHash,
      sdk: ver.sdk, runtime: ver.runtime, input: ver.input, releasedAt: ver.releasedAt, placeholder: ver.placeholder, notes: ver.notes,
    } : null,
    updatedAt: ver?.releasedAt ?? null,
    rank: publicRank(visibleRankings().byGame.get(g.id)),
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
    user: { id: user.id, username: user.username, displayName: user.displayName, avatarHue: user.avatarHue, memberSince: user.memberSince, guest: !!user.guest, email: user.email ?? null, emailVerified: emailVerified(user), hasPassword: !!user.passwordHash, google: !!user.googleId },
    features: { google: googleEnabled(), stripe: stripeEnabled(), currency: CURRENCY, gamesOrigin: GAMES_ORIGIN || null, signing: true, creatorShare: CREATOR_SHARE, requireApproval: requireApproval(), legal: LEGAL_VERSIONS },
    creator: {
      admin: isAdmin(session), creator: isCreator(user), canPublish: !publishBlocker(user, session), blocker: publishBlocker(user, session),
      devOpen: ADMIN_OPEN, passwordLogin: !!ADMIN_PASSWORD, agreementVersion: user.creator?.agreementVersion ?? null,
    },
    site: { demoContent: demoMode(), demoVisible: demoVisible(session) },
    owned: db.filter('ownerships', (o) => o.userId === user.id && !hiddenGame(db.get('games', o.gameId))).map((o) => o.gameId),
    wishlist: db.filter('wishlists', (w) => w.userId === user.id && storeListed(db.get('games', w.gameId))).map((w) => w.gameId),
  };
}

// ---------------- handlers ----------------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/state', ({ user, session }) => userState(user, session));

route('GET', '/api/catalog', ({ user }) => {
  const games = db.all('games').filter(storeListed).map(publicGame);
  // Games this player can open but that aren't in the store: bought before they were
  // taken down, or their own games awaiting review. Library-only, never on shelves.
  const unlisted = db.all('games').filter((g) => !storeListed(g) && !hiddenGame(g) && g.currentVersionId && (owns(user.id, g.id) || g.publishedBy === user.id))
    .map((g) => ({ ...publicGame(g), unlisted: true }));
  const { shelves, thresholds } = visibleRankings();
  const counts = {};
  const toolCounts = {};
  games.forEach((g) => {
    g.tags.forEach((t) => { counts[t] = (counts[t] ?? 0) + 1; });
    g.builtWith.forEach((t) => { toolCounts[t] = (toolCounts[t] ?? 0) + 1; });
  });
  return {
    games, unlisted, shelves, discovery: thresholds,
    tags: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    tools: Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count })),
  };
});

route('GET', '/api/games/:id', ({ user, session, params }) => {
  const g = requireGame(params.id);
  const unlocked = new Map(db.filter('userAchievements', (u) => u.userId === user.id && u.gameId === g.id).map((u) => [u.achievementId, u.unlockedAt]));
  return {
    ...publicGame(g),
    achievements: db.filter('achievements', (a) => a.gameId === g.id).map((a) => ({ id: a.key, name: a.name, description: a.description, unlockedAt: unlocked.get(a.id) ?? null })),
    versions: db.filter('gameVersions', (v) => v.gameId === g.id).map((v) => ({ version: v.version, releasedAt: v.releasedAt, sizeBytes: v.sizeBytes, notes: v.notes, buildHash: v.buildHash, fileCount: v.files.length })),
    canUpdate: canUpdateGame(user, session, g),
    owned: owns(user.id, g.id),
    play: playStats(user.id, g.id),
  };
});

// ----- commerce (mocked payment) -----
route('POST', '/api/games/:id/purchase', ({ user, session, params, body }) => {
  const g = requireGame(params.id);
  if (g.status !== 'released' || !g.currentVersionId) fail(409, 'This game is not available for purchase yet');
  requireListed(g);
  if (owns(user.id, g.id)) fail(409, 'You already own this game');
  if (body?.paymentMethod !== 'demo-wallet') fail(400, 'Unsupported payment method');
  if (stripeEnabled() && g.priceCents > 0) fail(403, 'Payments on this server go through Stripe checkout');
  const order = db.insert('orders', { id: db.id('ord'), userId: user.id, gameId: g.id, amountCents: g.priceCents, currency: CURRENCY, provider: g.priceCents ? 'mock' : 'free', status: 'pending', providerRef: null, createdAt: db.now(), paidAt: null });
  const ownership = fulfillOrder(order);
  return { ownership, order: publicOrder(order), state: userState(user, session) };
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
route('GET', '/api/library', ({ user, session }) => db.filter('ownerships', (o) => o.userId === user.id && !hiddenGame(db.get('games', o.gameId))).map((o) => ({
  gameId: o.gameId, acquiredAt: o.acquiredAt, source: o.source, ...playStats(user.id, o.gameId),
})));

// ----- runtime sessions -----
route('POST', '/api/games/:id/launch', ({ user, session, params, body, ctx }) => {
  const g = requireGame(params.id);
  const mode = body?.mode === 'demo' ? 'demo' : 'full';
  const owned = owns(user.id, g.id);
  if (!g.currentVersionId) fail(409, 'No playable build available');
  // Reviewers (admins) and the game's creator can play any build, including ones awaiting review.
  const reviewer = isAdmin(session) || g.publishedBy === user.id;
  if (mode === 'full' && !owned && !reviewer) fail(403, 'You do not own this game');
  if (mode === 'demo' && !g.demo) fail(403, 'This game has no demo');
  const picked = reviewer && body?.versionId ? db.get('gameVersions', String(body.versionId)) : null;
  const ver = picked?.gameId === g.id ? picked : db.get('gameVersions', g.currentVersionId);
  // Close any dangling session for this game (e.g. tab was killed).
  db.filter('playSessions', (s) => s.userId === user.id && s.gameId === g.id && !s.endedAt).forEach((s) => db.update(s, { endedAt: s.lastHeartbeatAt }));
  const play = db.insert('playSessions', { id: db.id('ses'), userId: user.id, gameId: g.id, versionId: ver.id, mode: owned ? 'full' : mode, startedAt: db.now(), lastHeartbeatAt: db.now(), endedAt: null, seconds: 0, ipHash: ipHash(ctx?.ip) });
  return {
    session: { id: play.id, mode: play.mode, reviewBuild: ver.id !== g.currentVersionId, startedAt: play.startedAt, demoSeconds: play.mode === 'demo' ? g.demo.minutes * 60 : null },
    build: { url: `${GAMES_ORIGIN}/games/${ver.packagePath}/${ver.entry}`, baseUrl: `${GAMES_ORIGIN}/games/${ver.packagePath}/`, entry: ver.entry, version: ver.version, buildHash: ver.buildHash, sizeBytes: ver.sizeBytes, fileCount: ver.files.length, sdk: ver.sdk },
    // Games only ever see a per-game pseudonymous player id — never the account id.
    player: { id: scopedPlayerId(user.id, g.id), displayName: user.displayName, avatarHue: user.avatarHue },
    game: { id: g.id, title: g.title },
  };
});

// A salted hash of the player's IP, only used to cap how many accounts per address count towards rankings.
const ipHash = (ip) => (ip ? crypto.createHash('sha256').update(`${ip}:lantern-rank`).digest('hex').slice(0, 12) : null);
// Launch health reported by the runtime: did the SDK connect, how many uncaught errors.
function healthPatch(s, health) {
  if (!health || typeof health !== 'object') return {};
  const errors = Math.max(0, Math.min(999, Math.floor(Number(health.errors) || 0)));
  return { connected: !!health.connected || !!s.connected, errors: Math.max(errors, s.errors ?? 0) };
}
function updateSession(user, sid, activeSeconds, end, health) {
  const s = db.get('playSessions', sid);
  if (!s || s.userId !== user.id) fail(404, 'Session not found');
  if (s.endedAt) return { ok: true, seconds: s.seconds };
  const wall = (Date.now() - Date.parse(s.startedAt)) / 1000;
  const secs = Math.max(s.seconds, Math.min(Math.floor(Number(activeSeconds) || 0), Math.ceil(wall) + 5));
  db.update(s, { seconds: secs, lastHeartbeatAt: db.now(), ...healthPatch(s, health), ...(end ? { endedAt: db.now() } : {}) });
  return { ok: true, seconds: secs };
}
route('POST', '/api/sessions/:sid/heartbeat', ({ user, session, params, body }) => updateSession(user, params.sid, body?.activeSeconds, false, body?.health));
route('POST', '/api/sessions/:sid/end', ({ user, session, params, body }) => updateSession(user, params.sid, body?.activeSeconds, true, body?.health));

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
  const owned = db.filter('ownerships', (o) => o.userId === user.id && !hiddenGame(db.get('games', o.gameId)));
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
    orders: db.filter('orders', (o) => o.userId === user.id && (o.status === 'paid' || o.status === 'refunded')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(publicOrder),
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
route('POST', '/api/packages/inspect', ({ user, session, body }) => {
  requireCreator(user, session);
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

route('POST', '/api/publish', async ({ user, session, body, ctx }) => {
  requireCreator(user, session);
  limit(`publish:${user.id}`, 10, 60 * 60e3);
  const title = String(body.title ?? '').trim();
  if (title.length < 2 || title.length > 60) fail(400, 'Title must be 2–60 characters');
  const priceCents = Math.round(Number(body.priceCents));
  if (!Number.isFinite(priceCents) || priceCents < 0 || priceCents > 9999) fail(400, 'Price must be between $0 and $99.99');
  const tags = (Array.isArray(body.tags) ? body.tags : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8);
  const version = String(body.version ?? '1.0.0');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(400, 'Version must look like 1.0.0');
  let vibeInfo;
  try { vibeInfo = cleanVibe(body.builtWith, body.vibe); } catch (e) { fail(400, e.message); }
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
  // Optional wide art: header capsule (≈920×430) and store-page hero banner (≈1920×620).
  // Without them the cover stands in, or generated art when there's no cover either.
  const header = body.header ? saveImage(gameId, 'header', body.header) : body.cover ? cover : saveSvg(gameId, 'header', art('header', { seed: title, motif, palette }));
  const hero = body.hero ? saveImage(gameId, 'hero', body.hero) : body.header ? header : body.cover ? cover : saveSvg(gameId, 'hero', art('hero', { seed: title, motif, palette }));
  const shots = (Array.isArray(body.screenshots) ? body.screenshots : []).slice(0, 6).map((s, i) => saveImage(gameId, `shot${i + 1}`, s));
  if (!shots.length) for (let i = 1; i <= 3; i++) shots.push(saveSvg(gameId, `shot${i}`, art('shot', { seed: `${title}${i}`, motif, palette })));

  const live = !requireApproval() || isAdmin(session);
  const game = db.insert('games', {
    id: gameId, title, developerId: dev.id, priceCents, tags: tags.length ? tags : ['Indie'],
    features: ['Single-player', 'Instant Play', ...(report.usesSdk ? ['Cloud Saves'] : []), ...((manifest.achievements ?? []).length ? ['Achievements'] : []),
      ...(Array.isArray(manifest.input) && manifest.input.includes('gamepad') ? ['Controller Support'] : []), ...(Array.isArray(manifest.input) && manifest.input.includes('touch') ? ['Touch Controls'] : [])],
    shortDescription: String(body.shortDescription ?? '').slice(0, 300) || `${title}: freshly vibe-coded and live on Vibe-Games.`,
    description: String(body.description ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).slice(0, 12),
    releaseDate: db.now().slice(0, 10), status: 'released', rating: null, stats: { sales: 0, trend: 100 },
    featured: false, demo: body.demo ? { minutes: 5 } : null,
    logo: { font: 'Barlow Condensed', weight: 700, color: '#ffffff', case: 'upper', spacing: '.06em' },
    media: { cover, header, hero, screenshots: shots }, blurb: 'Fresh off the prompt', currentVersionId: null,
    builtWith: vibeInfo.builtWith, vibe: vibeInfo.vibe,
    source: 'published', publishedBy: user.id, createdAt: db.now(),
    // Moderation: creators' games wait for review; admins' own uploads go straight live.
    listing: live ? 'live' : 'pending', submittedAt: db.now(),
    moderation: [{ at: db.now(), action: live ? 'published' : 'submitted', by: user.id }],
  });
  const ver = createVersion({ gameId, pkgDir: gameId, pkgVersion: version, notes: String(body.releaseNotes ?? 'Initial release.') });
  db.update(ver, { review: live ? 'approved' : 'pending', submittedBy: user.id });
  db.update(game, { currentVersionId: ver.id });
  (manifest.achievements ?? []).forEach((a) => db.insert('achievements', { id: `${gameId}:${a.id}`, gameId, key: a.id, name: String(a.name ?? a.id).slice(0, 60), description: String(a.description ?? '').slice(0, 140) }));
  db.insert('ownerships', { id: db.id('own'), userId: user.id, gameId, source: 'developer', pricePaidCents: 0, orderId: null, acquiredAt: db.now() });
  await backupUploads(gameId, version);
  if (!live) notifyAdmins(`New game to review: ${title}`, `${user.displayName} submitted “${title}” (v${version}).`, `${baseUrl(ctx)}/admin`);
  return { gameId, version: ver.version, buildHash: ver.buildHash, listing: game.listing, state: userState(user, session) };
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
  // everything uploaded through Publish (new games and updates to any game)
  fs.rmSync(PUBLISHED_PACKAGES_DIR, { recursive: true, force: true });
  fs.rmSync(USER_MEDIA_DIR, { recursive: true, force: true });
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


// ======================================================================
// Signed builds (offline cache + future desktop client)
// ======================================================================
function signedBuild(ver) {
  if (!ver.signature || ver.signKeyId !== currentKeyId()) {
    const { signature } = signBuild({ gameId: ver.gameId, version: ver.version, entry: ver.entry, buildHash: ver.buildHash, files: ver.files });
    db.update(ver, { signature, signKeyId: currentKeyId() });
  }
  const { manifest } = signBuild({ gameId: ver.gameId, version: ver.version, entry: ver.entry, buildHash: ver.buildHash, files: ver.files });
  return { manifest, signature: ver.signature };
}
route('GET', '/api/keys/packages', () => publicKey());
route('GET', '/api/games/:id/build', ({ user, params }) => {
  const g = requireGame(params.id);
  if (!g.currentVersionId) fail(409, 'No build available');
  if (!canUseGame(user, g)) fail(403, 'You do not own this game');
  const ver = db.get('gameVersions', g.currentVersionId);
  return { ...signedBuild(ver), baseUrl: `${GAMES_ORIGIN}/games/${ver.packagePath}/`, notes: ver.notes, releasedAt: ver.releasedAt };
});

// Sessions played while offline are uploaded when the player reconnects.
route('POST', '/api/sessions/offline', ({ user, body, ctx }) => {
  const g = requireGame(String(body?.gameId ?? ''));
  if (!owns(user.id, g.id)) fail(403, 'You do not own this game');
  const started = Date.parse(body?.startedAt);
  const seconds = Math.max(0, Math.min(12 * 3600, Math.floor(Number(body?.seconds) || 0)));
  if (!Number.isFinite(started) || started > Date.now() + 60e3 || started < Date.now() - 30 * 86400e3) fail(400, 'Bad session time');
  const clientId = String(body?.clientId ?? '').slice(0, 64);
  if (clientId && db.find('playSessions', (s) => s.userId === user.id && s.clientId === clientId)) return { ok: true, duplicate: true };
  db.insert('playSessions', { id: db.id('ses'), clientId: clientId || null, userId: user.id, gameId: g.id, versionId: g.currentVersionId, mode: 'offline', startedAt: new Date(started).toISOString(), lastHeartbeatAt: new Date(started + seconds * 1000).toISOString(), endedAt: new Date(started + seconds * 1000).toISOString(), seconds, ipHash: ipHash(ctx?.ip), ...healthPatch({}, body?.health) });
  return { ok: true };
});

// ======================================================================
// Accounts
// ======================================================================
async function signIn(res, ctx, session, account) {
  const current = db.get('users', session.userId);
  if (current?.guest) mergeUsers(current.id, account.id);
  db.remove('authSessions', (s) => s.id === session.id);
  const s = startSession(res, account.id, ctx);
  return userState(account, s);
}
route('POST', '/api/auth/signup', async ({ user, session, body, ctx, res }) => {
  limit(`signup:${ctx.ip}`, 10, 60 * 60e3);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (!EMAIL_RE.test(email)) fail(400, 'Enter a valid email address');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters');
  if (password.length > 200) fail(400, 'Password is too long');
  if (db.find('users', (u) => u.email === email)) fail(409, 'An account with this email already exists — sign in instead');
  const displayName = String(body?.displayName ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
  const passwordHash = await hashPassword(password);
  const terms = { termsVersion: LEGAL_VERSIONS.terms, termsAcceptedAt: db.now() }; // accepted on the sign-up form
  if (user.guest) {
    // Upgrade the guest in place: everything they own stays.
    db.update(user, { guest: false, email, passwordHash, emailVerified: false, ...terms, username: uniqueUsername(email.split('@')[0]), displayName: displayName.length >= 2 ? displayName : user.displayName, upgradedAt: db.now() });
    sendVerification(user, ctx);
    return userState(user, session);
  }
  const account = db.insert('users', { id: db.id('usr'), username: uniqueUsername(email.split('@')[0]), displayName: displayName.length >= 2 ? displayName : email.split('@')[0].slice(0, 24), email, passwordHash, emailVerified: false, ...terms, avatarHue: crypto.randomInt(360), memberSince: db.now(), guest: false });
  sendVerification(account, ctx);
  return signIn(res, ctx, session, account);
});
route('POST', '/api/auth/login', async ({ session, body, ctx, res }) => {
  limit(`login-user:${ctx.ip}`, 20, 15 * 60e3);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const account = db.find('users', (u) => u.email === email && !u.guest);
  const ok = account?.passwordHash ? await verifyPassword(String(body?.password ?? ''), account.passwordHash) : (await hashPassword('timing-equaliser'), false);
  if (!ok) fail(401, account && !account.passwordHash ? 'This account uses Google sign-in' : 'Wrong email or password');
  return signIn(res, ctx, session, account);
});
route('POST', '/api/auth/logout', ({ session, ctx, res }) => {
  db.remove('authSessions', (s) => s.id === session.id);
  clearSessionCookie(res, ctx);
  return { ok: true };
});
route('POST', '/api/auth/password', async ({ user, session, body }) => {
  if (user.guest) fail(400, 'Create an account first');
  if (user.passwordHash && !(await verifyPassword(String(body?.current ?? ''), user.passwordHash))) fail(401, 'Current password is wrong');
  const next = String(body?.password ?? '');
  if (next.length < 8) fail(400, 'Password must be at least 8 characters');
  db.update(user, { passwordHash: await hashPassword(next) });
  db.remove('authSessions', (s) => s.userId === user.id && s.id !== session.id); // sign out other devices
  return userState(user, session);
});

// Google sign-in: plain browser navigations (no platform header), see index.js.
export function googleStart(req, res, ctx) {
  if (!googleEnabled()) fail(404, 'Google sign-in is not configured');
  const { session } = authenticate(req, res, ctx);
  const url = googleStartUrl(`${baseUrl(ctx)}/api/auth/google/callback`, session.userId);
  res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
  res.end();
}
export async function googleCallback(req, res, ctx, url) {
  let to = '/profile?welcome=1';
  try {
    if (url.searchParams.get('error')) throw new Error('Google sign-in was cancelled');
    const { profile, guestUserId } = await googleFinish(url.searchParams.get('code'), url.searchParams.get('state'), `${baseUrl(ctx)}/api/auth/google/callback`);
    const email = profile.email_verified ? String(profile.email).toLowerCase() : null;
    let account = db.find('users', (u) => u.googleId === profile.sub) ?? (email ? db.find('users', (u) => u.email === email && !u.guest) : null);
    const guest = db.get('users', guestUserId);
    if (account) {
      if (!account.googleId) db.update(account, { googleId: profile.sub });
      if (guest?.guest) mergeUsers(guest.id, account.id);
    } else if (guest?.guest) {
      account = db.update(guest, { guest: false, googleId: profile.sub, email, emailVerified: !!email, termsVersion: LEGAL_VERSIONS.terms, termsAcceptedAt: db.now(), username: uniqueUsername((email ?? profile.name ?? 'player').split('@')[0]), displayName: String(profile.name ?? guest.displayName).slice(0, 24), upgradedAt: db.now() });
    } else {
      account = db.insert('users', { id: db.id('usr'), googleId: profile.sub, email, emailVerified: !!email, termsVersion: LEGAL_VERSIONS.terms, termsAcceptedAt: db.now(), username: uniqueUsername((email ?? 'player').split('@')[0]), displayName: String(profile.name ?? 'Player').slice(0, 24), avatarHue: crypto.randomInt(360), memberSince: db.now(), guest: false });
    }
    db.remove('authSessions', (s) => s.userId === guestUserId && guestUserId !== account.id);
    startSession(res, account.id, ctx);
  } catch (err) {
    to = `/profile?authError=${encodeURIComponent(err.message)}`;
  }
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  res.end();
}

// ======================================================================
// Commerce: orders, Stripe checkout, receipts
// ======================================================================
function publicOrder(o) {
  const g = db.get('games', o.gameId);
  return { id: o.id, gameId: o.gameId, title: g?.title ?? o.gameId, amountCents: o.amountCents, taxCents: o.taxCents ?? 0, currency: o.currency, provider: o.provider, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt, refundedAt: o.refundedAt ?? null, refund: refundEligibility(o) };
}
function fulfillOrder(order) {
  if (order.status !== 'paid') db.update(order, { status: 'paid', paidAt: db.now() });
  let own = db.find('ownerships', (r) => r.userId === order.userId && r.gameId === order.gameId);
  if (!own) {
    own = db.insert('ownerships', { id: db.id('own'), userId: order.userId, gameId: order.gameId, source: 'purchase', pricePaidCents: order.amountCents, orderId: order.id, acquiredAt: db.now() });
    const g = db.get('games', order.gameId);
    if (g) db.update(g, { stats: { ...g.stats, sales: (g.stats?.sales ?? 0) + 1 } });
  }
  db.remove('wishlists', (w) => w.userId === order.userId && w.gameId === order.gameId);
  if (!order.afterPaidAt) { db.update(order, { afterPaidAt: db.now() }); afterPaid(order).catch((err) => reportError(err, { where: 'afterPaid', orderId: order.id })); }
  return own;
}
route('POST', '/api/games/:id/checkout', async ({ user, session, params, ctx }) => {
  const g = requireGame(params.id);
  if (g.status !== 'released' || !g.currentVersionId) fail(409, 'This game is not available for purchase yet');
  requireListed(g);
  if (owns(user.id, g.id)) fail(409, 'You already own this game');
  if (g.priceCents === 0) {
    const order = db.insert('orders', { id: db.id('ord'), userId: user.id, gameId: g.id, amountCents: 0, currency: CURRENCY, provider: 'free', status: 'pending', providerRef: null, createdAt: db.now(), paidAt: null });
    fulfillOrder(order);
    return { status: 'paid', order: publicOrder(order), state: userState(user, session) };
  }
  if (!stripeEnabled()) return { status: 'mock' }; // client shows the Vibe Wallet (fake) checkout
  if (user.guest) fail(401, 'Create an account or sign in to buy — purchases are tied to your account');
  limit(`checkout:${user.id}`, 20, 10 * 60e3);
  const order = db.insert('orders', { id: db.id('ord'), userId: user.id, gameId: g.id, amountCents: g.priceCents, currency: CURRENCY, provider: 'stripe', status: 'pending', providerRef: null, createdAt: db.now(), paidAt: null });
  const base = baseUrl(ctx);
  const cs = await createCheckoutSession({
    order, game: g, email: user.email,
    successUrl: `${base}/checkout/complete?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/app/${encodeURIComponent(g.id)}?checkout=cancelled`,
  });
  db.update(order, { providerRef: cs.id });
  return { status: 'redirect', redirectUrl: cs.url, orderId: order.id };
});
route('POST', '/api/checkout/confirm', async ({ user, session, body }) => {
  const order = db.get('orders', String(body?.orderId ?? ''));
  if (!order || order.userId !== user.id) fail(404, 'Order not found');
  if (order.status === 'pending' && order.provider === 'stripe') {
    const cs = await retrieveCheckoutSession(order.providerRef);
    if (cs.metadata?.orderId !== order.id) fail(400, 'Checkout session does not match this order');
    if (cs.payment_status === 'paid') fulfillOrder(order);
    else if (cs.status === 'expired') db.update(order, { status: 'cancelled' });
  }
  return { order: publicOrder(order), state: userState(user, session) };
});
route('GET', '/api/orders', ({ user }) => db.filter('orders', (o) => o.userId === user.id && (o.status === 'paid' || o.status === 'refunded')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicOrder));

// Stripe → us. Raw body + signature, no cookies (see index.js).
export async function stripeWebhook(rawBody, signatureHeader) {
  const event = verifyWebhook(rawBody, signatureHeader);
  if (event.type === 'account.updated') { await onAccountUpdated(event.data?.object ?? {}); return { received: true }; }
  if (event.type === 'charge.refunded') {
    const ch = event.data?.object ?? {};
    const order = db.find('orders', (o) => (ch.payment_intent && o.paymentIntentId === ch.payment_intent) || (o.chargeId && o.chargeId === ch.id) || o.id === ch.metadata?.orderId);
    if (order && order.status === 'paid' && ch.refunded) await finishRefund(order, { by: 'stripe', reason: 'Refunded in Stripe', alreadyRefunded: true });
    return { received: true };
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const cs = event.data?.object ?? {};
    const order = db.get('orders', cs.metadata?.orderId ?? cs.client_reference_id);
    if (order && order.providerRef === cs.id && cs.payment_status === 'paid') fulfillOrder(order);
  } else if (event.type === 'checkout.session.expired') {
    const cs = event.data?.object ?? {};
    const order = db.get('orders', cs.metadata?.orderId);
    if (order && order.status === 'pending') db.update(order, { status: 'cancelled' });
  }
  return { received: true };
}

// ======================================================================
// Creator: my games + publishing new versions
// ======================================================================
const semver = (v) => String(v).split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const semverGt = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
// A game can be updated by its creator (while their creator account is active) or an admin.
function canUpdateGame(user, session, g) {
  if (ADMIN_OPEN || isAdmin(session)) return true;
  return !!user && g.publishedBy === user.id && !publishBlocker(user, session);
}
// Copy freshly written uploads (package + media) to object storage, if configured.
async function backupUploads(gameId, version) {
  try {
    if (version) await putDir(path.join(PUBLISHED_PACKAGES_DIR, gameId, version), `packages/${gameId}/${version}`);
    const media = path.join(USER_MEDIA_DIR, gameId);
    if (fs.existsSync(media)) await putDir(media, `media/${gameId}`);
  } catch (err) { reportError(err, { where: 'backupUploads', gameId }); }
}
function notifyAdmins(subject, line, url) {
  for (const to of ADMIN_EMAILS) emails.adminNotice(to, subject, line, url);
}
// Make a version the one players get (after approval, or straight away when no review is needed).
function activateVersion(g, ver) {
  db.update(ver, { review: 'approved', releasedAt: db.now() });
  db.update(g, { currentVersionId: ver.id });
  for (const a of ver.manifestAchievements ?? []) {
    if (!db.get('achievements', `${g.id}:${a.id}`)) db.insert('achievements', { id: `${g.id}:${a.id}`, gameId: g.id, key: a.id, name: String(a.name ?? a.id).slice(0, 60), description: String(a.description ?? '').slice(0, 140) });
  }
}
// Paid sales for a game and the creator's share. Refunded orders don't count.
function salesSummary(gameId) {
  const paid = db.filter('orders', (o) => o.gameId === gameId && o.status === 'paid' && o.amountCents > 0);
  const real = paid.filter((o) => o.provider === 'stripe');
  const grossCents = paid.reduce((t, o) => t + (o.subtotalCents ?? o.amountCents), 0);
  const earned = db.filter('earnings', (e) => e.gameId === gameId && e.status !== 'reversed' && e.status !== 'cancelled');
  return {
    count: paid.length, grossCents, share: CREATOR_SHARE, testCount: paid.length - real.length,
    creatorCents: earned.length ? earned.reduce((t, e) => t + e.amountCents, 0) : Math.floor(grossCents * CREATOR_SHARE),
    refunds: db.filter('orders', (o) => o.gameId === gameId && o.status === 'refunded').length,
  };
}
function moderationView(g) {
  const pending = db.filter('gameVersions', (v) => v.gameId === g.id && v.review === 'pending' && v.id !== g.currentVersionId);
  const last = [...(g.moderation ?? [])].reverse().find((m) => m.note);
  return { listing: listingOf(g), pendingVersions: pending.map((v) => ({ id: v.id, version: v.version, submittedAt: v.releasedAt })), lastNote: last ? { action: last.action, note: last.note, at: last.at } : null };
}
route('GET', '/api/creator/games', ({ user, session }) => {
  if (publishBlocker(user, session)) return [];
  const mineOnly = !(ADMIN_OPEN || isAdmin(session));
  return db.all('games').filter((g) => g.currentVersionId && !hiddenGame(g) && (mineOnly ? g.publishedBy === user.id : true) && (g.publishedBy === user.id || ADMIN_OPEN || isAdmin(session))).map((g) => {
    const vers = db.filter('gameVersions', (v) => v.gameId === g.id).sort((a, b) => (semverGt(a.version, b.version) ? -1 : 1));
    return {
      id: g.id, title: g.title, media: g.media, source: g.source, priceCents: g.priceCents, mine: g.publishedBy === user.id,
      placeholder: !!db.get('gameVersions', g.currentVersionId)?.placeholder,
      owners: db.filter('ownerships', (o) => o.gameId === g.id && o.source !== 'developer').length,
      sales: salesSummary(g.id),
      ranking: listingOf(g) === 'live' ? creatorRank(visibleRankings().byGame.get(g.id), visibleRankings().platform) : null,
      currentVersion: db.get('gameVersions', g.currentVersionId)?.version,
      moderation: moderationView(g),
      store: { shortDescription: g.shortDescription, description: g.description, tags: g.tags, priceCents: g.priceCents, demo: !!g.demo, builtWith: g.builtWith ?? [], vibe: g.vibe ?? null },
      versions: vers.map((v) => ({ version: v.version, releasedAt: v.releasedAt, notes: v.notes, sizeBytes: v.sizeBytes, fileCount: v.files.length, placeholder: v.placeholder, review: v.review ?? 'approved' })),
    };
  });
});
// Store-page edits by the creator go live immediately (they're logged for moderators).
route('PATCH', '/api/creator/games/:id', async ({ user, session, params, body }) => {
  const g = requireGame(params.id);
  if (!canUpdateGame(user, session, g)) fail(403, 'Only the game’s creator can edit it');
  const patch = {};
  if (body?.shortDescription !== undefined) patch.shortDescription = String(body.shortDescription).trim().slice(0, 300) || g.shortDescription;
  if (body?.description !== undefined) patch.description = String(body.description).split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
  if (body?.tags !== undefined) { const t = (Array.isArray(body.tags) ? body.tags : []).map((x) => String(x).trim().slice(0, 30)).filter(Boolean).slice(0, 8); if (t.length) patch.tags = t; }
  if (body?.priceCents !== undefined) {
    const c = Math.round(Number(body.priceCents));
    if (!Number.isFinite(c) || c < 0 || c > 9999) fail(400, 'Price must be between $0 and $99.99');
    patch.priceCents = c;
  }
  if (body?.demo !== undefined) patch.demo = body.demo ? { minutes: 5 } : null;
  if (body?.builtWith !== undefined || body?.vibe !== undefined) {
    try { const v = cleanVibe(body.builtWith ?? g.builtWith, body.vibe ?? g.vibe); patch.builtWith = v.builtWith; patch.vibe = v.vibe; } catch (e) { fail(400, e.message); }
  }
  // Store art: any of cover / header / hero, and screenshots (replaces the whole set).
  // New files get a fresh name so browsers and caches pick them up straight away.
  const m = body?.media;
  if (m && typeof m === 'object') {
    const stamp = Date.now().toString(36);
    const media = { ...g.media };
    for (const k of ['cover', 'header', 'hero']) if (m[k]) media[k] = saveImage(g.id, `${k}-${stamp}`, m[k]);
    if (Array.isArray(m.screenshots) && m.screenshots.length) media.screenshots = m.screenshots.slice(0, 6).map((x, i) => saveImage(g.id, `shot${i + 1}-${stamp}`, x));
    patch.media = media;
  }
  db.update(g, { ...patch, moderation: [...(g.moderation ?? []), { at: db.now(), action: 'edited', by: user.id, fields: Object.keys(patch) }] });
  if (patch.media) await backupUploads(g.id);
  return { ok: true, game: publicGame(g) };
});
route('POST', '/api/games/:id/versions', async ({ user, session, params, body, ctx }) => {
  const g = requireGame(params.id);
  if (!canUpdateGame(user, session, g)) fail(403, 'Only the developer who published this game can update it');
  limit(`publish:${user.id}`, 20, 60 * 60e3);
  const prev = g.currentVersionId ? db.get('gameVersions', g.currentVersionId) : null;
  const pkg = body?.package ?? fail(400, 'A game package is required');
  let report;
  try { report = inspectPackage(pkg.filename ?? 'package.zip', decodeB64(pkg.dataBase64, 50e6)); } catch (e) { fail(400, e.message); }
  if (!report.ok) fail(422, `Package invalid: ${report.errors.join('; ')}`);
  const version = String(body?.version || report.manifest.version || '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(400, 'Version must look like 1.2.0');
  const newest = db.filter('gameVersions', (v) => v.gameId === g.id && !v.placeholder).reduce((m, v) => (!m || semverGt(v.version, m) ? v.version : m), null);
  if (newest && !semverGt(version, newest)) fail(409, `Version must be higher than ${newest}`);
  if (db.find('gameVersions', (v) => v.gameId === g.id && v.version === version)) fail(409, `Version ${version} already exists`);
  const notes = String(body?.releaseNotes ?? '').trim().slice(0, 2000) || 'Bug fixes and improvements.';
  const manifest = { ...report.manifest, name: g.title, version };
  try { installPackage(g.id, version, report.entries, manifest); } catch (e) { fail(409, e.message); }
  const ver = createVersion({ gameId: g.id, pkgDir: g.id, pkgVersion: version, notes });
  // Updates to a live game wait for review; while a game itself is still pending,
  // the new build simply replaces the one under review.
  const needsReview = requireApproval() && !isAdmin(session);
  if (!needsReview) activateVersion(g, ver);
  else if (listingOf(g) !== 'live') { db.update(ver, { review: 'pending' }); db.update(g, { currentVersionId: ver.id }); }
  else db.update(ver, { review: 'pending', submittedBy: user.id });
  db.update(g, { moderation: [...(g.moderation ?? []), { at: db.now(), action: needsReview ? 'update-submitted' : 'updated', by: user.id, version }] });
  await backupUploads(g.id, version);
  if (needsReview && listingOf(g) === 'live') notifyAdmins(`Update to review: ${g.title} ${version}`, `${user.displayName} submitted version ${version} of “${g.title}”.`, `${baseUrl(ctx)}/admin`);
  // Delta vs previous build: what an installed player actually downloads.
  const prevHashes = new Set((prev?.files ?? []).map((f) => f.sha256));
  const changed = ver.files.filter((f) => !prevHashes.has(f.sha256));
  return {
    gameId: g.id, version: ver.version, previousVersion: prev?.version ?? null, buildHash: ver.buildHash, notes,
    pendingReview: ver.review === 'pending',
    delta: { changedFiles: changed.length, totalFiles: ver.files.length, downloadBytes: changed.reduce((t, f) => t + f.size, 0), totalBytes: ver.sizeBytes },
  };
});

// ----- reviews -----
// Any signed-in (non-guest) player who owns a game can review it, except its developer.
// One review per player per game (editing replaces it). Sample games also carry
// fictional written reviews (demo: true), shown only while sample content is visible.
const REVIEW_MAX = 4000;
function reviewEligibility(user, g) {
  const own = db.find('ownerships', (o) => o.userId === user.id && o.gameId === g.id);
  if (own?.source === 'developer' || g.publishedBy === user.id) return { ok: false, reason: 'developer' };
  if (user.guest) return { ok: false, reason: 'guest' };
  if (!own) return { ok: false, reason: 'not_owned' };
  return { ok: true, reason: null };
}
function publicReview(r, viewer) {
  const u = r.userId ? db.get('users', r.userId) : null;
  return {
    id: r.id, up: r.up, text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt ?? null, sample: !!r.demo,
    author: u ? { name: u.displayName, avatarHue: u.avatarHue } : { name: r.authorName ?? 'Player', avatarHue: r.avatarHue ?? 280 },
    playtimeSeconds: r.userId ? playStats(r.userId, r.gameId).playtimeSeconds : (r.playtimeSeconds ?? 0),
    mine: !!viewer && r.userId === viewer.id,
  };
}
route('GET', '/api/games/:id/reviews', ({ user, params, url }) => {
  const g = requireGame(params.id);
  const filter = url.searchParams.get('filter'); // 'up' | 'down' | null
  const rows = db.filter('reviews', (r) => r.gameId === g.id && (!r.demo || demoVisible()) && (filter === 'up' ? r.up : filter === 'down' ? !r.up : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mine = db.find('reviews', (r) => r.gameId === g.id && r.userId === user.id);
  return {
    rating: ratingFor(g), total: rows.length,
    reviews: rows.slice(0, 50).map((r) => publicReview(r, user)),
    mine: mine ? publicReview(mine, user) : null,
    eligibility: reviewEligibility(user, g),
  };
});
route('PUT', '/api/games/:id/review', ({ user, params, body }) => {
  const g = requireGame(params.id);
  const el = reviewEligibility(user, g);
  if (!el.ok) fail(403, { guest: 'Create an account to write reviews', not_owned: 'Only players who own this game can review it', developer: 'You can’t review your own game' }[el.reason]);
  if (typeof body?.up !== 'boolean') fail(400, 'Pick thumbs up or thumbs down');
  const text = String(body.text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (text.length > REVIEW_MAX) fail(400, `Reviews can be up to ${REVIEW_MAX} characters`);
  limit(`review:${user.id}`, 20, 10 * 60e3);
  const existing = db.find('reviews', (r) => r.gameId === g.id && r.userId === user.id);
  const row = existing
    ? db.update(existing, { up: body.up, text, updatedAt: db.now() })
    : db.insert('reviews', { id: db.id('rev'), gameId: g.id, userId: user.id, up: body.up, text, demo: false, createdAt: db.now(), updatedAt: null });
  return { review: publicReview(row, user), rating: ratingFor(g) };
});
route('DELETE', '/api/games/:id/review', ({ user, params }) => {
  const g = requireGame(params.id);
  db.remove('reviews', (r) => r.gameId === g.id && r.userId === user.id);
  return { ok: true, rating: ratingFor(g) };
});
// Moderation: admins can remove any review.
route('DELETE', '/api/reviews/:id', ({ session, params }) => {
  requireAdmin(session);
  const r = db.get('reviews', params.id) ?? fail(404, 'Review not found');
  db.remove('reviews', (x) => x.id === r.id);
  return { ok: true };
});

// ----- site settings (admin) -----
route('GET', '/api/admin/settings', ({ session }) => {
  requireAdmin(session);
  return { demoContent: demoMode(), demoContentDefault: DEMO_CONTENT_DEFAULT, modes: DEMO_CONTENT_MODES, requireApproval: requireApproval() };
});
route('PUT', '/api/admin/settings', ({ user, session, body }) => {
  requireAdmin(session);
  if (body?.demoContent !== undefined) {
    if (!DEMO_CONTENT_MODES.includes(body.demoContent)) fail(400, `demoContent must be one of ${DEMO_CONTENT_MODES.join(', ')}`);
    setSetting('demoContent', body.demoContent);
  }
  if (body?.requireApproval !== undefined) setSetting('requireApproval', !!body.requireApproval);
  return { demoContent: demoMode(), requireApproval: requireApproval(), state: userState(user, session) };
});

// ======================================================================
// Email verification + password reset
// ======================================================================
// One-time tokens: only a SHA-256 of the token is stored.
const tokenHash = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
function createToken(type, userId, ttlMs) {
  db.remove('tokens', (t) => t.userId === userId && t.type === type); // one live token per purpose
  db.remove('tokens', (t) => Date.parse(t.expiresAt) < Date.now() - 86400e3);
  const raw = crypto.randomBytes(32).toString('base64url');
  db.insert('tokens', { id: tokenHash(raw), type, userId, createdAt: db.now(), expiresAt: new Date(Date.now() + ttlMs).toISOString(), usedAt: null });
  return raw;
}
function useToken(type, raw) {
  const t = db.get('tokens', tokenHash(raw ?? ''));
  if (!t || t.type !== type || t.usedAt || Date.parse(t.expiresAt) < Date.now()) fail(400, 'This link is invalid or has expired. Request a new one.');
  db.update(t, { usedAt: db.now() });
  return db.get('users', t.userId) ?? fail(400, 'This link is invalid or has expired.');
}
function sendVerification(user, ctx) {
  if (!user.email || emailVerified(user)) return;
  const raw = createToken('verify', user.id, 48 * 3600e3);
  emails.verify(user.email, user.displayName, `${baseUrl(ctx)}/verify-email?token=${raw}`);
}
route('POST', '/api/auth/verify/resend', ({ user, ctx }) => {
  if (user.guest) fail(400, 'Create an account first');
  if (emailVerified(user)) return { ok: true, alreadyVerified: true };
  limit(`verify-send:${user.id}`, 5, 60 * 60e3);
  sendVerification(user, ctx);
  return { ok: true };
});
route('POST', '/api/auth/verify', ({ user, session, body }) => {
  const account = useToken('verify', body?.token);
  db.update(account, { emailVerified: true, emailVerifiedAt: db.now() });
  return { ok: true, email: account.email, state: account.id === user.id ? userState(user, session) : null };
});
route('POST', '/api/auth/forgot', ({ body, ctx }) => {
  limit(`forgot:${ctx.ip}`, 10, 60 * 60e3);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const account = EMAIL_RE.test(email) ? db.find('users', (u) => u.email === email && !u.guest) : null;
  if (account) {
    limit(`forgot-user:${account.id}`, 5, 60 * 60e3);
    const raw = createToken('reset', account.id, 3600e3);
    emails.reset(account.email, account.displayName, `${baseUrl(ctx)}/reset-password?token=${raw}`);
  }
  return { ok: true }; // same answer either way, so emails can't be enumerated
});
route('POST', '/api/auth/reset', async ({ body, ctx }) => {
  limit(`reset:${ctx.ip}`, 20, 60 * 60e3);
  const next = String(body?.password ?? '');
  if (next.length < 8) fail(400, 'Password must be at least 8 characters');
  if (next.length > 200) fail(400, 'Password is too long');
  const account = useToken('reset', body?.token);
  db.update(account, { passwordHash: await hashPassword(next), emailVerified: true });
  db.remove('authSessions', (s) => s.userId === account.id); // sign out everywhere
  return { ok: true, email: account.email };
});

// ======================================================================
// Creators: joining + payouts (Stripe Connect Express)
// ======================================================================
route('POST', '/api/creator/join', ({ user, session, body }) => {
  if (user.guest) fail(401, 'Create an account first');
  if (!emailVerified(user)) fail(403, 'Confirm your email address first');
  if (user.creator?.status === 'suspended') fail(403, 'Your creator account is suspended. Contact support.');
  if (body?.agree !== true) fail(400, 'Please accept the Creator Agreement');
  db.update(user, { creator: { ...(user.creator ?? {}), status: 'active', since: user.creator?.since ?? db.now(), agreementVersion: LEGAL_VERSIONS.creators, acceptedAt: db.now() } });
  return userState(user, session);
});

function payoutView(user) {
  const earned = db.filter('earnings', (e) => e.creatorId === user.id);
  const sum = (st) => earned.filter((e) => st.includes(e.status)).reduce((t, e) => t + e.amountCents, 0);
  const p = user.payouts ?? {};
  return {
    enabled: stripeEnabled(), connected: !!p.accountId, ready: !!p.ready, detailsSubmitted: !!p.detailsSubmitted, country: p.country ?? null,
    platformCountry: PLATFORM_COUNTRY,
    totals: { pendingCents: sum(['pending']), paidCents: sum(['paid']), reversedCents: sum(['reversed']), testCents: sum(['test']) },
    recent: earned.slice(-25).reverse().map((e) => ({ id: e.id, gameId: e.gameId, title: db.get('games', e.gameId)?.title ?? e.gameId, amountCents: e.amountCents, status: e.status, createdAt: e.createdAt, paidAt: e.paidAt ?? null })),
  };
}
async function refreshPayoutAccount(user) {
  if (!stripeEnabled() || !user.payouts?.accountId) return user;
  const acct = await retrieveAccount(user.payouts.accountId);
  const wasReady = !!user.payouts.ready;
  db.update(user, { payouts: { ...user.payouts, ready: payoutsReady(acct), detailsSubmitted: !!acct.details_submitted, updatedAt: db.now() } });
  if (!wasReady && user.payouts.ready) {
    if (user.email) emails.payoutsReady(user.email, user.displayName, `${PUBLIC_URL || ''}/publish`);
    await settleCreator(user.id);
  }
  return user;
}
async function onAccountUpdated(acct) {
  const user = db.find('users', (u) => u.payouts?.accountId === acct.id);
  if (!user) return;
  const wasReady = !!user.payouts.ready;
  db.update(user, { payouts: { ...user.payouts, ready: payoutsReady(acct), detailsSubmitted: !!acct.details_submitted, updatedAt: db.now() } });
  if (!wasReady && user.payouts.ready) {
    if (user.email) emails.payoutsReady(user.email, user.displayName, `${PUBLIC_URL || ''}/publish`);
    await settleCreator(user.id);
  }
}
route('GET', '/api/creator/payouts', async ({ user, session }) => {
  requireCreator(user, session);
  try { await refreshPayoutAccount(user); } catch (err) { reportError(err, { where: 'refreshPayoutAccount' }); }
  return payoutView(user);
});
route('POST', '/api/creator/payouts/onboard', async ({ user, session, body, ctx }) => {
  requireCreator(user, session);
  if (!stripeEnabled()) fail(409, 'Payouts need Stripe to be configured on this server');
  limit(`onboard:${user.id}`, 10, 60 * 60e3);
  if (!user.payouts?.accountId) {
    const country = /^[A-Z]{2}$/.test(String(body?.country ?? '').toUpperCase()) ? String(body.country).toUpperCase() : null;
    if (!country) fail(400, 'Choose the country you’ll be paid in');
    const acct = await createConnectAccount({ email: user.email, userId: user.id, country });
    db.update(user, { payouts: { accountId: acct.id, country, ready: payoutsReady(acct), detailsSubmitted: !!acct.details_submitted, createdAt: db.now() } });
  }
  const base = baseUrl(ctx);
  const link = await createAccountLink(user.payouts.accountId, `${base}/publish?payouts=retry`, `${base}/publish?payouts=done`);
  return { url: link.url };
});
route('POST', '/api/creator/payouts/dashboard', async ({ user, session }) => {
  requireCreator(user, session);
  if (!user.payouts?.accountId) fail(409, 'Set up payouts first');
  const link = await createLoginLink(user.payouts.accountId);
  return { url: link.url };
});

// After a sale: work out the creator's share, pay it out, send the receipt.
// Share = CREATOR_SHARE × (price − tax − Stripe fee). Mock-wallet sales are
// recorded as 'test' earnings and never paid out.
async function afterPaid(order) {
  const g = db.get('games', order.gameId);
  const buyer = db.get('users', order.userId);
  if (order.amountCents > 0 && order.provider === 'stripe' && order.providerRef) {
    try {
      const d = await saleDetails(order.providerRef);
      db.update(order, { paymentIntentId: d.paymentIntentId, chargeId: d.chargeId, subtotalCents: d.subtotalCents ?? order.amountCents, taxCents: d.taxCents ?? 0, feeCents: d.feeCents });
    } catch (err) { reportError(err, { where: 'saleDetails', orderId: order.id }); }
  }
  const creatorId = g?.publishedBy && g.source === 'published' ? g.publishedBy : null;
  if (creatorId && order.amountCents > 0 && creatorId !== order.userId && !db.find('earnings', (e) => e.orderId === order.id)) {
    const net = Math.max(0, (order.subtotalCents ?? order.amountCents) - (order.feeCents ?? estimateFee(order.amountCents)));
    db.insert('earnings', {
      id: db.id('ern'), orderId: order.id, gameId: order.gameId, creatorId, currency: order.currency,
      grossCents: order.subtotalCents ?? order.amountCents, feeCents: order.feeCents ?? null, amountCents: Math.floor(net * CREATOR_SHARE),
      status: order.provider === 'stripe' ? 'pending' : 'test', createdAt: db.now(),
    });
    if (order.provider === 'stripe') await settleCreator(creatorId);
  }
  if (order.amountCents > 0 && buyer?.email && !buyer.guest) {
    emails.receipt(buyer.email, {
      name: buyer.displayName, title: g?.title ?? order.gameId, amount: money(order.amountCents + (order.taxCents ?? 0), order.currency),
      orderId: order.id, date: new Date(order.paidAt ?? Date.now()).toDateString(), url: `${PUBLIC_URL || ''}/play/${order.gameId}`, refundDays: REFUND_WINDOW_DAYS,
    });
  }
}
const estimateFee = (cents) => Math.round(cents * 0.029) + 30; // used until Stripe reports the real fee
const money = (cents, cur = CURRENCY) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);

// Send every pending earning for a creator whose payout account is ready.
async function settleCreator(creatorId) {
  const user = db.get('users', creatorId);
  if (!stripeEnabled() || !user?.payouts?.ready) return 0;
  let n = 0;
  for (const e of db.filter('earnings', (x) => x.creatorId === creatorId && x.status === 'pending')) {
    const order = db.get('orders', e.orderId);
    if (!order || order.status !== 'paid') { db.update(e, { status: 'cancelled' }); continue; }
    if (e.amountCents <= 0) { db.update(e, { status: 'paid', paidAt: db.now() }); continue; }
    try {
      const tr = await createTransfer({ amount: e.amountCents, destination: user.payouts.accountId, chargeId: order.chargeId, orderId: order.id, currency: e.currency });
      db.update(e, { status: 'paid', transferId: tr.id, paidAt: db.now(), lastError: null });
      n++;
    } catch (err) {
      db.update(e, { lastError: err.message, lastTriedAt: db.now() });
      reportError(err, { where: 'transfer', earningId: e.id });
    }
  }
  return n;
}
export async function settleAllCreators() {
  const ids = new Set(db.filter('earnings', (e) => e.status === 'pending').map((e) => e.creatorId));
  for (const id of ids) await settleCreator(id);
}

// ======================================================================
// Refunds
// ======================================================================
// Players can refund themselves within REFUND_WINDOW_DAYS of purchase if they've
// played less than REFUND_MAX_PLAY_MINUTES. Admins can refund anything.
function refundEligibility(o) {
  if (o.status !== 'paid' || !(o.amountCents > 0)) return { ok: false, reason: o.status === 'refunded' ? 'refunded' : 'not_refundable' };
  const days = (Date.now() - Date.parse(o.paidAt ?? o.createdAt)) / 86400e3;
  if (days > REFUND_WINDOW_DAYS) return { ok: false, reason: 'window', days: REFUND_WINDOW_DAYS };
  const mins = playStats(o.userId, o.gameId).playtimeSeconds / 60;
  if (mins >= REFUND_MAX_PLAY_MINUTES) return { ok: false, reason: 'playtime', minutes: REFUND_MAX_PLAY_MINUTES };
  return { ok: true, reason: null, daysLeft: Math.max(0, Math.floor(REFUND_WINDOW_DAYS - days)) };
}
async function refundOrder(order, { by, reason }) {
  if (order.status === 'refunded') fail(409, 'This order was already refunded');
  if (order.status !== 'paid' || !(order.amountCents > 0)) fail(400, 'This order can’t be refunded');
  if (order.provider === 'stripe') {
    if (!order.paymentIntentId) {
      const d = await saleDetails(order.providerRef);
      db.update(order, { paymentIntentId: d.paymentIntentId, chargeId: d.chargeId });
    }
    const r = await createRefund(order.paymentIntentId, order.id);
    db.update(order, { refundId: r.id });
  }
  await finishRefund(order, { by, reason });
}
async function finishRefund(order, { by, reason }) {
  if (order.status === 'refunded') return;
  db.update(order, { status: 'refunded', refundedAt: db.now(), refundedBy: by, refundReason: String(reason ?? '').slice(0, 300) });
  db.remove('ownerships', (o) => o.userId === order.userId && o.gameId === order.gameId && o.orderId === order.id);
  for (const e of db.filter('earnings', (x) => x.orderId === order.id)) {
    if (e.status === 'paid' && e.transferId) {
      try { await reverseTransfer(e.transferId); db.update(e, { status: 'reversed', reversedAt: db.now() }); }
      catch (err) { db.update(e, { status: 'reversal_failed', lastError: err.message }); reportError(err, { where: 'reverseTransfer', earningId: e.id }); }
    } else if (e.status === 'pending' || e.status === 'test') db.update(e, { status: 'cancelled' });
  }
  const buyer = db.get('users', order.userId);
  const g = db.get('games', order.gameId);
  if (buyer?.email && !buyer.guest) emails.refund(buyer.email, { name: buyer.displayName, title: g?.title ?? order.gameId, amount: money(order.amountCents + (order.taxCents ?? 0), order.currency) });
}
route('POST', '/api/orders/:id/refund', async ({ user, session, params, body }) => {
  const order = db.get('orders', params.id);
  if (!order || order.userId !== user.id) fail(404, 'Order not found');
  const el = refundEligibility(order);
  if (!el.ok) fail(403, { refunded: 'This order was already refunded', window: `Refunds are available for ${REFUND_WINDOW_DAYS} days after purchase`, playtime: `Refunds are available if you’ve played less than ${REFUND_MAX_PLAY_MINUTES / 60} hours`, not_refundable: 'This order can’t be refunded' }[el.reason]);
  limit(`refund:${user.id}`, 5, 24 * 3600e3);
  await refundOrder(order, { by: 'player', reason: body?.reason });
  return { order: publicOrder(order), state: userState(user, session) };
});

// ======================================================================
// Reports (players flag games or reviews)
// ======================================================================
const REPORT_REASONS = ['broken', 'malware', 'stolen', 'offensive', 'misleading', 'spam', 'other'];
route('POST', '/api/reports', ({ user, body, ctx }) => {
  limit(`report:${ctx.ip}`, 10, 60 * 60e3);
  const type = body?.type === 'review' ? 'review' : body?.type === 'game' ? 'game' : fail(400, 'Unknown report type');
  const reason = REPORT_REASONS.includes(body?.reason) ? body.reason : fail(400, 'Pick a reason');
  let gameId;
  if (type === 'game') gameId = requireGame(String(body?.targetId ?? '')).id;
  else { const r = db.get('reviews', String(body?.targetId ?? '')) ?? fail(404, 'Review not found'); gameId = r.gameId; }
  if (db.find('reports', (r) => r.userId === user.id && r.targetId === body.targetId && r.status === 'open')) return { ok: true, duplicate: true };
  db.insert('reports', { id: db.id('rep'), type, targetId: String(body.targetId), gameId, userId: user.id, reason, details: String(body?.details ?? '').slice(0, 1000), status: 'open', createdAt: db.now() });
  return { ok: true };
});

// ======================================================================
// Admin: review queue, takedowns, reports, orders, creators, email outbox
// ======================================================================
const userBrief = (id) => { const u = id ? db.get('users', id) : null; return u ? { id: u.id, name: u.displayName, email: u.email ?? null, verified: emailVerified(u), creator: u.creator?.status ?? null } : null; };
function adminGame(g) {
  const ver = g.currentVersionId ? db.get('gameVersions', g.currentVersionId) : null;
  return {
    id: g.id, title: g.title, listing: listingOf(g), source: g.source, sample: isSample(g), priceCents: g.priceCents, media: g.media,
    creator: userBrief(g.publishedBy), submittedAt: g.submittedAt ?? g.createdAt, shortDescription: g.shortDescription, tags: g.tags, builtWith: g.builtWith ?? [],
    version: ver ? { id: ver.id, version: ver.version, sizeBytes: ver.sizeBytes, fileCount: ver.files.length, notes: ver.notes, review: ver.review ?? 'approved' } : null,
    sales: salesSummary(g.id), openReports: db.filter('reports', (r) => r.gameId === g.id && r.status === 'open').length,
    history: (g.moderation ?? []).slice(-10),
  };
}
route('GET', '/api/admin/queue', ({ session }) => {
  requireAdmin(session);
  const games = db.filter('games', (g) => listingOf(g) === 'pending').map(adminGame);
  const updates = db.filter('gameVersions', (v) => v.review === 'pending' && listingOf(db.get('games', v.gameId)) === 'live').map((v) => {
    const g = db.get('games', v.gameId);
    const cur = db.get('gameVersions', g.currentVersionId);
    return { id: v.id, gameId: g.id, title: g.title, media: g.media, version: v.version, currentVersion: cur?.version ?? null, notes: v.notes, sizeBytes: v.sizeBytes, fileCount: v.files.length, submittedAt: v.releasedAt, creator: userBrief(v.submittedBy ?? g.publishedBy) };
  });
  return { games, updates, openReports: db.filter('reports', (r) => r.status === 'open').length };
});
function moderate(g, action, by, note) {
  db.update(g, { moderation: [...(g.moderation ?? []), { at: db.now(), action, by, note: String(note ?? '').slice(0, 1000) || null }] });
}
function tellCreator(g, { approved, note, isUpdate }, ctx) {
  const c = db.get('users', g.publishedBy);
  if (c?.email) emails.gameReviewed(c.email, { name: c.displayName, title: g.title, approved, note, isUpdate, url: `${baseUrl(ctx)}${approved ? `/app/${g.id}` : '/publish'}` });
}
route('POST', '/api/admin/games/:id/:action', ({ user, session, params, body, ctx }) => {
  requireAdmin(session);
  const g = db.get('games', params.id) ?? fail(404, 'Game not found');
  const note = body?.note;
  switch (params.action) {
    case 'approve': {
      if (listingOf(g) !== 'pending' && listingOf(g) !== 'rejected') fail(409, 'This game is not waiting for review');
      const ver = db.get('gameVersions', g.currentVersionId);
      if (ver) activateVersion(g, ver);
      db.update(g, { listing: 'live', releaseDate: db.now().slice(0, 10), createdAt: db.now() }); // discovery window starts at launch
      moderate(g, 'approved', user.id, note); tellCreator(g, { approved: true, note }, ctx);
      break;
    }
    case 'reject':
      if (!String(note ?? '').trim()) fail(400, 'Tell the creator what to change');
      db.update(g, { listing: 'rejected' }); moderate(g, 'rejected', user.id, note); tellCreator(g, { approved: false, note }, ctx);
      break;
    case 'takedown':
      db.update(g, { listing: 'removed' }); moderate(g, 'removed', user.id, note);
      break;
    case 'restore':
      db.update(g, { listing: 'live' }); moderate(g, 'restored', user.id, note);
      break;
    default: fail(404, 'Unknown action');
  }
  return adminGame(g);
});
route('POST', '/api/admin/versions/:id/:action', ({ user, session, params, body, ctx }) => {
  requireAdmin(session);
  const ver = db.get('gameVersions', params.id) ?? fail(404, 'Version not found');
  const g = db.get('games', ver.gameId);
  if (ver.review !== 'pending') fail(409, 'This update is not waiting for review');
  if (params.action === 'approve') {
    activateVersion(g, ver);
    moderate(g, 'update-approved', user.id, body?.note); tellCreator(g, { approved: true, note: body?.note, isUpdate: true }, ctx);
  } else if (params.action === 'reject') {
    if (!String(body?.note ?? '').trim()) fail(400, 'Tell the creator what to change');
    db.update(ver, { review: 'rejected' });
    moderate(g, 'update-rejected', user.id, body?.note); tellCreator(g, { approved: false, note: body?.note, isUpdate: true }, ctx);
  } else fail(404, 'Unknown action');
  return { ok: true };
});
route('GET', '/api/admin/games', ({ session, url }) => {
  requireAdmin(session);
  const q = String(url.searchParams.get('q') ?? '').toLowerCase();
  return db.all('games').filter((g) => !q || g.title.toLowerCase().includes(q) || g.id.includes(q)).map(adminGame)
    .sort((a, b) => (a.sample - b.sample) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
});
route('GET', '/api/admin/reports', ({ session, url }) => {
  requireAdmin(session);
  const status = url.searchParams.get('status') ?? 'open';
  return db.filter('reports', (r) => status === 'all' || r.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map((r) => {
    const review = r.type === 'review' ? db.get('reviews', r.targetId) : null;
    return { ...r, reporter: userBrief(r.userId), game: { id: r.gameId, title: db.get('games', r.gameId)?.title ?? r.gameId }, review: review ? { text: review.text, up: review.up, author: userBrief(review.userId)?.name ?? review.authorName } : null };
  });
});
route('POST', '/api/admin/reports/:id/resolve', ({ user, session, params, body }) => {
  requireAdmin(session);
  const r = db.get('reports', params.id) ?? fail(404, 'Report not found');
  const action = body?.action === 'remove' ? 'remove' : 'dismiss';
  if (action === 'remove') {
    if (r.type === 'review') db.remove('reviews', (x) => x.id === r.targetId);
    else { const g = db.get('games', r.targetId); if (g) { db.update(g, { listing: 'removed' }); moderate(g, 'removed', user.id, `Report: ${r.reason}`); } }
  }
  // Close every open report about the same thing.
  for (const x of db.filter('reports', (y) => y.targetId === r.targetId && y.status === 'open')) db.update(x, { status: action === 'remove' ? 'resolved' : 'dismissed', resolvedAt: db.now(), resolvedBy: user.id });
  return { ok: true };
});
route('GET', '/api/admin/orders', ({ session, url }) => {
  requireAdmin(session);
  const q = String(url.searchParams.get('q') ?? '').trim().toLowerCase();
  return db.all('orders').filter((o) => o.amountCents > 0 && (!q || o.id.toLowerCase().includes(q) || (db.get('users', o.userId)?.email ?? '').includes(q) || o.gameId.includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    .map((o) => ({ ...publicOrder(o), buyer: userBrief(o.userId), refundedBy: o.refundedBy ?? null }));
});
route('POST', '/api/admin/orders/:id/refund', async ({ session, params, body }) => {
  requireAdmin(session);
  const order = db.get('orders', params.id) ?? fail(404, 'Order not found');
  await refundOrder(order, { by: 'admin', reason: body?.reason });
  return publicOrder(order);
});
route('GET', '/api/admin/creators', ({ session }) => {
  requireAdmin(session);
  return db.filter('users', (u) => u.creator).map((u) => ({
    ...userBrief(u.id), since: u.creator.since, agreementVersion: u.creator.agreementVersion, payoutsReady: !!u.payouts?.ready,
    games: db.filter('games', (g) => g.publishedBy === u.id).map((g) => ({ id: g.id, title: g.title, listing: listingOf(g) })),
  }));
});
route('POST', '/api/admin/creators/:id/:action', ({ session, params }) => {
  requireAdmin(session);
  const u = db.get('users', params.id) ?? fail(404, 'User not found');
  if (!u.creator) fail(409, 'Not a creator');
  if (params.action === 'suspend') db.update(u, { creator: { ...u.creator, status: 'suspended', suspendedAt: db.now() } });
  else if (params.action === 'reinstate') db.update(u, { creator: { ...u.creator, status: 'active' } });
  else fail(404, 'Unknown action');
  return { ok: true };
});
route('GET', '/api/admin/outbox', ({ session }) => {
  requireAdmin(session);
  return db.all('outbox').slice(-60).reverse();
});

// Browser errors → error tracking (rate limited, never trusted).
route('POST', '/api/client-errors', ({ body, ctx }) => {
  limit(`client-error:${ctx.ip}`, 20, 10 * 60e3);
  const e = new Error(String(body?.message ?? 'Unknown client error').slice(0, 500));
  e.name = 'ClientError';
  e.stack = `ClientError: ${e.message}\n${String(body?.stack ?? '').slice(0, 4000)}`;
  reportError(e, { url: String(body?.url ?? '').slice(0, 300), silent: true }, { platform: 'javascript', tags: { side: 'browser' } });
  return { ok: true };
});


export async function handleApi(req, res, url, body, ctx) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const { user, session } = authenticate(req, res, ctx);
    const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    return reqCtx.run({ session, user }, () => r.handler({ user, session, params, body, url, ctx, res }));
  }
  fail(404, 'No such endpoint');
}
