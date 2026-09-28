// Sign in / create account modal. Guests keep everything: creating an account
// upgrades the guest in place; signing in merges the guest's library into the account.
import { api } from '../api.js';
import { state, applyUserState, loadCatalog } from '../state.js';
import { esc, modal, toast, icons } from '../ui.js';

const GOOGLE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z"/></svg>';

export function openAuth({ mode = 'signup', reason = '', onDone } = {}) {
  let current = mode;
  modal(`<div class="auth">
    <div class="co-head"><h3 id="authTitle"></h3><button class="icon-btn" data-close aria-label="Close">${icons.close}</button></div>
    ${reason ? `<p class="auth-reason">${esc(reason)}</p>` : ''}
    <div class="auth-tabs"><button data-tab="signup">Create account</button><button data-tab="login">Sign in</button></div>
    ${state.features.google ? `<a class="btn btn-ghost auth-google" href="/api/auth/google/start">${GOOGLE_ICON} Continue with Google</a><div class="auth-or"><span>or</span></div>` : ''}
    <form id="authForm" class="auth-form" novalidate>
      <label class="f" data-only="signup"><span>Display name</span><input name="displayName" maxlength="24" autocomplete="nickname" value="${esc(state.user?.guest ? state.user.displayName : '')}"></label>
      <label class="f"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      <label class="f"><span>Password</span><input name="password" type="password" minlength="8" required></label>
      <p class="auth-note muted small" id="authNote"></p>
      <button class="btn btn-buy btn-lg" id="authSubmit"></button>
    </form>
  </div>`, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      const f = el.querySelector('#authForm');
      const setMode = (m) => {
        current = m;
        el.querySelectorAll('.auth-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === m));
        el.querySelectorAll('[data-only]').forEach((x) => { x.style.display = x.dataset.only === m ? '' : 'none'; });
        el.querySelector('#authTitle').textContent = m === 'signup' ? 'Create your Vibe-Games account' : 'Welcome back';
        el.querySelector('#authSubmit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
        f.elements.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
        el.querySelector('#authNote').textContent = state.user?.guest && state.owned.size
          ? (m === 'signup' ? `Your ${state.owned.size} game${state.owned.size === 1 ? '' : 's'}, saves and achievements move into the new account.` : 'Anything you did as a guest on this browser is added to your account.')
          : (m === 'signup' ? 'Your library, cloud saves and purchases follow you to any browser — and to the desktop app later.' : '');
      };
      el.querySelector('.auth-tabs').onclick = (e) => { if (e.target.dataset.tab) setMode(e.target.dataset.tab); };
      setMode(mode);
      // Focus the first field, but never steal focus from a field the user (or autofill) is already typing in.
      setTimeout(() => { if (!f.contains(document.activeElement)) (current === 'signup' ? f.elements.displayName : f.elements.email).focus(); }, 50);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#authSubmit');
        btn.disabled = true;
        try {
          const email = f.elements.email.value.trim(), password = f.elements.password.value;
          const s = current === 'signup' ? await api.auth.signup(email, password, f.elements.displayName.value.trim()) : await api.auth.login(email, password);
          applyUserState(s);
          navigator.serviceWorker?.controller?.postMessage({ type: 'clear-api-cache' });
          await loadCatalog();
          close();
          toast(current === 'signup' ? `Welcome to Vibe-Games, <b>${esc(s.user.displayName)}</b>` : `Signed in as <b>${esc(s.user.displayName)}</b>`, { kind: 'ok' });
          onDone?.(s);
        } catch (err) {
          btn.disabled = false;
          toast(esc(err.message), { kind: 'error' });
        }
      };
    },
  });
}

export async function signOut() {
  await api.auth.logout();
  navigator.serviceWorker?.controller?.postMessage({ type: 'clear-api-cache' });
  location.href = '/store'; // fresh guest session
}
