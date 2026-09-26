// PAYMENTS: Stripe Checkout over plain HTTPS (no SDK dependency).
// Flow: create an order → create a Checkout Session → Stripe hosts the payment
// page → we fulfil the order from the webhook (checkout.session.completed) or,
// as a fallback, when the player returns to /checkout/complete and we look the
// session up. Fulfilment is idempotent.
import crypto from 'node:crypto';
import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_API_BASE, CURRENCY } from './config.js';

export const stripeEnabled = () => !!STRIPE_SECRET_KEY;

async function stripe(method, path, form) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? `Stripe error (${res.status})`);
  return json;
}

export function createCheckoutSession({ order, game, successUrl, cancelUrl, email }) {
  const form = {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': CURRENCY,
    'line_items[0][price_data][unit_amount]': String(order.amountCents),
    'line_items[0][price_data][product_data][name]': game.title,
    'line_items[0][price_data][product_data][description]': (game.shortDescription ?? '').slice(0, 250) || game.title,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: order.id,
    'metadata[orderId]': order.id,
    'metadata[gameId]': game.id,
    'metadata[userId]': order.userId,
  };
  if (email) form.customer_email = email;
  return stripe('POST', '/v1/checkout/sessions', form);
}

export const retrieveCheckoutSession = (id) => stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

// Stripe-Signature: t=timestamp,v1=hex(hmac_sha256(secret, `${t}.${rawBody}`))
export function verifyWebhook(rawBody, header, toleranceSec = 300) {
  if (!STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  let t = null; const v1 = [];
  for (const kv of String(header ?? '').split(',')) {
    const [k, v] = kv.split('=');
    if (k === 't') t = v; else if (k === 'v1' && v) v1.push(v);
  }
  if (!t || !v1.length) throw new Error('Missing signature');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error('Signature too old');
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest();
  const ok = v1.some((sig) => { const b = Buffer.from(sig, 'hex'); return b.length === expected.length && crypto.timingSafeEqual(b, expected); });
  if (!ok) throw new Error('Bad signature');
  return JSON.parse(rawBody.toString('utf8'));
}
