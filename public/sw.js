// Vibe-Games service worker: keeps the platform itself (app shell + your library
// data) available offline. Game files are NOT served from here — sandboxed game
// frames can't be controlled by a service worker — they live in the verified,
// content-addressed package cache (js/offline/packages.js) and are handed to the
// runtime directly.
const VERSION = '__SW_VERSION__';
const SHELL = `vibe-shell-${VERSION}`;
const API = 'vibe-api-v1';
const FONTS = 'vibe-fonts-v1';
const PRECACHE = __PRECACHE__;

// API reads that are useful offline (network first, cached copy when offline).
// Build manifests are never served from here: a slow server must not hand out an old build as the
// "current" one (installing needs the network anyway, and installed builds keep their own manifest).
const API_CACHEABLE = /^\/api\/(state|catalog|library|profile|wishlist|orders|keys\/packages|games\/[^/]+(\/achievements)?)$/; // saves: see offline/sync.js

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if ((k.startsWith('vibe-shell-') && k !== SHELL) || /^lantern-(shell|api|fonts)/.test(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'clear-api-cache') e.waitUntil(caches.delete(API));
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function networkFirst(req, cacheName, ms) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(req), timeout(ms)]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (!hit) throw new Error('offline');
    const headers = new Headers(hit.headers);
    headers.set('X-Vibe-Offline', '1');
    return new Response(await hit.blob(), { status: hit.status, headers });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Google Fonts: cache so the store looks right offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => (await c.match(req)) ?? fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== self.location.origin || req.method !== 'GET') return;

  // Page navigations: network first, fall back to the cached app shell.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(req), timeout(4000)]);
        if (res.ok && url.pathname === '/') (await caches.open(SHELL)).put('/', res.clone());
        return res;
      } catch {
        return (await caches.match('/', { cacheName: SHELL })) ?? Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (API_CACHEABLE.test(url.pathname) && !url.pathname.includes('/auth/')) e.respondWith(networkFirst(req, API, 5000));
    return;
  }

  // Static shell, SDK, store media: stale-while-revalidate.
  // Videos (trailers) stream with Range requests straight from the network; never cached here.
  if (/\.(mp4|webm)$/i.test(url.pathname) || req.headers.has('range')) return;
  if (/^\/(js|css|sdk|media|user-media)\/|^\/favicon\.svg$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/') || url.pathname.startsWith('/sdk/') ? SHELL : API);
      const hit = await cache.match(req);
      const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit ?? (await net) ?? Response.error();
    })());
  }
});
