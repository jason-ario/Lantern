// Platform shell: boot, navigation, routing.
import { boot, state, onChange } from './state.js';
import { avatar, esc, toast, $$ } from './ui.js';
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
import * as packages from './offline/packages.js';
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

// Pages that need an account. Signed-out visitors see a sign-up prompt instead
// (the store, game pages, the creator guide and legal pages stay public).
const NEEDS_ACCOUNT = new Set([library, wishlist, profile, play, checkoutComplete]);
function gateReason(mod, m) {
  if (mod === play) { const g = state.byId.get(decodeURIComponent(m[1])); return `Create a free account to play${g ? ` ${g.title.replace(/[.!?]+$/, '')}` : ''}. Your saves, achievements and library follow you everywhere.`; }
  if (mod === wishlist) return 'Create a free account to keep a wishlist.';
  if (mod === library) return 'Create a free account to start your library.';
  return 'Sign up or sign in to see your profile.';
}
function renderGate(mod, m, query) {
  const g = mod === play ? state.byId.get(decodeURIComponent(m[1])) : null;
  if (query.get('authError')) toast(esc(query.get('authError')), { kind: 'error' });
  view.innerHTML = `<div class="page empty-state acct-gate">
    ${g ? `<img class="gate-cover" src="${esc(g.media.header ?? g.media.hero ?? '')}" alt="">` : ''}
    <h2>${g ? `Ready to play ${esc(g.title)}?` : 'Sign up to continue'}</h2>
    <p>${esc(gateReason(mod, m))}</p>
    <div class="co-actions center"><button class="btn btn-buy btn-lg" id="gateSignup">Create free account</button><button class="btn btn-ghost" id="gateLogin">Sign in</button></div>
    ${g ? `<p class="gate-back"><a href="/app/${esc(g.id)}" data-link>Back to ${esc(g.title)}</a></p>` : '<p class="gate-back"><a href="/store" data-link>Back to the store</a></p>'}
  </div>`;
  const reason = gateReason(mod, m);
  view.querySelector('#gateSignup').onclick = () => openAuth({ mode: 'signup', reason, onDone: () => render() });
  view.querySelector('#gateLogin').onclick = () => openAuth({ mode: 'login', reason, onDone: () => render() });
  openAuth({ mode: 'signup', reason, onDone: () => render() });
}

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
    const gated = !state.user && NEEDS_ACCOUNT.has(mod);
    const isPlay = mod === play && !gated;
    document.body.classList.toggle('in-game', isPlay);
    if (!isPlay) {
      lastNonPlay = path + location.search;
      setPrevious(lastNonPlay);
      $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      view.innerHTML = '';
      view.onclick = null;
      window.scrollTo(0, 0);
    }
    if (gated) { renderGate(mod, m, query); return; }
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
  me.innerHTML = state.user ? `${avatar(state.user, 26)}<span>${esc(state.user.displayName)}</span>` : '';
  me.classList.toggle('hidden', !state.user);
  let signIn = document.getElementById('signInBtn');
  if (!state.user && !signIn) {
    signIn = document.createElement('span');
    signIn.id = 'signInBtn'; signIn.className = 'nav-auth';
    signIn.innerHTML = '<button class="btn btn-ghost btn-sm nav-signin" data-auth="login">Sign in</button><button class="btn btn-buy btn-sm nav-signup" data-auth="signup">Sign up</button>';
    signIn.onclick = (e) => { const b = e.target.closest('[data-auth]'); if (b) openAuth({ mode: b.dataset.auth, onDone: () => render() }); };
    me.before(signIn);
  } else if (state.user && signIn) signIn.remove();
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
  // Keep downloaded games current, like a launcher does on start (unless the player turned off
  // automatic downloads in Profile; then the Update badges in the Library do it on request).
  let autoDl = true; try { autoDl = localStorage.getItem('vibe.autoDownload') !== '0'; } catch { /* ignore */ }
  if (!state.offline && autoDl) {
    packages.autoUpdate([...state.byId.values()], {
      onResult: (r) => {
        const g = state.byId.get(r.gameId);
        if (r.ok) toast(`<b>${esc(g?.title ?? r.gameId)}</b> updated to v${esc(r.version)}`, { kind: 'ok' });
        else toast(`Couldn't update <b>${esc(g?.title ?? r.gameId)}</b>: ${esc(r.error)}`, { kind: 'error' });
        if (location.pathname.startsWith('/library')) render();
      },
    }).catch(() => {});
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
