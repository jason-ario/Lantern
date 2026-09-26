import { api } from '../api.js';
import { state, toggleWishlist, onChange } from '../state.js';
import { esc, logo, price, ratingLabel, tagChips, date, bytes, hours, ago, icons, toast, $, $$ } from '../ui.js';
import { storeBar, bindStoreBar } from './store.js';
import { openCheckout } from './checkout.js';

const FEATURE_ICONS = { 'Cloud Saves': icons.cloud, Achievements: icons.trophy, 'Instant Play': icons.bolt, 'Offline Progress': icons.clock };

export async function render(root, [id]) {
  root.innerHTML = `${storeBar()}<div class="page"><div class="skeleton-hero"></div></div>`;
  bindStoreBar(root);
  const g = await api.game(id);
  const media = [g.media.hero, ...g.media.screenshots];
  const r = ratingLabel(g.rating);
  const unlocked = g.achievements.filter((a) => a.unlockedAt).length;

  const buyBlock = () => {
    const owned = state.owned.has(g.id);
    const wished = state.wishlist.has(g.id);
    let html = '';
    if (g.status === 'coming_soon') {
      html += `<div class="buy-box"><div class="bb-title">${esc(g.title)} releases ${date(g.releaseDate)}</div>
        <div class="bb-row"><span class="muted">Wishlist it and it'll be waiting on your list the day it launches.</span>
        <button class="btn ${wished ? 'btn-ghost' : 'btn-buy'}" data-wish>${wished ? `${icons.heart} On your wishlist` : `${icons.heartOutline} Add to Wishlist`}</button></div></div>`;
      return html;
    }
    if (owned) {
      html += `<div class="buy-box owned-box"><div class="bb-title">${esc(g.title)} is in your Library</div>
        <div class="bb-row"><span class="muted">${g.play.playtimeSeconds ? `${hours(g.play.playtimeSeconds)} on record · last played ${ago(g.play.lastPlayedAt).toLowerCase()}` : 'Never played — it launches in about a second.'}</span>
        <div class="bb-actions"><a class="btn btn-ghost" href="/library/${esc(g.id)}" data-link>View in Library</a><a class="btn btn-play btn-lg" href="/play/${esc(g.id)}" data-link>${icons.play} Play</a></div></div></div>`;
      return html;
    }
    if (g.demo) {
      html += `<div class="buy-box demo-box"><div class="bb-title">Try ${esc(g.title)} instantly</div>
        <div class="bb-row"><span class="muted">No download, no install. ${g.demo.minutes}-minute demo — your progress carries over if you buy.</span>
        <a class="btn btn-demo btn-lg" href="/play/${esc(g.id)}?demo=1" data-link>${icons.play} Try demo</a></div></div>`;
    }
    html += `<div class="buy-box"><div class="bb-title">Buy ${esc(g.title)}</div>
      <div class="bb-row"><span class="muted">${g.version?.placeholder ? 'Prototype: this title launches a placeholder build.' : 'Own it forever. Plays on web today, desktop soon.'}</span>
      <div class="bb-actions"><div class="bb-price">${price(g.priceCents)}</div><button class="btn btn-buy btn-lg" data-buy>Buy</button></div></div></div>`;
    return html;
  };

  root.innerHTML = `${storeBar()}
  <div class="game-hero" style="background-image:url('${esc(g.media.hero)}')"></div>
  <div class="page game-page">
    <div class="crumbs"><a href="/store" data-link>All Games</a> › <a href="/search?tag=${encodeURIComponent(g.tags[0])}" data-link>${esc(g.tags[0])}</a> › <span>${esc(g.title)}</span></div>
    <div class="gp-head">
      <h1>${esc(g.title)}</h1>
      <div class="gp-head-actions" id="wishHead"></div>
    </div>
    <div class="gp-top">
      <div class="gp-media">
        <div class="gp-stage" id="stage"></div>
        <div class="gp-thumbs" id="thumbs">${media.map((m, i) => `<button data-i="${i}" style="background-image:url('${esc(m)}')" aria-label="Screenshot ${i + 1}"></button>`).join('')}</div>
      </div>
      <aside class="gp-side">
        <div class="gp-capsule" style="background-image:url('${esc(g.media.header)}')">${logo(g, 'md')}</div>
        <p class="gp-short">${esc(g.shortDescription)}</p>
        <dl class="gp-facts">
          <dt>All reviews</dt><dd><span class="${r.cls}">${r.label}</span>${g.rating ? ` <span class="muted">(${g.rating.count.toLocaleString()})</span>` : ''}</dd>
          <dt>Release date</dt><dd>${date(g.releaseDate)}${g.status === 'coming_soon' ? ' <span class="soon-pill">Upcoming</span>' : ''}</dd>
          <dt>Developer</dt><dd><a href="/search?dev=${encodeURIComponent(g.developer?.id ?? '')}" data-link>${esc(g.developer?.name)}</a></dd>
          <dt>Publisher</dt><dd>${esc(g.developer?.name)}</dd>
        </dl>
        <div class="gp-tags-label">Popular tags</div>
        <div class="gp-tags">${tagChips(g.tags, 8)}</div>
      </aside>
    </div>

    <div class="gp-body">
      <div class="gp-main">
        <div id="buyArea">${buyBlock()}</div>

        <section class="gp-sec">
          <h3>About this game</h3>
          ${g.description.map((p) => `<p>${esc(p)}</p>`).join('')}
        </section>

        <section class="gp-sec">
          <h3>Achievements <span class="muted">· ${g.achievements.length}${state.owned.has(g.id) || unlocked ? ` · ${unlocked} unlocked` : ''}</span></h3>
          <div class="ach-grid">${g.achievements.map((a) => `<div class="ach ${a.unlockedAt ? 'got' : ''}"><div class="ach-ico">${icons.trophy}</div><div><div class="ach-n">${esc(a.name)}</div><div class="ach-d">${esc(a.description)}</div></div></div>`).join('')}</div>
        </section>

        <section class="gp-sec">
          <h3>Runtime &amp; requirements</h3>
          <div class="req">
            <div><span>Runs on</span><b>Lantern Runtime 1.x — web today, desktop app (coming)</b></div>
            <div><span>Install</span><b>None. Streams instantly, then cached${g.version ? ` · ${bytes(g.version.sizeBytes)} package` : ''}</b></div>
            <div><span>Graphics</span><b>${(g.version?.runtime?.features ?? ['canvas2d']).map((f) => ({ canvas2d: 'Canvas 2D', webgl2: 'WebGL 2', webgpu: 'WebGPU', webaudio: 'Web Audio', dom: 'HTML/CSS', wasm: 'WebAssembly' }[f] ?? f)).join(' · ')}</b></div>
            <div><span>Input</span><b>${(g.version?.input?.length ? g.version.input : ['keyboard', 'mouse']).map((i) => i[0].toUpperCase() + i.slice(1)).join(' · ')}</b></div>
            <div><span>Browser</span><b>Any current Chromium, Firefox or Safari</b></div>
            <div><span>Isolation</span><b>Sandboxed — the game can't access your account, other games or your files</b></div>
          </div>
        </section>

        <section class="gp-sec">
          <h3>Reviews</h3>
          ${g.rating ? `<div class="rev">
            <div class="rev-score"><div class="${r.cls} rev-label">${r.label}</div><div class="muted">${g.rating.pct}% of ${g.rating.count.toLocaleString()} reviews are positive</div></div>
            <div class="rev-bar"><div style="width:${g.rating.pct}%"></div></div>
            <p class="muted small">Written reviews arrive with community features. Ratings shown are placeholder data for this prototype.</p>
          </div>` : '<p class="muted">No reviews yet.</p>'}
        </section>
      </div>

      <aside class="gp-aside">
        <div class="side-box">
          ${g.features.map((f) => `<div class="feat-line">${FEATURE_ICONS[f] ?? icons.grid}<span>${esc(f)}</span></div>`).join('')}
        </div>
        ${g.version ? `<div class="side-box">
          <div class="side-h">${icons.box} Game package</div>
          <dl class="kv">
            <dt>Version</dt><dd>${esc(g.version.version)}</dd>
            <dt>Size</dt><dd>${bytes(g.version.sizeBytes)}</dd>
            <dt>Files</dt><dd>${g.version.fileCount}</dd>
            <dt>Build</dt><dd class="mono" title="${esc(g.version.buildHash)}">${esc(g.version.buildHash.slice(0, 12))}</dd>
            <dt>SDK</dt><dd>Lantern SDK v${esc(g.version.sdk)}</dd>
            <dt>Updated</dt><dd>${date(g.version.releasedAt)}</dd>
          </dl>
        </div>` : ''}
        <div class="side-box">
          <div class="side-h">Developer</div>
          <div class="dev-name">${esc(g.developer?.name)}</div>
          <div class="muted small">${esc(g.developer?.location ?? '')}</div>
        </div>
        ${g.versions.length ? `<div class="side-box"><div class="side-h">Version history</div>${g.versions.slice().reverse().map((v) => `<div class="ver-line"><b>${esc(v.version)}</b><span class="muted">${date(v.releasedAt)}</span></div>`).join('')}</div>` : ''}
      </aside>
    </div>
  </div>`;
  bindStoreBar(root);

  // media viewer
  const stage = $('#stage', root);
  const show = (i) => {
    stage.style.backgroundImage = `url('${media[i]}')`;
    stage.innerHTML = i === 0 ? logo(g, 'lg') : '';
    $$('#thumbs button', root).forEach((b, j) => b.classList.toggle('on', j === i));
  };
  show(media.length > 1 ? 1 : 0);
  $('#thumbs', root).onclick = (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };

  const wishHead = () => {
    if (state.owned.has(g.id)) { $('#wishHead', root).innerHTML = '<span class="owned-pill">✓ In Library</span>'; return; }
    const on = state.wishlist.has(g.id);
    $('#wishHead', root).innerHTML = `<button class="btn ${on ? 'btn-wish-on' : 'btn-ghost'}" data-wish>${on ? `${icons.heart} On Wishlist` : `${icons.heartOutline} Add to Wishlist`}</button>`;
  };
  wishHead();

  const rerender = () => { $('#buyArea', root).innerHTML = buyBlock(); wishHead(); };
  const off = onChange(rerender);
  root.onclick = async (e) => {
    if (e.target.closest('[data-buy]')) openCheckout(g);
    if (e.target.closest('[data-wish]')) {
      try {
        const on = await toggleWishlist(g.id);
        toast(on ? `${icons.heart} Added <b>${esc(g.title)}</b> to your wishlist` : `Removed <b>${esc(g.title)}</b> from your wishlist`);
      } catch (err) { toast(esc(err.message), { kind: 'error' }); }
    }
  };
  return off;
}
