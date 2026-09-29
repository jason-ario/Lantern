// Pages opened from emails: /verify-email?token=… and /reset-password?token=…
import { api } from '../api.js';
import { applyUserState, state } from '../state.js';
import { esc, toast } from '../ui.js';
import { openAuth } from './auth.js';
import { go } from '../nav.js';

export async function renderVerify(root, _, query) {
  root.innerHTML = '<div class="page acct-page"><div class="acct-card"><div class="spinner lg"></div><p class="muted">Confirming your email…</p></div></div>';
  const card = root.querySelector('.acct-card');
  try {
    const r = await api.auth.verify(query.get('token') ?? '');
    if (r.state) applyUserState(r.state);
    card.innerHTML = `<div class="co-check">✓</div><h1>Email confirmed</h1><p class="muted">${esc(r.email)} is verified. You can publish games and get paid.</p>
      <div class="co-actions"><a class="btn btn-ghost" href="/store" data-link>Back to the store</a><a class="btn btn-buy" href="/publish" data-link>Go to Publish</a></div>`;
  } catch (err) {
    card.innerHTML = `<h1>That link didn’t work</h1><p class="muted">${esc(err.message)}</p>
      ${state.user && !state.user.guest && !state.user.emailVerified ? '<button class="btn btn-buy" id="resend">Send a new link</button>' : '<a class="btn btn-ghost" href="/profile" data-link>Go to your profile</a>'}`;
    root.querySelector('#resend')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await api.auth.resendVerification(); toast(`New link sent to <b>${esc(state.user.email)}</b>`, { kind: 'ok' }); } catch (x) { e.target.disabled = false; toast(esc(x.message), { kind: 'error' }); }
    });
  }
  return null;
}

export async function renderReset(root, _, query) {
  const token = query.get('token') ?? '';
  root.innerHTML = `<div class="page acct-page"><form class="acct-card" id="resetForm">
    <h1>Choose a new password</h1>
    <p class="muted">You’ll be signed out everywhere else. Then sign in with the new password.</p>
    <label class="f"><span>New password</span><input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
    <label class="f"><span>Repeat it</span><input type="password" name="again" minlength="8" autocomplete="new-password" required></label>
    <button class="btn btn-buy btn-lg">Save new password</button>
  </form></div>`;
  const f = root.querySelector('#resetForm');
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.password.value !== f.again.value) { toast('The passwords don’t match', { kind: 'error' }); return; }
    const btn = f.querySelector('button'); btn.disabled = true;
    try {
      const r = await api.auth.reset(token, f.password.value);
      f.innerHTML = `<div class="co-check">✓</div><h1>Password changed</h1><p class="muted">Sign in as ${esc(r.email)} with your new password.</p><button type="button" class="btn btn-buy" id="signin">Sign in</button>`;
      f.querySelector('#signin').onclick = () => openAuth({ mode: 'login', onDone: () => go('/profile') });
    } catch (err) { btn.disabled = false; toast(esc(err.message), { kind: 'error' }); }
  };
  return null;
}
