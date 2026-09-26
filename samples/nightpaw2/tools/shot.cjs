// Headless screenshot helper for playtesting: node tools/shot.cjs <url-query> <out.png> [ms] [keys...]
// keys: "hold:ArrowRight:800" "press:KeyZ" "wait:500"
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(process.env.HOME || '', '.npm-global/lib/node_modules/playwright'))); }
(async () => {
  const [q, out, ms = '3000', ...keys] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  await page.goto(`http://localhost:8123/index.html${q}`);
  await page.waitForTimeout(Number(ms));
  for (const k of keys) {
    const [kind, a, b] = k.split(':');
    if (kind === 'wait') await page.waitForTimeout(Number(a));
    else if (kind === 'press') { await page.keyboard.press(a); await page.waitForTimeout(Number(b || 120)); }
    else if (kind === 'hold') { await page.keyboard.down(a); await page.waitForTimeout(Number(b)); await page.keyboard.up(a); }
    else if (kind === 'shot') await page.screenshot({ path: a });
    else if (kind === 'eval') console.log('eval:', JSON.stringify(await page.evaluate(decodeURIComponent(a))));
  }
  await page.screenshot({ path: out });
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await browser.close();
})();
