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
      headers: { 'X-Vibe-Client': 'platform', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      keepalive,
    });
  } catch (err) {
    setOffline(true);
    throw new TypeError('You are offline');
  }
  setOffline(res.headers.get('X-Vibe-Offline') === '1');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data;
}

// Large binary uploads (trailers): the file is the request body, with upload progress.
function uploadRaw(method, path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, path);
    xhr.setRequestHeader('X-Vibe-Client', 'platform');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => { setOffline(!navigator.onLine); reject(new TypeError('Upload failed: check your connection')); };
    xhr.send(file);
  });
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
  refund: (orderId, reason) => request('POST', `/api/orders/${enc(orderId)}/refund`, { reason }),
  report: (type, targetId, reason, details) => request('POST', '/api/reports', { type, targetId, reason, details }),
  build: (id) => request('GET', `/api/games/${enc(id)}/build`),
  packageKey: () => request('GET', '/api/keys/packages'),
  auth: {
    signup: (email, password, displayName) => request('POST', '/api/auth/signup', { email, password, displayName }),
    login: (email, password) => request('POST', '/api/auth/login', { email, password }),
    logout: () => request('POST', '/api/auth/logout'),
    changePassword: (current, password) => request('POST', '/api/auth/password', { current, password }),
    resendVerification: () => request('POST', '/api/auth/verify/resend'),
    verify: (token) => request('POST', '/api/auth/verify', { token }),
    forgot: (email) => request('POST', '/api/auth/forgot', { email }),
    reset: (token, password) => request('POST', '/api/auth/reset', { token, password }),
  },
  creator: {
    games: () => request('GET', '/api/creator/games'),
    publishVersion: (id, payload) => request('POST', `/api/games/${enc(id)}/versions`, payload),
    edit: (id, patch) => request('PATCH', `/api/creator/games/${enc(id)}`, patch),
    uploadTrailer: (id, file, onProgress) => uploadRaw('PUT', `/api/creator/games/${enc(id)}/trailer`, file, onProgress),
    removeTrailer: (id) => request('DELETE', `/api/creator/games/${enc(id)}/trailer`),
    join: () => request('POST', '/api/creator/join', { agree: true }),
    payouts: () => request('GET', '/api/creator/payouts'),
    onboard: (country) => request('POST', '/api/creator/payouts/onboard', { country }),
    payoutDashboard: () => request('POST', '/api/creator/payouts/dashboard'),
  },
  wishlist: {
    add: (id) => request('PUT', `/api/wishlist/${enc(id)}`),
    remove: (id) => request('DELETE', `/api/wishlist/${enc(id)}`),
    list: () => request('GET', '/api/wishlist'),
  },
  library: () => request('GET', '/api/library'),
  reviews: {
    list: (id, filter) => request('GET', `/api/games/${enc(id)}/reviews${filter ? `?filter=${enc(filter)}` : ''}`),
    save: (id, up, text) => request('PUT', `/api/games/${enc(id)}/review`, { up, text }),
    remove: (id) => request('DELETE', `/api/games/${enc(id)}/review`),
    moderate: (reviewId) => request('DELETE', `/api/reviews/${enc(reviewId)}`),
  },
  profile: () => request('GET', '/api/profile'),

  // Runtime-facing services. The runtime host receives these as an injected
  // dependency; games never see them.
  runtime: {
    launch: (id, mode, versionId) => request('POST', `/api/games/${enc(id)}/launch`, { mode, versionId: versionId ?? undefined }),
    heartbeat: (sid, activeSeconds, health) => request('POST', `/api/sessions/${enc(sid)}/heartbeat`, { activeSeconds, health }),
    end: (sid, activeSeconds, opts) => request('POST', `/api/sessions/${enc(sid)}/end`, { activeSeconds, health: opts?.health }, opts),
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
    settings: () => request('GET', '/api/admin/settings'),
    saveSettings: (patch) => request('PUT', '/api/admin/settings', patch),
    queue: () => request('GET', '/api/admin/queue'),
    gameAction: (id, action, note) => request('POST', `/api/admin/games/${enc(id)}/${action}`, { note }),
    versionAction: (id, action, note) => request('POST', `/api/admin/versions/${enc(id)}/${action}`, { note }),
    games: (q) => request('GET', `/api/admin/games${q ? `?q=${enc(q)}` : ''}`),
    reports: (status) => request('GET', `/api/admin/reports?status=${enc(status ?? 'open')}`),
    resolveReport: (id, action) => request('POST', `/api/admin/reports/${enc(id)}/resolve`, { action }),
    orders: (q) => request('GET', `/api/admin/orders${q ? `?q=${enc(q)}` : ''}`),
    refund: (id, reason) => request('POST', `/api/admin/orders/${enc(id)}/refund`, { reason }),
    creators: () => request('GET', '/api/admin/creators'),
    creatorAction: (id, action) => request('POST', `/api/admin/creators/${enc(id)}/${action}`),
    outbox: () => request('GET', '/api/admin/outbox'),
  },
};
