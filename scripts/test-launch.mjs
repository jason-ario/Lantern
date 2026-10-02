// Launch features: creator accounts, email verification + password reset,
// the review queue, reports, Stripe Connect payouts, refunds, object storage and
// (when TEST_DATABASE_URL is set) Postgres persistence. Runs its own servers plus
// fake Stripe, Resend and S3 endpoints.
//   node scripts/test-launch.mjs
//   TEST_DATABASE_URL=postgres://user@localhost:5432/vibe_test node scripts/test-launch.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-launch-'));
const PORT = 5341, BASE = `http://localhost:${PORT}`;
const WHSEC = 'whsec_launch';

// ---------------- fakes: Resend, Stripe, S3 ----------------
const mails = [];
const stripe = { sessions: new Map(), accounts: new Map(), transfers: [], reversals: [], refunds: [] };
const s3 = new Map(); const s3gets = [];
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => r(Buffer.concat(c))); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const fakes = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const u = new URL(req.url, 'http://x');
  // --- Resend ---
  if (u.pathname === '/emails' && req.method === 'POST') {
    if (req.headers.authorization !== 'Bearer re_test') return json(res, 401, { message: 'bad key' });
    const m = JSON.parse(body); mails.push(m); return json(res, 200, { id: `email_${mails.length}` });
  }
  // --- S3 (path style: /bucket/key) ---
  if (u.pathname.startsWith('/vibe-bucket/')) {
    if (!/^AWS4-HMAC-SHA256 Credential=AKTEST\//.test(req.headers.authorization ?? '')) { res.writeHead(403); res.end(); return; }
    const key = decodeURIComponent(u.pathname.slice('/vibe-bucket/'.length));
    if (req.method === 'PUT') { s3.set(key, body); res.writeHead(200); res.end(); return; }
    if (req.method === 'GET') { s3gets.push(key); const b = s3.get(key); if (!b) { res.writeHead(404); res.end(); return; } res.writeHead(200); res.end(b); return; }
    if (req.method === 'HEAD') { res.writeHead(s3.has(key) ? 200 : 404); res.end(); return; }
  }
  // --- Stripe ---
  if (u.pathname.startsWith('/v1/')) {
    if (req.headers.authorization !== 'Bearer sk_test_launch') return json(res, 401, { error: { message: 'bad key' } });
    const f = new URLSearchParams(body.toString());
    if (req.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      const id = `cs_${crypto.randomBytes(5).toString('hex')}`;
      const amount = Number(f.get('line_items[0][price_data][unit_amount]'));
      const s = { id, url: `http://127.0.0.1:5392/pay/${id}`, payment_status: 'unpaid', status: 'open', metadata: { orderId: f.get('metadata[orderId]'), gameId: f.get('metadata[gameId]') }, client_reference_id: f.get('client_reference_id'), amount_subtotal: amount, amount_total: amount, total_details: { amount_tax: 0 }, payment_intent: `pi_${id}`, automatic_tax: f.get('automatic_tax[enabled]') };
      stripe.sessions.set(id, s); return json(res, 200, s);
    }
    let m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) {
      const s = stripe.sessions.get(decodeURIComponent(m[1]));
      if (!s) return json(res, 404, { error: { message: 'no such session' } });
      const expand = u.searchParams.getAll('expand[]').length > 0;
      return json(res, 200, expand ? { ...s, payment_intent: { id: s.payment_intent, latest_charge: { id: `ch_${s.id}`, balance_transaction: { fee: 45 } } } } : s);
    }
    if (req.method === 'POST' && u.pathname === '/v1/accounts') {
      const id = `acct_${crypto.randomBytes(5).toString('hex')}`;
      const a = { id, country: f.get('country'), email: f.get('email'), tos: f.get('tos_acceptance[service_agreement]'), details_submitted: false, capabilities: { transfers: 'inactive' } };
      stripe.accounts.set(id, a); return json(res, 200, a);
    }
    m = /^\/v1\/accounts\/([^/]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) return json(res, 200, stripe.accounts.get(m[1]) ?? {});
    if (req.method === 'POST' && u.pathname === '/v1/account_links') return json(res, 200, { url: `https://connect.stripe.test/setup/${f.get('account')}` });
    if (req.method === 'POST' && /\/login_links$/.test(u.pathname)) return json(res, 200, { url: 'https://connect.stripe.test/dashboard' });
    if (req.method === 'POST' && u.pathname === '/v1/transfers') {
      const t = { id: `tr_${stripe.transfers.length + 1}`, amount: Number(f.get('amount')), destination: f.get('destination'), source_transaction: f.get('source_transaction') };
      stripe.transfers.push(t); return json(res, 200, t);
    }
    m = /^\/v1\/transfers\/([^/]+)\/reversals$/.exec(u.pathname);
    if (req.method === 'POST' && m) { stripe.reversals.push(m[1]); return json(res, 200, { id: `trr_${m[1]}` }); }
    if (req.method === 'POST' && u.pathname === '/v1/refunds') { const r = { id: `re_${stripe.refunds.length + 1}`, payment_intent: f.get('payment_intent') }; stripe.refunds.push(r); return json(res, 200, r); }
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fakes.listen(5392, r));
const FAKE = 'http://127.0.0.1:5392';

// ---------------- server ----------------
const env = {
  PORT: String(PORT), DATA_DIR: path.join(tmp, 'data'), PUBLIC_URL: BASE,
  ADMIN_EMAILS: 'boss@example.com', ADMIN_PASSWORD: 'unused-but-set',
  RESEND_API_KEY: 're_test', RESEND_API_BASE: FAKE, EMAIL_FROM: 'Vibe-Games <test@example.com>',
  STRIPE_SECRET_KEY: 'sk_test_launch', STRIPE_API_BASE: FAKE, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_TAX: '1',
  S3_BUCKET: 'vibe-bucket', S3_ENDPOINT: FAKE, S3_REGION: 'auto', S3_ACCESS_KEY_ID: 'AKTEST', S3_SECRET_ACCESS_KEY: 'secret',
  DEMO_CONTENT: 'off',
};
let server;
async function start(extra = {}) {
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100 && !log.includes('running'); i++) await wait(100);
  if (!log.includes('running')) console.error(log);
  server.log = () => log;
}
const stop = () => new Promise((r) => { server.once('exit', r); server.kill('SIGTERM'); });

const b = await chromium.launch();
async function person() {
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const api = (m, p, d) => page.request.fetch(BASE + p, { method: m, headers: { 'X-Vibe-Client': 'platform', 'Content-Type': 'application/json' }, data: d, failOnStatusCode: false }).then(async (r) => ({ status: r.status(), body: await r.json().catch(() => null) }));
  return { ctx, page, api, errors };
}
const findMail = (to, re) => [...mails].reverse().find((m) => m.to.includes(to) && (!re || re.test(m.subject)));
// Emails are sent in the background, so give them a moment to arrive.
async function lastMailTo(to, re, { since = 0 } = {}) {
  for (let i = 0; i < 40; i++) { const m = findMail(to, re); if (m && mails.indexOf(m) >= since) return m; await wait(50); }
  return null;
}
const tokenIn = (m) => /token=([A-Za-z0-9_-]+)/.exec(m?.text ?? '')?.[1];
function webhook(event) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${payload}`).digest('hex');
  return fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: payload });
}
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nameBuf = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]).toString('base64');
}
const pkg = (version) => ({ filename: 'g.zip', dataBase64: zip({ 'manifest.json': JSON.stringify({ name: 'Neon Snake', version, entry: 'index.html', sdk: '1' }), 'index.html': `<!doctype html><script src="/sdk/v1/platform-sdk.js"></script><p>v${version}</p>` }) });

try {
  await start();
  const creator = await person();
  const admin = await person();
  const player = await person();

  // ---------- accounts + verification ----------
  check('Signed-out visitors cannot publish', (await creator.api('POST', '/api/packages/inspect', pkg('1.0.0'))).status === 401);
  check('Signed-out visitors cannot play or buy', (await player.api('POST', '/api/games/voidrunner/launch', { mode: 'demo' })).status === 401 && (await player.api('POST', '/api/games/voidrunner/checkout', {})).status === 401);
  await player.api('POST', '/api/auth/signup', { email: 'fan@example.com', password: 'password123', displayName: 'Fan' });
  await creator.api('POST', '/api/auth/signup', { email: 'maker@example.com', password: 'password123', displayName: 'Maker' });
  let st = (await creator.api('GET', '/api/state')).body;
  check('New accounts start unverified', st.user.emailVerified === false && st.creator.blocker === 'verify');
  const vmail = (await lastMailTo('maker@example.com', /Confirm/));
  check('Verification email sent through Resend', !!vmail && vmail.from.includes('test@example.com') && !!tokenIn(vmail));
  check('Unverified accounts cannot become creators', (await creator.api('POST', '/api/creator/join', { agree: true })).status === 403);
  check('A bad verification token is refused', (await creator.api('POST', '/api/auth/verify', { token: 'nope' })).status === 400);
  const ver = await creator.api('POST', '/api/auth/verify', { token: tokenIn(vmail) });
  check('Email verification works', ver.status === 200 && ver.body.state.user.emailVerified === true);
  check('Verification links are single-use', (await creator.api('POST', '/api/auth/verify', { token: tokenIn(vmail) })).status === 400);
  check('Joining needs the Creator Agreement', (await creator.api('POST', '/api/creator/join', {})).status === 400);
  st = (await creator.api('POST', '/api/creator/join', { agree: true })).body;
  check('Verified players can become creators', st.creator.creator === true && st.creator.canPublish === true && st.creator.admin === false);

  // ---------- publish → review queue ----------
  const pub = await creator.api('POST', '/api/publish', { title: 'Neon Snake', priceCents: 499, tags: ['Arcade'], builtWith: ['claude-code', 'cursor'], vibe: { prompt: 'Snake, but neon', hours: 4 }, package: pkg('1.0.0') });
  check('Creator publishes: the game waits for review', pub.status === 200 && pub.body.listing === 'pending', pub.body?.error);
  const gid = pub.body.gameId;
  check('Built-with tools are saved on published games', (await creator.api('GET', `/api/games/${gid}`)).body.builtWith?.join() === 'claude-code,cursor');
  check('Pending games are not in the store', !(await player.api('GET', '/api/catalog')).body.games.some((g) => g.id === gid));
  check('Pending game pages are hidden from players', (await player.api('GET', `/api/games/${gid}`)).status === 404);
  check('The creator can still see and play their pending game', (await creator.api('GET', `/api/games/${gid}`)).status === 200 && (await creator.api('POST', `/api/games/${gid}/launch`, { mode: 'full' })).status === 200);
  check('Players can’t buy a pending game', (await player.api('POST', `/api/games/${gid}/checkout`, {})).status === 404);
  check('Uploads are copied to object storage', [...s3.keys()].some((k) => k === `packages/${gid}/1.0.0/index.html`) && [...s3.keys()].some((k) => k.startsWith(`media/${gid}/`)));

  check('Players can’t open the admin queue', (await player.api('GET', '/api/admin/queue')).status === 403);
  await admin.api('POST', '/api/auth/signup', { email: 'boss@example.com', password: 'password123', displayName: 'Boss' });
  check('Admin email isn’t admin until verified', (await admin.api('GET', '/api/state')).body.creator.admin === false);
  await admin.api('POST', '/api/auth/verify', { token: tokenIn((await lastMailTo('boss@example.com', /Confirm/))) });
  check('Verified ADMIN_EMAILS account is an admin', (await admin.api('GET', '/api/state')).body.creator.admin === true);
  // ---------- admin: accounts overview ----------
  check('Players can’t list accounts', (await player.api('GET', '/api/admin/accounts')).status === 403);
  const acc = (await admin.api('GET', '/api/admin/accounts')).body;
  check('Accounts tab counts every account that was set up', acc.summary.total === 3 && acc.users.length === 3, JSON.stringify(acc.summary));
  check('…with confirmed / unconfirmed / creator / active counts', acc.summary.verified === 2 && acc.summary.unconfirmed === 1 && acc.summary.creators === 1 && acc.summary.active30d === 3 && acc.summary.newThisWeek === 3, JSON.stringify(acc.summary));
  const fan = acc.users.find((u) => u.email === 'fan@example.com');
  check('Each account shows status, last active and role', fan && fan.active === true && fan.verified === false && !!fan.lastActiveAt && acc.users.find((u) => u.email === 'boss@example.com')?.admin === true);
  check('Accounts filter: unconfirmed', (await admin.api('GET', '/api/admin/accounts?filter=unconfirmed')).body.users.map((u) => u.email).join() === 'fan@example.com');
  check('Accounts filter: inactive is empty right after sign-up', (await admin.api('GET', '/api/admin/accounts?filter=inactive')).body.matched === 0);
  check('Accounts search by email', (await admin.api('GET', '/api/admin/accounts?q=MAKER')).body.users.map((u) => u.email).join() === 'maker@example.com');
  await admin.page.goto(`${BASE}/admin?tab=accounts`);
  await admin.page.waitForSelector('.adm-stats .adm-stat b', { timeout: 10000 }).catch(() => {});
  const tiles = await admin.page.$$eval('.adm-stat', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())).catch(() => []);
  const rowsShown = await admin.page.$$eval('.adm-table tbody tr', (els) => els.length).catch(() => 0);
  check('Admin page shows the Accounts tab with totals and a row per account', tiles[0]?.startsWith('3 Accounts set up') && tiles.some((t) => t.startsWith('3 Active')) && rowsShown === 3, tiles.join(' | '));
  await admin.page.click('.adm-stat[data-f="unconfirmed"]');
  await admin.page.waitForFunction(() => document.querySelectorAll('.adm-table tbody tr').length === 1, null, { timeout: 5000 }).catch(() => {});
  check('Clicking a total filters the list', (await admin.page.$$eval('.adm-table tbody tr', (els) => els.length)) === 1);
  await admin.page.screenshot({ path: process.env.ACCOUNTS_SHOT || path.join(tmp, 'accounts.png'), fullPage: true });
  check('No browser errors on the Accounts tab', admin.errors.length === 0, admin.errors.join(' | '));

  const q = (await admin.api('GET', '/api/admin/queue')).body;
  check('Admin sees the game in the review queue', q.games.some((g) => g.id === gid && g.creator.email === 'maker@example.com'));
  check('Rejecting needs a note', (await admin.api('POST', `/api/admin/games/${gid}/reject`, {})).status === 400);
  await admin.api('POST', `/api/admin/games/${gid}/reject`, { note: 'Add a pause menu please' });
  check('Rejection emails the creator with the note', /pause menu/.test((await lastMailTo('maker@example.com', /needs changes/))?.text ?? ''));
  const mg = (await creator.api('GET', '/api/creator/games')).body.find((g) => g.id === gid);
  check('Creator dashboard shows the reviewer note', mg.moderation.listing === 'rejected' && mg.moderation.lastNote.note.includes('pause'));
  await admin.api('POST', `/api/admin/games/${gid}/approve`, { note: 'Looks great' });
  check('Approval puts the game in the store', (await player.api('GET', '/api/catalog')).body.games.some((g) => g.id === gid));
  check('Approval emails the creator', !!(await lastMailTo('maker@example.com', /is live/)));

  // ---------- updates are reviewed ----------
  const upd = await creator.api('POST', `/api/games/${gid}/versions`, { version: '1.0.1', releaseNotes: 'Pause menu', package: pkg('1.0.1') });
  check('Updates wait for review', upd.status === 200 && upd.body.pendingReview === true, upd.body?.error);
  check('Players keep the approved version meanwhile', (await player.api('GET', `/api/games/${gid}`)).body.version.version === '1.0.0');
  const uq = (await admin.api('GET', '/api/admin/queue')).body.updates.find((u) => u.gameId === gid);
  check('Admin can play the build under review', (await admin.api('POST', `/api/games/${gid}/launch`, { mode: 'full', versionId: uq.id })).body.build.version === '1.0.1');
  await admin.api('POST', `/api/admin/versions/${uq.id}/approve`, {});
  check('Approved update goes live', (await player.api('GET', `/api/games/${gid}`)).body.version.version === '1.0.1');
  const edit = await creator.api('PATCH', `/api/creator/games/${gid}`, { shortDescription: 'Snake, but it glows.', priceCents: 499 });
  check('Creators can edit their store page', edit.status === 200 && edit.body.game.shortDescription === 'Snake, but it glows.');
  check('Other players can’t edit it', (await player.api('PATCH', `/api/creator/games/${gid}`, { shortDescription: 'hacked' })).status === 403);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(3000, 1)]);
  const putTrailer = (who) => who.page.request.fetch(`${BASE}/api/creator/games/${gid}/trailer`, { method: 'PUT', headers: { 'X-Vibe-Client': 'platform', 'Content-Type': 'video/mp4' }, data: mp4, failOnStatusCode: false });
  check('Other players can’t upload a trailer', (await putTrailer(player)).status() === 403);
  const tr = await (await putTrailer(creator)).json();
  check('Trailers go live straight away and are copied to object storage', /\.mp4$/.test(tr.trailer ?? '') && s3.has(`media/${gid}/${tr.trailer.split('/').pop()}`) && (await player.api('GET', `/api/games/${gid}`)).body.media.trailer === tr.trailer);

  // ---------- payouts: Connect onboarding ----------
  let po = (await creator.api('GET', '/api/creator/payouts')).body;
  check('Payouts start not connected', po.enabled && !po.connected && !po.ready);
  const ob = await creator.api('POST', '/api/creator/payouts/onboard', { country: 'GE' });
  check('Onboarding creates an Express account + link', ob.status === 200 && ob.body.url.startsWith('https://connect.stripe.test/setup/acct_'));
  const acct = [...stripe.accounts.values()][0];
  check('Creators outside the platform country are onboarded as recipients', acct.country === 'GE' && acct.tos === 'recipient');

  // ---------- a paid sale ----------
  const co = await player.api('POST', `/api/games/${gid}/checkout`, {});
  check('Checkout creates a Stripe session with automatic tax', co.body.status === 'redirect' && [...stripe.sessions.values()].at(-1).automatic_tax === 'true');
  const sess = [...stripe.sessions.values()].at(-1);
  sess.payment_status = 'paid'; sess.status = 'complete';
  await webhook({ type: 'checkout.session.completed', data: { object: { id: sess.id, payment_status: 'paid', metadata: sess.metadata, client_reference_id: sess.metadata.orderId } } });
  await wait(600);
  check('Paid order grants the game', (await player.api('GET', '/api/state')).body.owned.includes(gid));
  po = (await creator.api('GET', '/api/creator/payouts')).body;
  const expected = Math.floor((499 - 45) * 0.9);
  check('Creator earning = 90% of (price − tax − Stripe fee), held until payouts are ready', po.totals.pendingCents === expected && stripe.transfers.length === 0, JSON.stringify(po.totals));
  check('Buyer gets a receipt email', !!(await lastMailTo('fan@example.com', /receipt/i)));

  acct.capabilities.transfers = 'active'; acct.details_submitted = true;
  await webhook({ type: 'account.updated', data: { object: acct } });
  await wait(400);
  po = (await creator.api('GET', '/api/creator/payouts')).body;
  check('When the account is ready, held earnings are transferred', po.ready && po.totals.paidCents === expected && stripe.transfers[0]?.amount === expected && stripe.transfers[0]?.source_transaction === `ch_${sess.id}`);
  check('Creator is told payouts are ready', !!(await lastMailTo('maker@example.com', /Payouts are set up/)));
  check('Payout dashboard link', (await creator.api('POST', '/api/creator/payouts/dashboard')).body?.url === 'https://connect.stripe.test/dashboard');

  // ---------- refunds ----------
  const orders = (await player.api('GET', '/api/orders')).body;
  const ord = orders.find((o) => o.gameId === gid);
  check('Order shows as refundable (in window, not played)', ord.refund.ok === true);
  const rf = await player.api('POST', `/api/orders/${ord.id}/refund`, { reason: 'Not for me' });
  check('Player self-refund', rf.status === 200 && rf.body.order.status === 'refunded', rf.body?.error);
  check('Stripe refund issued and the creator transfer reversed', stripe.refunds[0]?.payment_intent === sess.payment_intent && stripe.reversals[0] === 'tr_1');
  check('Refunded game leaves the library', !(await player.api('GET', '/api/state')).body.owned.includes(gid));
  check('Refund email sent', !!(await lastMailTo('fan@example.com', /Refund issued/)));
  check('Can’t refund twice', (await player.api('POST', `/api/orders/${ord.id}/refund`, {})).status === 403);

  // ---------- admin: an account's library + playtime ----------
  const cl = (await creator.api('POST', `/api/games/${gid}/launch`, { mode: 'full' })).body;
  await creator.api('POST', `/api/sessions/${cl.session.id}/heartbeat`, { activeSeconds: 5 });
  const accts = (await admin.api('GET', '/api/admin/accounts')).body.users;
  const makerId = accts.find((u) => u.email === 'maker@example.com').id;
  const fanId = accts.find((u) => u.email === 'fan@example.com').id;
  check('Players can’t view someone’s library', (await player.api('GET', `/api/admin/accounts/${makerId}`)).status === 403);
  const lib = (await admin.api('GET', `/api/admin/accounts/${makerId}`)).body;
  const row = lib.library?.find((x) => x.gameId === gid);
  check('Admin sees an account’s library with playtime per game', row && row.owned && row.source === 'developer' && row.playtimeSeconds >= 5 && row.sessions >= 1 && !!row.lastPlayedAt && lib.totals.playtimeSeconds >= 5, JSON.stringify(lib.totals));
  check('Accounts list shows total playtime', accts.find((u) => u.id === makerId).playtimeSeconds >= 5);
  const fanLib = (await admin.api('GET', `/api/admin/accounts/${fanId}`)).body;
  check('Refunded games show as refunded, not owned', fanLib.library.some((x) => x.gameId === gid && !x.owned && x.source === 'refunded') && fanLib.totals.owned === 0, JSON.stringify(fanLib.library));
  check('Unknown account → 404', (await admin.api('GET', '/api/admin/accounts/usr_nope')).status === 404);
  await admin.page.goto(`${BASE}/admin?tab=accounts&q=maker`);
  await admin.page.waitForSelector(`[data-acct="${makerId}"]`, { timeout: 10000 }).catch(() => {});
  await admin.page.click(`[data-acct="${makerId}"]`);
  await admin.page.waitForSelector('.adm-lib tbody tr', { timeout: 5000 }).catch(() => {});
  const libText = await admin.page.$eval('.adm-lib', (e) => e.innerText).catch(() => '');
  check('Library button opens the account’s games and playtime', libText.includes('Maker’s library') && libText.includes('Neon Snake') && libText.includes('Creator’s own game'), libText.slice(0, 200));
  await wait(400);
  await admin.page.screenshot({ path: process.env.LIBRARY_SHOT || path.join(tmp, 'library.png') });
  await admin.page.keyboard.press('Escape');

  // ---------- reports + takedown ----------
  check('Players can report a game', (await player.api('POST', '/api/reports', { type: 'game', targetId: gid, reason: 'broken', details: 'Black screen' })).body?.ok === true);
  const reps = (await admin.api('GET', '/api/admin/reports')).body;
  check('Admin sees the report', reps.some((r) => r.gameId === gid && r.details === 'Black screen'));
  await admin.api('POST', `/api/admin/reports/${reps[0].id}/resolve`, { action: 'remove' });
  check('Resolving with "remove" takes the game down', !(await player.api('GET', '/api/catalog')).body.games.some((g) => g.id === gid));
  await admin.api('POST', `/api/admin/games/${gid}/restore`, {});
  check('Admin can restore it', (await player.api('GET', '/api/catalog')).body.games.some((g) => g.id === gid));

  // ---------- password reset ----------
  check('Forgot-password answers the same for unknown emails', (await player.api('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).body.ok === true);
  await player.api('POST', '/api/auth/forgot', { email: 'fan@example.com' });
  const rmail = (await lastMailTo('fan@example.com', /Reset/));
  check('Reset email sent', !!tokenIn(rmail));
  check('Reset needs a good password', (await player.api('POST', '/api/auth/reset', { token: tokenIn(rmail), password: 'short' })).status === 400);
  check('Password reset works', (await player.api('POST', '/api/auth/reset', { token: tokenIn(rmail), password: 'brandnewpass' })).status === 200);
  const other = await person();
  check('Old password no longer works', (await other.api('POST', '/api/auth/login', { email: 'fan@example.com', password: 'password123' })).status === 401);
  check('New password works', (await other.api('POST', '/api/auth/login', { email: 'fan@example.com', password: 'brandnewpass' })).status === 200);

  // ---------- suspension ----------
  const cid = (await creator.api('GET', '/api/state')).body.user.id;
  await admin.api('POST', `/api/admin/creators/${cid}/suspend`);
  check('Suspended creators can’t publish', (await creator.api('POST', `/api/games/${gid}/versions`, { version: '1.0.2', package: pkg('1.0.2') })).status === 403);
  await admin.api('POST', `/api/admin/creators/${cid}/reinstate`);

  // ---------- UI smoke ----------
  await admin.page.goto(`${BASE}/admin`); await admin.page.waitForSelector('.adm-tabs');
  check('Admin console renders', (await admin.page.textContent('.adm-tabs')).includes('Review queue'));
  await creator.page.goto(`${BASE}/publish`); await creator.page.waitForSelector('.payouts');
  check('Creator dashboard shows payouts', (await creator.page.textContent('.payouts')).includes('Paid to you'));
  await player.page.goto(`${BASE}/legal/creators`); await player.page.waitForSelector('.legal-doc h1');
  check('Legal pages render', (await player.page.textContent('.legal-doc h1')) === 'Creator Agreement');
  check('Client errors are accepted by the error endpoint', (await player.api('POST', '/api/client-errors', { message: 'test', stack: 'at x' })).status === 200);
  check('No page errors', ![creator, admin, player].some((p) => p.errors.length), [creator, admin, player].flatMap((p) => p.errors).join('; '));

  // ---------- object storage restores a lost disk ----------
  await stop();
  fs.rmSync(path.join(env.DATA_DIR, 'packages'), { recursive: true, force: true });
  fs.rmSync(path.join(env.DATA_DIR, 'media'), { recursive: true, force: true });
  await start();
  const html = await (await fetch(`${BASE}/games/${gid}/1.0.1/index.html`)).text();
  check('Game files come back from object storage after the disk is wiped', html.includes('v1.0.1'));
  // Several requests for the same missing file at once (a video's Range requests) share one download.
  const mediaKey = [...s3.keys()].find((k) => k.startsWith(`media/${gid}/`));
  fs.rmSync(path.join(env.DATA_DIR, mediaKey), { force: true });
  s3gets.length = 0;
  const same = await Promise.all([1, 2, 3, 4].map(() => fetch(`${BASE}/user-media/${mediaKey.slice('media/'.length)}`).then(async (r) => ({ status: r.status, len: (await r.arrayBuffer()).byteLength }))));
  check('Restoring one file for several requests downloads it once', same.every((r) => r.status === 200 && r.len === s3.get(mediaKey).length) && s3gets.filter((k) => k === mediaKey).length === 1, JSON.stringify({ same, gets: s3gets.filter((k) => k === mediaKey).length }));
  check('Restores leave no partial files behind', !fs.readdirSync(path.dirname(path.join(env.DATA_DIR, mediaKey))).some((f) => f.endsWith('.part')));
  // Files on disk that the bucket lacks (saved while storage was off, or a failed copy) are backed up at startup.
  const pkgKey = [...s3.keys()].find((k) => k.startsWith(`packages/${gid}/`) && fs.existsSync(path.join(env.DATA_DIR, k))); // only files this disk has
  s3.delete(pkgKey); s3.delete(mediaKey);
  await stop(); await start();
  for (let i = 0; i < 50 && !(s3.has(pkgKey) && s3.has(mediaKey)); i++) await wait(200);
  check('Startup backs up files the bucket is missing', s3.has(pkgKey) && s3.has(mediaKey));
  check('…and logs the result', /backup check: \d+ files, 2 newly uploaded/.test(server.log()), server.log().split('\n').filter((l) => l.includes('[storage]')).join(' | '));
  // With storage on, a file that's on neither the disk nor the bucket is reported to admins.
  const lostKey = [...s3.keys()].find((k) => k.startsWith(`media/${gid}/`));
  s3.delete(lostKey); fs.rmSync(path.join(env.DATA_DIR, lostKey), { force: true });
  await stop(); await start();
  const missingNow = (await admin.api('GET', '/api/admin/settings')).body;
  check('Admin sees files missing from both disk and bucket', missingNow.storage === true && missingNow.missingFiles.some((m) => m.id === gid), JSON.stringify(missingNow.missingFiles));

  // ---------- Postgres ----------
  if (process.env.TEST_DATABASE_URL) {
    await stop();
    await start({ DATABASE_URL: process.env.TEST_DATABASE_URL }); // imports data/db.json into an empty database
    const imported = await player.api('GET', '/api/catalog');
    check('Postgres: existing JSON data is imported on first start', imported.body.games.some((g) => g.id === gid));
    const p2 = await person();
    await p2.api('POST', '/api/auth/signup', { email: 'pg@example.com', password: 'password123', displayName: 'PG' });
    await stop();
    fs.rmSync(path.join(env.DATA_DIR, 'db.json'), { force: true });
    await start({ DATABASE_URL: process.env.TEST_DATABASE_URL });
    check('Postgres: data survives a restart without the JSON file', (await p2.api('POST', '/api/auth/login', { email: 'pg@example.com', password: 'password123' })).status === 200);
  } else console.log('  (skipping Postgres checks: set TEST_DATABASE_URL)');
} catch (e) {
  console.error(e); results.push(false);
} finally {
  await b.close();
  if (server && server.exitCode === null) await stop();
  fakes.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
