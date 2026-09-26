// Generates key art for the seed catalog into public/media/{gameId}/.
// Real gameplay screenshots (shotN.png) for playable games are captured separately
// by scripts/capture-screenshots.mjs and take precedence over generated shots.
import fs from 'node:fs';
import path from 'node:path';
import { art } from '../server/art.js';
import { games } from '../catalog/games.js';

for (const g of games) {
  const dir = path.resolve('public/media', g.id);
  fs.mkdirSync(dir, { recursive: true });
  const opts = { seed: g.id, motif: g.motif, palette: g.palette, cat: !!g.catArt };
  fs.writeFileSync(path.join(dir, 'cover.svg'), art('cover', opts));
  fs.writeFileSync(path.join(dir, 'header.svg'), art('header', opts));
  fs.writeFileSync(path.join(dir, 'hero.svg'), art('hero', opts));
  const shots = g.package ? 0 : 4;
  for (let i = 1; i <= shots; i++) fs.writeFileSync(path.join(dir, `shot${i}.svg`), art('shot', { ...opts, seed: `${g.id}-shot${i}`, hudKind: i % 2 ? g.hud : null }));
}
console.log(`generated art for ${games.length} games`);
