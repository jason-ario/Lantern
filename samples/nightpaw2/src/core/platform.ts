// Thin wrapper around the Lantern Platform SDK. When the game runs outside Lantern
// (local dev, tests) it falls back to localStorage and console logging.
const LS_PREFIX = 'nightpaw:';

const fallback: LanternPlatform = {
  ready: async () => ({ mode: 'standalone' }),
  user: { getCurrentUser: async () => ({ id: 'local', displayName: 'Player' }) },
  storage: {
    save: async (k, v) => { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch { /* private mode */ } return { revision: 0, savedAt: Date.now() }; },
    load: async (k) => { try { const s = localStorage.getItem(LS_PREFIX + k); return s ? JSON.parse(s) : null; } catch { return null; } },
    remove: async (k) => { try { localStorage.removeItem(LS_PREFIX + k); } catch { /* */ } },
    list: async () => [],
  },
  achievements: { unlock: async (id) => { console.info('[achievement]', id); return { newlyUnlocked: true }; }, list: async () => [] },
  game: { reportPlaytime() {}, onExit() {}, onPause() {}, onResume() {}, exit() {} },
};

let P: LanternPlatform = fallback;
let context: any = { mode: 'standalone' };

export const Platform = {
  async init() {
    if (window.Platform && window.parent !== window) {
      // Inside the Lantern runtime. Don't hang forever if the host never answers.
      const ctx = await Promise.race([window.Platform.ready(), new Promise((r) => setTimeout(() => r(null), 2500))]);
      if (ctx) { P = window.Platform; context = ctx; }
    }
    return context;
  },
  get api() { return P; },
  get context() { return context; },
  get isDemo() { return context?.launchMode === 'demo' || context?.demo === true; },
  save: (k: string, v: any) => P.storage.save(k, v),
  load: (k: string) => P.storage.load(k),
  remove: (k: string) => P.storage.remove(k),
  unlock: (id: string) => P.achievements.unlock(id),
  onExit: (fn: () => any) => P.game.onExit(fn),
  onPause: (fn: () => void) => P.game.onPause(fn),
  onResume: (fn: () => void) => P.game.onResume(fn),
  reportPlaytime: () => { try { P.game.reportPlaytime(); } catch { /* */ } },
};
