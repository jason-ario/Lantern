import { api } from '../api.js';
import { state, boot, applyUserState } from '../state.js';
import { esc, avatar, hours, ago, date, icons, modal, toast } from '../ui.js';
import { go } from '../nav.js';

export async function render(root) {
  const p = await api.profile();
  const s = p.stats;
  root.innerHTML = `<div class="profile">
    <div class="pf-banner" style="background-image:url('${esc(state.byId.get(p.games[0]?.gameId)?.media.hero ?? '/media/hollow-lantern/hero.svg')}')"></div>
    <div class="page">
      <div class="pf-head">
        ${avatar(p.user, 112)}
        <div class="pf-id">
          <h1><span id="pfName">${esc(p.user.displayName)}</span> <button class="link-btn" id="rename">Edit name</button></h1>
          <div class="muted">${p.user.guest ? 'Guest account on this browser' : `@${esc(p.user.username)}`} · Member since ${date(p.user.memberSince)}</div>
        </div>
      </div>
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
            <p class="muted small">${p.user.guest ? 'This is a guest account tied to this browser. Clearing cookies or switching browsers starts a new one.' : 'Demo account.'}</p>
            <button class="btn btn-ghost" id="resetMine">Reset my progress</button>
            ${state.creator.admin && state.creator.passwordRequired ? '<button class="btn btn-ghost" id="logoutCreator">Sign out of creator access</button>' : ''}
          </section>
          ${state.creator.admin ? `<section class="panel">
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
  root.querySelector('#resetMine').onclick = () => confirmBox('Reset your progress?', 'Your library, saves, playtime, achievements and wishlist on this account are deleted.', 'Reset my progress', async () => {
    applyUserState(await api.account.resetProgress()); toast('Your progress was reset'); go('/store');
  });
  root.querySelector('#resetSite')?.addEventListener('click', () => confirmBox('Reset the entire site?', 'Everyone’s accounts, purchases and saves are deleted and every published game is removed.', 'Reset site', async () => {
    await api.admin.resetSite(); await boot(); toast('Site reset'); go('/store');
  }));
  root.querySelector('#logoutCreator')?.addEventListener('click', async () => { applyUserState(await api.admin.logout()); toast('Signed out of creator access'); go('/profile'); });
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
