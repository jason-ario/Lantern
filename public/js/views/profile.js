import { api } from '../api.js';
import { state, boot } from '../state.js';
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
          <h1>${esc(p.user.displayName)}</h1>
          <div class="muted">@${esc(p.user.username)} · Member since ${date(p.user.memberSince)}</div>
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
            <h3>Prototype</h3>
            <p class="muted small">Single demo account. Reset restores the seeded catalog, library and wishlist and removes anything you've published.</p>
            <button class="btn btn-ghost" id="reset">Reset demo data</button>
          </section>
        </div>
      </div>
    </div>
  </div>`;
  root.querySelector('#reset').onclick = () => modal(`<div class="confirm"><h3>Reset demo data?</h3><p class="muted">Purchases, saves, playtime, wishlist and published games return to the seeded state.</p>
    <div class="co-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger" data-ok>Reset</button></div></div>`, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('[data-ok]').onclick = async () => { await api.resetDemo(); await boot(); close(); toast('Demo data reset'); go('/store'); };
    },
  });
  return null;
}
