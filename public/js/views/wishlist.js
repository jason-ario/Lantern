import { api } from '../api.js';
import { state, toggleWishlist, onChange } from '../state.js';
import { esc, logo, price, ratingLabel, date, icons, toast, $ } from '../ui.js';
import { openCheckout } from './checkout.js';

export async function render(root) {
  let rows = await api.wishlist.list();
  let sort = 'added';

  const draw = () => {
    const items = rows.filter((w) => state.wishlist.has(w.gameId)).map((w) => ({ ...w, g: state.byId.get(w.gameId) })).filter((x) => x.g);
    items.sort((a, b) => sort === 'price' ? a.g.priceCents - b.g.priceCents : sort === 'name' ? a.g.title.localeCompare(b.g.title) : sort === 'release' ? a.g.releaseDate.localeCompare(b.g.releaseDate) : b.addedAt.localeCompare(a.addedAt));
    const total = items.filter((x) => x.g.status === 'released').reduce((t, x) => t + x.g.priceCents, 0);
    root.innerHTML = `<div class="page wish">
      <div class="page-head">
        <div class="ph-left">${state.user ? `<h1>${esc(state.user.displayName)}'s Wishlist</h1>` : ''}<span class="muted">${items.length} ${items.length === 1 ? 'game' : 'games'}${total ? ` · ${price(total)} for everything available now` : ''}</span></div>
        <label class="sort">Sort by <select id="wSort">
          <option value="added">Date added</option><option value="name">Name</option><option value="price">Price</option><option value="release">Release date</option>
        </select></label>
      </div>
      ${items.length ? `<div class="wish-list">${items.map(({ g, addedAt }) => {
        const r = ratingLabel(g.rating);
        return `<div class="wish-row">
          <a class="wr-art" href="/app/${esc(g.id)}" data-link style="background-image:url('${esc(g.media.header)}')">${logo(g, 'sm')}</a>
          <div class="wr-body">
            <a class="wr-title" href="/app/${esc(g.id)}" data-link>${esc(g.title)}</a>
            <div class="wr-facts">
              <span>${g.status === 'coming_soon' ? '<span class="soon-pill">Coming soon</span>' : `<span class="${r.cls}">${r.label}</span>`}</span>
              <span class="muted">Release: ${date(g.releaseDate)}</span>
              <span class="muted">${esc(g.developer?.name ?? '')}</span>
            </div>
            <div class="wr-tags">${g.tags.slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          </div>
          <div class="wr-side">
            <div class="wr-buy">
              ${g.status === 'released' ? `${g.demo ? `<a class="btn btn-demo" href="/play/${esc(g.id)}?demo=1" data-link>${icons.play} Demo</a>` : ''}<span class="wr-price">${price(g.priceCents)}</span><button class="btn btn-buy" data-buy="${esc(g.id)}">Buy</button>` : `<span class="muted">Available ${date(g.releaseDate)}</span>`}
            </div>
            <div class="wr-meta"><span class="muted small">Added ${date(addedAt)}</span><button class="link-btn" data-remove="${esc(g.id)}">Remove</button></div>
          </div>
        </div>`;
      }).join('')}</div>` : `<div class="empty-state"><h2>Nothing on the list yet</h2><p>Tap the heart on any game you're vibing with and it'll wait for you here.</p><a class="btn btn-buy" href="/store" data-link>Browse the Store</a></div>`}
    </div>`;
    const sel = $('#wSort', root);
    if (sel) { sel.value = sort; sel.onchange = () => { sort = sel.value; draw(); }; }
  };

  root.onclick = async (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const g = state.byId.get(rm.dataset.remove);
      await toggleWishlist(g.id);
      toast(`Removed <b>${esc(g.title)}</b> from your wishlist`);
    }
    const buy = e.target.closest('[data-buy]');
    if (buy) openCheckout(state.byId.get(buy.dataset.buy));
  };
  draw();
  const off = onChange(draw);
  return () => { off(); root.onclick = null; };
}
