/*
 * Vibe-Games dev stand-in. Lets you open your game outside Vibe-Games (a local web
 * server, or your editor's live preview) with the same Platform API.
 *   • Inside Vibe-Games the real SDK has already defined window.Platform, so this does nothing.
 *   • Outside Vibe-Games, saves go to localStorage and achievements are logged to the console.
 * It applies the same limits as the real runtime so mistakes show up early.
 * Safe to ship in your package, or delete it before uploading.
 */
(function () {
  if (window.Platform) return;
  var KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/, ACH_RE = /^[a-z0-9_]{1,40}$/, MAX = 256 * 1024, P = 'vibe-dev:';
  var hooks = { exit: [], pause: [], resume: [] };
  function err(code, msg) { var e = new Error(msg); e.name = 'PlatformError'; e.code = code; return e; }
  function key(k) { if (typeof k !== 'string' || !KEY_RE.test(k)) throw err('invalid_key', 'Save keys must match [A-Za-z0-9_.-]{1,64}'); return P + 'save:' + k; }
  function store() { try { return window.localStorage; } catch (e) { return null; } }
  var mem = {};
  function get(k) { var s = store(); return s ? s.getItem(k) : (k in mem ? mem[k] : null); }
  function set(k, v) { var s = store(); if (s) s.setItem(k, v); else mem[k] = v; }
  function del(k) { var s = store(); if (s) s.removeItem(k); else delete mem[k]; }
  function wrap(fn) { return function () { var a = arguments; return new Promise(function (r) { r(fn.apply(null, a)); }); }; }
  var context = Object.freeze({ gameId: 'dev', gameTitle: document.title, version: '0.0.0-dev', mode: 'dev', sdk: '1.0.0', runtime: 'vibe-dev', locale: navigator.language });
  var Platform = {
    version: '1.0.0-dev',
    ready: wrap(function () { return context; }),
    user: { getCurrentUser: wrap(function () { return { id: 'dev-player', displayName: 'Dev Player' }; }) },
    storage: {
      save: wrap(function (k, v) {
        var json = JSON.stringify(v);
        if (json === undefined) throw err('invalid_value', 'Value must be JSON-serialisable');
        if (json.length > MAX) throw err('too_large', 'Save values are limited to 256 KB');
        var kk = key(k), prev = JSON.parse(get(kk) || 'null'), rev = (prev ? prev.revision : 0) + 1, at = new Date().toISOString();
        set(kk, JSON.stringify({ value: JSON.parse(json), revision: rev, updatedAt: at, sizeBytes: json.length }));
        return { revision: rev, savedAt: at };
      }),
      load: wrap(function (k) { var r = JSON.parse(get(key(k)) || 'null'); return r ? r.value : null; }),
      remove: wrap(function (k) { del(key(k)); return true; }),
      list: wrap(function () {
        var s = store(), keys = s ? Object.keys(s) : Object.keys(mem);
        return keys.filter(function (k) { return k.indexOf(P + 'save:') === 0; }).map(function (k) {
          var r = JSON.parse(get(k)); return { key: k.slice((P + 'save:').length), sizeBytes: r.sizeBytes, updatedAt: r.updatedAt };
        });
      }),
    },
    achievements: {
      unlock: wrap(function (id) {
        if (typeof id !== 'string' || !ACH_RE.test(id)) throw err('invalid_id', 'Invalid achievement id');
        var k = P + 'ach:' + id, had = get(k), at = had || new Date().toISOString();
        if (!had) { set(k, at); console.log('%c🏆 Achievement unlocked: ' + id, 'color:#ffb547;font-weight:bold'); }
        return { id: id, newlyUnlocked: !had, unlockedAt: at };
      }),
      list: wrap(function () {
        var s = store(), keys = s ? Object.keys(s) : Object.keys(mem);
        return keys.filter(function (k) { return k.indexOf(P + 'ach:') === 0; }).map(function (k) { var id = k.slice((P + 'ach:').length); return { id: id, name: id, description: '', unlockedAt: get(k) }; });
      }),
    },
    game: {
      getLaunchContext: wrap(function () { return context; }),
      reportPlaytime: wrap(function () { return { sessionSeconds: Math.round(performance.now() / 1000) }; }),
      exit: wrap(function () { console.log('[vibe-dev] game asked to exit'); return true; }),
      onExit: function (fn) { if (typeof fn === 'function') hooks.exit.push(fn); },
      onPause: function (fn) { if (typeof fn === 'function') hooks.pause.push(fn); },
      onResume: function (fn) { if (typeof fn === 'function') hooks.resume.push(fn); },
    },
  };
  document.addEventListener('visibilitychange', function () { (document.hidden ? hooks.pause : hooks.resume).forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); });
  addEventListener('pagehide', function () { hooks.exit.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); });
  window.Platform = Platform;
  console.info('[vibe-dev] Running outside Vibe-Games: saves use localStorage, achievements log to the console.');
})();
