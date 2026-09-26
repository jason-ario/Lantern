// Mocked checkout. No payment processing: the "Lantern Wallet" is a stand-in.
import { purchase } from '../state.js';
import { esc, price, modal, icons, logo, toast } from '../ui.js';
import { go } from '../nav.js';

export function openCheckout(g, { inGame = false, onPurchased } = {}) {
  modal(`
    <div class="co">
      <div class="co-head"><h3>Checkout</h3><button class="icon-btn" data-close aria-label="Close">${icons.close}</button></div>
      <div class="co-item">
        <div class="co-art" style="background-image:url('${esc(g.media.header)}')">${logo(g, 'sm')}</div>
        <div class="co-info"><div class="co-title">${esc(g.title)}</div><div class="muted">${esc(g.developer?.name ?? '')} · Digital edition · Plays on web &amp; desktop</div></div>
        <div class="co-price">${price(g.priceCents)}</div>
      </div>
      <div class="co-rows">
        <div><span>Subtotal</span><span>${price(g.priceCents)}</span></div>
        <div><span>Tax</span><span>$0.00</span></div>
        <div class="co-total"><span>Total</span><span>${price(g.priceCents)}</span></div>
      </div>
      <div class="co-pay">
        <div class="co-pay-label">Payment method</div>
        <label class="co-method"><input type="radio" checked> <span><b>Lantern Wallet</b><small>Prototype — no real payment is taken</small></span></label>
      </div>
      <p class="co-fine">Your purchase is a permanent licence tied to your Lantern account. Saves, achievements and playtime follow you across web and desktop.</p>
      <div class="co-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-buy btn-lg" data-confirm>Confirm purchase · ${price(g.priceCents)}</button></div>
    </div>`, {
    onMount(el, close) {
      el.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
      el.querySelector('[data-confirm]').onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Processing…';
        try {
          await Promise.all([purchase(g.id), new Promise((r) => setTimeout(r, 650))]);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Try again';
          toast(esc(err.message), { kind: 'error' });
          return;
        }
        onPurchased?.();
        el.innerHTML = `<div class="co co-done">
          <div class="co-check">✓</div>
          <h3>${esc(g.title)} is now in your Library</h3>
          <p class="muted">It's yours to keep. ${inGame ? 'Your demo progress has carried over — keep playing.' : 'Launch it instantly any time from your Library.'}</p>
          <div class="co-actions center">
            ${inGame ? '<button class="btn btn-play btn-lg" data-close>Keep playing</button>' : `<button class="btn btn-play btn-lg" data-play>${icons.play} Play now</button><button class="btn btn-ghost" data-lib>View in Library</button>`}
          </div></div>`;
        el.querySelector('[data-close]')?.addEventListener('click', close);
        el.querySelector('[data-play]')?.addEventListener('click', () => { close(); go(`/play/${g.id}`); });
        el.querySelector('[data-lib]')?.addEventListener('click', () => { close(); go(`/library/${g.id}`); });
      };
    },
  });
}
