// Client-side view state: catalog cache + the signed-in user's entitlements.
import { api, onConnectivity, isOffline } from './api.js';

const listeners = new Set();
export const state = {
  user: null,
  creator: { admin: false, passwordRequired: true, enabled: false },
  features: { google: false, stripe: false, currency: 'usd', gamesOrigin: null, creatorShare: 0.9 },
  offline: false,
  owned: new Set(),
  wishlist: new Set(),
  games: [],
  byId: new Map(),
  tags: [],
  shelves: {},
  discovery: { promoteAt: 45, windowPlayers: 200, windowDays: 30 }, // algorithmic store shelves from the server (ids)
  running: null, // { gameId } while a game is open
};

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(state));
export const notify = emit;
state.offline = isOffline();
onConnectivity((v) => { state.offline = v; emit(); });

export function applyUserState(s) {
  state.user = s.user;
  if (s.creator) state.creator = s.creator;
  if (s.features) state.features = s.features;
  state.owned = new Set(s.owned);
  state.wishlist = new Set(s.wishlist);
  emit();
}

export async function loadCatalog() {
  const c = await api.catalog();
  state.games = c.games;
  state.byId = new Map(c.games.map((g) => [g.id, g]));
  state.tags = c.tags;
  state.shelves = c.shelves ?? {};
  if (c.discovery) state.discovery = c.discovery;
  emit();
}

export async function boot() {
  const [s] = await Promise.all([api.state(), loadCatalog()]);
  applyUserState(s);
}

export async function toggleWishlist(id) {
  const s = state.wishlist.has(id) ? await api.wishlist.remove(id) : await api.wishlist.add(id);
  applyUserState(s);
  return state.wishlist.has(id);
}

export async function purchase(id) {
  const r = await api.purchase(id);
  applyUserState(r.state);
  return r.ownership;
}

export const game = (id) => state.byId.get(id);
export const released = () => state.games.filter((g) => g.status === 'released');
// Resolve a server shelf (list of ids) to games, dropping any that vanished.
export const shelf = (name) => (state.shelves[name] ?? []).map((id) => state.byId.get(id)).filter(Boolean);
// Discovery order for lists: promoted/new first, then listed, games needing fixes last.
const STATUS_ORDER = { promoted: 0, new: 1, listed: 2, needs_fix: 3 };
export const byDiscovery = (a, b) => (STATUS_ORDER[a.rank?.status] ?? 2) - (STATUS_ORDER[b.rank?.status] ?? 2) || (b.rank?.score ?? 0) - (a.rank?.score ?? 0);
