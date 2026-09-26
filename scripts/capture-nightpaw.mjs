// Regenerates Nightpaw 2.0 store media (capsules + gameplay screenshots) → public/media/nightpaw/
//   1. build & serve the game:  cd samples/nightpaw2 && node tools/build.cjs && cd dist && python -m http.server 8123
//   2. node scripts/capture-nightpaw.mjs
// Needs Playwright (npm i -D playwright && npx playwright install chromium) and bun (for the capsule composer).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
execSync('node samples/nightpaw2/tools/store/make-store-media.cjs --shots http://localhost:8123/index.html', { stdio: 'inherit' });
for (const f of ['cover.svg', 'header.svg', 'hero.svg', 'shot1.png', 'shot2.png', 'shot3.png', 'shot4.png', 'shot5.png'])
  fs.copyFileSync(`samples/nightpaw2/store-media/${f}`, `public/media/nightpaw/${f}`);
console.log('Updated public/media/nightpaw/');
