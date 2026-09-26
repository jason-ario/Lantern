// Paints a room's tiles into one texture using the area's tileset PNGs:
// lumpy rock silhouettes filled with a painted rock texture, darker toward the
// inside, with grassy lips, drips, planks, thorns and seeded decoration.
import { ART, T } from '../core/config';
import { seeded } from '../core/util';
import { Room, tileAt, isSolid } from '../world/world';

const TP = T * ART; // tile size in texture px (64)
const MAX_CACHE = 5;
const cacheOrder: string[] = [];

export interface RoomArtResult { key: string; lights: { x: number; y: number; r: number; color: number; a: number }[] }

export function roomTexture(scene: any, r: Room): RoomArtResult {
  const key = `room_${r.id}`;
  const lightsKey = `${key}_lights`;
  if (scene.textures.exists(key)) {
    const i = cacheOrder.indexOf(key); if (i >= 0) cacheOrder.splice(i, 1); cacheOrder.push(key);
    return { key, lights: scene.registry.get(lightsKey) || [] };
  }
  const ts = r.area.tileset;
  const img = (k: string) => (scene.textures.exists(k) ? scene.textures.get(k).getSourceImage() : null);
  const W = r.w * TP, H = r.h * TP;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  const R = seeded(`room-${r.id}`);
  const wt = (lx: number, ly: number) => tileAt(r.x + lx, r.y + ly);
  const solidAt = (lx: number, ly: number) => { const ch = wt(lx, ly); return ch === '#'; };
  const lights: RoomArtResult['lights'] = [];

  // ---- 1. rock silhouette mask ----
  const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
  const m = mask.getContext('2d')!;
  m.fillStyle = '#fff';
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.grid[y][x] !== '#') continue;
    const px = x * TP, py = y * TP;
    const up = solidAt(x, y - 1), dn = solidAt(x, y + 1), lf = solidAt(x - 1, y), rt = solidAt(x + 1, y);
    const inset = 3;
    m.fillRect(px + (lf ? 0 : inset), py + (up ? 0 : inset), TP - (lf ? 0 : inset) - (rt ? 0 : inset), TP - (up ? 0 : inset) - (dn ? 0 : inset));
    // lumps along exposed edges
    const lump = (cx: number, cy: number) => { m.beginPath(); m.arc(cx, cy, 10 + R() * 12, 0, Math.PI * 2); m.fill(); };
    if (!up) for (let i = 0; i < 2; i++) lump(px + 10 + R() * (TP - 20), py + 16 + R() * 6);
    if (!dn) for (let i = 0; i < 2; i++) lump(px + 10 + R() * (TP - 20), py + TP - 18 - R() * 4);
    if (!lf) for (let i = 0; i < 2; i++) lump(px + 16 + R() * 4, py + 10 + R() * (TP - 20));
    if (!rt) for (let i = 0; i < 2; i++) lump(px + TP - 18 - R() * 4, py + 10 + R() * (TP - 20));
  }
  // ---- 2. fill with rock texture ----
  c.drawImage(mask, 0, 0);
  c.globalCompositeOperation = 'source-in';
  const rock = img(`${ts}_rock`);
  if (rock) { c.fillStyle = c.createPattern(rock, 'repeat')!; c.fillRect(0, 0, W, H); } else { c.fillStyle = '#1d1a26'; c.fillRect(0, 0, W, H); }
  // ---- 3. deeper rock gets darker (distance field → blurred overlay) ----
  const dist: number[][] = r.grid.map((row) => row.map((ch) => (ch === '#' ? 99 : 0)));
  for (let pass = 0; pass < 4; pass++) for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (dist[y][x] === 0) continue;
    const nb = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= r.w || yy >= r.h ? (solidAt(xx, yy) ? 99 : 0) : dist[yy][xx]);
    dist[y][x] = Math.min(dist[y][x], nb(x - 1, y) + 1, nb(x + 1, y) + 1, nb(x, y - 1) + 1, nb(x, y + 1) + 1);
  }
  const dark = document.createElement('canvas'); dark.width = W; dark.height = H;
  const d = dark.getContext('2d')!;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const v = dist[y][x]; if (!v) continue;
    d.fillStyle = `rgba(4,3,8,${[0, 0.15, 0.62, 0.86, 0.95][Math.min(4, v)]})`;
    d.fillRect(x * TP - 16, y * TP - 16, TP + 32, TP + 32);
  }
  c.globalCompositeOperation = 'source-atop';
  c.filter = 'blur(18px)'; c.drawImage(dark, 0, 0); c.filter = 'none';
  c.globalCompositeOperation = 'source-over';

  // ---- 4. edges ----
  const top = [img(`${ts}_top`), img(`${ts}_top2`)].filter(Boolean);
  const bottom = img(`${ts}_bottom`), side = img(`${ts}_side`);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.grid[y][x] !== '#') continue;
    const px = x * TP, py = y * TP;
    if (side && !solidAt(x - 1, y)) c.drawImage(side, px + 2, py, 24, TP);
    if (side && !solidAt(x + 1, y)) { c.save(); c.translate(px + TP - 2, py); c.scale(-1, 1); c.drawImage(side, 0, 0, 24, TP); c.restore(); }
    if (bottom && !solidAt(x, y + 1) && wt(x, y + 1) !== 'X') c.drawImage(bottom, px, py + TP - 10);
  }
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.grid[y][x] !== '#') continue;
    if (!solidAt(x, y - 1) && wt(x, y - 1) !== 'X' && top.length) c.drawImage(top[Math.floor(R() * top.length)], x * TP, y * TP - 6);
  }
  // ---- 5. platforms & thorns ----
  const plank = img(`${ts}_plank`), thorns = img(`${ts}_thorns`);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const ch = r.grid[y][x];
    if (ch === '=' && plank) c.drawImage(plank, x * TP, y * TP - 2);
    if (ch === '^' && thorns) { c.save(); if (R() < 0.5) { c.translate(x * TP + TP, 0); c.scale(-1, 1); c.drawImage(thorns, 0, y * TP + TP - 44 + 2); } else c.drawImage(thorns, x * TP, y * TP + TP - 44 + 2); c.restore(); }
  }
  // ---- 6. seeded decoration ----
  const amount = r.decor ?? 1;
  if (amount > 0) {
    const floorDecor = ['deco_mushroom', 'deco_bones', 'deco_teacup', 'deco_key'].map((k) => [k, img(k)] as const).filter(([, i]) => i);
    const roots = img('deco_roots');
    for (let y = 1; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const floor = r.grid[y][x] === '#' && r.grid[y - 1][x] === '.';
      const ceil = r.grid[y - 1][x] === '#' && r.grid[y][x] === '.';
      if (floor && R() < 0.1 * amount && floorDecor.length) {
        const [k, im] = floorDecor[R() < 0.6 ? 0 : Math.floor(R() * floorDecor.length)];
        const dx = x * TP + R() * (TP - im!.width), dy = y * TP - im!.height + 4;
        c.drawImage(im!, dx, dy);
        if (k === 'deco_mushroom') lights.push({ x: (dx + 16) / ART, y: (dy + 14) / ART, r: 30, color: 0xa0e0ff, a: 0.5 });
      }
      if (ceil && roots && R() < 0.14 * amount) { const s = 0.5 + R() * 0.6; c.drawImage(roots, x * TP + R() * 20, y * TP - 6, roots.width * s, roots.height * s); }
    }
  }

  scene.textures.addCanvas(key, cv);
  scene.registry.set(lightsKey, lights);
  cacheOrder.push(key);
  while (cacheOrder.length > MAX_CACHE) {
    const old = cacheOrder.shift()!;
    if (scene.textures.exists(old)) scene.textures.remove(old);
  }
  return { key, lights };
}

export function isSolidTile(ch: string) { return isSolid(ch); }
