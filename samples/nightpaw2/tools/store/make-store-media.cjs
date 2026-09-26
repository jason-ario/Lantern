// Generates Lantern store media for Nightpaw into store-media/:
//   cover.svg (600x900), header.svg (920x430), hero.svg (1920x620)  — composed capsule art
//   shot1..5.png (1280x720)                                         — real gameplay captures
// Usage: node tools/store/make-store-media.cjs [--shots http://localhost:8123/index.html]
// Copy the results into Lantern's public/media/nightpaw/.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'store-media');
fs.mkdirSync(out, { recursive: true });
const shotsUrl = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const LAUNCH = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };

async function capsules(browser) {
  const bundle = path.join(out, '.compose.js');
  execSync(`bun build ${path.join(__dirname, 'compose.ts')} --outfile ${bundle} --target browser --format iife`, { stdio: 'ignore' });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: path.join(root, 'tools/art/painter.js') });
  await page.addScriptTag({ path: bundle });
  const chars = ['np_head', 'np_ear', 'np_eye', 'np_mask', 'np_cloak', 'np_hem', 'np_lining', 'np_leg', 'np_arm', 'np_claws', 'np_tail',
    'moth_body', 'moth_wing', 'moth_antenna', 'candle', 'flame', 'sock_cuff', 'sock_mid', 'sock_foot', 'sock_eyes', 'warden_head', 'button_coin', 'hol_top'];
  const res = await page.evaluate(async ([chars]) => {
    const pick = (list, scale) => Object.fromEntries(window.renderAll(list, scale).map((a) => [a.key, a]));
    const assets = { ...pick(chars, 6), ...pick(['hol_bg_far', 'hol_bg_mid', 'fog'], 2), ...pick(['hol_rock'], 3) };
    return window.composeStore(assets);
  }, [chars]);
  for (const [name, W, H] of [['cover', 600, 900], ['header', 920, 430], ['hero', 1920, 620]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"><image href="${res[name]}" x="0" y="0" width="${W}" height="${H}"/></svg>\n`;
    fs.writeFileSync(path.join(out, `${name}.svg`), svg);
    fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(res[name + '_png'].split(',')[1], 'base64'));
    console.log(`${name}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
  }
  fs.rmSync(bundle);
  await page.close();
}

async function shots(browser) {
  // Each shot: open a room via the debug URL, stage the moment, fast-forward, capture the canvas.
  const open = async (q) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(shotsUrl + q);
    await page.waitForFunction(() => window.__NP && window.__NP.started, null, { timeout: 60000 });
    // store shots: a lived-in save, and a little more light than the (moodier) default
    await page.evaluate(() => { window.__NP_GAME.save.buttons = 184; const L = window.__NP.light; L.setDark = () => {}; L.dark = L.darkTarget = 0.3; });
    const adv = (s) => page.evaluate((s) => { const g = window.__NP.sys.game; let t = Math.max(window.__simT || 0, performance.now()); for (let i = 0; i < s * 60; i++) { t += 1000 / 60; g.headlessStep(t, 1000 / 60); } window.__simT = t; }, s);
    const freeze = () => page.evaluate(() => { const g = window.__NP; g._step = g.step; g.step = () => {}; g.updateSkip = () => {}; g.ui.skipUI(0, false); });
    const snap = async (n) => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.screenshot({ path: path.join(out, `shot${n}.png`) }); console.log(`shot${n}.png`); };
    return { page, adv, freeze, snap };
  };
  let s;
  // 1 — Weeping Tunnels: scratching a Thimble Mite
  s = await open('?room=weeping_tunnels&x=6&y=14&flags=intro_done,met_tallow');
  await s.adv(1.2);
  await s.page.evaluate(() => { const g = window.__NP, m = g.ents.find((e) => e.name === 'Thimble Mite'); g.player.x = m.x - 22; g.player.face = 1; m.dir = -1; g.player.hp = 3; });
  await s.adv(0.05);
  await s.page.keyboard.down('KeyX'); await s.adv(0.06); await s.page.keyboard.up('KeyX'); await s.adv(0.03);
  await s.freeze(); await s.snap(1); await s.page.close();
  // 2 — Ashen Gate: Tallow by the candle shrine
  s = await open('?room=ashen_gate&x=11&y=14&flags=met_tallow');
  await s.adv(0.8);
  await s.page.evaluate(() => { const g = window.__NP; g.player.face = 1; g.inCutscene = true; g.player.locked = true; g.ui.letterbox(true);
    g.ui.say('tallow', "This is the Underneath. It's where lost things go. It used to be lovely."); });
  await s.adv(3.5); await s.freeze(); await s.snap(2); await s.page.close();
  // 3 — The Hollow Warden
  s = await open('?room=warden_hall&x=12&y=16&abilities=dash&flags=warden_met');
  await s.adv(0.3);
  await s.page.evaluate(() => { const g = window.__NP; g.bossActive = true; const b = g.ents.find((e) => e.name === 'The Hollow Warden'); b.wake(); g.bossBar(b, b.name); g.bossActive = true; });
  await s.adv(1.6);
  await s.page.evaluate(() => { const g = window.__NP, b = g.ents.find((e) => e.name === 'The Hollow Warden'); b.hp = 17; b.set('windRain'); g.player.hp = 3; });
  await s.adv(1.35);
  await s.page.evaluate(() => { const g = window.__NP, b = g.ents.find((e) => e.name === 'The Hollow Warden'); g.player.x = b.x - 60; g.player.face = 1; });
  await s.page.keyboard.down('KeyZ'); await s.adv(0.25); await s.page.keyboard.up('KeyZ');
  await s.page.keyboard.down('KeyX'); await s.adv(0.05); await s.page.keyboard.up('KeyX');
  await s.freeze(); await s.snap(3); await s.page.close();
  // 4 — Storybook prologue
  s = await open('?room=well_bottom&x=3&y=14');
  await s.page.evaluate(() => { window.__NP.ui.storybook([{ image: 'sb_bedroom', lines: ['Mira had a cat called Nightpaw, because he walked around at night, and his paws were the night.'] }]); });
  // tweens run on wall-clock time, so let the page fade in for real
  await s.page.waitForTimeout(5500); await s.snap(4); await s.page.close();
  // 5 — Thorn Gap: the Shadow Dash carries Nightpaw over the thorns
  s = await open('?room=thorn_gap&x=10&y=14&abilities=dash&flags=intro_done');
  await s.adv(0.6);
  await s.page.keyboard.down('ArrowRight'); await s.adv(0.18);
  await s.page.keyboard.down('KeyZ'); await s.adv(0.22); await s.page.keyboard.up('KeyZ');
  await s.page.keyboard.down('KeyC'); await s.adv(0.1);
  await s.freeze(); await s.snap(5); await s.page.close();
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  await capsules(browser);
  if (shotsUrl) await shots(browser);
  await browser.close();
  console.log('→', path.relative(process.cwd(), out));
})();
