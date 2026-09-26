// Feature tests: accounts, offline play, updates + delta downloads, package
// signing/tamper detection, Stripe checkout (against a local fake Stripe), and
// the separate games origin. Starts its own Lantern servers on spare ports.
//   node scripts/test-features.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-test-'));
const servers = [];
async function startLantern(port, env = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: path.join(tmp, `data-${port}`), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !log.includes('running'); i++) await new Promise((r) => setTimeout(r, 100));
  return { child, log: () => log, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();

async function newPlayer(base) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const api = (m, p, d) => page.request.fetch(base + p, { method: m, headers: { 'X-Lantern-Client': 'platform', 'Content-Type': 'application/json' }, data: d, failOnStatusCode: false }).then(async (r) => ({ status: r.status(), body: await r.json().catch(() => null) }));
  return { ctx, page, api, errors };
}
const gameFrame = async (page) => { for (let i = 0; i < 60; i++) { const f = page.frames().find((x) => x !== page.mainFrame() && (x.url().includes('/games/') || x.url() === 'about:srcdoc')); if (f) return f; await wait(100); } throw new Error('no game frame'); };
const quit = async (page) => { await page.click('#rtQuit'); await page.waitForFunction(() => !document.body.classList.contains('in-game'), null, { timeout: 15000 }); };

try {
  // =================================================================== main instance
  const A = 'http://localhost:5301';
  await startLantern(5301);

  // ---------------- accounts ----------------
  {
    const { page, api, ctx } = await newPlayer(A);
    await page.goto(`${A}/store`); await page.waitForSelector("#meChip"); // boot has created the guest session
    await api('POST', '/api/games/voidrunner/purchase', { paymentMethod: 'demo-wallet' });
    const email = `jason+${Date.now()}@example.com`;
    const up = await api('POST', '/api/auth/signup', { email, password: 'correct horse', displayName: 'Jason' });
    check('Guest upgrades to an account and keeps their library', up.status === 200 && !up.body.user.guest && up.body.owned.includes('voidrunner'), `owned=${up.body?.owned}`);
    check('Duplicate email is refused', (await api('POST', '/api/auth/signup', { email, password: 'another pass' })).status === 409);
    await api('POST', '/api/auth/logout');
    const guest = await api('GET', '/api/state');
    check('Signing out starts a fresh guest', guest.body.user.guest && guest.body.owned.length === 0);
    await api('PUT', '/api/wishlist/kepler');
    await api('POST', '/api/games/tidewater/purchase', { paymentMethod: 'demo-wallet' });
    check('Wrong password is rejected', (await api('POST', '/api/auth/login', { email, password: 'nope nope' })).status === 401);
    const login = await api('POST', '/api/auth/login', { email, password: 'correct horse' });
    check('Signing in merges the guest session into the account', login.status === 200 && login.body.owned.includes('voidrunner') && login.body.owned.includes('tidewater') && login.body.wishlist.includes('kepler'), `owned=${login.body?.owned} wish=${login.body?.wishlist}`);
    // UI: sign-in modal exists for guests
    const ctx2 = await b.newContext(); const p2 = await ctx2.newPage();
    await p2.goto(`${A}/store`); await p2.waitForSelector('#signInBtn');
    await p2.click('#signInBtn'); await p2.waitForSelector('.auth-form');
    await p2.fill('.auth-form input[name=email]', email); await p2.fill('.auth-form input[name=password]', 'correct horse');
    await p2.click('#authSubmit'); await p2.waitForFunction(() => !document.getElementById('signInBtn'));
    check('Sign-in modal signs in from the UI', (await p2.textContent('#meChip')).includes('Jason'));
    await ctx2.close();
    await ctx.close();
  }

  // ---------------- offline play (the server is really stopped) ----------------
  {
    const O = 'http://localhost:5304';
    let srv = await startLantern(5304);
    const { page, api, ctx, errors } = await newPlayer(O);
    const A = O;
    await page.goto(`${A}/app/tidewater`);
    await page.waitForSelector('[data-buy]');
    await page.click('[data-buy]');
    await page.click('.co [data-confirm]');
    await page.waitForSelector('.co-done');
    await page.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('lantern.installs.v1'))?.tidewater; } catch { return false; } }, null, { timeout: 15000 });
    check('Purchase pre-caches the game for offline play', true);
    await page.goto(`${A}/library/tidewater`); await page.waitForSelector('.lib-detail');
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
    await page.goto(`${A}/library`); await page.waitForSelector('.lib-card');
    await srv.stop();              // the whole backend is gone
    await ctx.setOffline(true);
    await page.goto(`${A}/library/tidewater`);
    await page.waitForSelector('.lib-detail', { timeout: 10000 });
    await page.waitForSelector('#offlineBanner', { timeout: 5000 }).catch(() => {});
    check('Library opens with the server down (service worker shell + cached data)', await page.isVisible('#offlineBanner'));
    await page.click('.ld-bar .btn-play');
    const f = await gameFrame(page);
    await page.waitForSelector('#rtSplash.gone', { state: 'attached', timeout: 15000 });
    const src = await page.textContent('#rtSrc');
    check('Game launches offline from the verified local copy', /Local/.test(src) && /Offline/.test(src), src);
    await f.waitForSelector('#modalOk'); await f.click('#modalOk');
    for (let i = 0; i < 25; i++) await f.click('#haul');
    await f.click('[data-buy="skiff"]');
    await wait(1200);
    await quit(page);
    const queued = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lantern.queue')).map((k) => JSON.parse(localStorage.getItem(k)).length).reduce((a, n) => a + n, 0));
    check('Offline saves and playtime are queued locally', queued >= 2, `${queued} queued`);
    srv = await startLantern(5304); // back online, same data
    await ctx.setOffline(false);
    await page.goto(`${A}/library`); await page.waitForSelector('.lib-card');
    await wait(2500);
    const saved = await api('GET', '/api/games/tidewater/saves/harbor');
    check('Reconnecting uploads offline progress', saved.body?.value?.buildings?.skiff === 1, `skiffs=${saved.body?.value?.buildings?.skiff}`);
    const lib = await api('GET', '/api/library');
    check('Offline playtime recorded on the server', (lib.body.find((e) => e.gameId === 'tidewater')?.playtimeSeconds ?? 0) > 0);

    // ---------------- tamper detection ----------------
    const tamper = await page.evaluate(async () => {
      const m = await import('/js/offline/packages.js');
      const inst = m.installed('tidewater');
      const f = inst.files.find((x) => x.path === 'game.js');
      const cache = await caches.open('lantern-packages-v1');
      await cache.put(`/__lantern/blob/${f.sha256}`, new Response('alert("evil")', { headers: { 'Content-Type': 'text/javascript' } }));
      let fileCheck = 'accepted';
      try { await m.loadFiles('tidewater'); } catch (e) { fileCheck = e.message; }
      const forged = { ...inst.manifest, files: inst.manifest.files.map((x) => (x.path === 'game.js' ? { ...x, sha256: '0'.repeat(64) } : x)) };
      const sigOk = await m.verifySignature(forged, inst.signature);
      await m.remove('tidewater');
      return { fileCheck, sigOk };
    });
    check('A modified local file is refused before it runs', /Corrupted/.test(tamper.fileCheck), tamper.fileCheck);
    check('A forged manifest fails signature verification', tamper.sigOk === false);
    check('No page errors (offline flow)', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }

  // ---------------- publishing updates + delta downloads ----------------
  {
    const { page, api, ctx } = await newPlayer(A);
    await page.goto(`${A}/store`); await page.waitForSelector("#meChip"); // boot has created the guest session
    const zip = (v) => ({ filename: `skylark-${v}.zip`, dataBase64: fs.readFileSync(`public/creator/skylark-${v}.zip`).toString('base64') });
    const pub = await api('POST', '/api/publish', { title: 'Skylark', developerName: 'Afternoon Games', version: '1.0.0', priceCents: 0, tags: ['Arcade'], package: zip('1.0.0') });
    check('Publish Skylark 1.0.0', pub.status === 200, pub.body?.error);
    await page.evaluate(async () => { const m = await import('/js/offline/packages.js'); await m.install('skylark'); });
    const lower = await api('POST', '/api/games/skylark/versions', { version: '0.9.0', package: zip('1.1.0') });
    check('Older version numbers are refused', lower.status === 409);
    const upd = await api('POST', '/api/games/skylark/versions', { version: '1.1.0', releaseNotes: 'The dusk update.', package: zip('1.1.0') });
    check('Publish update 1.1.0 with delta stats', upd.status === 200 && upd.body.delta.changedFiles === 2 && upd.body.delta.totalFiles === 3, JSON.stringify(upd.body?.delta));
    await page.goto(`${A}/library`); await page.waitForSelector('.lib-card');
    check('Library shows "update available"', await page.isVisible('.upd-strip') && await page.isVisible('.lib-badge.upd'));
    await page.goto(`${A}/play/skylark`);
    await page.waitForSelector('#rtSplash.gone', { state: 'attached', timeout: 15000 });
    const ver = await page.textContent('#rtVer');
    await page.waitForSelector('.toast');
    const toastText = await page.textContent('#toasts');
    check('Launching applies the update, downloading only changed files', ver === 'v1.1.0' && /reused 1|1 files unchanged|unchanged/.test(toastText), `${ver} · ${toastText.slice(0, 120)}`);
    await quit(page);
    const g = await api('GET', '/api/games/skylark');
    check('Patch notes + new achievement published', g.body.versions.length === 2 && g.body.achievements.some((a) => a.id === 'high_flyer'));
    await page.goto(`${A}/library/skylark`); await page.waitForSelector('.news');
    check("Library shows What's new", (await page.textContent('#ldNews')).includes('dusk update'));
    // UI flow for a creator update
    await page.goto(`${A}/publish`); await page.waitForSelector('[data-update="skylark"]');
    check('Publish page lists your games with "Publish update"', true);
    // Creator guide + starter kit + earnings
    await page.goto(`${A}/developers`); await page.waitForSelector('.dv-hero');
    check('Creator guide renders with the revenue share', (await page.textContent('.dv-hero h1')).includes('90%') && (await page.$$('.dv-sec')).length >= 10);
    const kit = await fetch(`${A}/creator/lantern-starter.zip`);
    const starter = await api('POST', '/api/publish', { title: 'Firefly Jar', version: '1.0.0', priceCents: 499, tags: ['Casual'], package: { filename: 'lantern-starter.zip', dataBase64: Buffer.from(await kit.arrayBuffer()).toString('base64') } });
    check('Starter kit downloads and publishes cleanly', kit.ok && starter.status === 200, starter.body?.error);
    const buyer = await newPlayer(A);
    await buyer.page.goto(`${A}/store`); await buyer.page.waitForSelector('#meChip');
    await buyer.api('POST', `/api/games/${starter.body.gameId}/purchase`, { paymentMethod: 'demo-wallet' });
    await buyer.page.goto(`${A}/play/${starter.body.gameId}`);
    const sf = await gameFrame(buyer.page);
    await buyer.page.waitForSelector('#rtSplash.gone', { state: 'attached', timeout: 15000 });
    await sf.waitForFunction(() => document.getElementById('total')?.textContent === '0');
    const box = await buyer.page.$eval('#rtFrame, iframe', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    for (let i = 0; i < 120 && (await sf.textContent('#score')) === '0'; i++) await buyer.page.mouse.click(box.x + Math.random() * box.w, box.y + box.h * (0.2 + Math.random() * 0.7));
    await quit(buyer.page);
    const bs = await buyer.api('GET', `/api/games/${starter.body.gameId}/saves`);
    const ba = await buyer.api('GET', `/api/games/${starter.body.gameId}/achievements`);
    check('Starter game saves and unlocks achievements on Lantern', bs.body.some((x) => x.key === 'progress') && ba.body.find((a) => a.id === 'first_catch')?.unlockedAt, JSON.stringify(bs.body));
    await buyer.ctx.close();
    const mine = (await api('GET', '/api/creator/games')).body.find((x) => x.id === starter.body.gameId);
    check('Creator sees the sale and a 90% share', mine.sales.count === 1 && mine.sales.creatorCents === 449, JSON.stringify(mine.sales));
    await ctx.close();
  }

  // =================================================================== Stripe (fake API)
  {
    const WHSEC = 'whsec_test_secret';
    const sessions = new Map();
    const fake = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const u = new URL(req.url, 'http://x');
        if (req.headers.authorization !== 'Bearer sk_test_lantern') { res.writeHead(401); res.end('{"error":{"message":"bad key"}}'); return; }
        if (req.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
          const f = new URLSearchParams(body);
          const id = `cs_test_${crypto.randomBytes(6).toString('hex')}`;
          const s = { id, url: `http://127.0.0.1:5391/pay/${id}`, payment_status: 'unpaid', status: 'open', success_url: f.get('success_url').replace('{CHECKOUT_SESSION_ID}', id), metadata: { orderId: f.get('metadata[orderId]'), gameId: f.get('metadata[gameId]') }, amount_total: Number(f.get('line_items[0][price_data][unit_amount]')) };
          sessions.set(id, s);
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s)); return;
        }
        const m = /^\/v1\/checkout\/sessions\/(.+)$/.exec(u.pathname);
        if (req.method === 'GET' && m) { const s = sessions.get(decodeURIComponent(m[1])); res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s ?? { error: { message: 'no such session' } })); return; }
        res.writeHead(404); res.end('{}');
      });
    });
    // "Hosted payment page": marks paid and redirects back (no auth header needed)
    const payPage = http.createServer((req, res) => {
      const id = req.url.split('/pay/')[1];
      const s = sessions.get(id);
      if (!s) { res.writeHead(404); res.end(); return; }
      s.payment_status = 'paid'; s.status = 'complete';
      res.writeHead(302, { Location: s.success_url }); res.end();
    });
    const fakeApi = http.createServer((req, res) => (req.url.startsWith('/pay/') ? payPage.emit('request', req, res) : fake.emit('request', req, res)));
    await new Promise((r) => fakeApi.listen(5391, r));
    const S = 'http://localhost:5302';
    await startLantern(5302, { STRIPE_SECRET_KEY: 'sk_test_lantern', STRIPE_API_BASE: 'http://127.0.0.1:5391', STRIPE_WEBHOOK_SECRET: WHSEC });
    const { page, api, ctx } = await newPlayer(S);
    await page.goto(`${S}/app/nightpaw`); await page.waitForSelector('[data-buy]');
    await page.click('[data-buy]');
    await page.waitForSelector('.auth-form');
    check('Stripe mode: guests are asked to create an account before paying', (await page.textContent('.auth-reason')).includes('Create an account'));
    await page.fill('.auth-form input[name=displayName]', 'Buyer');
    await page.fill('.auth-form input[name=email]', 'buyer@example.com');
    await page.fill('.auth-form input[name=password]', 'hunter2hunter2');
    await page.click('#authSubmit');
    await page.waitForURL(/\/checkout\/complete/, { timeout: 15000 });
    await page.waitForSelector('.cd-panel .co-check', { timeout: 15000 });
    check('Stripe Checkout round-trip grants the game', (await page.textContent('.cd-panel h2')).includes('Nightpaw is yours'));
    const st = await api('GET', '/api/state');
    check('Ownership recorded after Stripe payment', st.body.owned.includes('nightpaw'));
    const orders = await api('GET', '/api/orders');
    check('Receipt in purchase history', orders.body[0]?.provider === 'stripe' && orders.body[0]?.amountCents === 999);
    check('Fake wallet is disabled when Stripe is on', (await api('POST', '/api/games/voidrunner/purchase', { paymentMethod: 'demo-wallet' })).status === 403);
    // webhook: pending order fulfilled by a signed event; unsigned rejected
    const co = await api('POST', '/api/games/tidewater/checkout', {});
    const sess = [...sessions.values()].find((x) => x.metadata.orderId === co.body.orderId);
    const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: sess.id, payment_status: 'paid', metadata: sess.metadata, client_reference_id: sess.metadata.orderId } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', WHSEC).update(`${t}.${event}`).digest('hex');
    const bad = await fetch(`${S}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${'0'.repeat(64)}` }, body: event });
    const good = await fetch(`${S}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=${sig}` }, body: event });
    check('Webhook with a bad signature is rejected', bad.status === 400);
    const after = await api('GET', '/api/state');
    check('Signed webhook fulfils the order', good.status === 200 && after.body.owned.includes('tidewater'));
    await ctx.close();
    fakeApi.close();
  }

  // =================================================================== separate games origin
  {
    const P = 'http://localhost:5303', G = 'http://127.0.0.1:5303';
    await startLantern(5303, { GAMES_ORIGIN: G, PUBLIC_URL: P });
    const { page, api, ctx, errors } = await newPlayer(P);
    check('Games origin does not serve the platform or API', (await fetch(`${G}/api/state`, { headers: { 'X-Lantern-Client': 'platform' } })).status === 404 && (await fetch(`${G}/store`)).status === 404);
    check('Platform origin does not serve game files', (await fetch(`${P}/games/voidrunner/1.0.0/index.html`)).status === 404);
    const csp = (await fetch(`${G}/games/voidrunner/1.0.0/index.html`)).headers.get('content-security-policy');
    check('Game files only embeddable by the platform', csp.includes(`frame-ancestors ${P}`));
    await page.goto(`${P}/play/voidrunner?demo=1`);
    const f = await gameFrame(page);
    await page.waitForSelector('#rtSplash.gone', { state: 'attached', timeout: 15000 });
    await wait(1000);
    check('Game streams from the games origin', f.url().startsWith(`${G}/games/voidrunner/`), f.url());
    await page.mouse.click(640, 400); await page.keyboard.press('Enter'); await wait(1500);
    await quit(page);
    const saves = await api('GET', '/api/games/voidrunner/saves');
    check('SDK saves work across origins', saves.body.some((s) => s.key === 'progress'));
    await api('POST', '/api/games/voidrunner/purchase', { paymentMethod: 'demo-wallet' });
    const inst = await page.evaluate(async () => { const m = await import('/js/offline/packages.js'); return m.install('voidrunner'); });
    check('Offline install downloads from the games origin', inst.fileCount === 5);
    check('No page errors (games origin)', errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} catch (err) {
  console.error(err);
  results.push(false);
} finally {
  await b.close();
  await Promise.all(servers.filter((s) => s.exitCode === null && s.signalCode === null).map((s) => new Promise((r) => { s.once('exit', r); s.kill(); })));
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
