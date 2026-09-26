/*!
 * Lantern Platform SDK v1
 * Include in your game:  <script src="/sdk/v1/platform-sdk.js"></script>
 *
 * The game never talks to servers, storage or the platform UI directly.
 * Every call is an async RPC over a private MessageChannel to the Lantern
 * runtime host, which validates it and decides how to fulfil it
 * (web: platform API; desktop: local cache + cloud sync). Same game code, both.
 *
 *   await Platform.ready()                       -> launch context
 *   await Platform.user.getCurrentUser()         -> { id, displayName }  (id is per-game pseudonymous)
 *   await Platform.storage.save(key, value)      -> { revision, savedAt }
 *   await Platform.storage.load(key)             -> value | null
 *   await Platform.storage.remove(key) / list()
 *   await Platform.achievements.unlock(id)       -> { newlyUnlocked }
 *   await Platform.achievements.list()
 *   Platform.game.reportPlaytime()               -> activity ping (host keeps the authoritative clock)
 *   Platform.game.onExit(async () => save())     -> flush state before the runtime closes the game
 *   Platform.game.onPause(fn) / onResume(fn)
 *   Platform.game.exit()                         -> ask the platform to close the game
 */
(function () {
  'use strict';
  if (window.Platform) return;

  var PROTOCOL = 1;
  var port = null;
  var queue = [];
  var pending = new Map();
  var nextId = 1;
  var context = null;
  var resolveReady;
  var readyPromise = new Promise(function (r) { resolveReady = r; });
  var handlers = { exit: [], pause: [], resume: [] };

  function PlatformError(code, message) {
    var e = new Error(message || code);
    e.name = 'PlatformError';
    e.code = code;
    return e;
  }

  // --- handshake: announce ourselves to the host frame and wait for a private port ---
  var tries = 0;
  function hello() {
    if (port || tries++ > 100) { clearInterval(helloTimer); return; }
    window.parent.postMessage({ type: 'lantern:hello', protocol: PROTOCOL }, '*');
  }
  var helloTimer = setInterval(hello, 150);
  hello();

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.type !== 'lantern:init' || !e.ports || !e.ports[0]) return;
    if (port) port.close();
    port = e.ports[0];
    port.onmessage = onPortMessage;
    context = Object.freeze(d.context || {});
    clearInterval(helloTimer);
    resolveReady(context);
    queue.splice(0).forEach(function (m) { port.postMessage(m); });
  });

  function onPortMessage(e) {
    var d = e.data || {};
    if (d.id && pending.has(d.id)) {
      var p = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) p.reject(PlatformError(d.error.code, d.error.message));
      else p.resolve(d.result);
      return;
    }
    if (d.event === 'exit-requested') runExitHandlers();
    else if (d.event === 'pause') handlers.pause.forEach(safe);
    else if (d.event === 'resume') handlers.resume.forEach(safe);
  }

  // Uncaught errors are counted by the platform (launch health). Only a count and a
  // short message leave the game, capped so a broken loop can't flood the channel.
  var reportedErrors = 0;
  function reportError(msg) {
    if (reportedErrors++ >= 20) return;
    var m = { event: 'error', message: String(msg || 'Error').slice(0, 200) };
    if (port) port.postMessage(m); else queue.push(m);
  }
  window.addEventListener('error', function (e) { reportError(e && e.message); });
  window.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; reportError(r && r.message ? r.message : r); });

  function safe(fn) { try { return fn(); } catch (err) { console.error('[Lantern SDK] handler error', err); } }

  function runExitHandlers() {
    var work = Promise.all(handlers.exit.map(function (h) { return Promise.resolve().then(h).catch(function (err) { console.error('[Lantern SDK] onExit handler failed', err); }); }));
    var timeout = new Promise(function (r) { setTimeout(r, 1500); });
    Promise.race([work, timeout]).then(function () { port && port.postMessage({ event: 'exit-ready' }); });
  }

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      var msg = { id: id, method: method, params: params || {} };
      if (port) port.postMessage(msg); else queue.push(msg);
    });
  }

  var Platform = {
    version: '1.0.0',
    ready: function () { return readyPromise; },
    user: {
      getCurrentUser: function () { return call('user.getCurrentUser'); },
    },
    storage: {
      save: function (key, value) { return call('storage.save', { key: key, value: value }); },
      load: function (key) { return call('storage.load', { key: key }); },
      remove: function (key) { return call('storage.remove', { key: key }); },
      list: function () { return call('storage.list'); },
    },
    achievements: {
      unlock: function (id) { return call('achievements.unlock', { id: id }); },
      list: function () { return call('achievements.list'); },
    },
    game: {
      getLaunchContext: function () { return readyPromise; },
      reportPlaytime: function () { return call('game.reportPlaytime'); },
      exit: function () { return call('game.exit'); },
      onExit: function (fn) { if (typeof fn === 'function') handlers.exit.push(fn); },
      onPause: function (fn) { if (typeof fn === 'function') handlers.pause.push(fn); },
      onResume: function (fn) { if (typeof fn === 'function') handlers.resume.push(fn); },
    },
  };

  function deepFreeze(o) { Object.values(o).forEach(function (v) { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); }
  Object.defineProperty(window, 'Platform', { value: deepFreeze(Platform), writable: false, configurable: false });
})();
