import { api } from '../api.js';
import { state, boot, applyUserState, loadCatalog } from '../state.js';
import { esc, avatar, hours, ago, date, icons, modal, toast, price, bytes } from '../ui.js';
import { go } from '../nav.js';
import { openAuth, signOut } from './auth.js';
import * as packages from '../offline/packages.js';

export async function render(root, _, query) {
  if (query?.get('authError')) toast(esc(query.get('authError')), { kind: 'error' });
  if (query?.get('welcome')) toast(`Signed in as <b>${esc(state.user?.displayName ?? '')}</b>`, { kind: 'ok' });
  const p = await api.profile();
  const s = p.stats;
  root.innerHTML = `<div class="profile">
    <div class="pf-banner" style="background-image:url('${esc(state.byId.get(p.games[0]?.gameId)?.media.hero ?? '/media/hollow-lantern/hero.svg')}')"></div>
    <div class="page">
      <div class="pf-head">
        ${avatar(p.user, 112)}
        <div class="pf-id">
          <h1><span id="pfName">${esc(p.user.displayName)}</span> <button class="link-btn" id="rename">Edit name</button></h1>
          <div class="muted">@${esc(p.user.username)}${p.user.email ? ` · ${esc(p.user.email)}` : ''} · Member since ${date(p.user.memberSince)}</div>
        </div>
      </div>
      ${p.user.email && !p.user.emailVerified ? `<div class="guest-cta verify-cta"><div><b>Confirm your email.</b><span class="muted">We sent a link to ${esc(p.user.email)}. Confirming lets you publish games and recover your account.</span></div><div class="guest-cta-actions"><button class="btn btn-buy" id="resendVerify">Resend link</button></div></div>` : ''}
      <div class="pf-stats">
        <div><b>${s.owned}</b><span>Games owned</span></div>
        <div><b>${s.played}</b><span>Games played</span></div>
        <div><b>${hours(s.totalSeconds)}</b><span>Total playtime</span></div>
        <div><b>${s.achievements}</b><span>Achievements</span></div>
        <div><b>${s.wishlist}</b><span>Wishlisted</span></div>
      </div>
      <div class="pf-body">
        <section class="panel">
          <h3>Recent activity</h3>
          ${p.games.filter((x) => x.lastPlayedAt).map((x) => {
            const g = state.byId.get(x.gameId); if (!g) return '';
            return `<a class="pf-game" href="/library/${esc(g.id)}" data-link>
              <span class="pf-game-art" style="background-image:url('${esc(g.media.header)}')"></span>
              <span class="pf-game-t"><b>${esc(g.title)}</b><small>${hours(x.playtimeSeconds)} on record · last played ${ago(x.lastPlayedAt).toLowerCase()}</small></span>
              <span class="pf-game-ach"><small>Achievements</small><b>${x.achievements.unlocked}/${x.achievements.total}</b><span class="ld-meter"><span style="width:${x.achievements.total ? (x.achievements.unlocked / x.achievements.total) * 100 : 0}%"></span></span></span>
            </a>`;
          }).join('') || '<p class="muted">No games played yet.</p>'}
        </section>
        <div>
          <section class="panel">
            <h3>Latest achievements</h3>
            ${p.recentAchievements.map((a) => `<div class="ach got compact"><div class="ach-ico">${icons.trophy}</div><div><div class="ach-n">${esc(a.name)}</div><div class="ach-d">${esc(state.byId.get(a.gameId)?.title ?? '')} · ${ago(a.unlockedAt)}</div></div></div>`).join('') || '<p class="muted">None yet.</p>'}
          </section>
          <section class="panel">
            <h3>Account</h3>
            ${`<dl class="kv acct-kv"><dt>Email</dt><dd>${esc(p.user.email ?? '—')}</dd><dt>Sign-in</dt><dd>${[p.user.hasPassword ? 'Password' : '', p.user.google ? 'Google' : ''].filter(Boolean).join(' + ') || '—'}</dd></dl>`}
            <div class="acct-actions">
              ${p.user.hasPassword ? '<button class="btn btn-ghost btn-sm" id="changePw">Change password</button>' : ''}<button class="btn btn-ghost btn-sm" id="signOut">Sign out</button>
              <button class="btn btn-ghost btn-sm" id="resetMine">Reset my progress</button>

            </div>
          </section>
          <section class="panel">
            <h3>Purchase history</h3>
            ${(p.orders ?? []).length ? `<table class="saves orders"><tbody>${p.orders.map((o) => `<tr><td><a href="/app/${esc(o.gameId)}" data-link>${esc(o.title)}</a><div class="muted small mono">${esc(o.id)}</div></td><td>${date(o.paidAt ?? o.createdAt)}</td><td>${o.amountCents ? price(o.amountCents) : 'Free'}</td><td class="muted small">${{ stripe: 'Card (Stripe)', mock: 'Demo wallet', free: 'Free' }[o.provider] ?? esc(o.provider)}</td><td class="ord-refund">${o.status === 'refunded' ? '<span class="lst lst-removed">Refunded</span>' : o.refund?.ok ? `<button class="link-btn" data-refund="${esc(o.id)}" data-title="${esc(o.title)}">Refund</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No purchases yet.</p>'}
          </section>
          <section class="panel">
            <h3>Offline &amp; downloads</h3>
            <p class="muted small" id="dlUsage">…</p>
            <label class="f check"><input type="checkbox" id="autoDl" ${localStorage.getItem('vibe.autoDownload') !== '0' ? 'checked' : ''}><span>Download games after purchase so they play offline</span></label>
            <button class="btn btn-ghost btn-sm" id="clearDl">Remove all downloads</button>
          </section>
          ${state.creator.admin ? `<section class="panel">
            <h3>Admin</h3>
            <p class="muted small">Review queue, reports, refunds, creators and site settings (including sample content).</p>
            <a class="btn btn-buy btn-sm" href="/admin" data-link>Open admin console</a>
          </section>
          <section class="panel">
            <h3>Site admin</h3>
            <p class="muted small">Restores the seeded catalog for everyone and removes every published game, account and save.</p>
            <button class="btn btn-danger" id="resetSite">Reset entire site</button>
          </section>` : ''}
        </div>
      </div>
    </div>
  </div>`;
  const confirmBox = (title, text, label, action) => modal(`<div class="confirm"><h3>${title}</h3><p class="muted">${text}</p>
    <div class="co-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" data-ok>${label}</button></div></div>`, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-ok]').onclick = async () => { try { await action(); close(); } catch (err) { toast(esc(err.message), { kind: 'error' }); } };
    },
  });
  packages.usage().then((u) => { const el = root.querySelector('#dlUsage'); if (el) el.textContent = u.games ? `${u.games} game${u.games === 1 ? '' : 's'} downloaded on this device · ${bytes(u.bytes)}. Each build is signature-checked before it runs.` : 'No games downloaded on this device yet.'; });
  root.querySelector('#autoDl').onchange = (e) => { try { localStorage.setItem('vibe.autoDownload', e.target.checked ? '1' : '0'); } catch { /* ignore */ } };
  root.querySelector('#clearDl').onclick = async () => { await packages.clearAll(); toast('Removed all downloaded games from this device'); go('/profile'); };
  root.querySelector('#signOut')?.addEventListener('click', () => signOut());
  root.querySelector('#changePw')?.addEventListener('click', () => modal(`<form class="confirm"><h3>Change password</h3>
    <label class="f"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
    <label class="f" style="margin-top:10px"><span>New password</span><input type="password" name="password" minlength="8" autocomplete="new-password" required></label>
    <p class="muted small">Other devices signed in to this account will be signed out.</p>
    <div class="co-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-buy">Change password</button></div></form>`, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('form').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { applyUserState(await api.auth.changePassword(f.current.value, f.password.value)); close(); toast('Password changed', { kind: 'ok' }); } catch (err) { toast(esc(err.message), { kind: 'error' }); } };
    },
  }));
  root.querySelector('#resetMine').onclick = () => confirmBox('Reset your progress?', 'Your library, saves, playtime, achievements and wishlist on this account are deleted.', 'Reset my progress', async () => {
    applyUserState(await api.account.resetProgress()); toast('Your progress was reset'); go('/store');
  });
  root.querySelector('#resendVerify')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api.auth.resendVerification(); toast(`New link sent to <b>${esc(p.user.email)}</b>`, { kind: 'ok' }); } catch (err) { e.target.disabled = false; toast(esc(err.message), { kind: 'error' }); }
  });
  root.querySelectorAll('[data-refund]').forEach((b) => { b.onclick = () => confirmBox(`Refund ${esc(b.dataset.title)}?`, 'The game is removed from your library and the money goes back to your original payment method (usually 5–10 business days). Your saves are kept in case you buy it again.', 'Refund', async () => {
    const r = await api.refund(b.dataset.refund); applyUserState(r.state); toast('Refund issued. We’ve emailed you a confirmation.', { kind: 'ok' }); go('/profile');
  }); });
  root.querySelector('#resetSite')?.addEventListener('click', () => confirmBox('Reset the entire site?', 'Everyone’s accounts, purchases and saves are deleted and every published game is removed.', 'Reset site', async () => {
    await api.admin.resetSite(); await boot(); toast('Site reset'); go('/store');
  }));
  root.querySelector('#rename').onclick = () => modal(`<form class="confirm" id="nameForm"><h3>Your display name</h3>
    <p class="muted">Shown on your profile and to games you play.</p>
    <input name="name" maxlength="24" value="${esc(state.user.displayName)}" style="width:100%;margin-bottom:16px" autocomplete="off">
    <div class="co-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-buy">Save</button></div></form>`, {
    onMount(el, close) {
      const f = el.querySelector('form');
      f.elements.name.focus(); f.elements.name.select();
      el.querySelector('[data-close]').onclick = close;
      f.onsubmit = async (e) => {
        e.preventDefault();
        try { applyUserState(await api.account.rename(f.elements.name.value)); close(); go('/profile'); toast('Name updated'); }
        catch (err) { toast(esc(err.message), { kind: 'error' }); }
      };
    },
  });
  return null;
}
