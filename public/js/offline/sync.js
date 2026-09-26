// OFFLINE-CAPABLE RUNTIME SERVICES
// The game runtime receives this object instead of the raw API. Online it's a
// thin pass-through (plus a local mirror of saves); offline it reads the mirror
// and queues writes — saves, achievements and play sessions — then replays them
// in order when the connection returns. Games can't tell the difference.
import { api, isNetworkError, onConnectivity } from '../api.js';
import { state } from '../state.js';

const uid = () => state.user?.id ?? 'anon';
const K = { mirror: () => `lantern.saves.v1:${uid()}`, queue: () => `lantern.queue.v1:${uid()}`, ach: () => `lantern.ach.v1:${uid()}` };
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

function mirrorSet(gameId, key, value, updatedAt) {
  const m = read(K.mirror(), {});
  (m[gameId] ??= {})[key] = { value, updatedAt };
  write(K.mirror(), m);
}
function mirrorDel(gameId, key) { const m = read(K.mirror(), {}); if (m[gameId]) delete m[gameId][key]; write(K.mirror(), m); }
const mirrorGet = (gameId, key) => read(K.mirror(), {})[gameId]?.[key] ?? null;

function enqueue(item) { const q = read(K.queue(), []); q.push({ ...item, at: new Date().toISOString() }); write(K.queue(), q); }
const pendingFor = (gameId, key) => read(K.queue(), []).some((i) => i.gameId === gameId && i.key === key && (i.kind === 'save' || i.kind === 'remove'));
export const queued = () => read(K.queue(), []).length;

let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let q = read(K.queue(), []);
    let sent = 0;
    while (q.length) {
      const i = q[0];
      try {
        if (i.kind === 'save') await api.saves.put(i.gameId, i.key, i.value);
        else if (i.kind === 'remove') await api.saves.remove(i.gameId, i.key);
        else if (i.kind === 'ach') await api.achievements.unlock(i.gameId, i.key);
        else if (i.kind === 'session') await api.runtime.offlineSession({ gameId: i.gameId, startedAt: i.startedAt, seconds: i.seconds, clientId: i.clientId });
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break; // still offline — try again later
        // rejected by the server (e.g. ownership revoked): drop it
      }
      q = read(K.queue(), []); q.shift(); write(K.queue(), q);
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}
onConnectivity((off) => { if (!off) flush(); });

export const services = {
  saves: {
    async list(gameId) {
      try { return await api.saves.list(gameId); } catch (e) {
        if (!isNetworkError(e)) throw e;
        return Object.entries(read(K.mirror(), {})[gameId] ?? {}).map(([key, v]) => ({ key, sizeBytes: JSON.stringify(v.value).length, updatedAt: v.updatedAt }));
      }
    },
    async get(gameId, key) {
      if (pendingFor(gameId, key)) { const m = mirrorGet(gameId, key); return m && { key, value: m.value, updatedAt: m.updatedAt }; }
      try {
        const r = await api.saves.get(gameId, key);
        if (r) mirrorSet(gameId, key, r.value, r.updatedAt); else mirrorDel(gameId, key);
        return r;
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        const m = mirrorGet(gameId, key);
        return m && { key, value: m.value, updatedAt: m.updatedAt };
      }
    },
    async put(gameId, key, value) {
      const now = new Date().toISOString();
      mirrorSet(gameId, key, value, now);
      if (pendingFor(gameId, key)) { enqueue({ kind: 'save', gameId, key, value }); return { revision: 0, updatedAt: now, queued: true }; }
      try { return await api.saves.put(gameId, key, value); } catch (e) {
        if (!isNetworkError(e)) throw e;
        enqueue({ kind: 'save', gameId, key, value });
        return { revision: 0, updatedAt: now, queued: true };
      }
    },
    async remove(gameId, key) {
      mirrorDel(gameId, key);
      try { return await api.saves.remove(gameId, key); } catch (e) {
        if (!isNetworkError(e)) throw e;
        enqueue({ kind: 'remove', gameId, key });
        return { ok: true, queued: true };
      }
    },
  },
  achievements: {
    async list(gameId) {
      try {
        const list = await api.achievements.list(gameId);
        const all = read(K.ach(), {}); all[gameId] = list; write(K.ach(), all);
        return list;
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        return read(K.ach(), {})[gameId] ?? [];
      }
    },
    async unlock(gameId, key) {
      try { return await api.achievements.unlock(gameId, key); } catch (e) {
        if (!isNetworkError(e)) throw e;
        const all = read(K.ach(), {});
        const def = (all[gameId] ?? []).find((a) => a.id === key);
        if (!def) throw new Error('Unknown achievement');
        const already = !!def.unlockedAt;
        if (!already) { def.unlockedAt = new Date().toISOString(); write(K.ach(), all); enqueue({ kind: 'ach', gameId, key }); }
        return { newlyUnlocked: !already, achievement: def };
      }
    },
  },
  runtime: {
    heartbeat: (sid, secs) => (String(sid).startsWith('local_') ? Promise.resolve({ ok: true }) : api.runtime.heartbeat(sid, secs)),
    async end(sid, secs, opts) {
      if (String(sid).startsWith('local_')) {
        const s = localSessions.get(sid);
        if (s && secs > 0) enqueue({ kind: 'session', gameId: s.gameId, startedAt: s.startedAt, seconds: secs, clientId: sid });
        localSessions.delete(sid);
        flush();
        return { ok: true };
      }
      return api.runtime.end(sid, secs, opts);
    },
  },
};

// Offline launches create a local session; its playtime is uploaded later.
const localSessions = new Map();
export function localLaunch(game, player, build) {
  const id = `local_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const startedAt = new Date().toISOString();
  localSessions.set(id, { gameId: game.id, startedAt });
  return { session: { id, mode: 'full', startedAt, demoSeconds: null, offline: true }, build, player, game: { id: game.id, title: game.title } };
}
