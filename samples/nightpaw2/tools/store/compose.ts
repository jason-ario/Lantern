// Store capsule composer (runs in a browser page; see make-store-media.cjs).
// Builds cover / header / hero scenes from the same painted parts and rig definitions the
// game uses, drawn from high-resolution renders of the parts so nothing looks upscaled.
import { nightpawRig, mothRig, sockRig } from '../../src/render/rigs';
import type { PartDef } from '../../src/render/puppet';

type Pose = Record<string, { x?: number; y?: number; rot?: number; sx?: number; sy?: number; alpha?: number }>;
interface Tex { img: HTMLImageElement; w: number; h: number } // w/h = base (game) size in art px
let TEX: Record<string, Tex> = {};

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

function drawNode(c: CanvasRenderingContext2D, d: PartDef, pose: Pose) {
  const p = pose[d.name] ?? {};
  c.save();
  c.translate(d.x + (p.x ?? 0), d.y + (p.y ?? 0));
  c.rotate((d.rot ?? 0) + (p.rot ?? 0));
  c.scale((d.sx ?? 1) * (p.sx ?? 1), (d.sy ?? 1) * (p.sy ?? 1));
  const a = (d.alpha ?? 1) * (p.alpha ?? 1);
  c.globalAlpha *= a;
  for (const k of d.behind ?? []) drawNode(c, k, pose);
  if (d.key && TEX[d.key] && a > 0.001) {
    const t = TEX[d.key];
    const prev = c.globalCompositeOperation;
    if (d.add) c.globalCompositeOperation = 'lighter';
    c.drawImage(t.img, -(d.ox ?? 0.5) * t.w, -(d.oy ?? 0.5) * t.h, t.w, t.h);
    c.globalCompositeOperation = prev;
  }
  for (const k of d.front ?? []) drawNode(c, k, pose);
  c.restore();
}
function rig(c: CanvasRenderingContext2D, def: PartDef, x: number, y: number, scale: number, pose: Pose, face = 1) {
  c.save(); c.translate(x, y); c.scale(scale * face, scale); drawNode(c, def, pose); c.restore();
}

// ---------------------------------------------------------------- scene helpers
function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a)); g.addColorStop(0.35, rgba(color, a * 0.4)); g.addColorStop(1, rgba(color, 0));
  c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.restore();
}
function rgba(hex: string, a: number) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function backdrop(c: CanvasRenderingContext2D, W: number, H: number, o: { shiftX?: number; blur?: number } = {}) {
  c.fillStyle = '#07060b'; c.fillRect(0, 0, W, H);
  const far = TEX.hol_bg_far.img, mid = TEX.hol_bg_mid.img;
  const s = (H * 1.15) / TEX.hol_bg_far.h;
  const fw = TEX.hol_bg_far.w * s;
  c.save();
  c.filter = `blur(${o.blur ?? 2}px)`;
  c.globalAlpha = 0.55;
  for (let x = -(o.shiftX ?? 0) % fw - fw; x < W; x += fw) c.drawImage(far, x, -H * 0.1, fw, TEX.hol_bg_far.h * s);
  c.globalAlpha = 0.5; c.filter = `blur(${(o.blur ?? 2) * 2}px)`;
  const ms = (H * 1.25) / TEX.hol_bg_mid.h, mw = TEX.hol_bg_mid.w * ms;
  for (let x = -((o.shiftX ?? 0) * 1.6) % mw - mw; x < W; x += mw) c.drawImage(mid, x, -H * 0.12, mw, TEX.hol_bg_mid.h * ms);
  c.restore();
  // cool colour grade
  c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = '#6a64a0'; c.fillRect(0, 0, W, H); c.restore();
}
function beam(c: CanvasRenderingContext2D, x: number, w: number, H: number, a = 0.14, lean = 0.35) {
  c.save(); c.globalCompositeOperation = 'lighter';
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, `rgba(200,210,255,${a})`); g.addColorStop(1, 'rgba(200,210,255,0)');
  c.fillStyle = g; c.filter = 'blur(10px)';
  c.beginPath(); c.moveTo(x, -20); c.lineTo(x + w, -20); c.lineTo(x + w + H * lean + w * 1.2, H); c.lineTo(x + H * lean - w * 0.2, H); c.closePath(); c.fill();
  c.restore();
}
function fog(c: CanvasRenderingContext2D, W: number, y: number, h: number, a = 0.5) {
  const img = TEX.fog.img;
  c.save(); c.globalAlpha = a; c.globalCompositeOperation = 'lighter';
  for (let x = -200; x < W; x += h * 4) c.drawImage(img, x, y, h * 4, h);
  c.restore();
}
/** A rock ledge: painted rock fill, darker toward the bottom, grassy lip along the top. */
function ledge(c: CanvasRenderingContext2D, pts: [number, number][], topY: (x: number) => number, x0: number, x1: number, scale: number) {
  const pat = c.createPattern(TEX.hol_rock.img, 'repeat')!;
  pat.setTransform(new DOMMatrix().scale(scale / (TEX.hol_rock.img.width / TEX.hol_rock.w)));
  c.save();
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.closePath();
  c.fillStyle = pat; c.fill();
  c.clip();
  const minY = Math.min(...pts.map((p) => p[1]));
  const g = c.createLinearGradient(0, minY, 0, minY + 260 * scale / 3);
  g.addColorStop(0, 'rgba(4,3,8,0.05)'); g.addColorStop(0.35, 'rgba(4,3,8,0.7)'); g.addColorStop(1, 'rgba(4,3,8,0.97)');
  c.fillStyle = g; c.fillRect(-10, minY - 10, 99999, 99999);
  c.restore();
  // lip
  const lip = TEX.hol_top, lw = lip.w * scale / 4 * 1.0, lh = lip.h * scale / 4;
  for (let x = x0; x < x1; x += lw * 0.92) c.drawImage(lip.img, x, topY(x + lw / 2) - lh * 0.3, lw, lh);
}
function motes(c: CanvasRenderingContext2D, W: number, H: number, n: number, seed: number, color = '#ffcf7a') {
  const r = rng(seed);
  for (let i = 0; i < n; i++) glow(c, r() * W, r() * H, 2 + r() * 6, color, 0.25 + r() * 0.5);
}
function vignette(c: CanvasRenderingContext2D, W: number, H: number, a = 0.7) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}
function grain(c: CanvasRenderingContext2D, W: number, H: number) {
  const r = rng(7);
  for (let i = 0; i < (W * H) / 60; i++) { c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.025 * r()})` : `rgba(0,0,0,${0.05 * r()})`; c.fillRect(r() * W, r() * H, 1.5, 1.5); }
}

// ---------------------------------------------------------------- characters
/** Nightpaw on a windy ledge: cloak and scarf blowing back, tail up, eyes on the dark. */
const HERO_POSE: Pose = {
  body: { rot: -0.03 }, head: { rot: -0.1 }, legNear: { rot: 0.1 }, legFar: { rot: -0.12 },
  cloak: { rot: 0.07, sx: 1.02 }, hem: { rot: 0.14, sx: 1.07 }, lining: { alpha: 0.3, rot: 0.1 },
  tail0: { rot: -0.6 }, tail1: { rot: 0.02 }, tail2: { rot: 0.03 }, tail3: { rot: 0.04 }, tail4: { rot: 0.05 }, tail5: { rot: 0.06 }, tail6: { rot: 0.1 }, tail7: { rot: 0.24 }, tail8: { rot: 0.3 }, tail9: { rot: 0.32 },
  earF: { rot: 0.05 }, earB: { rot: -0.05 },
};
function nightpaw(c: CanvasRenderingContext2D, x: number, y: number, scale: number, face = 1) {
  // soft shadow, then a rim of cool light behind him so the silhouette pops
  c.save(); c.filter = 'blur(10px)'; c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.ellipse(x, y + 2, 34 * scale, 5 * scale, 0, 0, Math.PI * 2); c.fill(); c.restore();
  glow(c, x - 4 * scale * face, y - 58 * scale, 70 * scale, '#9d8cff', 0.18);
  rig(c, nightpawRig(), x, y, scale * 0.78, HERO_POSE, face);
}
function tallow(c: CanvasRenderingContext2D, x: number, y: number, scale: number, face = -1) {
  glow(c, x + 14 * scale * face, y - 20 * scale, 110 * scale, '#ffcf7a', 0.35);
  rig(c, mothRig(), x, y, scale * 0.8, { wingF: { rot: 0.25 }, wingB: { rot: -0.2 }, body: { rot: 0.05 } }, face);
}
function sock(c: CanvasRenderingContext2D, x: number, y: number, scale: number, blur: number, rot = 0) {
  c.save(); c.filter = `blur(${blur}px)`; c.globalAlpha = 0.85;
  glow(c, x, y - 20 * scale, 40 * scale, '#bfeaff', 0.25);
  rig(c, sockRig(), x, y, scale * 0.6, { cuff: { rot }, mid: { rot: rot * 1.6 + 0.2 }, foot: { rot: rot * 2 + 0.3 } }, 1);
  c.restore();
}
function wardenShadow(c: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  // the Warden waiting far off in the dark: antlered mask barely lit, two red eyes
  c.save(); c.filter = 'blur(3px) brightness(0.35)'; c.globalAlpha = 0.9;
  const t = TEX.warden_head; c.drawImage(t.img, x - (t.w * scale) / 2, y - t.h * scale * 0.8, t.w * scale, t.h * scale);
  c.restore();
  for (const dx of [-9, 9]) glow(c, x + dx * scale, y - t.h * scale * 0.8 + 71 * scale, 16 * scale, '#ff3b4f', 0.9);
}
function candles(c: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const cd = TEX.candle, fl = TEX.flame;
  glow(c, x, y - 30 * scale, 140 * scale, '#ffcf7a', 0.4);
  for (const [dx, s] of [[-14, 0.8], [0, 1], [13, 0.65]] as const) {
    const w = cd.w * scale * s, h = cd.h * scale * s;
    c.drawImage(cd.img, x + dx * scale - w / 2, y - h, w, h);
    const fw = fl.w * scale * s, fh = fl.h * scale * s;
    c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(fl.img, x + dx * scale - fw / 2, y - h - fh * 0.62, fw, fh); c.restore();
  }
}
function coins(c: CanvasRenderingContext2D, pts: [number, number, number][]) {
  const t = TEX.button_coin;
  for (const [x, y, s] of pts) { glow(c, x, y, 18 * s, '#ffe0a0', 0.35); c.drawImage(t.img, x - (t.w * s) / 2, y - (t.h * s) / 2, t.w * s, t.h * s); }
}

// ---------------------------------------------------------------- the three capsules
function cover(c: CanvasRenderingContext2D, W: number, H: number) {
  backdrop(c, W, H, { shiftX: 300, blur: 2.5 });
  beam(c, W * 0.34, W * 0.2, H, 0.2, 0.12);
  fog(c, W, H * 0.55, H * 0.2, 0.35);
  wardenShadow(c, W * 0.22, H * 0.56, 0.9);
  sock(c, W * 0.66, H * 0.2, 1.5, 4, 0.3);
  sock(c, W * 0.12, H * 0.28, 1.4, 5, -0.4);
  tallow(c, W * 0.8, H * 0.5, 2.2, -1);
  const top = (x: number) => H * 0.8 + Math.sin(x * 0.012) * 8;
  ledge(c, [[-20, top(-20)], ...Array.from({ length: 13 }, (_, i) => [i * W / 12, top(i * W / 12)] as [number, number]), [W + 20, top(W)], [W + 20, H + 10], [-20, H + 10]], top, -40, W + 40, 3.2);
  nightpaw(c, W * 0.46, top(W * 0.46) + 4, 4.4, 1);
  coins(c, [[W * 0.64, H * 0.77, 2.4], [W * 0.7, H * 0.785, 2]]);
  motes(c, W, H * 0.8, 40, 3);
  fog(c, W, H * 0.78, H * 0.12, 0.25);
  vignette(c, W, H, 0.75); grain(c, W, H);
}
function header(c: CanvasRenderingContext2D, W: number, H: number) {
  backdrop(c, W, H, { shiftX: 120, blur: 2 });
  beam(c, W * 0.12, W * 0.1, H, 0.18, 0.3);
  beam(c, W * 0.66, W * 0.07, H, 0.1, 0.3);
  fog(c, W, H * 0.5, H * 0.3, 0.4);
  wardenShadow(c, W * 0.84, H * 0.62, 0.72);
  sock(c, W * 0.63, H * 0.36, 1.6, 3, 0.2);
  const top = (x: number) => H * 0.86 - Math.max(0, 180 - x) * 0.12;
  ledge(c, [[-20, top(-20)], ...Array.from({ length: 11 }, (_, i) => [i * W / 10, top(i * W / 10)] as [number, number]), [W + 20, top(W)], [W + 20, H + 10], [-20, H + 10]], top, -40, W + 40, 2.2);
  candles(c, W * 0.1, top(W * 0.1) + 3, 2.4);
  nightpaw(c, W * 0.27, top(W * 0.27) + 3, 3.2, 1);
  tallow(c, W * 0.5, H * 0.56, 1.6, -1);
  motes(c, W, H, 28, 11);
  vignette(c, W, H, 0.65); grain(c, W, H);
}
function hero(c: CanvasRenderingContext2D, W: number, H: number) {
  backdrop(c, W, H, { shiftX: 0, blur: 1.5 });
  beam(c, W * 0.1, W * 0.05, H, 0.16, 0.5);
  beam(c, W * 0.42, W * 0.08, H, 0.2, 0.5);
  beam(c, W * 0.86, W * 0.05, H, 0.12, 0.5);
  fog(c, W, H * 0.45, H * 0.35, 0.45);
  wardenShadow(c, W * 0.18, H * 0.66, 0.85);
  sock(c, W * 0.38, H * 0.3, 1.8, 4, 0.3);
  sock(c, W * 0.55, H * 0.18, 1.2, 6, -0.3);
  sock(c, W * 0.93, H * 0.35, 1.5, 3, 0.1);
  // a lower far ledge on the left, the hero's ledge on the right
  const far = (x: number) => H * 0.9 + Math.sin(x * 0.01) * 6;
  ledge(c, [[-20, far(-20)], [W * 0.1, far(W * 0.1)], [W * 0.3, far(W * 0.3)], [W * 0.46, far(W * 0.46)], [W * 0.5, H + 10], [-20, H + 10]], far, -40, W * 0.46, 2.4);
  const top = (x: number) => H * 0.78 + Math.sin(x * 0.02) * 5;
  ledge(c, [[W * 0.56, top(W * 0.56) + 40], [W * 0.6, top(W * 0.6)], [W * 0.8, top(W * 0.8)], [W + 20, top(W)], [W + 20, H + 10], [W * 0.54, H + 10]], top, W * 0.585, W + 40, 2.6);
  candles(c, W * 0.9, top(W * 0.9) + 3, 2.2);
  nightpaw(c, W * 0.7, top(W * 0.7) + 3, 3.3, -1);
  tallow(c, W * 0.6, H * 0.48, 1.6, 1);
  coins(c, [[W * 0.33, far(W * 0.33) - 6, 1.8], [W * 0.36, far(W * 0.36) - 5, 1.5]]);
  motes(c, W, H, 70, 21);
  motes(c, W, H, 20, 5, '#bfeaff');
  vignette(c, W, H, 0.6); grain(c, W, H);
}

(window as any).composeStore = async (assets: Record<string, { data: string; w: number; h: number }>) => {
  TEX = {};
  for (const [k, a] of Object.entries(assets)) TEX[k] = { img: await load(a.data), w: a.w, h: a.h };
  const out: Record<string, string> = {};
  for (const [name, W, H, fn] of [['cover', 600, 900, cover], ['header', 920, 430, header], ['hero', 1920, 620, hero]] as const) {
    // render at 2x for crisp edges, then downsample
    const big = document.createElement('canvas'); big.width = W * 2; big.height = H * 2;
    const bc = big.getContext('2d')!; bc.scale(2, 2); (fn as any)(bc, W, H);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cc = cv.getContext('2d')!; cc.imageSmoothingQuality = 'high'; cc.drawImage(big, 0, 0, W, H);
    out[name] = cv.toDataURL('image/jpeg', 0.9);
    out[name + '_png'] = cv.toDataURL('image/png');
  }
  return out;
};
