// DISCOVERY / RANKING
// Algorithmic curation. No human review: every released game is scored from how
// players actually behave, and the store's shelves are built from those scores.
//
//   1. Discovery window  - a new game is shown on the "Fresh off the prompt" shelf until
//                          it has had RANK.windowPlayers players (or windowDays pass),
//                          so every game gets a fair first audience.
//   2. Vibe Score     - hook (share playing 15+ min), engagement (median minutes),
//                          retention (came back on a 2nd day), conversion (demo -> buy,
//                          or claim -> play for free games) and reach (recent players).
//                          Rates are Bayesian-smoothed towards a neutral prior, so a
//                          handful of players can't make or break a game.
//   3. Promotion         - after the window, games scoring >= RANK.promoteAt appear on
//                          the front page and in recommendations; the rest stay listed
//                          and searchable.
//   4. Health gate       - games that mostly fail to start (the SDK never connects) or
//                          throw uncaught errors are pulled from shelves until fixed.
//
// Anti-gaming: guests count half, at most RANK.ipCap players per IP per game, and a
// developer's own play and purchases are ignored. Revenue is used for the Top Sellers
// shelf only; the score uses per-player rates so free games compete on equal terms.
//
// Seeded demo-catalog games carry a baseline (derived from their catalog stats) as a
// strong prior, so the demo store isn't empty; real play shifts it over time.
import * as db from './db.js';

export const RANK = {
  lookbackDays: 28,
  windowPlayers: 200,
  windowDays: 30,
  promoteAt: 45,
  priorWeight: 20,        // pseudo-players pulling new games towards the neutral prior
  hookMinutes: 15,
  ipCap: 3,
  guestWeight: 0.5,
  minutesFull: 120,       // median minutes that earns full engagement credit
  reachFull: 5000,        // monthly players that earns full reach credit
  weights: { hook: 0.30, engagement: 0.20, retention: 0.25, conversion: 0.15, reach: 0.10 },
  priors: { hook: 0.35, retention: 0.15, conversion: 0.15, minutes: 8 },
  health: { minSessions: 5, minConnectRate: 0.5, maxErrorRate: 0.5 },
};

const DAY = 86400e3;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const engagementOf = (min) => clamp01(Math.log1p(Math.max(0, min)) / Math.log1p(RANK.minutesFull));
const reachOf = (players) => clamp01(Math.log10(1 + Math.max(0, players)) / Math.log10(1 + RANK.reachFull));
const smooth = (x, n, prior, k) => (x + prior * k) / (n + k || 1);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
function median(xs) {
  if (!xs.length) return 0;
  const a = [...xs].sort((p, q) => p - q), m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Demo-catalog baseline: plausible behaviour derived from the catalog's rating/sales.
function baselineFor(g) {
  if (g.source !== 'seed' || !g.rating || !g.stats?.sales) return null;
  const q = clamp01((g.rating.pct - 78) / 20);
  const players28 = Math.round(g.stats.sales * 0.35);
  return {
    weight: Math.min(500, players28),
    players28,
    hook: 0.3 + 0.5 * q,
    retention: 0.12 + 0.4 * q,
    conversion: 0.12 + 0.3 * q,
    minutes: 20 + (g.priceCents / 100) * 6,
    trend: g.stats.trend ?? 50,
    revenue28: Math.round(players28 * 0.6 * g.priceCents),
    sales: g.stats.sales,
  };
}

function gameMetrics(g, ctx) {
  const { now, since, usersById, sessionsByGame, ordersByGame, ownsByGame } = ctx;
  const devId = g.publishedBy ?? null;
  const weightOf = (uid) => (usersById.get(uid)?.guest ? RANK.guestWeight : 1);
  const sessions = (sessionsByGame.get(g.id) ?? []).filter((s) => s.userId !== devId);

  // --- per-player aggregation ---
  const all = new Map();   // all-time: uid -> { first, ip }
  const recent = new Map(); // lookback: uid -> { secs, days, ip, demoAt, last }
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (!Number.isFinite(t)) continue;
    const a = all.get(s.userId) ?? { first: t, ip: s.ipHash ?? null };
    a.first = Math.min(a.first, t); a.ip ??= s.ipHash ?? null;
    all.set(s.userId, a);
    if (t < since) continue;
    const r = recent.get(s.userId) ?? { secs: 0, days: new Set(), ip: s.ipHash ?? null, demoAt: null, last: 0 };
    r.secs += s.seconds || 0; r.days.add(dayKey(t)); r.ip ??= s.ipHash ?? null; r.last = Math.max(r.last, t);
    if (s.mode === 'demo') r.demoAt = r.demoAt == null ? t : Math.min(r.demoAt, t);
    recent.set(s.userId, r);
  }
  // At most RANK.ipCap players per IP address count (keeps the most engaged ones).
  const capByIp = (map, scoreFn) => {
    const byIp = new Map();
    for (const [uid, v] of map) { const k = v.ip ?? `u:${uid}`; (byIp.get(k) ?? byIp.set(k, []).get(k)).push([uid, v]); }
    const kept = new Map();
    for (const list of byIp.values()) list.sort((a, b) => scoreFn(b[1]) - scoreFn(a[1])).slice(0, RANK.ipCap).forEach(([uid, v]) => kept.set(uid, v));
    return kept;
  };
  const players = capByIp(recent, (v) => v.secs);
  const allPlayers = capByIp(all, () => 0);

  let n = 0, hooked = 0, retEligible = 0, returned = 0, p7 = 0, pPrev = 0, demoN = 0, demoBought = 0;
  const minutes = [];
  const paidOrders = (ordersByGame.get(g.id) ?? []).filter((o) => o.status === 'paid' && o.userId !== devId);
  const boughtAt = new Map(paidOrders.map((o) => [o.userId, Date.parse(o.paidAt ?? o.createdAt)]));
  for (const [uid, p] of players) {
    const w = weightOf(uid);
    n += w;
    minutes.push(p.secs / 60);
    if (p.secs >= RANK.hookMinutes * 60) hooked += w;
    if (all.get(uid).first <= now - DAY) { retEligible += w; if (p.days.size >= 2) returned += w; }
    if (p.last >= now - 7 * DAY) p7 += w;
    else if (p.last >= now - 14 * DAY) pPrev += w;
    if (p.demoAt != null) { demoN += w; const b = boughtAt.get(uid); if (b != null && b >= p.demoAt) demoBought += w; }
  }
  let allN = 0;
  for (const uid of allPlayers.keys()) allN += weightOf(uid);

  // Conversion: demo -> purchase for paid games; claim -> actually played for free games.
  let convX = 0, convN = 0;
  if (g.priceCents > 0) { convX = demoBought; convN = demoN; } else {
    const claims = (ownsByGame.get(g.id) ?? []).filter((o) => o.source !== 'developer' && o.userId !== devId && Date.parse(o.acquiredAt) >= since);
    for (const o of claims) { const w = weightOf(o.userId); convN += w; if (all.has(o.userId)) convX += w; }
  }

  // Health: from sessions that reported it (SDK handshake + uncaught error count).
  const withHealth = sessions.filter((s) => Date.parse(s.startedAt) >= since && typeof s.connected === 'boolean');
  const sdkGame = sessions.some((s) => s.connected === true);
  const connectRate = withHealth.length ? withHealth.filter((s) => s.connected).length / withHealth.length : null;
  const errorRate = withHealth.length ? withHealth.filter((s) => (s.errors ?? 0) > 0).length / withHealth.length : null;

  const revenue28 = paidOrders.filter((o) => Date.parse(o.paidAt ?? o.createdAt) >= since).reduce((t, o) => t + o.amountCents, 0);
  return {
    n, allN, hooked, retEligible, returned, minutesMedian: median(minutes), p7, pPrev, convX, convN,
    revenue28, salesAll: paidOrders.length, health: { sessions: withHealth.length, sdkGame, connectRate, errorRate },
  };
}

function scoreGame(g, m, now) {
  const base = baselineFor(g);
  const P = RANK.priors, W = RANK.weights;
  const k = base?.weight ?? RANK.priorWeight;
  const prior = base ? { hook: base.hook, retention: base.retention, conversion: base.conversion, minutes: base.minutes } : P;

  const hook = smooth(m.hooked, m.n, prior.hook, k);
  const retention = smooth(m.returned, m.retEligible, prior.retention, k);
  const conversion = smooth(m.convX, m.convN, prior.conversion, k);
  const minutes = (m.n * m.minutesMedian + k * prior.minutes) / (m.n + k);
  const players28 = m.n + (base?.players28 ?? 0);
  const parts = {
    hook, engagement: engagementOf(minutes), retention, conversion, reach: reachOf(players28),
  };
  const raw = Object.entries(W).reduce((t, [key, w]) => t + w * parts[key], 0);
  const quality = (raw - W.reach * parts.reach) / (1 - W.reach);

  // Trending: growth this week vs last week, damped for tiny numbers.
  const growth = (m.p7 - m.pPrev) / (m.pPrev + 10);
  let trend = 50 + 40 * Math.tanh(growth) * Math.min(1, m.p7 / 20) + 10 * reachOf(m.p7 * 4);
  if (base) trend = (base.weight * base.trend + m.p7 * trend) / (base.weight + m.p7);

  const created = Date.parse(g.createdAt ?? `${g.releaseDate}T00:00:00Z`);
  const ageDays = Math.max(0, (now - created) / DAY);
  const inWindow = !base && ageDays < RANK.windowDays && m.allN < RANK.windowPlayers;
  const h = m.health, HR = RANK.health;
  const broken = h.sdkGame && h.sessions >= HR.minSessions && (h.connectRate < HR.minConnectRate || h.errorRate > HR.maxErrorRate);
  const score = Math.round(raw * 1000) / 10;
  const status = broken ? 'needs_fix' : inWindow ? 'new' : score >= RANK.promoteAt ? 'promoted' : 'listed';

  return {
    status, score, quality: Math.round(quality * 1000) / 10, trend: Math.round(trend),
    confidence: Math.round(((m.n + (base ? base.weight : 0)) / (m.n + k + (base ? RANK.priorWeight : 0))) * 100) / 100,
    players28: Math.round(players28), medianMinutes: Math.round(minutes), parts,
    window: inWindow ? { players: Math.round(m.allN * 10) / 10, target: RANK.windowPlayers, daysLeft: Math.max(0, Math.ceil(RANK.windowDays - ageDays)) } : null,
    revenue28: m.revenue28 + (base?.revenue28 ?? 0), salesAll: m.salesAll + (base?.sales ?? 0),
    health: h, baseline: !!base,
    observed: { players: Math.round(m.n * 10) / 10, hookedPct: m.n ? m.hooked / m.n : null, returnPct: m.retEligible ? m.returned / m.retEligible : null, medianMinutes: m.n ? Math.round(m.minutesMedian * 10) / 10 : null, conversionPct: m.convN ? m.convX / m.convN : null, conversionBase: Math.round(m.convN * 10) / 10 },
  };
}

// ---------------- cache ----------------
let cache = null;
export function rankings({ now = Date.now(), fresh = false } = {}) {
  if (!fresh && cache && cache.rev === db.revision() && now - cache.at < 60e3) return cache.value;
  const value = compute(now);
  cache = { rev: db.revision(), at: now, value };
  return value;
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r);
  return m;
}

function compute(now) {
  const ctx = {
    now, since: now - RANK.lookbackDays * DAY,
    usersById: new Map(db.all('users').map((u) => [u.id, u])),
    sessionsByGame: groupBy(db.all('playSessions'), 'gameId'),
    ordersByGame: groupBy(db.all('orders'), 'gameId'),
    ownsByGame: groupBy(db.all('ownerships'), 'gameId'),
  };
  const byGame = new Map();
  for (const g of db.all('games')) {
    if (g.status !== 'released' || !g.currentVersionId) continue;
    byGame.set(g.id, scoreGame(g, gameMetrics(g, ctx), now));
  }
  const games = [...byGame.entries()].map(([id, r]) => ({ id, r, g: db.get('games', id) }));
  const visible = games.filter((x) => x.r.status !== 'needs_fix');
  const promoted = visible.filter((x) => x.r.status === 'promoted');

  // Ranks used by shelves (revenue itself stays private to the developer).
  [...visible].sort((a, b) => b.r.revenue28 - a.r.revenue28 || b.r.salesAll - a.r.salesAll).forEach((x, i) => { x.r.salesRank = i + 1; });
  [...visible].sort((a, b) => b.r.players28 - a.r.players28).forEach((x, i) => { x.r.playedRank = i + 1; });

  // Platform averages among promoted games, so developers can compare.
  const avg = {};
  for (const key of Object.keys(RANK.weights)) avg[key] = promoted.length ? promoted.reduce((t, x) => t + x.r.parts[key], 0) / promoted.length : null;
  const reachMedian = median(promoted.map((x) => x.r.players28));

  const by = (f) => (a, b) => f(b) - f(a);
  const ids = (list, max) => list.slice(0, max).map((x) => x.id);
  const hourSeed = Math.floor(now / 3600e3);
  const jitter = (id) => { let h = hourSeed; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 1000; };
  const recentRelease = (x) => now - Date.parse(`${x.g.releaseDate}T00:00:00Z`) < 21 * DAY;

  const trending = [...visible].filter((x) => x.r.status !== 'listed').sort(by((x) => x.r.trend));
  const gems = promoted.filter((x) => x.r.quality >= 55 && x.r.players28 < reachMedian / 2).sort(by((x) => x.r.quality));
  const shelves = {
    featured: ids([...promoted].sort(by((x) => 0.7 * x.r.score + 0.3 * x.r.trend)), 6),
    // Games in their discovery window first (fewest players first, rotated hourly), then recent releases.
    new: ids([
      ...visible.filter((x) => x.r.status === 'new').sort((a, b) => a.r.window.players - b.r.window.players || jitter(a.id) - jitter(b.id)),
      ...visible.filter((x) => x.r.status !== 'new' && recentRelease(x)).sort((a, b) => b.g.releaseDate.localeCompare(a.g.releaseDate)),
    ], 10),
    trending: ids(trending, 10),
    top: ids([...visible].sort((a, b) => a.r.salesRank - b.r.salesRank).filter((x) => x.g.priceCents > 0), 10),
    played: ids([...visible].sort((a, b) => a.r.playedRank - b.r.playedRank), 10),
    gems: ids(gems, 6),
    free: ids(promoted.filter((x) => x.g.priceCents === 0).sort(by((x) => x.r.score)), 8),
    best: ids([...promoted].sort(by((x) => x.r.score)), 20),
  };

  // Badges
  for (const x of games) x.r.badges = [];
  for (const x of games) if (x.r.status === 'new') x.r.badges.push('New');
  trending.slice(0, 5).filter((x) => x.r.trend >= 65).forEach((x) => x.r.badges.push('Trending'));
  gems.slice(0, 6).forEach((x) => x.r.badges.push('Hidden gem'));
  visible.filter((x) => x.r.salesRank <= 3 && x.g.priceCents > 0 && x.r.status === 'promoted').forEach((x) => x.r.badges.push('Top seller'));

  return { byGame, shelves, platform: avg, thresholds: { promoteAt: RANK.promoteAt, windowPlayers: RANK.windowPlayers, windowDays: RANK.windowDays } };
}

// What players see: enough to sort and label, nothing about revenue.
export function publicRank(r) {
  if (!r) return null;
  return { status: r.status, score: r.score, trend: r.trend, players: r.players28, medianMinutes: r.medianMinutes, badges: r.badges ?? [], salesRank: r.salesRank ?? null, playedRank: r.playedRank ?? null };
}

// What the developer sees on the Publish page: the whole breakdown plus tips.
const TIPS = {
  hook: 'Get to the fun fast: a strong first 5 minutes keeps players past the 15-minute mark.',
  engagement: 'More to do per session, whether levels, goals or unlocks, raises median playtime.',
  retention: 'Give players a reason to come back tomorrow: saves, daily goals, an unfinished run.',
  conversion: 'Paid: end the demo on a high point. Free: a clear store page means claimers actually play.',
  reach: 'Reach grows with the rest: better scores earn more shelf space and more players.',
};
const LABELS = { hook: 'Hook', engagement: 'Engagement', retention: 'Retention', conversion: 'Conversion', reach: 'Reach' };
const DESCS = {
  hook: `Players who play ${RANK.hookMinutes}+ minutes`,
  engagement: 'Median minutes per player',
  retention: 'Players who return on another day',
  conversion: 'Demo → purchase (paid) · claim → play (free)',
  reach: 'Players in the last 28 days',
};
export function creatorRank(r, platform) {
  if (!r) return null;
  const o = r.observed;
  const shown = {
    hook: o.hookedPct, engagement: o.medianMinutes, retention: o.returnPct, conversion: o.conversionPct, reach: r.players28,
  };
  return {
    ...publicRank(r), quality: r.quality, confidence: r.confidence, window: r.window, health: r.health, baseline: r.baseline,
    promoteAt: RANK.promoteAt, sales28Cents: r.revenue28,
    factors: Object.keys(RANK.weights).map((key) => ({
      key, label: LABELS[key], description: DESCS[key], weight: RANK.weights[key],
      value: r.parts[key], platform: platform[key], observed: shown[key], tip: TIPS[key],
    })),
  };
}
