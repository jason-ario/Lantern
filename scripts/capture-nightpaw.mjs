// Captures real Nightpaw gameplay screenshots through the Lantern runtime → public/media/nightpaw/shotN.png
//   node scripts/capture-nightpaw.mjs [baseUrl]    (then reset/re-seed so the store picks them up)
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5173';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
const api = (m, path, d) => p.request.fetch(BASE + path, { method: m, headers: { 'X-Lantern-Client': 'platform', 'Content-Type': 'application/json' }, data: d }).then((r) => r.json());
const wait = (ms) => p.waitForTimeout(ms);
let f;
const tp = (x, y) => f.evaluate(([a, c]) => window.__nightpaw.teleport(a, c), [x, y]);
const shot = async (n) => { await p.addStyleTag({ content: '#rtAch{display:none!important}' }); await p.locator('#rtStage').screenshot({ path: `public/media/nightpaw/shot${n}.png` }); };

await api('POST', '/api/dev/reset');
await api('POST', '/api/games/nightpaw/purchase', { paymentMethod: 'demo-wallet' });
const save = (extra) => api('PUT', '/api/games/nightpaw/saves/save', { value: { v: 1, has: { wings: true, dash: true }, maxHp: 6, hp: 6, glimmers: 184, visited: ['gate', 'tunnels', 'hollow', 'well', 'shrine', 'loft', 'hall', 'throne'], taken: [], boss: false, deaths: 3, shrine: null, pos: { x: 51, y: 210 }, playSeconds: 1500, savedAt: Date.now(), ...extra } });
async function launch() {
  await p.goto(`${BASE}/play/nightpaw`);
  await p.waitForSelector('#rtSplash.gone', { state: 'attached' });
  f = p.frames().find((x) => x !== p.mainFrame() && (x.url().includes('/games/') || x.url() === 'about:srcdoc'));
  await f.waitForFunction(() => window.__nightpaw?.state().mode === 'title');
  await p.click('.runtime-frame', { position: { x: 900, y: 120 } });
  await p.keyboard.down('Enter'); await wait(60); await p.keyboard.up('Enter');
  await wait(3600); // let the area title fade
}

// 1 — Weeping Tunnels: slashing a crawler
await save();
await launch();
const nearest = async (type) => (await f.evaluate(() => window.__nightpaw.state())).ents.find((e) => e.type === type);
await tp(40 + 5, 14); await wait(900);
let c = await nearest('crawler');
await tp(Math.floor(c.x / 16) - 2, 14); await wait(120);
c = await nearest('crawler');
await tp(Math.floor(c.x / 16) - 2, 14); await wait(40);
await p.keyboard.down('ArrowRight'); await wait(30); await p.keyboard.up('ArrowRight');
await p.keyboard.down('KeyX'); await wait(25);
await shot(1);
await p.keyboard.up('KeyX');

// 2 — The Hollow Well: double jump between ledges
await tp(90 + 18, -17 + 26); await wait(700);
await p.keyboard.down('Space'); await wait(280); await p.keyboard.up('Space'); await wait(15);
await p.keyboard.down('Space'); await p.keyboard.down('ArrowLeft'); await wait(120);
await shot(2);
await p.keyboard.up('Space'); await p.keyboard.up('ArrowLeft'); await wait(800);

// 3 — The Hollow Warden
await tp(179 + 9, -34 + 14); await wait(2400);
const boss = await nearest('boss');
await tp(Math.floor(boss.x / 16) - 2, -34 + 14); await wait(40);
await p.keyboard.down('ArrowRight'); await wait(30); await p.keyboard.up('ArrowRight');
await p.keyboard.down('KeyX'); await wait(25);
await shot(3);
await p.keyboard.up('KeyX');

// 4 — Shrine of Whispers, resting by candlelight
await save({ taken: [] });
await launch();
await tp(84 + 9, 17 + 14); await wait(600);
await p.keyboard.down('ArrowUp'); await wait(80); await p.keyboard.up('ArrowUp'); await wait(1200);
await shot(4);

// 5 — Warden's Hall: dashing over the thorns
await tp(135 + 18, -34 + 14); await wait(700);
await p.keyboard.down('ArrowRight'); await p.keyboard.down('Space'); await wait(110);
await p.keyboard.down('KeyC'); await wait(90);
await shot(5);
await p.keyboard.up('KeyC'); await p.keyboard.up('Space'); await p.keyboard.up('ArrowRight');

await b.close();
console.log('captured nightpaw screenshots');
