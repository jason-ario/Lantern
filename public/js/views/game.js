import { api } from '../api.js';
import { state, toggleWishlist, onChange } from '../state.js';
import { openAuth, requireAccount } from './auth.js';
import { avatar, esc, logo, price, ratingLabel, tagChips, date, bytes, hours, ago, icons, toast, modal, rankBadges, compact, vibeChips, vibeTime, $, $$ } from '../ui.js';
import { storeBar, bindStoreBar } from './store.js';
import { openCheckout } from './checkout.js';

const FEATURE_ICONS = { 'Cloud Saves': icons.cloud, Achievements: icons.trophy, 'Instant Play': icons.bolt, 'Offline Progress': icons.clock };

export async function render(root, [id], query) {
  if (query?.get('checkout') === 'cancelled') toast('Checkout cancelled — you were not charged');
  root.innerHTML = `${storeBar()}<div class="page"><div class="skeleton-hero"></div></div>`;
  bindStoreBar(root);
  const g = await api.game(id);
  // Gallery: the trailer (when there is one) always comes first, then the banner, then screenshots.
  const media = [
    ...(g.media.trailer ? [{ video: g.media.trailer }] : []),
    { img: g.media.hero, banner: true },
    ...g.media.screenshots.map((img) => ({ img })),
  ];
  const r = ratingLabel(g.rating);
  const unlocked = g.achievements.filter((a) => a.unlockedAt).length;

  const buyBlock = () => {
    const owned = state.owned.has(g.id);
    const wished = state.wishlist.has(g.id);
    let html = '';
    if (g.listing && g.listing !== 'live' && !owned) {
      return `<div class="buy-box"><div class="bb-title">${g.listing === 'removed' ? 'No longer available' : 'Not on sale yet'}</div><div class="bb-row"><span class="muted">${g.listing === 'removed' ? 'This game was taken off the store. Players who bought it can still play it.' : 'This game is waiting for review, so it isn’t on sale yet.'}</span>${g.canUpdate || state.creator.admin ? `<a class="btn btn-play btn-lg" href="/play/${esc(g.id)}" data-link>${icons.play} Play it</a>` : ''}</div></div>`;
    }
    if (g.status === 'coming_soon') {
      html += `<div class="buy-box"><div class="bb-title">${esc(g.title)} releases ${date(g.releaseDate)}</div>
        <div class="bb-row"><span class="muted">Still cooking. Wishlist it and it'll be waiting for you on launch day.</span>
        <button class="btn ${wished ? 'btn-ghost' : 'btn-buy'}" data-wish>${wished ? `${icons.heart} On your wishlist` : `${icons.heartOutline} Add to Wishlist`}</button></div></div>`;
      return html;
    }
    if (owned) {
      html += `<div class="buy-box owned-box"><div class="bb-title">${esc(g.title)} is in your Library</div>
        <div class="bb-row"><span class="muted">${g.play.playtimeSeconds ? `${hours(g.play.playtimeSeconds)} on record · last played ${ago(g.play.lastPlayedAt).toLowerCase()}` : 'Never played. It launches in about a second.'}</span>
        <div class="bb-actions"><a class="btn btn-ghost" href="/library/${esc(g.id)}" data-link>View in Library</a><a class="btn btn-play btn-lg" href="/play/${esc(g.id)}" data-link>${icons.play} Play</a></div></div></div>`;
      return html;
    }
    if (g.demo) {
      html += `<div class="buy-box demo-box"><div class="bb-title">Try ${esc(g.title)} instantly</div>
        <div class="bb-row"><span class="muted">No download, no install. A ${g.demo.minutes}-minute demo, and your progress carries over if you buy.</span>
        <a class="btn btn-demo btn-lg" href="/play/${esc(g.id)}?demo=1" data-link>${icons.play} Try demo</a></div></div>`;
    }
    html += `<div class="buy-box"><div class="bb-title">Buy ${esc(g.title)}</div>
      <div class="bb-row"><span class="muted">${g.version?.placeholder ? 'Prototype: this title launches a placeholder build.' : 'Yours forever. Plays in any browser today, desktop app soon.'}</span>
      <div class="bb-actions"><div class="bb-price">${price(g.priceCents)}</div><button class="btn btn-buy btn-lg" data-buy>Buy</button></div></div></div>`;
    return html;
  };

  root.innerHTML = `${storeBar()}
  <div class="game-hero" style="background-image:url('${esc(g.media.hero)}')"></div>
  <div class="page game-page">
    ${g.listing && g.listing !== 'live' ? `<div class="sample-banner"><b>${{ pending: 'In review', rejected: 'Changes requested', removed: 'Taken down' }[g.listing] ?? g.listing}</b> ${g.listing === 'pending' ? 'Only you and the review team can see this page until it’s approved.' : g.listing === 'rejected' ? 'See the reviewer’s note on your Publish page, fix it and publish an update.' : 'This game is no longer on the store.'}${state.creator.admin ? ' <a href="/admin" data-link>Open the admin queue</a>' : ''}</div>` : ''}
    ${g.sample ? `<div class="sample-banner"><b>Sample listing</b> This is a fictional demo game used to show off the store${state.site.demoContent === 'admins' ? ' (visible to admins only)' : ''}. Its ratings and reviews are sample data.</div>` : ''}
    <div class="crumbs"><a href="/store" data-link>All Games</a> › <a href="/search?tag=${encodeURIComponent(g.tags[0])}" data-link>${esc(g.tags[0])}</a> › <span>${esc(g.title)}</span></div>
    <div class="gp-head">
      <h1>${esc(g.title)}</h1>
      <div class="gp-head-actions" id="wishHead"></div>
    </div>
    <div class="gp-top">
      <div class="gp-media">
        <div class="gp-stage" id="stage"></div>
        <div class="gp-thumbs" id="thumbs">${media.map((m, i) => m.video
          ? `<button data-i="${i}" class="thumb-video" style="background-image:url('${esc(g.media.hero)}')" aria-label="Trailer">${icons.play}</button>`
          : `<button data-i="${i}" style="background-image:url('${esc(m.img)}')" aria-label="${m.banner ? 'Banner' : `Screenshot ${i}`}"></button>`).join('')}</div>
      </div>
      <aside class="gp-side">
        <div class="gp-capsule" style="background-image:url('${esc(g.media.header)}')">${logo(g, 'md')}</div>
        <p class="gp-short">${esc(g.shortDescription)}</p>
        ${g.rank?.badges?.length ? `<div class="gp-badges">${rankBadges(g, 3)}</div>` : ''}
        <dl class="gp-facts">
          <dt>All reviews</dt><dd><span class="${r.cls}">${r.label}</span>${g.rating ? ` <span class="muted">(${g.rating.count.toLocaleString()})</span>` : ''}</dd>
          ${g.rank && g.rank.status !== 'new' && g.rank.players >= 10 ? `<dt>Players</dt><dd>${compact(g.rank.players)} this month · ~${g.rank.medianMinutes} min typical</dd>` : ''}
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

        ${g.vibe || g.builtWith?.length ? `<section class="vibe-box"><div class="vibe-box-in">
          <h3>How it was vibed</h3>
          ${g.vibe?.prompt ? `<div class="vibe-prompt">${esc(g.vibe.prompt)}</div><p class="muted small vibe-cap">The prompt that started it all, straight from the developer.</p>` : ''}
          <div class="vibe-stats">
            ${g.builtWith?.length ? `<div class="vibe-stat"><small>built with</small>${vibeChips(g.builtWith, { max: 5, link: true })}</div>` : ''}
            ${vibeTime(g) ? `<div class="vibe-stat"><small>time to build</small><b>${esc(vibeTime(g))}${g.vibe.hours >= 48 ? `<small>~${Math.round(g.vibe.hours)} hrs</small>` : ''}</b></div>` : ''}
            <div class="vibe-stat"><small>made by</small><b>${esc(g.developer?.name ?? 'Unknown')}</b></div>
          </div>
        </div></section>` : ''}


        <section class="gp-sec">
          <h3>Achievements <span class="muted">· ${g.achievements.length}${state.owned.has(g.id) || unlocked ? ` · ${unlocked} unlocked` : ''}</span></h3>
          <div class="ach-grid">${g.achievements.map((a) => `<div class="ach ${a.unlockedAt ? 'got' : ''}"><div class="ach-ico">${icons.trophy}</div><div><div class="ach-n">${esc(a.name)}</div><div class="ach-d">${esc(a.description)}</div></div></div>`).join('')}</div>
        </section>

        <section class="gp-sec">
          <h3>Runtime &amp; requirements</h3>
          <div class="req">
            <div><span>Runs on</span><b>Vibe-Games Runtime 1.x. Web today, desktop app soon</b></div>
            <div><span>Install</span><b>None. Streams instantly, then cached${g.version ? ` · ${bytes(g.version.sizeBytes)} package` : ''}</b></div>
            <div><span>Graphics</span><b>${(g.version?.runtime?.features ?? ['canvas2d']).map((f) => ({ canvas2d: 'Canvas 2D', webgl2: 'WebGL 2', webgpu: 'WebGPU', webaudio: 'Web Audio', dom: 'HTML/CSS', wasm: 'WebAssembly' }[f] ?? f)).join(' · ')}</b></div>
            <div><span>Input</span><b>${(g.version?.input?.length ? g.version.input : ['keyboard', 'mouse']).map((i) => i[0].toUpperCase() + i.slice(1)).join(' · ')}</b></div>
            <div><span>Browser</span><b>Any current Chromium, Firefox or Safari</b></div>
            <div><span>Isolation</span><b>Sandboxed. The game can't touch your account, other games or your files</b></div>
          </div>
        </section>

        <section class="gp-sec" id="reviews">
          <h3>Player reviews</h3>
          <div id="revBody"><div class="spinner"></div></div>
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
            <dt>SDK</dt><dd>Vibe-Games SDK v${esc(g.version.sdk)}</dd>
            <dt>Updated</dt><dd>${date(g.version.releasedAt)}</dd>
          </dl>
        </div>` : ''}
        <div class="side-box">
          <div class="side-h">Developer</div>
          <div class="dev-name">${esc(g.developer?.name)}</div>
          <div class="muted small">${esc(g.developer?.location ?? '')}</div>
        </div>
        <div class="side-box report-box"><button class="link-btn" id="reportGame">Report this game</button></div>
        ${g.versions.length ? `<div class="side-box"><div class="side-h">Version history</div>${g.versions.slice().reverse().map((v) => `<div class="ver-line"><b>${esc(v.version)}</b><span class="muted">${date(v.releasedAt)}</span></div>`).join('')}</div>` : ''}
      </aside>
    </div>
  </div>`;
  bindStoreBar(root);

  // media viewer
  const stage = $('#stage', root);
  // Stop a trailer properly: clearing src also cancels its download, so a big trailer
  // doesn't keep streaming in the background after you switch slides or leave the page.
  const stopStageVideo = () => { const v = stage.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } };
  const show = (i) => {
    const m = media[i];
    stopStageVideo();
    stage.classList.toggle('is-video', !!m.video);
    if (m.video) {
      // Autoplays muted (browsers only allow that); the controls unmute it.
      stage.style.backgroundImage = '';
      stage.innerHTML = '';
      const v = document.createElement('video');
      Object.assign(v, { poster: g.media.hero, controls: true, muted: true, autoplay: true, playsInline: true, preload: 'auto' });
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('autoplay', '');
      v.setAttribute('aria-label', `${g.title} trailer`);
      // The file is missing or the browser can't decode it: say so on the banner instead of a black box.
      v.addEventListener('error', () => {
        if (!v.isConnected) return;
        stage.classList.remove('is-video');
        v.remove();
        stage.style.backgroundImage = `url('${g.media.hero}')`;
        stage.innerHTML = `${logo(g, 'lg')}<div class="gp-video-error">Trailer unavailable right now</div>`;
      });
      v.src = m.video;
      stage.append(v);
      v.play().catch(() => {});
    } else {
      stage.style.backgroundImage = `url('${m.img}')`;
      stage.innerHTML = m.banner ? logo(g, 'lg') : '';
    }
    $$('#thumbs button', root).forEach((b, j) => b.classList.toggle('on', j === i));
  };
  show(g.media.trailer ? 0 : media.length > 1 ? 1 : 0);
  $('#thumbs', root).onclick = (e) => { const b = e.target.closest('button'); if (b) show(+b.dataset.i); };

  const wishHead = () => {
    if (state.owned.has(g.id)) { $('#wishHead', root).innerHTML = '<span class="owned-pill">✓ In Library</span>'; return; }
    const on = state.wishlist.has(g.id);
    $('#wishHead', root).innerHTML = g.listing && g.listing !== 'live' ? '' : `<button class="btn ${on ? 'btn-wish-on' : 'btn-ghost'}" data-wish>${on ? `${icons.heart} On Wishlist` : `${icons.heartOutline} Add to Wishlist`}</button>`;
  };
  wishHead();

  // ---------- reviews ----------
  let revFilter = null, editing = false;
  const revBody = $('#revBody', root);
  const reviewCard = (x) => `<article class="review ${x.up ? 'up' : 'down'}${x.mine ? ' mine' : ''}">
    <div class="rv-who">${avatar({ displayName: x.author.name, avatarHue: x.author.avatarHue }, 34)}<div><b>${esc(x.author.name)}</b><small>${hours(x.playtimeSeconds)} on record</small></div></div>
    <div class="rv-main">
      <div class="rv-head"><span class="rv-thumb">${x.up ? '👍 Recommended' : '👎 Not recommended'}</span><span class="muted small">${date(x.createdAt)}${x.updatedAt ? ' · edited' : ''}</span>${x.sample ? '<span class="sample-pill">Sample</span>' : ''}${state.creator.admin && !x.mine && !x.sample ? `<button class="link-btn rv-mod" data-mod="${esc(x.id)}">Remove</button>` : !x.mine && !x.sample ? `<button class="link-btn rv-mod" data-report-review="${esc(x.id)}">Report</button>` : ''}</div>
      ${x.text ? `<p>${esc(x.text).replace(/\n/g, '<br>')}</p>` : '<p class="muted small">No written review.</p>'}
    </div>
  </article>`;
  const composer = (mine) => `<form class="rv-form" id="rvForm">
    <div class="rv-form-h"><b>${mine ? 'Edit your review' : `Review ${esc(g.title)}`}</b><span class="muted small">Would you recommend it?</span></div>
    <div class="rv-pick">
      <label><input type="radio" name="up" value="1" ${mine?.up !== false ? 'checked' : ''}><span>👍 Yes</span></label>
      <label><input type="radio" name="up" value="0" ${mine?.up === false ? 'checked' : ''}><span>👎 No</span></label>
    </div>
    <textarea name="text" rows="4" maxlength="4000" placeholder="What did you like or dislike? Other players will see this.">${esc(mine?.text ?? '')}</textarea>
    <div class="rv-actions">${mine ? '<button type="button" class="btn btn-ghost btn-sm" id="rvCancel">Cancel</button><button type="button" class="link-btn" id="rvDelete">Delete review</button>' : ''}<button class="btn btn-buy">${mine ? 'Save review' : 'Post review'}</button></div>
  </form>`;
  const loadReviews = async () => {
    let d;
    try { d = await api.reviews.list(g.id, revFilter); } catch (err) { revBody.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    const rr = ratingLabel(d.rating);
    const el = d.eligibility;
    const cta = d.mine && !editing ? ''
      : el.ok ? composer(editing ? d.mine : null)
      : el.reason === 'account' ? '<div class="rv-cta"><span>Own this game? Sign in to review it.</span><button class="btn btn-buy btn-sm" id="rvSignup">Sign in</button></div>'
      : el.reason === 'not_owned' ? '<div class="rv-cta muted small">Only players who own this game can review it.</div>' : '';
    revBody.innerHTML = `
      ${d.rating ? `<div class="rev">
        <div class="rev-score"><div class="${rr.cls} rev-label">${rr.label}</div><div class="muted">${d.rating.pct}% of ${d.rating.count.toLocaleString()} ${d.rating.count === 1 ? 'review is' : 'reviews are'} positive</div></div>
        <div class="rev-bar"><div style="width:${d.rating.pct}%"></div></div>
      </div>` : '<p class="muted">No reviews yet. Owners can be the first.</p>'}
      ${d.mine && !editing ? `<div class="rv-mine-h"><span>Your review</span><button class="btn btn-ghost btn-sm" id="rvEdit">Edit</button></div>${reviewCard(d.mine)}` : ''}
      ${cta}
      ${d.total || revFilter ? `<div class="rv-filter">${[[null, 'All'], ['up', '👍 Positive'], ['down', '👎 Negative']].map(([v, l]) => `<button data-rf="${v ?? ''}" class="${revFilter === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="rv-list">${d.reviews.filter((x) => !x.mine).map(reviewCard).join('') || (d.total ? '' : revFilter ? '<p class="muted small">No reviews match.</p>' : '')}</div>`;
    const f = $('#rvForm', revBody);
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = f.querySelector('.btn-buy'); btn.disabled = true;
      try { await api.reviews.save(g.id, f.elements.up.value === '1', f.elements.text.value); editing = false; toast('Thanks! Your review is live', { kind: 'ok' }); loadReviews(); }
      catch (err) { btn.disabled = false; toast(esc(err.message), { kind: 'error' }); }
    };
    $('#rvEdit', revBody)?.addEventListener('click', () => { editing = true; loadReviews(); });
    $('#rvCancel', revBody)?.addEventListener('click', () => { editing = false; loadReviews(); });
    $('#rvDelete', revBody)?.addEventListener('click', async () => { try { await api.reviews.remove(g.id); editing = false; toast('Review deleted'); loadReviews(); } catch (err) { toast(esc(err.message), { kind: 'error' }); } });
    $('#rvSignup', revBody)?.addEventListener('click', () => openAuth({ mode: 'login', onDone: () => loadReviews() }));
    revBody.querySelectorAll('[data-rf]').forEach((b) => { b.onclick = () => { revFilter = b.dataset.rf || null; loadReviews(); }; });
    revBody.querySelectorAll('[data-report-review]').forEach((b) => { b.onclick = () => requireAccount('Sign in to report a review.', () => openReport('review', b.dataset.reportReview, 'this review')); });
    revBody.querySelectorAll('[data-mod]').forEach((b) => { b.onclick = async () => { try { await api.reviews.moderate(b.dataset.mod); toast('Review removed'); loadReviews(); } catch (err) { toast(esc(err.message), { kind: 'error' }); } }; });
  };
  loadReviews();
  $('#reportGame', root)?.addEventListener('click', () => requireAccount('Sign in to report a game.', () => openReport('game', g.id, g.title)));

  const rerender = () => { $('#buyArea', root).innerHTML = buyBlock(); wishHead(); loadReviews(); };
  const off = onChange(rerender);
  root.onclick = async (e) => {
    if (e.target.closest('[data-buy]')) openCheckout(g);
    if (e.target.closest('[data-wish]')) {
      if (!state.user) { requireAccount(`Create a free account to wishlist ${g.title}.`, () => root.querySelector('[data-wish]')?.click()); return; }
      try {
        const on = await toggleWishlist(g.id);
        toast(on ? `${icons.heart} Added <b>${esc(g.title)}</b> to your wishlist` : `Removed <b>${esc(g.title)}</b> from your wishlist`);
      } catch (err) { toast(esc(err.message), { kind: 'error' }); }
    }
  };
  // A detached <video> keeps playing (and can be unmuted), so stop the trailer on leave.
  return () => { off(); stopStageVideo(); };
}

// Report a game or review to the moderators.
const REPORT_REASONS = [['broken', 'It doesn’t work'], ['misleading', 'Misleading store page'], ['offensive', 'Offensive or hateful'], ['stolen', 'Uses stolen content'], ['malware', 'Malware or suspicious behaviour'], ['spam', 'Spam'], ['other', 'Something else']];
function openReport(type, targetId, label) {
  modal(`<form class="confirm"><h3>Report ${esc(label)}</h3>
    <label class="f"><span>What’s wrong?</span><select name="reason">${REPORT_REASONS.filter(([k]) => type === 'game' || !['broken', 'stolen', 'malware'].includes(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label class="f" style="margin-top:10px"><span>Details <small>optional</small></span><textarea name="details" rows="3" maxlength="1000"></textarea></label>
    <p class="muted small">Our moderators review every report. Thanks for keeping Vibe-Games good.</p>
    <div class="co-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-buy">Send report</button></div></form>`, {
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelector('form').onsubmit = async (e) => {
        e.preventDefault();
        try { await api.report(type, targetId, e.target.reason.value, e.target.details.value); close(); toast('Thanks, the report was sent to our moderators', { kind: 'ok' }); }
        catch (err) { toast(esc(err.message), { kind: 'error' }); }
      };
    },
  });
}
