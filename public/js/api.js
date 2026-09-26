// PLATFORM SERVICES CLIENT
// The only module in the platform UI that knows services live behind HTTP.
// A desktop shell (Tauri/Electron) can swap this for an implementation that
// talks to a local cache + sync engine without touching views or the runtime.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Connectivity is observed here (fetch failures, or answers the service worker
// served from its offline cache) and published to the UI.
const netListeners = new Set();
let offline = false;
export const onConnectivity = (fn) => { netListeners.add(fn); return () => netListeners.delete(fn); };
export const isOffline = () => offline;
function setOffline(v) { if (v !== offline) { offline = v; netListeners.forEach((fn) => fn(v)); } }
window.addEventListener('online', () => setOffline(false));
window.addEventListener('offline', () => setOffline(true));

export const isNetworkError = (e) => !(e instanceof ApiError);

async function request(method, path, body, { keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'X-Lantern-Client': 'platform', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      keepalive,
    });
  } catch (err) {
    setOffline(true);
    throw new TypeError('You are offline');
  }
  setOffline(res.headers.get('X-Lantern-Offline') === '1');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data;
}

const enc = encodeURIComponent;

export const api = {
  state: () => request('GET', '/api/state'),
  catalog: () => request('GET', '/api/catalog'),
  game: (id) => request('GET', `/api/games/${enc(id)}`),
  purchase: (id) => request('POST', `/api/games/${enc(id)}/purchase`, { paymentMethod: 'demo-wallet' }),
  checkout: (id) => request('POST', `/api/games/${enc(id)}/checkout`, {}),
  confirmCheckout: (orderId) => request('POST', '/api/checkout/confirm', { orderId }),
  orders: () => request('GET', '/api/orders'),
  build: (id) => request('GET', `/api/games/${enc(id)}/build`),
  packageKey: () => request('GET', '/api/keys/packages'),
  auth: {
    signup: (email, password, displayName) => request('POST', '/api/auth/signup', { email, password, displayName }),
    login: (email, password) => request('POST', '/api/auth/login', { email, password }),
    logout: () => request('POST', '/api/auth/logout'),
    changePassword: (current, password) => request('POST', '/api/auth/password', { current, password }),
  },
  creator: {
    games: () => request('GET', '/api/creator/games'),
    publishVersion: (id, payload) => request('POST', `/api/games/${enc(id)}/versions`, payload),
  },
  wishlist: {
    add: (id) => request('PUT', `/api/wishlist/${enc(id)}`),
    remove: (id) => request('DELETE', `/api/wishlist/${enc(id)}`),
    list: () => request('GET', '/api/wishlist'),
  },
  library: () => request('GET', '/api/library'),
  profile: () => request('GET', '/api/profile'),

  // Runtime-facing services. The runtime host receives these as an injected
  // dependency; games never see them.
  runtime: {
    launch: (id, mode) => request('POST', `/api/games/${enc(id)}/launch`, { mode }),
    heartbeat: (sid, activeSeconds) => request('POST', `/api/sessions/${enc(sid)}/heartbeat`, { activeSeconds }),
    end: (sid, activeSeconds, opts) => request('POST', `/api/sessions/${enc(sid)}/end`, { activeSeconds }, opts),
    offlineSession: (s) => request('POST', '/api/sessions/offline', s),
  },
  saves: {
    list: (gameId) => request('GET', `/api/games/${enc(gameId)}/saves`),
    get: (gameId, key) => request('GET', `/api/games/${enc(gameId)}/saves/${enc(key)}`),
    put: (gameId, key, value) => request('PUT', `/api/games/${enc(gameId)}/saves/${enc(key)}`, { value }),
    remove: (gameId, key) => request('DELETE', `/api/games/${enc(gameId)}/saves/${enc(key)}`),
  },
  achievements: {
    list: (gameId) => request('GET', `/api/games/${enc(gameId)}/achievements`),
    unlock: (gameId, key) => request('POST', `/api/games/${enc(gameId)}/achievements/${enc(key)}`),
  },

  publishing: {
    inspect: (filename, dataBase64) => request('POST', '/api/packages/inspect', { filename, dataBase64 }),
    publish: (payload) => request('POST', '/api/publish', payload),
  },
  account: {
    rename: (displayName) => request('PATCH', '/api/me', { displayName }),
    resetProgress: () => request('POST', '/api/me/reset'),
  },
  admin: {
    login: (password) => request('POST', '/api/admin/login', { password }),
    logout: () => request('POST', '/api/admin/logout'),
    resetSite: () => request('POST', '/api/admin/reset'),
  },
};
