// Unit test for the discovery algorithm (server/ranking.js) on synthetic play data.
//   node scripts/test-ranking.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-rank-'));
process.env.DATA_DIR = tmp;
process.env.PACKAGE_SIGNING_KEY = '';
const { initSigning } = await import('../server/signing.js');
const db = await import('../server/db.js');
const { seed } = await import('../server/seed.js');
const { rankings, creatorRank, RANK } = await import('../server/ranking.js');
initSigning();
db.open(path.join(tmp, 'db.json'), seed);

const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

const NOW = Date.now(), DAY = 86400e3;
const iso = (ms) => new Date(ms).toISOString();
const verId = db.all('games').find((g) => g.currentVersionId).currentVersionId;
let u = 0;
const user = (guest = false) => db.insert('users', { id: `usr_t${u++}`, username: `t${u}`, displayName: `T${u}`, guest });
const dev = user();
function game(id, { priceCents = 499, ageDays = 40, demo = true } = {}) {
  return db.insert('games', { id, title: id, developerId: 'dev_x', priceCents, tags: ['Test'], status: 'released', currentVersionId: verId, source: 'published', publishedBy: dev.id, createdAt: iso(NOW - ageDays * DAY), releaseDate: iso(NOW - ageDays * DAY).slice(0, 10), demo: demo ? { minutes: 5 } : null, stats: { sales: 0, trend: 100 }, rating: null });
}
let ip = 0;
function play(gameId, userId, { daysAgo = 3, minutes = 10, mode = 'full', ipHash, connected = true, errors = 0 } = {}) {
  const start = NOW - daysAgo * DAY;
  db.insert('playSessions', { id: db.id('ses'), userId, gameId, versionId: verId, mode, startedAt: iso(start), lastHeartbeatAt: iso(start), endedAt: iso(start + minutes * 60e3), seconds: Math.round(minutes * 60), ipHash: ipHash ?? `ip${ip++}`, connected, errors });
}
const buy = (gameId, userId, cents, daysAgo) => db.insert('orders', { id: db.id('ord'), userId, gameId, amountCents: cents, currency: 'usd', provider: 'mock', status: 'paid', createdAt: iso(NOW - daysAgo * DAY), paidAt: iso(NOW - daysAgo * DAY) });
const claim = (gameId, userId, daysAgo) => db.insert('ownerships', { id: db.id('own'), userId, gameId, source: 'purchase', pricePaidCents: 0, acquiredAt: iso(NOW - daysAgo * DAY) });

// A: a great paid game, played over the whole month.
game('great');
for (let i = 0; i < 250; i++) {
  const p = user(); const d = 2 + (i % 26);
  const demo = i < 100;
  play('great', p.id, { daysAgo: d, minutes: i % 20 < 13 ? 25 : 4, mode: demo ? 'demo' : 'full' });
  if (i % 3 === 0) play('great', p.id, { daysAgo: d - 1, minutes: 15 });
  if (demo && i % 10 < 3) buy('great', p.id, 499, d - 0.5);
}
// B: shallow game - people bounce.
game('shallow');
for (let i = 0; i < 250; i++) play('shallow', user().id, { daysAgo: 2 + (i % 26), minutes: 3, mode: i < 100 ? 'demo' : 'full' });
// C: brand new, good early numbers.
game('fresh', { ageDays: 3 });
for (let i = 0; i < 40; i++) play('fresh', user().id, { daysAgo: 1 + (i % 2), minutes: 30 });
// D: bot farm - 300 guest accounts from one network.
game('sybil', { ageDays: 3 });
for (let i = 0; i < 300; i++) play('sybil', user(true).id, { daysAgo: 1, minutes: 40, ipHash: 'farm' });
// E: broken build - most launches never connect to the SDK.
game('broken');
for (let i = 0; i < 30; i++) play('broken', user().id, { daysAgo: 5, minutes: 1, connected: i < 5 });
// F: a free hit, growing fast this week.
game('freebie', { priceCents: 0, demo: false });
for (let i = 0; i < 250; i++) {
  const p = user(); const d = 1 + (i % 6);
  claim('freebie', p.id, d + 0.2);
  if (i % 10 !== 0) { play('freebie', p.id, { daysAgo: d, minutes: 28 }); if (i % 2) play('freebie', p.id, { daysAgo: d - 0.9, minutes: 12 }); }
}
// G: only the developer plays their own game (and buys it).
game('selfie');
for (let i = 0; i < 20; i++) play('selfie', dev.id, { daysAgo: 2 + i, minutes: 300 });
buy('selfie', dev.id, 499, 2);

const R = rankings({ fresh: true });
const r = (id) => R.byGame.get(id);
const s = (id) => `${r(id).status} · score ${r(id).score} · quality ${r(id).quality} · trend ${r(id).trend}`;
console.log('great  ', s('great')); console.log('shallow', s('shallow')); console.log('fresh  ', s('fresh'));
console.log('sybil  ', s('sybil')); console.log('broken ', s('broken')); console.log('freebie', s('freebie')); console.log('selfie ', s('selfie'));

check('A well-liked game is promoted after its window', r('great').status === 'promoted' && r('great').score >= RANK.promoteAt, s('great'));
check('A game players bounce off stays listed (searchable, not promoted)', r('shallow').status === 'listed', s('shallow'));
check('Good beats bad by a wide margin', r('great').score - r('shallow').score > 15);
check('A brand-new game is in its discovery window on the New shelf', r('fresh').status === 'new' && r('fresh').window.players === 40 && R.shelves.new.includes('fresh'));
check('New shelf shows games with the fewest players first', R.shelves.new.indexOf('sybil') < R.shelves.new.indexOf('fresh'), R.shelves.new.slice(0, 4).join(','));
check('300 guest accounts from one network count as 1.5 players', r('sybil').window.players === 1.5, `${r('sybil').window.players}`);
check('A build that mostly fails to launch is pulled from every shelf', r('broken').status === 'needs_fix' && !Object.values(R.shelves).flat().includes('broken'));
check('A free game can be promoted and compete with paid ones', r('freebie').status === 'promoted' && r('freebie').score >= r('great').score - 10 && R.shelves.free.includes('freebie'), s('freebie'));
check('Free games never appear on Top Sellers', !R.shelves.top.includes('freebie'));
check('Fast growth this week ranks higher on Trending', r('freebie').trend > r('great').trend + 20 && R.shelves.trending.includes('freebie') && !R.shelves.trending.includes('broken'), `${r('freebie').trend} vs ${r('great').trend}`);
check("A developer's own play and purchases are ignored", r('selfie').observed.players === 0 && r('selfie').revenue28 === 0 && r('selfie').status === 'listed');
const promotedIds = [...R.byGame].filter(([, x]) => x.status === 'promoted').map(([id]) => id);
check('Hidden gems are promoted games that few players have found', R.shelves.gems.length > 0 && R.shelves.gems.every((id) => promotedIds.includes(id)) && R.shelves.gems.some((id) => ['great', 'freebie'].includes(id)), R.shelves.gems.join(','));
check('Featured carousel is only promoted games', R.shelves.featured.length > 0 && R.shelves.featured.every((id) => promotedIds.includes(id)));
check('Seeded demo-catalog games rank from their baseline', r('nightpaw').baseline && ['promoted', 'listed'].includes(r('nightpaw').status));
const cr = creatorRank(r('shallow'), R.platform);
check('Creators get a per-signal breakdown vs. promoted games', cr.factors.length === 5 && cr.factors.every((f) => typeof f.value === 'number' && typeof f.platform === 'number') && cr.factors.find((f) => f.key === 'hook').observed === 0);

// Small samples can't make or break a game: 3 players who love it vs 3 who don't.
game('tinyA'); game('tinyB');
for (let i = 0; i < 3; i++) { play('tinyA', user().id, { minutes: 120 }); play('tinyB', user().id, { minutes: 1 }); }
const R2 = rankings({ fresh: true });
check('Three players barely move the score (smoothing towards a neutral prior)', Math.abs(R2.byGame.get('tinyA').score - R2.byGame.get('tinyB').score) < 10 && R2.byGame.get('tinyA').status === 'listed', `${R2.byGame.get('tinyA').score} vs ${R2.byGame.get('tinyB').score}`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
