// Seeds the database from the catalog + package directories.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { hashDir, packageDir, readManifest } from './packages.js';
import { developers, games, placeholderAchievements, sampleReviews } from '../catalog/games.js';
import { ACCOUNT_MODE, BUILTIN_PACKAGES_DIR } from './config.js';
import { signBuild, currentKeyId } from './signing.js';

export const DEFAULT_USER_ID = 'usr_jason';
const PLACEHOLDER = { dir: '_placeholder', version: '1.0.0' };

function mediaFor(id) {
  const base = `/media/${id}`;
  const dir = path.resolve('public/media', id);
  const shots = [];
  for (let i = 1; i <= 5; i++) {
    for (const ext of ['png', 'jpg', 'svg']) {
      if (fs.existsSync(path.join(dir, `shot${i}.${ext}`))) { shots.push(`${base}/shot${i}.${ext}`); break; }
    }
  }
  return { cover: `${base}/cover.svg`, header: `${base}/header.svg`, hero: `${base}/hero.svg`, screenshots: shots };
}

export function createVersion({ gameId, pkgDir, pkgVersion, placeholder = false, notes, releasedAt }) {
  const manifest = readManifest(pkgDir, pkgVersion);
  const { files, sizeBytes, buildHash } = hashDir(packageDir(pkgDir, pkgVersion));
  const version = placeholder ? '0.0.1-placeholder' : manifest.version;
  const { signature } = signBuild({ gameId, version, entry: manifest.entry, buildHash, files });
  return db.insert('gameVersions', {
    id: db.id('ver'), gameId, version, signature, signKeyId: currentKeyId(),
    packagePath: `${pkgDir}/${pkgVersion}`, entry: manifest.entry, sdk: String(manifest.sdk),
    runtime: manifest.runtime ?? { min: '1.0', features: [] }, input: manifest.input ?? [],
    files, sizeBytes, buildHash, placeholder, notes: notes ?? '', releasedAt: releasedAt ?? db.now(),
    manifestAchievements: manifest.achievements ?? [],
  });
}

export function seed() {
  const created = '2026-01-01T00:00:00.000Z';
  for (const d of developers) db.insert('developers', { ...d, userId: null, createdAt: created });

  for (const g of games) {
    const row = db.insert('games', {
      id: g.id, title: g.title, developerId: g.developerId, priceCents: g.priceCents,
      tags: g.tags, features: g.features, shortDescription: g.short, description: g.description,
      releaseDate: g.releaseDate, status: g.status, rating: g.rating, stats: g.stats,
      featured: g.featured, demo: g.demo, logo: g.logo, media: mediaFor(g.id), blurb: g.blurb,
      builtWith: g.builtWith ?? [], vibe: g.vibe ?? null,
      currentVersionId: null, source: 'seed', createdAt: created,
    });
    if (g.status !== 'released') {
      placeholderAchievements.forEach((a) => db.insert('achievements', { id: `${g.id}:${a.id}`, gameId: g.id, key: a.id, name: a.name, description: a.description }));
      continue;
    }
    const pkg = g.package ?? PLACEHOLDER;
    const ver = createVersion({ gameId: g.id, pkgDir: pkg.dir, pkgVersion: pkg.version, placeholder: !g.package, releasedAt: `${g.releaseDate}T12:00:00.000Z`, notes: g.package ? 'Launch build.' : '' });
    db.update(row, { currentVersionId: ver.id });
    const defs = g.package ? ver.manifestAchievements : placeholderAchievements;
    defs.forEach((a) => db.insert('achievements', { id: `${g.id}:${a.id}`, gameId: g.id, key: a.id, name: a.name, description: a.description }));
  }

  seedSampleReviews();
  if (ACCOUNT_MODE === 'single') seedDemoUser();
}

// Fictional written reviews for the sample games (demo: true). Idempotent.
export function seedSampleReviews() {
  for (const [gameId, list] of Object.entries(sampleReviews)) {
    list.forEach(([authorName, up, hours, date, text], i) => {
      const id = `rev_sample_${gameId}_${i}`;
      if (db.get('reviews', id)) return;
      let h = 0; for (const c of authorName) h = (h * 31 + c.charCodeAt(0)) % 360;
      db.insert('reviews', { id, gameId, userId: null, authorName, avatarHue: h, up, text, playtimeSeconds: Math.round(hours * 3600), demo: true, createdAt: `${date}T18:00:00.000Z`, updatedAt: null });
    });
  }
}

// Keeps an existing database in step with the code on every start:
//  • seed games pick up catalog fields added later (built-with tools, vibe
//    metadata, store copy), so an old data/db.json doesn't need a reset;
//  • built-in packages that were edited on disk are re-hashed and re-signed, so
//    offline verification keeps matching the files the server actually serves.
// Published (creator-uploaded) games and versions are never touched.
export function syncSeedCatalog() {
  retireRemovedSeedGames();
  seedSampleReviews();
  for (const g of games) {
    const row = db.get('games', g.id);
    if (!row || row.source !== 'seed') continue;
    const patch = {};
    for (const [k, v] of Object.entries({ builtWith: g.builtWith ?? [], vibe: g.vibe ?? null, shortDescription: g.short, description: g.description, blurb: g.blurb, features: g.features })) {
      if (JSON.stringify(row[k] ?? null) !== JSON.stringify(v ?? null)) patch[k] = v;
    }
    if (Object.keys(patch).length) db.update(row, patch);
  }
  for (const ver of db.all('gameVersions')) {
    const [dir, version] = String(ver.packagePath ?? '').split('/');
    const game = db.get('games', ver.gameId);
    if (!dir || !version || game?.source !== 'seed' || !fs.existsSync(path.join(BUILTIN_PACKAGES_DIR, dir, version))) continue;
    const { files, sizeBytes, buildHash } = hashDir(packageDir(dir, version));
    if (buildHash === ver.buildHash) continue;
    const { signature } = signBuild({ gameId: ver.gameId, version: ver.version, entry: ver.entry, buildHash, files });
    db.update(ver, { files, sizeBytes, buildHash, signature, signKeyId: currentKeyId() });
  }
}

// Sample games that were taken out of the catalog (Nightpaw moved out to be
// uploaded through Publish like any other game) are removed from an existing
// database along with their builds, achievements, demo purchases, saves and
// sample reviews, so their id is free again. A game someone paid real money for
// (a Stripe order) is left alone and a warning is logged instead.
const GAME_TABLES = ['gameVersions', 'achievements', 'userAchievements', 'ownerships', 'orders', 'saves', 'playSessions', 'wishlists', 'reviews', 'reports'];
export function retireRemovedSeedGames() {
  const inCatalog = new Set(games.map((g) => g.id));
  for (const g of db.filter('games', (x) => x.source === 'seed' && !inCatalog.has(x.id))) {
    const paid = db.filter('orders', (o) => o.gameId === g.id && o.provider === 'stripe' && ['paid', 'refunded'].includes(o.status));
    if (paid.length) {
      console.warn(`[seed] ${g.id} is no longer in the sample catalog but has ${paid.length} real order(s); leaving it in place.`);
      continue;
    }
    for (const t of GAME_TABLES) db.remove(t, (r) => r.gameId === g.id);
    db.remove('games', (r) => r.id === g.id);
    console.log(`[seed] Removed retired sample game ${g.id}`);
  }
  const catalogDevs = new Set(developers.map((d) => d.id));
  db.remove('developers', (d) => !d.userId && !catalogDevs.has(d.id) && !db.all('games').some((g) => g.developerId === d.id));
}

// The original single-account demo ("Jason" with some play history). Only used with ACCOUNT_MODE=single.
export function seedDemoUser() {
  db.insert('users', {
    id: DEFAULT_USER_ID, username: 'jason', displayName: 'Jason', avatarHue: 32,
    memberSince: '2024-03-12T10:00:00.000Z', country: 'GE',
  });

  // A little prior history so Library/Profile aren't empty on first open.
  // The two real games are intentionally NOT owned, so the primary flow
  // (discover → try → buy → play → save → return) can be exercised from scratch.
  const history = [
    { gameId: 'hollow-lantern', acquired: '2026-06-05', hours: 23.4, sessions: 14, last: '2026-09-24T21:10:00.000Z', ach: ['first_steps', 'regular', 'dedicated'] },
    { gameId: 'night-market', acquired: '2026-08-03', hours: 6.2, sessions: 5, last: '2026-09-19T20:02:00.000Z', ach: ['first_steps', 'regular'] },
    { gameId: 'cold-summit', acquired: '2026-04-20', hours: 1.1, sessions: 2, last: '2026-05-02T18:40:00.000Z', ach: ['first_steps'] },
  ];
  for (const h of history) {
    const game = db.get('games', h.gameId);
    db.insert('ownerships', { id: db.id('own'), userId: DEFAULT_USER_ID, gameId: h.gameId, source: 'purchase', pricePaidCents: game.priceCents, orderId: db.id('ord'), acquiredAt: `${h.acquired}T12:00:00.000Z` });
    const per = Math.round((h.hours * 3600) / h.sessions);
    const lastMs = Date.parse(h.last);
    for (let i = 0; i < h.sessions; i++) {
      const start = new Date(lastMs - (h.sessions - 1 - i) * 3 * 86400000);
      db.insert('playSessions', { id: db.id('ses'), userId: DEFAULT_USER_ID, gameId: h.gameId, versionId: game.currentVersionId, mode: 'full', startedAt: start.toISOString(), lastHeartbeatAt: new Date(start.getTime() + per * 1000).toISOString(), endedAt: new Date(start.getTime() + per * 1000).toISOString(), seconds: per });
    }
    h.ach.forEach((k, i) => db.insert('userAchievements', { userId: DEFAULT_USER_ID, gameId: h.gameId, achievementId: `${h.gameId}:${k}`, unlockedAt: new Date(Date.parse(`${h.acquired}T20:00:00Z`) + i * 5 * 86400000).toISOString() }));
    db.insert('saves', { userId: DEFAULT_USER_ID, gameId: h.gameId, key: 'launches', value: h.sessions, revision: h.sessions, sizeBytes: 2, updatedAt: h.last });
  }
  for (const [gameId, d] of [['kepler', '2026-09-02'], ['starfall', '2026-09-12'], ['ashfall', '2026-09-20']]) {
    db.insert('wishlists', { userId: DEFAULT_USER_ID, gameId, addedAt: `${d}T12:00:00.000Z` });
  }
}
