// Checkout. With Stripe configured the player is sent to Stripe's hosted payment
// page; otherwise the fake "Vibe Wallet" confirms instantly (prototype mode).
import { api, ApiError } from '../api.js';
import { state, purchase, applyUserState } from '../state.js';
import { esc, price, modal, icons, logo, toast } from '../ui.js';
import { go } from '../nav.js';
import { openAuth } from './auth.js';
import * as packages from '../offline/packages.js';

const autoDownload = () => { try { return localStorage.getItem('vibe.autoDownload') !== '0'; } catch { return true; } };

// After any purchase: pre-cache the build so it's playable offline right away.
export function afterPurchase(g) {
  if (!packages.supported() || !autoDownload() || !g.version) return;
  packages.install(g.id).then(
    (r) => toast(`${icons.box} <b>${esc(g.title)}</b> is downloaded and ready to play offline (${Math.max(1, Math.round(r.totalBytes / 1024))} KB)`, { kind: 'ok' }),
    () => {},
  );
}

export async function openCheckout(g, { inGame = false, onPurchased, onBeforeRedirect } = {}) {
  if (state.offline) { toast("You're offline — purchases need a connection", { kind: 'error' }); return; }
  if (!state.user) {
    openAuth({ mode: 'signup', reason: `Create a free account (or sign in) to get ${g.title}. Your games are tied to your account.`, onDone: () => openCheckout(g, { inGame, onPurchased, onBeforeRedirect }) });
    return;
  }
  let r;
  try { r = await api.checkout(g.id); } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      openAuth({ mode: 'signup', reason: `Create an account (or sign in) to buy ${g.title}. Purchases are permanent and tied to your account.`, onDone: () => openCheckout(g, { inGame, onPurchased, onBeforeRedirect }) });
      return;
    }
    toast(esc(err.message), { kind: 'error' });
    return;
  }
  if (r.status === 'paid') { // free game
    applyUserState(r.state);
    onPurchased?.();
    afterPurchase(g);
    toast(`<b>${esc(g.title)}</b> added to your library`, { kind: 'ok' });
    return;
  }
  if (r.status === 'redirect') {
    try { sessionStorage.setItem('vibe.checkout', JSON.stringify({ orderId: r.orderId, gameId: g.id, inGame })); } catch { /* ignore */ }
    await onBeforeRedirect?.(); // e.g. save & close a running game first
    location.href = r.redirectUrl; // Stripe-hosted checkout
    return;
  }
  mockCheckout(g, { inGame, onPurchased });
}

function mockCheckout(g, { inGame, onPurchased }) {
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
        <label class="co-method"><input type="radio" checked> <span><b>Vibe Wallet</b><small>Prototype — no real payment is taken (Stripe isn't configured on this server)</small></span></label>
      </div>
      <p class="co-fine">Your purchase is a licence tied to your Vibe-Games account. Saves, achievements and playtime follow you across web and desktop. By buying you agree to the <a href="/legal/terms" data-link>Terms</a>, ask for the game to be available straight away, and can still use our <a href="/legal/refunds" data-link>14-day refund policy</a>.</p>
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
        afterPurchase(g);
        el.innerHTML = successHtml(g, inGame);
        bindSuccess(el, g, close);
      };
    },
  });
}

export function successHtml(g, inGame) {
  return `<div class="co co-done">
    <div class="co-check">✓</div>
    <h3>${esc(g.title)} is now in your Library</h3>
    <p class="muted">It's yours to keep. ${inGame ? 'Your demo progress has carried over — keep playing.' : 'It launches instantly, and it\'s being downloaded so you can play offline too.'}</p>
    <div class="co-actions center">
      ${inGame ? '<button class="btn btn-play btn-lg" data-close>Keep playing</button>' : `<button class="btn btn-play btn-lg" data-play>${icons.play} Play now</button><button class="btn btn-ghost" data-lib>View in Library</button>`}
    </div></div>`;
}
export function bindSuccess(el, g, close) {
  el.querySelector('[data-close]')?.addEventListener('click', close);
  el.querySelector('[data-play]')?.addEventListener('click', () => { close(); go(`/play/${g.id}`); });
  el.querySelector('[data-lib]')?.addEventListener('click', () => { close(); go(`/library/${g.id}`); });
}
