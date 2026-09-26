// Client-side view state: catalog cache + the signed-in user's entitlements.
import { api } from './api.js';

const listeners = new Set();
export const state = {
  user: null,
  owned: new Set(),
  wishlist: new Set(),
  games: [],
  byId: new Map(),
  tags: [],
  running: null, // { gameId } while a game is open
};

export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn(state));

export function applyUserState(s) {
  state.user = s.user;
  state.owned = new Set(s.owned);
  state.wishlist = new Set(s.wishlist);
  emit();
}

export async function loadCatalog() {
  const c = await api.catalog();
  state.games = c.games;
  state.byId = new Map(c.games.map((g) => [g.id, g]));
  state.tags = c.tags;
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
