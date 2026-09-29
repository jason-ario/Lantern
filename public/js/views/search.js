import { state, byDiscovery } from '../state.js';
import { esc, price, priceTag, ratingLabel, date, rankBadges, genreTags, $ } from '../ui.js';
import { TOOL_BY_ID } from '../vibe.js';
import { storeBar, bindStoreBar } from './store.js';
import { go } from '../nav.js';

export async function render(root, _, query) {
  const q = (query.get('q') ?? '').trim();
  const tag = query.get('tag');
  const dev = query.get('dev');
  const tool = query.get('tool');
  const demo = query.get('demo') === '1';
  const sort = query.get('sort') ?? (q ? 'relevance' : 'best');
  const maxPrice = query.get('max');
  const hideOwned = query.get('hideOwned') === '1';

  const ql = q.toLowerCase();
  let results = state.games.filter((g) =>
    (!ql || g.title.toLowerCase().includes(ql) || g.tags.some((t) => t.toLowerCase().includes(ql)) || g.developer?.name.toLowerCase().includes(ql) || g.shortDescription.toLowerCase().includes(ql)
      || (g.builtWith ?? []).some((id) => TOOL_BY_ID.get(id)?.name.toLowerCase().includes(ql)) || (g.vibe?.prompt ?? '').toLowerCase().includes(ql))
    && (!tag || g.tags.includes(tag)) && (!tool || (g.builtWith ?? []).includes(tool)) && (!dev || g.developer?.id === dev) && (!demo || g.demo)
    && (!maxPrice || g.priceCents <= +maxPrice) && (!hideOwned || !state.owned.has(g.id)));
  const sorters = {
    relevance: (a, b) => (b.title.toLowerCase().startsWith(ql) ? 1 : 0) - (a.title.toLowerCase().startsWith(ql) ? 1 : 0) || byDiscovery(a, b),
    best: byDiscovery,
    top: (a, b) => (a.rank?.salesRank ?? 1e9) - (b.rank?.salesRank ?? 1e9),
    played: (a, b) => (a.rank?.playedRank ?? 1e9) - (b.rank?.playedRank ?? 1e9),
    trending: (a, b) => (b.rank?.trend ?? 0) - (a.rank?.trend ?? 0),
    new: (a, b) => b.releaseDate.localeCompare(a.releaseDate),
    fastest: (a, b) => (a.vibe?.hours ?? 1e9) - (b.vibe?.hours ?? 1e9),
    price: (a, b) => a.priceCents - b.priceCents,
    name: (a, b) => a.title.localeCompare(b.title),
  };
  results.sort(sorters[sort] ?? sorters.top);

  const heading = tool ? `Built with ${TOOL_BY_ID.get(tool)?.name ?? tool}` : tag ? `Tag: ${tag}` : dev ? `Games by ${state.games.find((g) => g.developer?.id === dev)?.developer.name ?? 'developer'}` : demo ? 'Try instantly' : q ? `Results for “${q}”` : sort === 'new' ? 'Fresh drops' : sort === 'top' ? 'Top sellers' : sort === 'played' ? 'Most played' : sort === 'trending' ? 'Trending' : sort === 'fastest' ? 'Fastest builds' : 'All games';
  const link = (patch) => { const p = new URLSearchParams(query); Object.entries(patch).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v))); return `/search?${p}`; };

  root.innerHTML = `${storeBar(demo ? 'demo' : sort === 'new' && !q && !tag ? 'new' : sort === 'top' && !q && !tag ? 'top' : sort === 'played' && !q && !tag ? 'played' : '', q)}
  <div class="page search">
    <div class="search-main">
      <div class="page-head"><div class="ph-left"><h1>${esc(heading)}</h1><span class="muted">${results.length} ${results.length === 1 ? 'result' : 'results'}</span></div>
        <label class="sort">Sort by <select id="sSort">${Object.keys(sorters).map((k) => `<option value="${k}" ${k === sort ? 'selected' : ''}>${{ relevance: 'Relevance', best: 'Recommended', top: 'Top sellers', played: 'Most played', trending: 'Trending', new: 'Release date', fastest: 'Fastest build', price: 'Lowest price', name: 'Name' }[k]}</option>`).join('')}</select></label></div>
      <div class="results">${results.map((g) => {
        const r = ratingLabel(g.rating);
        return `<a class="result" href="/app/${esc(g.id)}" data-link>
          <span class="res-art" style="background-image:url('${esc(g.media.header)}')"></span>
          <span class="res-t"><b>${esc(g.title)} ${rankBadges(g, 2)}</b><span class="res-tags">${genreTags(g.tags, 4)}</span></span>
          <span class="res-date muted">${date(g.releaseDate)}</span>
          <span class="res-rating ${r.cls}" title="${r.label}">${g.rating ? `${g.rating.pct}%` : '—'}</span>
          <span class="res-price">${priceTag(g, { compact: true })}</span>
        </a>`;
      }).join('') || '<div class="empty-state"><h2>Nothing vibes with that</h2><p>Try a different search, or loosen a filter.</p></div>'}</div>
    </div>
    <aside class="search-side">
      <div class="panel">
        <h3>Narrow by price</h3>
        ${[['Any price', null], ['Free', 0], ['Under $5', 500], ['Under $10', 1000], ['Under $15', 1500]].map(([l, v]) => `<a class="filter ${String(maxPrice ?? '') === String(v ?? '') ? 'on' : ''}" href="${link({ max: v })}" data-link>${l}</a>`).join('')}
      </div>
      <div class="panel">
        <h3>Options</h3>
        <a class="filter ${demo ? 'on' : ''}" href="${link({ demo: demo ? null : '1' })}" data-link>Has instant demo</a>
        <a class="filter ${hideOwned ? 'on' : ''}" href="${link({ hideOwned: hideOwned ? null : '1' })}" data-link>Hide games I own</a>
      </div>
      <div class="panel">
        <h3>Narrow by genre</h3>
        <div class="tag-cloud">${state.tags.map((t) => `<a class="tag ${t.name === tag ? 'on' : ''}" href="${link({ tag: t.name === tag ? null : t.name })}" data-link>${esc(t.name)} <small>${t.count}</small></a>`).join('')}</div>
      </div>
      <div class="panel">
        <h3>Made with <small class="muted">(AI tools)</small></h3>
        <div class="tag-cloud">${state.tools.map((t) => { const x = TOOL_BY_ID.get(t.id); return x ? `<a class="tag ${t.id === tool ? 'on' : ''}" href="${link({ tool: t.id === tool ? null : t.id })}" data-link><span class="tool-dot" style="--c:${x.color}"></span>${esc(x.name)} <small>${t.count}</small></a>` : ''; }).join('')}</div>
      </div>
    </aside>
  </div>`;
  bindStoreBar(root);
  $('#sSort', root).onchange = (e) => go(link({ sort: e.target.value }));
  return null;
}
