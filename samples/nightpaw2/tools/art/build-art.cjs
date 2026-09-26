// Renders every asset in painter.js to assets/art/<key>.png and writes assets/art/art.json.
// Usage: node tools/art/build-art.cjs [key1,key2,...]
// Needs Playwright + Chromium (npm i -D playwright && npx playwright install chromium).
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(process.env.HOME || '', '.npm-global/lib/node_modules/playwright'))); }

(async () => {
  const root = path.resolve(__dirname, '../..');
  const outDir = path.join(root, 'assets/art');
  fs.mkdirSync(outDir, { recursive: true });
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ path: path.join(__dirname, 'painter.js') });
  const assets = await page.evaluate((o) => window.renderAll(o), only);
  const manifestPath = path.join(outDir, 'art.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  for (const a of assets) {
    fs.writeFileSync(path.join(outDir, `${a.key}.png`), Buffer.from(a.data.split(',')[1], 'base64'));
    manifest[a.key] = { w: a.w, h: a.h };
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`painted ${assets.length} assets → ${path.relative(root, outDir)}`);
  await browser.close();
})();
