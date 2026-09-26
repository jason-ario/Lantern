// GAME RUNTIME HOST
// Runs an untrusted game package inside a sandboxed iframe and brokers every
// Platform SDK call. This is the security boundary between PLATFORM and GAME:
//
//  • iframe sandbox="allow-scripts allow-pointer-lock" (no allow-same-origin)
//    → the game gets an opaque origin: no platform cookies, no localStorage of
//      ours, no DOM access to the parent, no top navigation, no popups/forms.
//  • The server also sends a CSP `sandbox` header + path-scoped CSP for game files.
//  • All SDK traffic flows over a private MessageChannel port handed to the
//    frame after a hello handshake we verify by `event.source`.
//  • The host binds every call to the launched gameId — a game can't name
//    another game's saves or achievements — and enforces an allowlist of
//    methods, argument validation, payload size limits and a rate limit.
//
// The host depends only on an injected `services` object, so a desktop shell can
// provide local-cache implementations while games stay byte-for-byte identical.

const SAVE_KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_SAVE_BYTES = 256 * 1024;
const RATE = { perSecond: 30, burst: 60 };
const HEARTBEAT_MS = 30_000;
const EXIT_GRACE_MS = 2000;

// ---------------------------------------------------------------------------
// LOCAL (offline) BUILDS
// A sandboxed frame can't be served by a service worker, so for builds from the
// verified local package cache the runtime ships the files into the frame
// itself. The frame is still sandboxed with an opaque origin; the tiny
// bootstrap below turns the files into in-frame blob: URLs, points relative
// URLs (script/link/img/audio src, fetch, XHR, Worker, CSS url()) at them and
// then writes the game's entry document. The platform's per-page CSP nonce is
// required to run it (srcdoc frames inherit the platform CSP).
// ---------------------------------------------------------------------------
const VFS_BOOTSTRAP = String.raw`(() => {
  const P = window.parent;
  addEventListener('message', function once(e) {
    if (e.source !== P || !e.data || e.data.type !== 'lantern:vfs') return;
    removeEventListener('message', once);
    boot(e.data);
  });
  P.postMessage({ type: 'lantern:vfs-ready' }, '*');
  function boot({ files, entry, sdk, nonce }) {
    const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
    const base = dirOf(entry);
    const urls = new Map(), text = new Map();
    const dec = new TextDecoder();
    for (const f of files) {
      urls.set(f.path, URL.createObjectURL(new Blob([f.buf], { type: f.type })));
      if (/^text\/|json|javascript|svg/.test(f.type)) text.set(f.path, dec.decode(f.buf));
    }
    const norm = (u, from) => {
      if (typeof u !== 'string' || !u || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(u)) return null;
      u = u.split('#')[0].split('?')[0];
      const parts = (u.startsWith('/') ? u.slice(1) : (from ?? base) + u).split('/');
      const out = [];
      for (const seg of parts) { if (seg === '..') out.pop(); else if (seg !== '.' && seg !== '') out.push(seg); }
      try { return decodeURIComponent(out.join('/')); } catch { return out.join('/'); }
    };
    const resolve = (u, from) => { const p = norm(u, from); return p !== null && urls.has(p) ? urls.get(p) : null; };
    const rf = window.fetch.bind(window);
    window.fetch = (input, init) => { const u = typeof input === 'string' ? input : input && input.url; const b = resolve(u); return rf(b || input, init); };
    const xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...r) { return xo.call(this, m, resolve(String(u)) || u, ...r); };
    for (const [C, a] of [[HTMLImageElement, 'src'], [HTMLMediaElement, 'src'], [HTMLSourceElement, 'src'], [HTMLScriptElement, 'src'], [HTMLLinkElement, 'href']]) {
      const d = Object.getOwnPropertyDescriptor(C.prototype, a);
      if (d && d.set) Object.defineProperty(C.prototype, a, { ...d, set(v) { d.set.call(this, resolve(String(v)) || v); } });
    }
    const sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) { return sa.call(this, n, (n === 'src' || n === 'href') ? (resolve(String(v)) || v) : v); };
    if (window.Worker) { const W = window.Worker; window.Worker = function (u, o) { return new W(resolve(String(u)) || u, o); }; }
    const css = (t, from) => t.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => { const b = resolve(u, from); return b ? 'url("' + b + '")' : m; });
    const doc = new DOMParser().parseFromString(text.get(entry) || '', 'text/html');
    for (const s of doc.querySelectorAll('script')) {
      const src = s.getAttribute('src');
      s.setAttribute('nonce', nonce);
      if (src) {
        s.removeAttribute('src');
        if (/\/sdk\/v1\/platform-sdk\.js$/.test(src)) s.textContent = sdk;
        else { const p = norm(src); s.textContent = p !== null && text.has(p) ? text.get(p) + '\n//# sourceURL=' + p : 'console.error("[Lantern] missing file: " + ' + JSON.stringify(src) + ')'; }
      }
      // inline script text must not close the <script> element when re-parsed
      s.textContent = s.textContent.replace(/<\/(script)/gi, '<\\/$1');
    }
    for (const l of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
      const p = norm(l.getAttribute('href'));
      const st = doc.createElement('style');
      st.textContent = p !== null && text.has(p) ? css(text.get(p), dirOf(p)) : '';
      l.replaceWith(st);
    }
    for (const st of doc.querySelectorAll('style')) st.textContent = css(st.textContent, base);
    for (const el of doc.querySelectorAll('[src]:not(script)')) { const b = resolve(el.getAttribute('src')); if (b) el.setAttribute('src', b); }
    for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', css(el.getAttribute('style'), base));
    document.open();
    document.write('<!doctype html>' + doc.documentElement.outerHTML);
    document.close();
  }
})();`;

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pageNonce = () => document.querySelector('script[nonce]')?.nonce || '';
let sdkSource = null;
async function loadSdk() {
  if (!sdkSource) sdkSource = await (await fetch('/sdk/v1/platform-sdk.js')).text();
  return sdkSource;
}

class RpcError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class GameRuntime {
  constructor({ services, container, launch, callbacks = {} }) {
    this.services = services;
    this.container = container;
    this.launch = launch; // { session, build, player, game }
    this.cb = callbacks;
    this.gameId = launch.game.id;
    this.port = null;
    this.frame = null;
    this.inFlight = new Set();
    this.tokens = RATE.burst;
    this.lastRefill = performance.now();
    this.activeSeconds = 0;
    this.health = { connected: false, errors: 0 }; // reported to the platform for the launch-health check
    this.paused = false;
    this.closing = false;
    this.closed = false;
    this.exitReady = null;
    this.onWindowMessage = this.onWindowMessage.bind(this);
  }

  start() {
    window.addEventListener('message', this.onWindowMessage);
    const f = document.createElement('iframe');
    f.className = 'runtime-frame';
    f.title = this.launch.game.title;
    f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    f.setAttribute('allow', 'gamepad; autoplay; fullscreen');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.addEventListener('load', () => this.cb.onLoaded?.());
    if (this.launch.build.local) {
      const nonce = pageNonce();
      if (!nonce) throw new Error('Local builds need the platform page nonce');
      this.nonce = nonce;
      f.srcdoc = `<!doctype html><meta charset="utf-8"><script nonce="${escAttr(nonce)}">${VFS_BOOTSTRAP.replace(/<\/script/gi, '<\\/script')}</script>`;
    } else {
      f.src = this.launch.build.url;
    }
    this.frame = f;
    this.container.appendChild(f);
    this.clock = setInterval(() => {
      if (!this.paused && !document.hidden) this.activeSeconds += 1;
      this.cb.onTick?.(this.activeSeconds);
    }, 1000);
    this.heartbeat = setInterval(() => {
      this.services.runtime.heartbeat(this.launch.session.id, this.activeSeconds, this.health).catch(() => {});
    }, HEARTBEAT_MS);
    this.onUnload = () => { this.services.runtime.end(this.launch.session.id, this.activeSeconds, { keepalive: true, health: this.health }).catch(() => {}); };
    window.addEventListener('pagehide', this.onUnload);
  }

  focus() { this.frame?.focus(); }

  // ---- handshake ----
  onWindowMessage(e) {
    if (!this.frame || e.source !== this.frame.contentWindow) return; // only our frame
    const d = e.data;
    if (d && d.type === 'lantern:vfs-ready' && this.launch.build.local && !this.vfsSent) {
      this.vfsSent = true;
      const { files, entry } = this.launch.build;
      loadSdk().then((sdk) => {
        const copies = files.map((x) => ({ path: x.path, type: x.type, buf: x.buf.slice(0) }));
        this.frame?.contentWindow.postMessage({ type: 'lantern:vfs', files: copies, entry, sdk, nonce: this.nonce }, '*', copies.map((x) => x.buf));
      });
      return;
    }
    if (!d || d.type !== 'lantern:hello') return;
    if (d.protocol !== 1) { console.warn('[runtime] unsupported SDK protocol', d.protocol); return; }
    this.port?.close();
    const ch = new MessageChannel();
    this.port = ch.port1;
    this.port.onmessage = (ev) => this.onPortMessage(ev.data);
    const context = Object.freeze({
      gameId: this.gameId, gameTitle: this.launch.game.title, version: this.launch.build.version,
      mode: this.launch.session.mode, sdk: '1.0.0', runtime: 'lantern-web/1.0', locale: navigator.language,
    });
    // Target '*' is required: the sandboxed frame has an opaque origin. The port
    // itself is only transferable to that exact window, so nothing else receives it.
    this.frame.contentWindow.postMessage({ type: 'lantern:init', protocol: 1, context }, '*', [ch.port2]);
    this.health.connected = true;
    this.cb.onConnected?.();
  }

  onPortMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.event === 'exit-ready') { this.exitReady?.(); return; }
    if (msg.event === 'error') { this.health.errors = Math.min(999, this.health.errors + 1); return; }
    if (typeof msg.id !== 'number') return;
    const p = this.handle(msg.method, msg.params ?? {})
      .then((result) => this.port?.postMessage({ id: msg.id, result }))
      .catch((err) => this.port?.postMessage({ id: msg.id, error: { code: err.code ?? 'internal', message: err.code ? err.message : 'Platform error' } }))
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  rateLimit() {
    const now = performance.now();
    this.tokens = Math.min(RATE.burst, this.tokens + ((now - this.lastRefill) / 1000) * RATE.perSecond);
    this.lastRefill = now;
    if (this.tokens < 1) throw new RpcError('rate_limited', 'Too many platform calls');
    this.tokens -= 1;
  }

  // ---- broker: the complete surface area games can reach ----
  async handle(method, params) {
    if (this.closed) throw new RpcError('closed', 'Runtime closed');
    this.rateLimit();
    const s = this.services;
    const key = () => {
      if (typeof params.key !== 'string' || !SAVE_KEY_RE.test(params.key)) throw new RpcError('invalid_key', 'Save keys must match [A-Za-z0-9_.-]{1,64}');
      return params.key;
    };
    switch (method) {
      case 'user.getCurrentUser': {
        const p = this.launch.player;
        return { id: p.id, displayName: p.displayName };
      }
      case 'storage.save': {
        const k = key();
        let json;
        try { json = JSON.stringify(params.value); } catch { throw new RpcError('invalid_value', 'Value must be JSON-serialisable'); }
        if (json === undefined) throw new RpcError('invalid_value', 'Value must be JSON-serialisable');
        if (json.length > MAX_SAVE_BYTES) throw new RpcError('too_large', 'Save values are limited to 256 KB');
        this.cb.onSaveState?.('saving');
        try {
          const r = await s.saves.put(this.gameId, k, JSON.parse(json));
          this.cb.onSaveState?.('saved', r.updatedAt);
          return { revision: r.revision, savedAt: r.updatedAt };
        } catch (e) {
          this.cb.onSaveState?.('error');
          throw new RpcError('save_failed', e.message);
        }
      }
      case 'storage.load': {
        const r = await s.saves.get(this.gameId, key());
        return r ? r.value : null;
      }
      case 'storage.remove':
        await s.saves.remove(this.gameId, key());
        return true;
      case 'storage.list':
        return (await s.saves.list(this.gameId)).map(({ key: k, sizeBytes, updatedAt }) => ({ key: k, sizeBytes, updatedAt }));
      case 'achievements.unlock': {
        if (typeof params.id !== 'string' || !/^[a-z0-9_]{1,40}$/.test(params.id)) throw new RpcError('invalid_id', 'Invalid achievement id');
        try {
          const r = await s.achievements.unlock(this.gameId, params.id);
          if (r.newlyUnlocked) this.cb.onAchievement?.(r.achievement);
          return { id: params.id, newlyUnlocked: r.newlyUnlocked, unlockedAt: r.achievement.unlockedAt };
        } catch (e) { throw new RpcError('unlock_failed', e.message); }
      }
      case 'achievements.list':
        return s.achievements.list(this.gameId);
      case 'game.reportPlaytime':
        // The host clock is authoritative; games can only signal activity.
        return { sessionSeconds: this.activeSeconds };
      case 'game.exit':
        setTimeout(() => this.cb.onExitRequested?.(), 0);
        return true;
      default:
        throw new RpcError('unknown_method', `Unknown platform method: ${String(method).slice(0, 60)}`);
    }
  }

  pause() { this.paused = true; this.port?.postMessage({ event: 'pause' }); }
  resume() { this.paused = false; this.port?.postMessage({ event: 'resume' }); this.focus(); }

  // Graceful shutdown: let the game flush saves, wait for in-flight platform
  // calls, record the session, then destroy the frame.
  async close() {
    if (this.closing) return;
    this.closing = true;
    if (this.port) {
      const ready = new Promise((r) => { this.exitReady = r; });
      this.port.postMessage({ event: 'exit-requested' });
      await Promise.race([ready, new Promise((r) => setTimeout(r, EXIT_GRACE_MS))]);
    }
    await Promise.race([Promise.allSettled([...this.inFlight]), new Promise((r) => setTimeout(r, EXIT_GRACE_MS))]);
    this.destroy();
    await this.services.runtime.end(this.launch.session.id, this.activeSeconds, { health: this.health }).catch(() => {});
  }

  destroy() {
    this.closed = true;
    clearInterval(this.clock);
    clearInterval(this.heartbeat);
    window.removeEventListener('message', this.onWindowMessage);
    window.removeEventListener('pagehide', this.onUnload);
    this.port?.close();
    this.port = null;
    if (this.frame) { this.frame.src = 'about:blank'; this.frame.remove(); this.frame = null; }
  }
}
