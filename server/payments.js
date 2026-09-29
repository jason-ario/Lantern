// PAYMENTS: Stripe over plain HTTPS (no SDK dependency).
// Players: create an order → Checkout Session → Stripe hosts the payment page →
// we fulfil the order from the webhook (checkout.session.completed) or, as a
// fallback, when the player returns to /checkout/complete. Fulfilment is idempotent.
// Creators: Stripe Connect Express accounts. The platform is the seller of record;
// after a sale the creator's share is sent with a Transfer (separate charges and
// transfers), and reversed if the sale is refunded.
import crypto from 'node:crypto';
import { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_API_BASE, CURRENCY, STRIPE_TAX } from './config.js';

// Country the platform's Stripe account is in. Creators elsewhere are onboarded
// as "recipients" (payouts only), which Stripe supports in many more countries.
export const PLATFORM_COUNTRY = (process.env.STRIPE_PLATFORM_COUNTRY ?? 'US').toUpperCase();

export const stripeEnabled = () => !!STRIPE_SECRET_KEY;

export async function stripe(method, path, form) {
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form && method !== 'GET' ? new URLSearchParams(form) : undefined,
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
  form['payment_intent_data[metadata][orderId]'] = order.id;
  form['payment_intent_data[transfer_group]'] = order.id;
  if (STRIPE_TAX) {
    form['automatic_tax[enabled]'] = 'true';
    form['line_items[0][price_data][tax_behavior]'] = 'exclusive';
    form['line_items[0][price_data][product_data][tax_code]'] = 'txcd_10202000'; // digital video games
    form['billing_address_collection'] = 'required';
  }
  return stripe('POST', '/v1/checkout/sessions', form);
}

export const retrieveCheckoutSession = (id) => stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);

// Amounts, tax and the Stripe fee for a completed Checkout Session.
export async function saleDetails(sessionId) {
  const cs = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge.balance_transaction`);
  const pi = cs.payment_intent && typeof cs.payment_intent === 'object' ? cs.payment_intent : null;
  const charge = pi?.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null;
  return {
    paymentIntentId: pi?.id ?? (typeof cs.payment_intent === 'string' ? cs.payment_intent : null),
    chargeId: charge?.id ?? (typeof pi?.latest_charge === 'string' ? pi.latest_charge : null),
    subtotalCents: cs.amount_subtotal ?? null,
    taxCents: cs.total_details?.amount_tax ?? 0,
    totalCents: cs.amount_total ?? null,
    feeCents: bt?.fee ?? null,
  };
}

// ---------------- Connect (creator payouts) ----------------
export function createConnectAccount({ email, userId, country }) {
  const form = {
    type: 'express',
    'capabilities[transfers][requested]': 'true',
    'metadata[userId]': userId,
    'business_profile[product_description]': 'Games sold on Vibe-Games',
  };
  if (email) form.email = email;
  if (country) {
    form.country = country;
    if (country !== PLATFORM_COUNTRY) form['tos_acceptance[service_agreement]'] = 'recipient';
  }
  return stripe('POST', '/v1/accounts', form);
}
export const retrieveAccount = (id) => stripe('GET', `/v1/accounts/${encodeURIComponent(id)}`);
export const createAccountLink = (account, refreshUrl, returnUrl) => stripe('POST', '/v1/account_links', { account, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
export const createLoginLink = (account) => stripe('POST', `/v1/accounts/${encodeURIComponent(account)}/login_links`, {});
export const payoutsReady = (acct) => acct?.capabilities?.transfers === 'active';

export function createTransfer({ amount, destination, chargeId, orderId, currency = CURRENCY }) {
  const form = { amount: String(amount), currency, destination, transfer_group: orderId, 'metadata[orderId]': orderId };
  if (chargeId) form.source_transaction = chargeId; // funds become available with the charge
  return stripe('POST', '/v1/transfers', form);
}
export const reverseTransfer = (transferId) => stripe('POST', `/v1/transfers/${encodeURIComponent(transferId)}/reversals`, {});
export const createRefund = (paymentIntentId, orderId) => stripe('POST', '/v1/refunds', { payment_intent: paymentIntentId, 'metadata[orderId]': orderId });

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
  // Several secrets may be configured (comma separated): one per webhook endpoint,
  // e.g. your account's events + Connect (connected accounts) events.
  const ok = STRIPE_WEBHOOK_SECRET.split(',').map((x) => x.trim()).filter(Boolean).some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
    return v1.some((sig) => { const b = Buffer.from(sig, 'hex'); return b.length === expected.length && crypto.timingSafeEqual(b, expected); });
  });
  if (!ok) throw new Error('Bad signature');
  return JSON.parse(rawBody.toString('utf8'));
}
