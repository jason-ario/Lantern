import { state, released, shelf, byDiscovery } from '../state.js';
import { esc, logo, capsule, cover, price, priceTag, ratingLabel, tagChips, date, icons, rankBadges, compact, vibeTime, genreTags, bytes, $, $$ } from '../ui.js';
import { TOOL_BY_ID } from '../vibe.js';
import { go } from '../nav.js';

export function storeBar(active = 'home', q = '') {
  return `<div class="store-bar"><div class="page store-bar-inner">
    <a href="/store" data-link class="${active === 'home' ? 'on' : ''}">Home</a>
    <a href="/search?sort=new" data-link class="${active === 'new' ? 'on' : ''}">Fresh drops</a>
    <a href="/search?demo=1" data-link class="${active === 'demo' ? 'on' : ''}">Try instantly</a>
    <a href="/search?sort=top" data-link class="${active === 'top' ? 'on' : ''}">Top sellers</a>
    <a href="/search?sort=played" data-link class="${active === 'played' ? 'on' : ''}">Most played</a>
    <form class="store-search" role="search" id="storeSearch">
      <input name="q" type="search" placeholder="Search games or genres" value="${esc(q)}" autocomplete="off" aria-label="Search the store">
      <button aria-label="Search">${icons.search}</button>
    </form>
  </div></div>`;
}

export function bindStoreBar(root) {
  $('#storeSearch', root)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(e.target).get('q').trim();
    go(`/search${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  });
}

function recommendations() {
  const owned = [...state.owned].map((id) => state.byId.get(id)).filter(Boolean);
  const weights = {};
  owned.forEach((g) => g.tags.forEach((t) => { weights[t] = (weights[t] ?? 0) + 1; }));
  const pool = released().filter((g) => !state.owned.has(g.id));
  const pool2 = pool.filter((g) => g.rank?.status === 'promoted' || g.rank?.status === 'new');
  const scored = pool2.map((g) => ({ g, s: g.tags.reduce((t, tag) => t + (weights[tag] ?? 0), 0) + (g.rank?.score ?? 0) / 50 }))
    .sort((a, b) => b.s - a.s);
  const basis = owned.sort((a, b) => b.tags.filter((t) => weights[t] > 1).length - a.tags.filter((t) => weights[t] > 1).length)[0];
  return { basis, games: scored.slice(0, 4).map((x) => x.g) };
}

function listRow(g) {
  const r = ratingLabel(g.rating);
  return `<a class="list-row" href="/app/${esc(g.id)}" data-link data-preview="${esc(g.id)}">
    <div class="lr-art" style="background-image:url('${esc(g.media.header)}')"></div>
    <div class="lr-body">
      <div class="lr-title">${esc(g.title)}</div>
      <div class="lr-tags">${genreTags(g.tags, 4)}</div>
      <div class="lr-sub">${g.status === 'coming_soon' ? `Releases ${date(g.releaseDate)}` : `<span class="${r.cls}">${r.label}</span>`}${g.demo ? ' · <span class="demo-inline">Instant demo</span>' : ''} ${rankBadges(g, 1)}</div>
    </div>
    <div class="lr-price">${priceTag(g, { compact: true })}</div>
  </a>`;
}

function preview(g) {
  if (!g) return '';
  const r = ratingLabel(g.rating);
  return `<div class="pv-title">${esc(g.title)}</div>
    <div class="pv-meta"><span class="${r.cls}">${r.label}</span>${g.rating ? ` <span class="muted">(${g.rating.count.toLocaleString()})</span>` : ''}</div>
    <div class="pv-tags">${g.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    ${g.media.screenshots.slice(0, 4).map((s) => `<div class="pv-shot" style="background-image:url('${esc(s)}')"></div>`).join('')}`;
}

export async function render(root) {
  // Every shelf is algorithmic (see server/ranking.js); nothing here is hand-picked.
  const feat = shelf('featured').length ? shelf('featured') : released().slice(0, 5);
  const fresh = shelf('new');
  const demos = released().filter((g) => g.demo && g.rank?.status !== 'needs_fix' && g.rank?.status !== 'listed').sort(byDiscovery).slice(0, 6);
  const trending = shelf('trending');
  const gems = shelf('gems');
  const free = shelf('free');
  const tabs = {
    top: shelf('top').slice(0, 8),
    played: shelf('played').slice(0, 8),
    new: fresh.slice(0, 8),
    soon: state.games.filter((g) => g.status === 'coming_soon').sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)),
  };
  const rec = recommendations();
  const topTags = state.tags.slice(0, 8);
  const tools = state.tools.filter((t) => TOOL_BY_ID.has(t.id) && t.id !== 'other').slice(0, 8);
  const quickest = released().filter((g) => g.vibe?.hours).sort((a, b) => a.vibe.hours - b.vibe.hours)[0];
  const heroGame = feat[0];

  // Launch state: no games on the shelves yet (e.g. sample content hidden, nothing published).
  if (!released().length) {
    const soon = state.games.filter((g) => g.status === 'coming_soon');
    root.innerHTML = `${storeBar('home')}
    <div class="page store">
      <section class="vg-hero">
        <div>
          <span class="vg-hero-kicker"><i></i>The shelves are being stocked</span>
          <h1>Prompted into existence.<br><em>Polished enough to pay&nbsp;for.</em></h1>
          <p>Vibe-Games is the premium store for games built with AI. The first games are on their way. Made one yourself? Be the first on the shelf.</p>
          <div class="vg-cta">
            <a class="btn btn-buy btn-lg" href="/developers" data-link>Ship your vibe-coded game</a>
            <a class="btn btn-ghost btn-lg" href="/publish" data-link>Open Publish</a>
          </div>
        </div>
        <div class="vg-term" aria-hidden="true">
          <div class="vg-term-h"><span></span><span></span><span></span><small>~/vibe-games</small></div>
          <div class="vg-term-b">
            <div class="ln"><span class="pr">&gt;</span> open the store</div>
            <div class="ln dim">  …stocking shelves</div>
            <div class="ln ok">✓ checkout, cloud saves, offline play ready</div>
            <div class="ln"><span class="pr">&gt;</span> <a href="/developers" data-link>waiting for your game</a><span class="caret"></span></div>
          </div>
        </div>
      </section>
      ${soon.length ? `<section class="block"><div class="sec-h"><h2>Still cooking</h2></div><div class="capsule-grid">${soon.slice(0, 8).map((g) => capsule(g)).join('')}</div></section>` : ''}
    </div>`;
    bindStoreBar(root);
    return null;
  }

  root.innerHTML = `${storeBar('home')}
  <div class="page store">
    <section class="vg-hero">
      <div>
        <span class="vg-hero-kicker"><i></i>${released().length} vibe-coded ${released().length === 1 ? "game" : "games"} · play ${released().length === 1 ? "it" : "any of them"} in one click</span>
        <h1>Prompted into existence.<br><em>Polished enough to pay&nbsp;for.</em></h1>
        <p>Vibe-Games is the premium store for games built with AI. Every game here was made by a human with a vision and a coding assistant with no sleep schedule. No installs, no launchers: hit play and you're in.</p>
        <div class="vg-cta">
          <a class="btn btn-buy btn-lg" href="/search?demo=1" data-link>${icons.play} Play something now</a>
          <a class="btn btn-ghost btn-lg" href="/developers" data-link>Ship your vibe-coded game</a>
        </div>
      </div>
      ${heroGame ? `<div class="vg-term" aria-hidden="true">
        <div class="vg-term-h"><span></span><span></span><span></span><small>~/games/${esc(heroGame.id)}</small></div>
        <div class="vg-term-b">
          <div class="ln"><span class="pr">&gt;</span> ${esc(heroGame.vibe?.prompt ?? heroGame.shortDescription)}</div>
          <div class="ln dim">  …${heroGame.vibe?.hours ? ` ${esc(vibeTime(heroGame))} of vibing later` : ''}</div>
          <div class="ln ok">✓ ${esc(heroGame.title)} is live · ${heroGame.version ? bytes(heroGame.version.sizeBytes) : 'instant play'}</div>
          <div class="ln"><span class="pr">&gt;</span> <a href="/play/${esc(heroGame.id)}${state.owned.has(heroGame.id) ? '' : '?demo=1'}" data-link>play ${esc(heroGame.id)}</a><span class="caret"></span></div>
        </div>
      </div>` : ''}
    </section>

    <section class="block">
      <div class="sec-h"><h2>Featured vibes</h2><span class="sec-note">The newest arrivals, then the games players love most</span></div>
      <div class="feat" id="feat">
        <a class="feat-main" id="featMain" href="#" data-link></a>
        <button class="feat-sound" id="featSound" type="button" hidden></button>
        <div class="feat-side" id="featSide"></div>
        <button class="feat-arrow prev" aria-label="Previous">‹</button><button class="feat-arrow next" aria-label="Next">›</button>
      </div>
      <div class="dots" id="featDots">${feat.map((_, i) => `<button data-i="${i}" aria-label="Featured ${i + 1}"></button>`).join('')}</div>
    </section>

    ${fresh.length ? `<section class="block">
      <div class="sec-h"><h2>Fresh off the prompt</h2><span class="sec-note">Every new game gets the spotlight here while it finds its first players</span><a href="/search?sort=new" data-link>See all</a></div>
      <div class="capsule-grid new-grid">${fresh.slice(0, 4).map((g) => capsule(g)).join('')}</div>
    </section>` : ''}

    <section class="block instant">
      <div class="sec-h"><h2><span class="bolt">${icons.bolt}</span> Zero installs. Just vibes.</h2><span class="sec-note">Free demos that start in about a second</span><a href="/search?demo=1" data-link>See all</a></div>
      <div class="instant-grid">
        ${demos.map((g) => `<div class="instant-card">
          <a class="ic-art" href="/app/${esc(g.id)}" data-link style="background-image:url('${esc(g.media.hero)}')">${logo(g, 'md')}</a>
          <div class="ic-body">
            <div><div class="ic-title">${esc(g.title)}</div><div class="ic-sub">${esc(g.blurb ?? '')} · ${g.demo.minutes}-min demo · ${g.version ? bytes(g.version.sizeBytes) : ''}</div>${g.tags?.length ? `<div class="ic-tags">${genreTags(g.tags, 2)}</div>` : ''}</div>
            <div class="ic-actions">
              ${state.owned.has(g.id)
                ? `<a class="btn btn-play" href="/play/${esc(g.id)}" data-link>${icons.play} Play</a>`
                : `<a class="btn btn-demo" href="/play/${esc(g.id)}?demo=1" data-link>${icons.play} Try now</a><a class="btn btn-ghost" href="/app/${esc(g.id)}" data-link>${price(g.priceCents)}</a>`}
            </div>
          </div>
        </div>`).join('')}
      </div>
    </section>

    <section class="block">
      <div class="sec-h"><h2>Trending</h2><div class="row-arrows"><button data-scroll="-1" aria-label="Scroll left">‹</button><button data-scroll="1" aria-label="Scroll right">›</button></div></div>
      <div class="cover-row" id="trending">${trending.map((g) => cover(g, { sub: `<span>${esc(g.title)}</span>${priceTag(g, { compact: true })}` })).join('')}</div>
    </section>

    <section class="block">
      <div class="tabs" role="tablist">
        <button class="on" data-tab="top">Top sellers</button><button data-tab="played">Most played</button><button data-tab="new">New releases</button><button data-tab="soon">Still cooking</button>
      </div>
      <div class="tabbed">
        <div class="tab-list" id="tabList"></div>
        <aside class="tab-preview" id="tabPreview"></aside>
      </div>
    </section>

    ${gems.length ? `<section class="block">
      <div class="sec-h"><h2>Hidden gems</h2><span class="sec-note">The people who find these can't stop playing. Not many have found them yet</span></div>
      <div class="capsule-grid">${gems.slice(0, 4).map((g) => capsule(g)).join('')}</div>
    </section>` : ''}

    ${free.length ? `<section class="block">
      <div class="sec-h"><h2>Free &amp; great</h2><span class="sec-note">Free games people are actually hooked on</span><a href="/search?max=0" data-link>See all free</a></div>
      <div class="capsule-grid">${free.slice(0, 4).map((g) => capsule(g)).join('')}</div>
    </section>` : ''}

    ${rec.games.length ? `<section class="block">
      <div class="sec-h"><h2>Recommended for you</h2>${rec.basis ? `<span class="sec-note">Because you play <a href="/app/${esc(rec.basis.id)}" data-link>${esc(rec.basis.title)}</a></span>` : ''}</div>
      <div class="capsule-grid">${rec.games.map((g) => capsule(g)).join('')}</div>
    </section>` : ''}

    <section class="block">
      <div class="sec-h"><h2>Browse by genre</h2></div>
      <div class="tag-tiles">${topTags.map((t) => {
        const g = released().find((x) => x.tags.includes(t.name)) ?? state.games[0];
        return `<a class="tag-tile" href="/search?tag=${encodeURIComponent(t.name)}" data-link style="background-image:url('${esc(g.media.header)}')"><span>${esc(t.name)}</span><small>${t.count} games</small></a>`;
      }).join('')}</div>
    </section>

    ${tools.length ? `<section class="block">
      <div class="sec-h"><h2>For the curious: what built it</h2><span class="sec-note">Every game lists the AI tools behind it${quickest ? `. Fastest build: <a href="/app/${esc(quickest.id)}" data-link>${esc(quickest.title)}</a>, in ${esc(vibeTime(quickest))}` : ''}</span></div>
      <div class="tool-tiles">${tools.map((t) => { const tool = TOOL_BY_ID.get(t.id); return `<a class="tool-tile" href="/search?tool=${encodeURIComponent(t.id)}" data-link style="--c:${tool.color}"><i></i><b>${esc(tool.name)}</b><small>${t.count} ${t.count === 1 ? 'game' : 'games'}</small></a>`; }).join('')}</div>
    </section>` : ''}
  </div>`;
  bindStoreBar(root);

  // --- featured carousel ---
  // A game with a trailer plays it (muted until the viewer turns sound on) in place of the
  // banner, and the carousel waits for it to finish instead of moving on after 7 seconds.
  let fi = 0, timer = null, hovering = false, video = null, muted = true;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const soundBtn = $('#featSound', root);
  const paintSound = () => {
    soundBtn.hidden = !video;
    soundBtn.innerHTML = muted ? icons.soundOff : icons.soundOn;
    soundBtn.setAttribute('aria-label', muted ? 'Turn trailer sound on' : 'Mute trailer');
    soundBtn.title = muted ? 'Sound on' : 'Mute';
  };
  const stopVideo = () => { if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null; } $('#featMain', root)?.classList.remove('has-video'); paintSound(); };
  const showFeat = (i) => {
    fi = (i + feat.length) % feat.length;
    const g = feat[fi];
    const r = ratingLabel(g.rating);
    const main = $('#featMain', root);
    stopVideo();
    main.href = `/app/${g.id}`;
    main.style.backgroundImage = `url('${g.media.hero}')`;
    main.innerHTML = `${logo(g, 'xl')}<div class="feat-caption">${esc(g.shortDescription)}</div>`;
    if (g.media.trailer && !reduceMotion) {
      const v = document.createElement('video');
      Object.assign(v, { poster: g.media.hero, muted, autoplay: true, playsInline: true, preload: 'auto', className: 'feat-video' });
      // Attributes as well as properties: iOS Safari and some Chromium builds only allow
      // muted autoplay when the attributes are present.
      if (muted) v.setAttribute('muted', '');
      v.setAttribute('playsinline', ''); v.setAttribute('autoplay', '');
      v.setAttribute('aria-hidden', 'true');
      // If the trailer can't play (missing file, unsupported codec, autoplay blocked, a stalled
      // download), keep the banner and resume the carousel instead of sitting on a black frame.
      let watchdog = null;
      const arm = (ms) => { clearTimeout(watchdog); watchdog = setTimeout(fallBack, ms); };
      function fallBack() { clearTimeout(watchdog); if (video === v) { stopVideo(); auto(); } }
      v.addEventListener('playing', () => clearTimeout(watchdog));
      v.addEventListener('waiting', () => { if (!document.hidden) arm(12000); }); // stuck buffering mid-trailer
      v.addEventListener('ended', () => { clearTimeout(watchdog); if (video === v) { showFeat(fi + 1); auto(); } });
      v.addEventListener('error', fallBack);
      v.src = g.media.trailer;
      main.prepend(v); main.classList.add('has-video');
      video = v;
      clearInterval(timer);
      arm(10000); // has to start within 10 s
      v.play().catch((err) => { if (err?.name !== 'AbortError') fallBack(); });
    }
    paintSound();
    $('#featSide', root).innerHTML = `
      <div class="fs-title">${esc(g.title)}</div>
      <div class="fs-shots">${g.media.screenshots.slice(0, 4).map((s) => `<div style="background-image:url('${esc(s)}')"></div>`).join('')}</div>
      <div class="fs-status">${state.owned.has(g.id) ? 'In your library' : g.rank?.players >= 10 ? `${compact(g.rank.players)} players this month` : 'Now available'} ${rankBadges(g, 2)}</div>
      <div class="fs-tags">${tagChips(g.tags, 4)}</div>
      <div class="fs-foot"><span class="${r.cls}">${r.label}</span>${g.demo ? '<span class="demo-inline">Instant demo</span>' : ''}${priceTag(g)}</div>`;
    $$('#featDots button', root).forEach((b, j) => b.classList.toggle('on', j === fi));
  };
  // Images rotate every 7s (not while hovered); a trailer moves on when it ends.
  const auto = () => { clearInterval(timer); if (!hovering && !video) timer = setInterval(() => showFeat(fi + 1), 7000); };
  showFeat(0); auto();
  $('#feat', root).addEventListener('mouseenter', () => { hovering = true; clearInterval(timer); });
  $('#feat', root).addEventListener('mouseleave', () => { hovering = false; auto(); });
  $('.feat-arrow.prev', root).onclick = () => { showFeat(fi - 1); auto(); };
  $('.feat-arrow.next', root).onclick = () => { showFeat(fi + 1); auto(); };
  $('#featDots', root).onclick = (e) => { if (e.target.dataset.i) { showFeat(+e.target.dataset.i); auto(); } };
  soundBtn.onclick = () => {
    muted = !muted;
    if (video) { video.muted = muted; if (video.paused) video.play().catch(() => {}); }
    paintSound();
  };

  // --- trending scroller ---
  $$('[data-scroll]', root).forEach((b) => { b.onclick = () => $('#trending', root).scrollBy({ left: +b.dataset.scroll * 600, behavior: 'smooth' }); });

  // --- tabs with hover preview ---
  const showTab = (k) => {
    $$('.tabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    $('#tabList', root).innerHTML = tabs[k].map(listRow).join('');
    $('#tabPreview', root).innerHTML = preview(tabs[k][0]);
    $('#tabList .list-row', root)?.classList.add('hot');
  };
  $('.tabs', root).onclick = (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); };
  $('#tabList', root).addEventListener('mouseover', (e) => {
    const row = e.target.closest('[data-preview]');
    if (!row || row.classList.contains('hot')) return;
    $$('#tabList .list-row', root).forEach((r) => r.classList.toggle('hot', r === row));
    $('#tabPreview', root).innerHTML = preview(state.byId.get(row.dataset.preview));
  });
  showTab('top');

  return () => { clearInterval(timer); stopVideo(); };
}
