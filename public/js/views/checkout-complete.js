// Return page after Stripe checkout: confirm the order, then celebrate.
import { api } from '../api.js';
import { state, applyUserState } from '../state.js';
import { esc, logo, icons } from '../ui.js';
import { afterPurchase } from './checkout.js';

export async function render(root, _, query) {
  const orderId = query.get('order');
  root.innerHTML = `<div class="page checkout-done"><div class="panel cd-panel"><div class="spinner lg"></div><h2>Confirming your payment…</h2></div></div>`;
  let r = null;
  for (let i = 0; i < 6; i++) {
    try { r = await api.confirmCheckout(orderId); } catch (err) { root.querySelector('.cd-panel').innerHTML = `<h2>We couldn't confirm this order</h2><p class="muted">${esc(err.message)}</p><a class="btn" href="/store" data-link>Back to Store</a>`; return null; }
    if (r.order.status === 'paid' || r.order.status === 'cancelled') break;
    await new Promise((res) => setTimeout(res, 1500)); // webhook may still be on its way
  }
  applyUserState(r.state);
  const g = state.byId.get(r.order.gameId);
  const panel = root.querySelector('.cd-panel');
  if (r.order.status !== 'paid') {
    panel.innerHTML = `<h2>Payment not completed</h2><p class="muted">Your card wasn't charged. You can try again from the store page.</p><a class="btn btn-buy" href="/app/${esc(r.order.gameId)}" data-link>Back to ${esc(r.order.title)}</a>`;
    return null;
  }
  if (g) afterPurchase(g);
  panel.innerHTML = `
    ${g ? `<div class="cd-art" style="background-image:url('${esc(g.media.header)}')">${logo(g, 'md')}</div>` : ''}
    <div class="co-check">✓</div>
    <h2>${esc(r.order.title)} is yours</h2>
    <p class="muted">Payment received — order <span class="mono">${esc(r.order.id)}</span>. A receipt is in your profile.</p>
    <div class="co-actions center"><a class="btn btn-play btn-lg" href="/play/${esc(r.order.gameId)}" data-link>${icons.play} Play now</a><a class="btn btn-ghost" href="/library/${esc(r.order.gameId)}" data-link>View in Library</a></div>`;
  return null;
}
