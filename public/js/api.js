// PLATFORM SERVICES CLIENT
// The only module in the platform UI that knows services live behind HTTP.
// A desktop shell (Tauri/Electron) can swap this for an implementation that
// talks to a local cache + sync engine without touching views or the runtime.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, path, body, { keepalive = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Lantern-Client': 'platform', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    keepalive,
  });
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
  resetDemo: () => request('POST', '/api/dev/reset'),
};
