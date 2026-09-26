// Seeds the database from the catalog + package directories.
import fs from 'node:fs';
import path from 'node:path';
import * as db from './db.js';
import { hashDir, packageDir, readManifest } from './packages.js';
import { developers, games, placeholderAchievements } from '../catalog/games.js';

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
  return db.insert('gameVersions', {
    id: db.id('ver'), gameId, version: placeholder ? '0.0.1-placeholder' : manifest.version,
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
