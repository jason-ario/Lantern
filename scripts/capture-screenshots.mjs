// Captures REAL gameplay screenshots of the playable games through the runtime,
// saving them as public/media/{id}/shotN.png (used by the store pages).
//   node scripts/capture-screenshots.mjs [baseUrl]   (server must be running; re-seed afterwards)
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 760 } });
const api = (m, p, d) => page.request.fetch(`${BASE}${p}`, { method: m, headers: { 'X-Lantern-Client': 'platform', 'Content-Type': 'application/json' }, data: d });
await page.goto(BASE); await api('POST', '/api/dev/reset');
await api('POST', '/api/games/voidrunner/purchase', { paymentMethod: 'demo-wallet' });
await api('POST', '/api/games/tidewater/purchase', { paymentMethod: 'demo-wallet' });
const stage = () => page.locator('#rtStage');
async function launch(id) {
  await page.goto(`${BASE}/play/${id}`);
  await page.waitForSelector('#rtSplash.gone', { state: 'attached' });
  await page.addStyleTag({ content: '#rtAch{display:none!important}' });
  await page.waitForTimeout(900);
  return page.frames().find((f) => f.url().includes('/games/'));
}
// Voidrunner
await api('PUT', '/api/games/voidrunner/saves/progress', { value: { bestScore: 48210, furthestSector: 6, runs: 31, totalKills: 1420 } });
await launch('voidrunner');
await stage().screenshot({ path: 'public/media/voidrunner/shot4.png' });
for (const [n, sector, t] of [[1, 3, 5200], [2, 6, 6500], [3, 2, 4200]]) {
  await api('PUT', '/api/games/voidrunner/saves/run', { value: { sector, score: sector * 4100, lives: 3, savedAt: Date.now() } });
  await launch('voidrunner');
  await page.mouse.click(640, 400); await page.keyboard.press('Enter');
  const start = Date.now();
  while (Date.now() - start < t) { await page.mouse.move(400 + Math.random() * 480, 520 + Math.random() * 180, { steps: 8 }); await page.waitForTimeout(120); }
  await stage().screenshot({ path: `public/media/voidrunner/shot${n}.png` });
}
// Tidewater — a well-developed harbor
await api('PUT', '/api/games/tidewater/saves/harbor', { value: { v: 1, harborName: 'Gull\'s Rest', coins: 18430, lifetime: 412000, clicks: 2210, buildings: { skiff: 14, traps: 9, cannery: 5, cog: 3, icehouse: 1 }, upgrades: ['nets', 'hulls', 'bait', 'lighthouse', 'salt'], startedAt: Date.now() - 86400000 * 3, savedAt: Date.now(), playSeconds: 15400 } });
let f = await launch('tidewater');
await page.waitForTimeout(1500);
await stage().screenshot({ path: 'public/media/tidewater/shot1.png' });
for (let i = 0; i < 12; i++) await f.click('#haul');
await stage().screenshot({ path: 'public/media/tidewater/shot2.png' });
await api('PUT', '/api/games/tidewater/saves/harbor', { value: { v: 1, harborName: 'Lantern Cove', coins: 1240, lifetime: 9800, clicks: 400, buildings: { skiff: 5, traps: 3, cannery: 1 }, upgrades: ['nets', 'hulls'], startedAt: Date.now() - 3600000, savedAt: Date.now() - 3 * 3600000, playSeconds: 3400 } });
f = await launch('tidewater');
await page.waitForTimeout(800);
await stage().screenshot({ path: 'public/media/tidewater/shot3.png' });
await f.click('#modalOk');
await page.setViewportSize({ width: 1280, height: 1100 });
await page.waitForTimeout(600);
await stage().screenshot({ path: 'public/media/tidewater/shot4.png' });
await b.close();
console.log('captured');
