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
import * as developers from './views/developers.js';
import * as play from './views/play.js';
import * as checkoutComplete from './views/checkout-complete.js';
import * as admin from './views/admin.js';
import * as legal from './views/legal.js';
import { renderVerify, renderReset } from './views/account-links.js';
import { openAuth } from './views/auth.js';
import { flush } from './offline/sync.js';
import { setNavigator, setPrevious } from './nav.js';
import { migrateLegacyStorage } from './migrate.js';

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
  [/^\/developers\/?$/, developers, 'developers'],
  [/^\/play\/([^/]+)\/?$/, play, null],
  [/^\/checkout\/complete\/?$/, checkoutComplete, 'store'],
  [/^\/admin\/?$/, admin, 'admin'],
  [/^\/legal\/([a-z]+)\/?$/, legal, null],
  [/^\/verify-email\/?$/, { render: renderVerify }, null],
  [/^\/reset-password\/?$/, { render: renderReset }, null],
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
      view.innerHTML = `<div class="page empty-state"><h2>That wasn't the vibe</h2><p>${esc(err.message)}</p><a class="btn" href="/store" data-link>Back to Store</a></div>`;
    }
    return;
  }
  view.innerHTML = '<div class="page empty-state"><h2>404: this page was never prompted</h2><p>Nothing lives at this address. Maybe it&rsquo;s still being vibed.</p><a class="btn" href="/store" data-link>Back to Store</a></div>';
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
  let signIn = document.getElementById('signInBtn');
  if (state.user?.guest && !signIn) {
    signIn = document.createElement('button');
    signIn.id = 'signInBtn'; signIn.className = 'btn btn-ghost btn-sm nav-signin'; signIn.textContent = 'Sign in';
    signIn.onclick = () => openAuth({ mode: 'login' });
    me.before(signIn);
  } else if (!state.user?.guest && signIn) signIn.remove();
  let banner = document.getElementById('offlineBanner');
  if (state.offline && !banner) {
    banner = document.createElement('div');
    banner.id = 'offlineBanner'; banner.className = 'offline-banner';
    banner.innerHTML = "<b>You're offline.</b> Downloaded games still play, and saves sync when you reconnect.";
    document.querySelector('.topnav').after(banner);
  } else if (!state.offline && banner) banner.remove();
  document.body.classList.toggle('is-offline', !!state.offline);
  document.getElementById('navAdmin')?.classList.toggle('hidden', !state.creator?.admin);
  const wc = document.getElementById('wishCount');
  wc.textContent = state.wishlist.size ? state.wishlist.size : '';
}
onChange(renderChrome);

// Browser errors → the server's error tracking (deduplicated, capped per page load).
let reported = 0;
const reportClientError = (message, stack) => {
  if (reported++ >= 5 || !message) return;
  fetch('/api/client-errors', { method: 'POST', headers: { 'X-Vibe-Client': 'platform', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(message), stack: String(stack ?? ''), url: location.pathname }) }).catch(() => {});
};
window.addEventListener('error', (e) => { if (e.filename && !e.filename.startsWith(location.origin)) return; reportClientError(e.message, e.error?.stack); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason instanceof TypeError && /offline|fetch/i.test(e.reason.message)) return; reportClientError(e.reason?.message ?? e.reason, e.reason?.stack); });

(async () => {
  await migrateLegacyStorage();
  try {
    await boot();
  } catch (err) {
    if (err instanceof TypeError) { view.innerHTML = `<div class="page empty-state"><h2>You're offline</h2><p>Open Vibe-Games once while online and your library comes with you offline.</p></div>`; return; }
    view.innerHTML = `<div class="page empty-state"><h2>Can't reach Vibe-Games right now</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  renderChrome();
  await render();
  flush(); // upload anything queued while offline
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
