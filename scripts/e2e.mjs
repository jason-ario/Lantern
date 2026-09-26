// End-to-end check of the primary flow with Playwright.
//   node scripts/e2e.mjs [baseUrl] [screenshotDir]
// Requires `playwright` to be resolvable (npm i -D playwright) and a running server.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'e2e-shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };
const errors = [];
let probing = false;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const ignorable = (t) => /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|Failed to load resource: net::ERR_(FAILED|TUNNEL)/.test(t);
page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text()) && !(probing && /Content Security Policy|Failed to load resource/.test(m.text()))) errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400 && !probing) errors.push(`[http ${r.status()}] ${r.url()}`); });
const api = (method, path, data) => page.request.fetch(`${BASE}${path}`, { method, headers: { 'X-Lantern-Client': 'platform', 'Content-Type': 'application/json' }, data }).then((r) => r.json());
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const gameFrame = async () => {
  for (let i = 0; i < 50; i++) {
    const f = page.frames().find((fr) => fr.url().includes('/games/'));
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('game frame not found');
};
const waitSplashGone = () => page.waitForSelector('#rtSplash.gone', { state: 'attached', timeout: 10000 });
const quitGame = async () => {
  await page.click('#rtQuit');
  await page.waitForFunction(() => !document.body.classList.contains('in-game'), null, { timeout: 10000 });
};

// ---- reset & store ----
await api('POST', '/api/dev/reset');
await page.goto(`${BASE}/store`);
await page.waitForSelector('#featMain .logo');
check('Store renders featured carousel', await page.locator('#featMain .logo').count() === 1);
check('Store shows trending covers', (await page.locator('#trending .cover').count()) >= 8);
await page.waitForTimeout(400);
await shot('01-store');
await page.screenshot({ path: `${OUT}/01b-store-full.png`, fullPage: true });

// ---- search ----
await page.fill('#storeSearch input', 'harbor');
await page.press('#storeSearch input', 'Enter');
await page.waitForSelector('.result');
check('Search finds Tidewater for "harbor"', (await page.locator('.result:has-text("Tidewater")').count()) === 1);

// ---- game page ----
await page.goto(`${BASE}/app/voidrunner`);
await page.waitForSelector('.buy-box');
check('Game page shows demo + buy boxes', (await page.locator('.demo-box').count()) === 1 && (await page.locator('[data-buy]').count()) === 1);
await shot('02-game-page');

// ---- try demo instantly ----
const t0 = Date.now();
await page.click('.demo-box a.btn-demo');
await page.waitForSelector('.runtime-frame');
let frame = await gameFrame();
await waitSplashGone();
check('Demo launches in the runtime', true, `${Date.now() - t0} ms to playable`);
check('Demo timer visible', (await page.textContent('#rtDemo')).startsWith('DEMO'));
await page.waitForTimeout(800);
await page.click('.runtime-frame', { position: { x: 700, y: 400 } });
await page.keyboard.press('Enter'); // start new run from title menu
await page.waitForTimeout(3500);
await shot('03-voidrunner-demo');

// Security probes from inside the untrusted game frame.
probing = true;
const probe = await frame.evaluate(async () => {
  const r = {};
  try { localStorage.setItem('x', '1'); r.localStorage = 'ACCESSIBLE'; } catch { r.localStorage = 'blocked'; }
  try { r.cookie = document.cookie === '' ? 'empty' : 'VISIBLE'; } catch { r.cookie = 'blocked'; }
  try { void window.parent.document.body; r.parentDom = 'ACCESSIBLE'; } catch { r.parentDom = 'blocked'; }
  try { const res = await fetch('/api/state', { headers: { 'X-Lantern-Client': 'platform' } }); r.api = `status ${res.status}`; } catch { r.api = 'blocked'; }
  try { const res = await fetch('/api/state'); r.apiNoHeader = `status ${res.status}`; } catch { r.apiNoHeader = 'blocked'; }
  try { const res = await fetch('/games/tidewater/1.2.0/manifest.json'); r.otherGame = `status ${res.status}`; } catch { r.otherGame = 'blocked'; }
  try { r.otherSave = await Platform.storage.load('../tidewater/harbor'); } catch (e) { r.otherSave = `rejected (${e.code})`; }
  try { await Platform.storage.save('x', 'y'.repeat(300000)); r.bigSave = 'ACCEPTED'; } catch (e) { r.bigSave = `rejected (${e.code})`; }
  try { await Platform.achievements.unlock('not_real'); r.fakeAch = 'ACCEPTED'; } catch (e) { r.fakeAch = `rejected (${e.code})`; }
  r.origin = self.origin;
  return r;
});
await page.waitForTimeout(200);
probing = false;
check('Game has opaque origin', probe.origin === 'null', probe.origin);
check('Game cannot use platform localStorage', probe.localStorage === 'blocked');
check('Game cannot read parent DOM', probe.parentDom === 'blocked');
check('Game cannot call platform API', !/status 200/.test(probe.api) && !/status 200/.test(probe.apiNoHeader), `${probe.api} / ${probe.apiNoHeader}`);
check('Game cannot fetch another game package', probe.otherGame === 'blocked', probe.otherGame);
check('SDK rejects invalid save key', probe.otherSave.startsWith('rejected'), probe.otherSave);
check('SDK rejects oversized save', probe.bigSave.startsWith('rejected'), probe.bigSave);
check('SDK rejects unknown achievement', probe.fakeAch.startsWith('rejected'), probe.fakeAch);

await quitGame();
check('Quit returns to game page', page.url().endsWith('/app/voidrunner'), page.url());
const demoSaves = await api('GET', '/api/games/voidrunner/saves');
check('Demo progress saved via Platform.storage', demoSaves.some((s) => s.key === 'progress'), demoSaves.map((s) => s.key).join(','));

// ---- buy ----
await page.click('[data-buy]');
await page.waitForSelector('.co [data-confirm]');
await shot('04-checkout');
await page.click('.co [data-confirm]');
await page.waitForSelector('.co-done');
await shot('05-purchased');
await page.click('.co-done [data-lib]');
await page.waitForSelector('.lib-detail');
check('Purchased game appears in Library', (await page.locator('.lib-item:has-text("Voidrunner")').count()) >= 1);
const st = await api('GET', '/api/state');
check('Ownership persisted server-side', st.owned.includes('voidrunner'));

// ---- play full game from library, quit mid-run ----
await page.click('.ld-bar .btn-play');
frame = await gameFrame();
await waitSplashGone();
await page.waitForTimeout(700);
await page.click('.runtime-frame', { position: { x: 700, y: 400 } });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await quitGame();
const vrSaves = await api('GET', '/api/games/voidrunner/saves');
const run = await api('GET', '/api/games/voidrunner/saves/run');
check('Voidrunner saved in-progress run on quit', !!run?.value?.sector, JSON.stringify(run?.value ?? null));
await page.goto(`${BASE}/library/voidrunner`);
await page.waitForSelector('.saves');
await shot('06-library-detail');
check('Library shows playtime', !/0 hrs/.test(await page.textContent('.ld-bar')));

// ---- Tidewater: meaningful state → save → quit → relaunch → restore ----
await api('POST', '/api/games/tidewater/purchase', { paymentMethod: 'demo-wallet' });
await page.goto(`${BASE}/play/tidewater`);
frame = await gameFrame();
await waitSplashGone();
await frame.waitForSelector('#modalOk');
await frame.click('#modalOk');
for (let i = 0; i < 40; i++) await frame.click('#haul');
await frame.click('[data-buy="skiff"]');
await frame.click('[data-buy="skiff"]');
await frame.click('#harborName');
await frame.fill('input.harbor-name', 'Lantern Cove');
await frame.press('input.harbor-name', 'Enter');
await page.waitForTimeout(1500);
const before = await frame.evaluate(() => ({ coins: document.getElementById('coins').textContent, name: document.getElementById('harborName').textContent, skiffs: document.querySelector('[data-b="skiff"] .count').textContent }));
await shot('07-tidewater');
await quitGame();
const harbor = await api('GET', '/api/games/tidewater/saves/harbor');
check('Tidewater state saved', harbor?.value?.buildings?.skiff === 2 && harbor.value.harborName === 'Lantern Cove', `skiffs=${harbor?.value?.buildings?.skiff} name=${harbor?.value?.harborName}`);
await page.goto(`${BASE}/library`);
await page.waitForTimeout(500);
await page.goto(`${BASE}/play/tidewater`);
frame = await gameFrame();
await waitSplashGone();
await frame.waitForFunction(() => /restored/.test(document.getElementById('saveState').textContent));
const after = await frame.evaluate(() => ({ coins: document.getElementById('coins').textContent, name: document.getElementById('harborName').textContent, skiffs: document.querySelector('[data-b="skiff"] .count').textContent }));
check('Tidewater restored after relaunch', after.name === before.name && after.skiffs === before.skiffs && parseFloat(after.coins) >= parseFloat(before.coins) - 1, `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
await shot('08-tidewater-restored');
await quitGame();

// ---- wishlist persistence ----
await api('PUT', '/api/wishlist/kepler');
await page.goto(`${BASE}/app/pinewatch`);
await page.click('#wishHead [data-wish]');
await page.waitForSelector('#wishHead .btn-wish-on');
await page.reload();
await page.waitForSelector('#wishHead');
check('Wishlist add persists across reload', (await page.locator('#wishHead .btn-wish-on').count()) === 1);
await page.goto(`${BASE}/wishlist`);
await page.waitForSelector('.wish-row');
check('Wishlist page lists Pinewatch', (await page.locator('.wish-row:has-text("Pinewatch")').count()) === 1);
await page.click('.wish-row:has-text("Last Light of Kepler") [data-remove]');
await page.waitForTimeout(300);
await page.reload();
await page.waitForSelector('.wish-row');
check('Wishlist remove persists', (await page.locator('.wish-row:has-text("Last Light of Kepler")').count()) === 0);
await shot('09-wishlist');

// ---- profile ----
await page.goto(`${BASE}/profile`);
await page.waitForSelector('.pf-stats');
await shot('10-profile');
check('Profile shows achievements', +(await page.textContent('.pf-stats div:nth-child(4) b')) > 0);

// ---- publish ----
await page.goto(`${BASE}/publish`);
await page.click('#useSample');
await page.waitForSelector('.report.ok');
await shot('11-publish');
await page.click('#publishBtn');
await page.waitForSelector('.pub-live', { timeout: 15000 });
await shot('12-published');
await page.click('.pub-live a.btn-ghost');
await page.waitForSelector('.gp-head h1');
check('Published game has a store page', (await page.textContent('.gp-head h1')) === 'Skylark');
await page.click('.owned-box .btn-play');
frame = await gameFrame();
await waitSplashGone();
check('Published game launches', frame.url().includes('/games/skylark/1.0.0/'));
await quitGame();

// ---- direct URL instant play (web: URL → instantly try) ----
const p2 = await ctx.newPage();
p2.on('pageerror', (e) => errors.push(`[pageerror p2] ${e.message}`));
await p2.goto(`${BASE}/play/tidewater`);
await p2.waitForSelector('#rtSplash.gone', { state: 'attached' });
check('Direct /play URL launches game', true);
await p2.close();

// ---- mobile ----
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() }); // same guest account
const mp = await m.newPage();
mp.on('pageerror', (e) => errors.push(`[pageerror mobile] ${e.message}`));
for (const [name, path, sel] of [['m-store', '/store', '#featMain .logo'], ['m-game', '/app/tidewater', '.buy-box'], ['m-library', '/library', '.lib-card'], ['m-library-detail', '/library/voidrunner', '.ld-bar'], ['m-wishlist', '/wishlist', '.wish-row'], ['m-profile', '/profile', '.pf-stats'], ['m-publish', '/publish', '.drop']]) {
  await mp.goto(`${BASE}${path}`);
  await mp.waitForSelector(sel);
  await mp.waitForTimeout(300);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`Mobile ${path} has no horizontal overflow`, overflow <= 1, `${overflow}px`);
  await mp.screenshot({ path: `${OUT}/${name}.png` });
}
await mp.goto(`${BASE}/play/tidewater`);
await mp.waitForSelector('#rtSplash.gone', { state: 'attached' });
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${OUT}/m-runtime.png` });
await m.close();

check('No console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
