// Platform shell: boot, navigation, routing.
import { boot, state, onChange } from './state.js';
import { avatar, esc, $$ } from './ui.js';
import * as store from './views/store.js';
import * as gamePage from './views/game.js';
import * as search from './views/search.js';
import * as library from './views/library.js';
import * as wishlist from './views/wishlist.js';
import * as profile from './views/profile.js';
import * as publish from './views/publish.js';
import * as play from './views/play.js';
import { setNavigator, setPrevious } from './nav.js';

const routes = [
  [/^\/$/, () => navigate('/store', { replace: true })],
  [/^\/store\/?$/, store, 'store'],
  [/^\/app\/([^/]+)\/?$/, gamePage, 'store'],
  [/^\/search\/?$/, search, 'store'],
  [/^\/library\/?$/, library, 'library'],
  [/^\/library\/([^/]+)\/?$/, library, 'library'],
  [/^\/wishlist\/?$/, wishlist, 'wishlist'],
  [/^\/profile\/?$/, profile, 'profile'],
  [/^\/publish\/?$/, publish, 'publish'],
  [/^\/play\/([^/]+)\/?$/, play, null],
];

const view = document.getElementById('view');
let cleanup = null;
let renderSeq = 0;
let lastNonPlay = '/store';

export async function navigate(path, { replace = false } = {}) {
  const same = path === location.pathname + location.search;
  history[replace || same ? 'replaceState' : 'pushState']({}, '', path);
  await render();
}
window.addEventListener('popstate', () => render());
setNavigator(navigate);

async function render() {
  const seq = ++renderSeq;
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  if (cleanup) { const c = cleanup; cleanup = null; await c(); }
  if (seq !== renderSeq) return;
  for (const [re, mod, nav] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    if (typeof mod === 'function') return mod();
    const isPlay = mod === play;
    document.body.classList.toggle('in-game', isPlay);
    if (!isPlay) {
      lastNonPlay = path + location.search;
      setPrevious(lastNonPlay);
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      view.innerHTML = '';
      view.onclick = null;
      window.scrollTo(0, 0);
    }
    try {
      cleanup = (await mod.render(isPlay ? document.getElementById('runtime-root') : view, m.slice(1).map(decodeURIComponent), query)) ?? null;
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="page empty-state"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a class="btn" href="/store" data-link>Back to Store</a></div>`;
    }
    return;
  }
  view.innerHTML = '<div class="page empty-state"><h2>Page not found</h2><a class="btn" href="/store" data-link>Back to Store</a></div>';
}

// Intercept in-app links.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});

function renderChrome() {
  const me = document.getElementById('meChip');
  if (state.user) me.innerHTML = `${avatar(state.user, 26)}<span>${esc(state.user.displayName)}</span>`;
  const wc = document.getElementById('wishCount');
  wc.textContent = state.wishlist.size ? state.wishlist.size : '';
}
onChange(renderChrome);

(async () => {
  try {
    await boot();
  } catch (err) {
    view.innerHTML = `<div class="page empty-state"><h2>Can't reach Lantern services</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  renderChrome();
  await render();
})();
