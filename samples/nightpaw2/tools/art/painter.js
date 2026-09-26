/* Nightpaw art generator — runs in a browser (headless Chromium via build-art.mjs).
 * Every asset is painted into its own canvas and saved as a PNG in assets/art/.
 * These are stand-in paintings: an artist can replace any PNG with the same
 * name and size (or a new size, updating pivots in src/render/rigs.ts).
 *
 * Style: inky silhouettes, soft rim light from the upper left, glowing accents.
 */
(function () {
  'use strict';
  const S = 4; // pixels per world unit (world tile = 16 units = 64 px)

  // ---------- helpers ----------
  function rng(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function mix(h1, h2, t) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
    const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
    const bl = Math.round(lerp(a & 255, b & 255, t));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }
  function ell(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2); }
  function poly(c, pts, close = true) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (close) c.closePath();
  }
  // smooth closed blob through points (Catmull-Rom → Bezier)
  function blobPath(c, pts) {
    const n = pts.length;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      if (i === 0) c.moveTo(p1[0], p1[1]);
      c.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    c.closePath();
  }
  function glow(c, x, y, r, color, a = 1) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexA(color, a)); g.addColorStop(0.35, hexA(color, a * 0.45)); g.addColorStop(1, hexA(color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  // Painted fill: base colour, soft light/shadow gradient, blurred inner rim light, speckle texture.
  function paint(c, pathFn, o) {
    const { base, light = null, dark = null, rim = null, rimW = 3, lx = -0.6, ly = -0.8, bbox, tex = 0.06, seed = 'p' } = o;
    const [x0, y0, x1, y1] = bbox;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.max(x1 - x0, y1 - y0) * 0.75;
    c.save();
    pathFn(c); c.fillStyle = base; c.fill();
    pathFn(c); c.clip();
    if (light) {
      const g = c.createRadialGradient(cx + lx * R * 0.5, cy + ly * R * 0.5, 0, cx + lx * R * 0.5, cy + ly * R * 0.5, R);
      g.addColorStop(0, hexA(light, 0.55)); g.addColorStop(1, hexA(light, 0));
      c.fillStyle = g; c.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);
    }
    if (dark) {
      const g = c.createLinearGradient(cx + lx * R * 0.4, cy + ly * R * 0.4, cx - lx * R * 0.6, cy - ly * R * 0.6);
      g.addColorStop(0, hexA(dark, 0)); g.addColorStop(1, hexA(dark, 0.7));
      c.fillStyle = g; c.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);
    }
    if (tex > 0) {
      const r = rng(seed);
      const area = (x1 - x0) * (y1 - y0);
      for (let i = 0; i < area / 18; i++) {
        c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${tex * r()})` : `rgba(0,0,0,${tex * 1.6 * r()})`;
        c.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 1 + r() * 2, 1 + r() * 2);
      }
    }
    if (rim) {
      c.filter = `blur(${Math.max(1, rimW * 0.6)}px)`;
      c.translate(-lx * rimW * 0.9, -ly * rimW * 0.9);
      c.lineWidth = rimW * 1.6; c.strokeStyle = hexA(rim, 0.9);
      pathFn(c); c.stroke();
      c.filter = 'none';
      c.translate(lx * rimW * 1.8, ly * rimW * 1.8);
      c.lineWidth = rimW * 3; c.strokeStyle = 'rgba(0,0,0,0.35)';
      pathFn(c); c.stroke();
    }
    c.restore();
  }
  function strokes(c, n, seed, fn) { const r = rng(seed); for (let i = 0; i < n; i++) fn(r, i); }

  const INK = '#0b0a10', FUR = '#17141e', FUR_L = '#3a3450', RIM = '#8d86b8', EYE = '#ffd45a', RED = '#c8283a', RED_D = '#6e0f1e', PALE = '#e9e2ff', BLUE = '#bfeaff', CANDLE = '#ffcf7a';

  const assets = [];
  function A(key, w, h, draw) { assets.push({ key, w: Math.ceil(w), h: Math.ceil(h), draw }); }

  // ====================================================================
  // NIGHTPAW (the cat) — puppet parts. Sizes are in px (4 px / unit).
  // ====================================================================
  function catBody(c, s = 1) {
    const w = 60 * s, h = 40 * s;
    const path = (q) => blobPath(q, [[8 * s, 20 * s], [16 * s, 9 * s], [34 * s, 6 * s], [50 * s, 10 * s], [56 * s, 20 * s], [50 * s, 31 * s], [30 * s, 34 * s], [14 * s, 31 * s]]);
    paint(c, path, { base: FUR, light: FUR_L, dark: INK, rim: RIM, rimW: 3 * s, bbox: [0, 0, w, h], seed: 'catbody' });
    // fur tufts
    c.save(); path(c); c.clip();
    strokes(c, 26, 'tuft', (r) => { c.strokeStyle = `rgba(160,150,210,${0.08 + r() * 0.1})`; c.lineWidth = 1; const x = 12 * s + r() * 38 * s, y = 8 * s + r() * 10 * s; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 4 * s, y - 3 * s); c.stroke(); });
    c.restore();
  }
  A('cat_body', 60, 40, (c) => catBody(c));

  function catHead(c, s = 1, ox = 0, oy = 0) {
    c.save(); c.translate(ox, oy);
    const path = (q) => blobPath(q, [[6 * s, 22 * s], [9 * s, 11 * s], [22 * s, 6 * s], [35 * s, 10 * s], [40 * s, 21 * s], [36 * s, 31 * s], [22 * s, 35 * s], [9 * s, 31 * s]]);
    paint(c, path, { base: FUR, light: FUR_L, dark: INK, rim: RIM, rimW: 3 * s, bbox: [0, 0, 46 * s, 40 * s], seed: 'cathead' });
    // cheek fluff
    c.fillStyle = FUR; poly(c, [[34 * s, 26 * s], [42 * s, 30 * s], [35 * s, 31 * s]]); c.fill();
    poly(c, [[9 * s, 27 * s], [3 * s, 31 * s], [10 * s, 31 * s]]); c.fill();
    // nose/mouth hint
    c.fillStyle = 'rgba(120,90,120,0.6)'; ell(c, 37 * s, 25 * s, 1.4 * s, 1 * s); c.fill();
    // whiskers
    c.strokeStyle = 'rgba(220,215,255,0.35)'; c.lineWidth = Math.max(1, 0.8 * s);
    for (const [a, b] of [[24, 30], [26, 34], [27, 29]]) { c.beginPath(); c.moveTo(36 * s, 27 * s); c.quadraticCurveTo(42 * s, a * s, 46 * s, b * s); c.stroke(); }
    c.restore();
  }
  A('cat_head', 48, 40, (c) => catHead(c));

  function catEar(c, s = 1) {
    const path = (q) => blobPath(q, [[2 * s, 20 * s], [7 * s, 2 * s], [9 * s, 1 * s], [16 * s, 18 * s], [9 * s, 21 * s]]);
    paint(c, path, { base: FUR, light: FUR_L, rim: RIM, rimW: 2 * s, bbox: [0, 0, 18 * s, 22 * s], seed: 'ear', tex: 0.03 });
    c.fillStyle = 'rgba(95,55,80,0.8)'; poly(c, [[6 * s, 17 * s], [8.5 * s, 6 * s], [12 * s, 17 * s]]); c.fill();
  }
  A('cat_ear', 18, 22, (c) => catEar(c));

  function catEye(c, s = 1) {
    const w = 14 * s, h = 12 * s;
    glow(c, w / 2, h / 2, 7 * s, EYE, 0.35);
    c.fillStyle = EYE; ell(c, w / 2, h / 2, 4.2 * s, 4.6 * s); c.fill();
    const g = c.createLinearGradient(0, h / 2 - 5 * s, 0, h / 2 + 5 * s); g.addColorStop(0, 'rgba(255,255,220,0.9)'); g.addColorStop(1, 'rgba(200,120,0,0.5)');
    c.fillStyle = g; ell(c, w / 2, h / 2, 4.2 * s, 4.6 * s); c.fill();
    c.fillStyle = INK; ell(c, w / 2 + 0.6 * s, h / 2, 1.2 * s, 3.6 * s); c.fill();
    c.fillStyle = '#fff'; ell(c, w / 2 - 1.5 * s, h / 2 - 1.8 * s, 1 * s, 1 * s); c.fill();
  }
  A('cat_eye', 14, 12, (c) => catEye(c));

  A('cat_leg', 12, 26, (c) => {
    const path = (q) => blobPath(q, [[3, 2], [9, 2], [9.5, 14], [10.5, 22], [6, 24.5], [1.5, 22], [2.5, 14]]);
    paint(c, path, { base: FUR, light: FUR_L, dark: INK, rim: RIM, rimW: 2, bbox: [0, 0, 12, 26], seed: 'leg', tex: 0.03 });
  });
  A('cat_leg_back', 12, 26, (c) => {
    const path = (q) => blobPath(q, [[3, 2], [9, 2], [9.5, 14], [10.5, 22], [6, 24.5], [1.5, 22], [2.5, 14]]);
    paint(c, path, { base: '#0f0d15', light: '#231f30', rim: '#4a4466', rimW: 2, bbox: [0, 0, 12, 26], seed: 'legb', tex: 0.02 });
  });
  A('cat_tail', 16, 16, (c) => {
    const path = (q) => ell(q, 8, 8, 6.5, 6.5);
    paint(c, path, { base: FUR, light: FUR_L, rim: RIM, rimW: 2, bbox: [0, 0, 16, 16], seed: 'tail', tex: 0.02 });
  });
  A('cat_bow', 22, 18, (c) => {
    const L = (q) => blobPath(q, [[11, 9], [3, 3], [1, 9], [3, 15]]);
    const Rr = (q) => blobPath(q, [[11, 9], [19, 3], [21, 9], [19, 15]]);
    paint(c, L, { base: RED, light: '#ff6d7a', dark: RED_D, rim: '#ff9aa4', rimW: 1.5, bbox: [0, 0, 12, 18], seed: 'bowl', tex: 0.03 });
    paint(c, Rr, { base: RED, light: '#ff6d7a', dark: RED_D, rim: '#ff9aa4', rimW: 1.5, bbox: [10, 0, 22, 18], seed: 'bowr', tex: 0.03 });
    c.fillStyle = '#9e1a2c'; ell(c, 11, 9, 3, 3.4); c.fill();
  });
  A('cat_ribbon', 8, 22, (c) => {
    const path = (q) => blobPath(q, [[2, 1], [6, 1], [6.5, 12], [7, 21], [4.5, 18], [1.5, 21], [1.5, 12]]);
    paint(c, path, { base: RED, light: '#ff6d7a', dark: RED_D, bbox: [0, 0, 8, 22], seed: 'rib', tex: 0.03 });
  });
  A('needle', 60, 10, (c) => {
    const g = c.createLinearGradient(0, 3, 0, 8); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#b9b6cc'); g.addColorStop(1, '#5d5970');
    c.fillStyle = g; poly(c, [[2, 5], [8, 3], [56, 4.2], [59.5, 5], [56, 5.8], [8, 7]]); c.fill();
    c.clearRect(9, 4.4, 5, 1.2);
    c.strokeStyle = RED; c.lineWidth = 1.2; c.beginPath(); c.moveTo(11, 5); c.bezierCurveTo(6, 1, 3, 9, 0, 6); c.stroke();
  });
  A('fx_slash', 128, 96, (c) => {
    c.save();
    c.translate(20, 48);
    for (let i = 0; i < 6; i++) {
      c.beginPath(); c.arc(0, 0, 92 - i * 5, -1.05, 1.05); c.arc(0, 8, 62 - i * 2, 1.0, -1.0, true); c.closePath();
      c.fillStyle = `rgba(235,230,255,${0.07 + i * 0.05})`; c.fill();
    }
    c.filter = 'blur(2px)';
    c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 88, -0.9, 0.9); c.stroke();
    c.restore();
  });
  A('fx_glow', 64, 64, (c) => glow(c, 32, 32, 32, '#ffffff', 1));
  A('fx_light', 256, 256, (c) => { const g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 256, 256); });
  A('fx_dot', 16, 16, (c) => { glow(c, 8, 8, 8, '#ffffff', 1); });
  A('fx_dust', 16, 16, (c) => { c.fillStyle = 'rgba(255,255,255,0.9)'; blobPath(c, [[3, 8], [7, 3], [13, 6], [12, 12], [6, 13]]); c.fill(); });
  A('fx_shadow', 48, 16, (c) => { const g = c.createRadialGradient(24, 8, 0, 24, 8, 24); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.save(); c.scale(1, 0.33); c.fillStyle = g; c.fillRect(0, 0, 48, 48); c.restore(); });

  // ====================================================================
  // NIGHTPAW, GAMEPLAY RIG — big head, scarf over the muzzle, bell cloak
  // covering the whole body, thin legs, tail up. (The four-legged cat above
  // is kept for storybook art.)
  // ====================================================================
  const SCARF = '#b3142c', SCARF_L = '#ff5a68', SCARF_D = '#4a0612', LINING = '#1c0409';
  A('np_head', 56, 46, (c) => {
    const path = (q) => blobPath(q, [[4, 24], [8, 11], [20, 4], [36, 4], [48, 11], [52, 24], [47, 36], [28, 42], [9, 36]]);
    paint(c, path, { base: FUR, light: FUR_L, dark: INK, rim: RIM, rimW: 2.5, bbox: [0, 0, 56, 46], seed: 'nph', tex: 0.04 });
    // cheek fluff poking out at the sides
    c.fillStyle = FUR; poly(c, [[6, 30], [0, 34], [8, 36]]); c.fill(); poly(c, [[49, 30], [56, 33], [48, 36]]); c.fill();
  });
  A('np_ear', 18, 28, (c) => {
    const path = (q) => blobPath(q, [[2, 27], [5, 9], [9, 0.5], [14, 10], [16, 27], [9, 25]]);
    paint(c, path, { base: FUR, light: FUR_L, rim: RIM, rimW: 1.8, bbox: [0, 0, 18, 28], seed: 'npe', tex: 0.02 });
    c.fillStyle = 'rgba(90,45,75,0.8)'; poly(c, [[6, 24], [9, 8], [12, 24]]); c.fill();
  });
  A('np_eye', 18, 14, (c) => {
    // wide almond, narrow slit pupil, a shadowed upper lid for a sly look
    glow(c, 9, 7, 9, EYE, 0.5);
    c.save(); c.beginPath(); c.moveTo(1, 7.5); c.quadraticCurveTo(9, -0.5, 17, 6); c.quadraticCurveTo(9, 15, 1, 7.5); c.closePath(); c.clip();
    const g = c.createLinearGradient(0, 1, 0, 13); g.addColorStop(0, '#fff7c8'); g.addColorStop(0.55, EYE); g.addColorStop(1, '#b86a00');
    c.fillStyle = g; c.fillRect(0, 0, 18, 14);
    c.fillStyle = 'rgba(20,10,20,0.55)'; c.fillRect(0, 0, 18, 4.2);
    c.fillStyle = INK; ell(c, 9.6, 7.4, 1.2, 4.6); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.9)'; ell(c, 6.2, 6, 1, 1); c.fill();
    c.restore();
  });
  A('np_mask', 64, 26, (c) => {
    // whiskers first, so the scarf sits on top of their roots
    c.strokeStyle = 'rgba(235,230,255,0.75)'; c.lineWidth = 1.1; c.lineCap = 'round';
    for (const [y1, y2] of [[9, 5], [12, 12], [15, 18]]) {
      c.beginPath(); c.moveTo(14, y1 + 2); c.quadraticCurveTo(6, y1, 1, y2); c.stroke();
      c.beginPath(); c.moveTo(50, y1 + 2); c.quadraticCurveTo(58, y1, 63, y2); c.stroke();
    }
    const path = (q) => blobPath(q, [[10, 6], [24, 3], [40, 3], [54, 6], [55, 19], [40, 23], [24, 23], [9, 19]]);
    paint(c, path, { base: SCARF, light: SCARF_L, dark: SCARF_D, rim: '#ff9aa4', rimW: 1.5, bbox: [8, 2, 56, 24], seed: 'mask2', tex: 0.05 });
    c.save(); path(c); c.clip();
    c.strokeStyle = 'rgba(60,0,12,0.5)'; c.lineWidth = 1.3;
    for (let x = 16; x < 52; x += 7) { c.beginPath(); c.moveTo(x, 3); c.quadraticCurveTo(x + 3, 13, x - 1, 23); c.stroke(); }
    c.restore();
  });
  function cloakPath(q, w, h, hem) {
    const pts = [[w * 0.3, 1], [w * 0.7, 1], [w * 0.86, h * 0.45], [w * 0.97, h - (hem ? 6 : 2)]];
    if (hem) pts.push([w * 0.84, h - 1], [w * 0.72, h - 8], [w * 0.6, h], [w * 0.46, h - 6], [w * 0.33, h - 0.5], [w * 0.2, h - 7], [w * 0.06, h - 1]);
    else pts.push([w * 0.5, h]);
    pts.push([w * 0.03, h - (hem ? 6 : 2)], [w * 0.14, h * 0.45]);
    blobPath(q, pts);
  }
  A('np_cloak', 60, 44, (c) => {
    const path = (q) => cloakPath(q, 60, 44, false);
    paint(c, path, { base: SCARF, light: SCARF_L, dark: SCARF_D, rim: '#ff8a96', rimW: 2, bbox: [0, 0, 60, 44], seed: 'cloak2', tex: 0.06 });
    c.save(); path(c); c.clip();
    c.strokeStyle = 'rgba(40,0,8,0.5)'; c.lineWidth = 2.2;
    for (const f of [0.34, 0.5, 0.66]) { c.beginPath(); c.moveTo(60 * f, 2); c.bezierCurveTo(60 * (f + (f - 0.5) * 0.4), 18, 60 * (f + (f - 0.5) * 0.7), 30, 60 * (f + (f - 0.5) * 0.9), 44); c.stroke(); }
    // the front opening, where a paw peeks out
    c.fillStyle = 'rgba(20,2,6,0.85)'; blobPath(c, [[37, 16], [40, 17], [42, 44], [35, 44]]); c.fill();
    c.restore();
  });
  A('np_hem', 70, 24, (c) => {
    const path = (q) => cloakPath(q, 70, 24, true);
    paint(c, path, { base: '#9e1027', light: SCARF_L, dark: SCARF_D, rim: '#ff8a96', rimW: 1.6, bbox: [0, 0, 70, 24], seed: 'hem', tex: 0.06 });
    c.save(); path(c); c.clip();
    c.strokeStyle = 'rgba(40,0,8,0.45)'; c.lineWidth = 2;
    for (const f of [0.25, 0.42, 0.58, 0.75]) { c.beginPath(); c.moveTo(70 * f, 0); c.lineTo(70 * (f + (f - 0.5) * 0.3), 24); c.stroke(); }
    c.fillStyle = 'rgba(20,2,6,0.85)'; blobPath(c, [[42, 0], [47, 0], [49, 18], [42, 20]]); c.fill();
    c.restore();
  });
  A('np_lining', 64, 60, (c) => {
    paint(c, (q) => cloakPath(q, 64, 60, true), { base: LINING, light: '#4a0c18', dark: '#050102', bbox: [0, 0, 64, 60], seed: 'lin2', tex: 0.03 });
  });
  A('np_leg', 10, 22, (c) => {
    const path = (q) => blobPath(q, [[3, 1], [7, 1], [7.4, 14], [8.6, 19], [5, 21.5], [1.5, 19.5], [2.6, 14]]);
    paint(c, path, { base: FUR, light: FUR_L, dark: INK, rim: RIM, rimW: 1.4, bbox: [0, 0, 10, 22], seed: 'npl', tex: 0.02 });
  });
  A('np_arm', 12, 26, (c) => {
    // a paw that slips out of the cloak for scratching
    const path = (q) => blobPath(q, [[3.5, 1], [8.5, 1], [9, 16], [10.5, 22], [6, 25], [1.5, 22], [3, 16]]);
    paint(c, path, { base: FUR, light: FUR_L, dark: INK, rim: RIM, rimW: 1.4, bbox: [0, 0, 12, 26], seed: 'npa', tex: 0.02 });
  });
  A('np_tail', 20, 14, (c) => {
    // soft capsule segment with a rim-lit edge: overlapping copies read as one smooth tail
    c.fillStyle = FUR; ell(c, 10, 7, 9.5, 5.5); c.fill();
    c.save(); ell(c, 10, 7, 9.5, 5.5); c.clip();
    c.filter = 'blur(0.8px)'; c.strokeStyle = 'rgba(160,152,210,0.95)'; c.lineWidth = 2.4;
    c.beginPath(); c.moveTo(0, 2.6); c.lineTo(20, 2.6); c.stroke();
    c.restore();
  });
  A('np_claws', 14, 10, (c) => {
    c.strokeStyle = '#f4f0ff'; c.lineWidth = 1.4; c.lineCap = 'round';
    for (const x of [3, 7, 11]) { c.beginPath(); c.moveTo(x, 1); c.quadraticCurveTo(x + 1.5, 5, x - 0.5, 9); c.stroke(); }
  });
  A('fx_claw', 128, 96, (c) => {
    // three bright claw streaks
    c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const y = 26 + i * 20;
      c.save(); c.filter = 'blur(3px)'; c.strokeStyle = 'rgba(255,120,140,0.55)'; c.lineWidth = 10;
      c.beginPath(); c.moveTo(12, y - 14); c.quadraticCurveTo(64, y + 16, 118, y - 6); c.stroke(); c.restore();
      const g = c.createLinearGradient(12, 0, 118, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,220,230,0)');
      c.strokeStyle = g; c.lineWidth = 4;
      c.beginPath(); c.moveTo(12, y - 14); c.quadraticCurveTo(64, y + 16, 118, y - 6); c.stroke();
    }
  });

  // ====================================================================
  // ENEMIES
  // ====================================================================
  // Thimble Mite: a lost thimble with legs.
  A('mite_shell', 64, 48, (c) => {
    const path = (q) => blobPath(q, [[8, 44], [10, 16], [20, 5], [44, 5], [54, 16], [56, 44]]);
    paint(c, path, { base: '#6e6a7c', light: '#d8d4ea', dark: '#1a1822', rim: '#ffffff', rimW: 2, bbox: [6, 3, 58, 46], seed: 'thimble', tex: 0.05 });
    c.save(); path(c); c.clip();
    for (let y = 12; y < 42; y += 5) for (let x = 12 + (y % 10 ? 2.5 : 0); x < 54; x += 5) { c.fillStyle = 'rgba(20,18,30,0.45)'; ell(c, x, y, 1.3, 1.3); c.fill(); c.fillStyle = 'rgba(255,255,255,0.12)'; ell(c, x - 0.6, y - 0.6, 0.7, 0.7); c.fill(); }
    c.restore();
    c.fillStyle = '#3c3848'; c.fillRect(6, 40, 52, 6);
    c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(8, 40, 48, 1.5);
  });
  A('mite_face', 40, 20, (c) => {
    c.fillStyle = INK; ell(c, 20, 12, 18, 8); c.fill();
    glow(c, 13, 11, 7, '#ff9a4a', 0.6); glow(c, 27, 11, 7, '#ff9a4a', 0.6);
    c.fillStyle = '#ffc07a'; ell(c, 13, 11, 2.4, 2.4); c.fill(); ell(c, 27, 11, 2.4, 2.4); c.fill();
  });
  A('mite_leg', 6, 18, (c) => { c.strokeStyle = '#0d0b12'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(3, 2); c.quadraticCurveTo(5, 10, 2, 16); c.stroke(); });

  // Sock Wisp: a drifting lost sock, hollow-eyed.
  function sockSeg(c, key, w, h, top) {
    const path = (q) => blobPath(q, [[3, 2], [w - 3, 2], [w - 2, h - 2], [3, h - 2]]);
    paint(c, path, { base: '#b9a7a0', light: '#fff3ea', dark: '#4a3a44', rim: '#ffffff', rimW: 1.5, bbox: [0, 0, w, h], seed: key, tex: 0.05 });
    c.save(); path(c); c.clip();
    c.fillStyle = 'rgba(170,40,60,0.55)';
    for (let y = top ? 4 : 8; y < h; y += 12) c.fillRect(0, y, w, 4);
    c.restore();
  }
  A('sock_cuff', 36, 20, (c) => { sockSeg(c, 'cuff', 36, 20, true); c.strokeStyle = 'rgba(60,40,50,0.5)'; for (let x = 6; x < 32; x += 4) { c.beginPath(); c.moveTo(x, 3); c.lineTo(x, 17); c.stroke(); } });
  A('sock_mid', 32, 24, (c) => sockSeg(c, 'mid', 32, 24, false));
  A('sock_foot', 40, 26, (c) => {
    const path = (q) => blobPath(q, [[3, 3], [26, 3], [38, 12], [34, 23], [4, 22]]);
    paint(c, path, { base: '#b9a7a0', light: '#fff3ea', dark: '#4a3a44', rim: '#ffffff', rimW: 1.5, bbox: [0, 0, 40, 26], seed: 'foot', tex: 0.05 });
    c.fillStyle = 'rgba(80,60,70,0.5)'; ell(c, 30, 13, 5, 6); c.fill(); // darned heel patch
    c.strokeStyle = 'rgba(40,30,40,0.7)'; c.lineWidth = 1; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(26 + i * 2.5, 8); c.lineTo(28 + i * 2.5, 18); c.stroke(); }
  });
  A('sock_eyes', 28, 14, (c) => {
    for (const x of [8, 20]) { c.fillStyle = '#07060a'; ell(c, x, 7, 4, 5); c.fill(); glow(c, x, 7, 6, BLUE, 0.7); c.fillStyle = '#dff6ff'; ell(c, x, 7.5, 1.4, 1.8); c.fill(); }
  });

  // Button Snail
  A('snail_shell', 56, 56, (c) => {
    const path = (q) => ell(q, 28, 28, 25, 25);
    paint(c, path, { base: '#7b4b3a', light: '#e6a37c', dark: '#2a1410', rim: '#ffd8b8', rimW: 2.5, bbox: [3, 3, 53, 53], seed: 'button', tex: 0.05 });
    c.strokeStyle = 'rgba(40,18,12,0.7)'; c.lineWidth = 2.5; ell(c, 28, 28, 18, 18); c.stroke();
    c.strokeStyle = 'rgba(255,200,170,0.25)'; c.lineWidth = 1; ell(c, 28, 27, 18, 18); c.stroke();
    for (const [x, y] of [[22, 22], [34, 22], [22, 34], [34, 34]]) { c.fillStyle = '#1a0c08'; ell(c, x, y, 3.2, 3.2); c.fill(); c.fillStyle = 'rgba(255,200,170,0.3)'; ell(c, x - 0.6, y + 1, 2, 1); c.fill(); }
  });
  A('snail_body', 64, 28, (c) => {
    const path = (q) => blobPath(q, [[2, 24], [10, 12], [40, 10], [56, 6], [62, 14], [58, 24]]);
    paint(c, path, { base: '#3d3645', light: '#8f86a8', dark: INK, rim: '#c8c0e6', rimW: 2, bbox: [0, 4, 64, 26], seed: 'slug', tex: 0.04 });
    c.fillStyle = 'rgba(191,234,255,0.25)'; c.fillRect(4, 23, 54, 2);
  });
  A('snail_stalk', 8, 22, (c) => {
    c.strokeStyle = '#3d3645'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(4, 21); c.quadraticCurveTo(2, 12, 4, 5); c.stroke();
    glow(c, 4, 4, 4, '#ffb070', 0.8); c.fillStyle = '#ffd3a0'; ell(c, 4, 4, 1.8, 1.8); c.fill();
  });
  A('proj_button', 20, 20, (c) => {
    glow(c, 10, 10, 10, '#ffb070', 0.45);
    const path = (q) => ell(q, 10, 10, 6, 6);
    paint(c, path, { base: '#c46a4a', light: '#ffd0a8', rim: '#ffe6d0', rimW: 1, bbox: [4, 4, 16, 16], seed: 'pb', tex: 0.02 });
    c.fillStyle = '#2a1410'; for (const [x, y] of [[8.5, 8.5], [11.5, 8.5], [8.5, 11.5], [11.5, 11.5]]) { ell(c, x, y, 0.9, 0.9); c.fill(); }
  });

  // Marble Toad
  A('toad_body', 64, 48, (c) => {
    const path = (q) => blobPath(q, [[4, 40], [8, 20], [24, 8], [44, 9], [58, 22], [60, 40], [32, 46]]);
    paint(c, path, { base: '#2c3a36', light: '#7fa08e', dark: '#07100d', rim: '#bfe6d4', rimW: 2.5, bbox: [2, 6, 62, 46], seed: 'toad', tex: 0.08 });
    strokes(c, 16, 'wart', (r) => { c.fillStyle = 'rgba(160,200,180,0.18)'; ell(c, 12 + r() * 40, 14 + r() * 24, 1.5 + r() * 2, 1.5 + r() * 2); c.fill(); });
    c.fillStyle = 'rgba(210,190,150,0.25)'; blobPath(c, [[20, 40], [36, 34], [54, 38], [40, 45]]); c.fill();
  });
  A('toad_eye', 22, 22, (c) => {
    glow(c, 11, 11, 11, '#7fe3ff', 0.4);
    const g = c.createRadialGradient(8, 8, 1, 11, 11, 8); g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, '#7fe3ff'); g.addColorStop(0.7, '#2a6ab0'); g.addColorStop(1, '#0a1a30');
    c.fillStyle = g; ell(c, 11, 11, 7.5, 7.5); c.fill();
    c.strokeStyle = 'rgba(255,120,80,0.8)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(6, 13); c.bezierCurveTo(9, 7, 13, 15, 16, 9); c.stroke();
  });
  A('toad_leg', 26, 18, (c) => {
    const path = (q) => blobPath(q, [[2, 4], [14, 2], [22, 10], [25, 16], [8, 16], [3, 10]]);
    paint(c, path, { base: '#223029', light: '#5f806e', rim: '#a8d8c0', rimW: 1.5, bbox: [0, 0, 26, 18], seed: 'tleg', tex: 0.05 });
  });

  // The Hollow Warden: an antlered coat-stand in a moth-eaten coat.
  A('warden_coat', 160, 170, (c) => {
    const pts = [[48, 10], [112, 10], [128, 60], [140, 130], [148, 166], [132, 158], [120, 168], [104, 156], [88, 168], [74, 156], [58, 168], [44, 156], [28, 166], [16, 160], [26, 120], [34, 60]];
    const path = (q) => blobPath(q, pts);
    paint(c, path, { base: '#1c1622', light: '#4a3c56', dark: '#050407', rim: '#b8a2c8', rimW: 4, bbox: [10, 6, 150, 168], seed: 'coat', tex: 0.06 });
    c.save(); path(c); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 3;
    for (const x of [60, 80, 100]) { c.beginPath(); c.moveTo(x, 20); c.quadraticCurveTo(x + 6, 90, x - 4 + (x - 80) * 0.3, 165); c.stroke(); }
    // moth holes
    strokes(c, 14, 'holes', (r) => { const x = 30 + r() * 100, y = 40 + r() * 110; c.fillStyle = '#050407'; blobPath(c, [[x, y], [x + 4 + r() * 4, y + 1], [x + 5, y + 5 + r() * 3], [x, y + 4]]); c.fill(); c.fillStyle = 'rgba(255,60,80,0.35)'; ell(c, x + 2.5, y + 2.5, 1.2, 1.2); c.fill(); });
    // buttons down the front
    for (let y = 36; y < 130; y += 22) { c.fillStyle = '#6b5a3a'; ell(c, 80, y, 4, 4); c.fill(); c.fillStyle = 'rgba(255,230,180,0.4)'; ell(c, 79, y - 1, 1.5, 1.5); c.fill(); }
    c.restore();
    // collar
    paint(c, (q) => blobPath(q, [[40, 20], [80, 4], [120, 20], [104, 34], [80, 22], [56, 34]]), { base: '#2a2030', light: '#6a5878', rim: '#d0bce0', rimW: 2.5, bbox: [40, 2, 120, 36], seed: 'collar' });
  });
  A('warden_head', 120, 120, (c) => {
    // antlers
    c.save();
    c.strokeStyle = '#d9d2e6'; c.lineCap = 'round';
    const antler = (dir) => {
      c.lineWidth = 7; c.beginPath(); c.moveTo(60 + dir * 12, 70); c.bezierCurveTo(60 + dir * 26, 50, 60 + dir * 40, 34, 60 + dir * 38, 6); c.stroke();
      c.lineWidth = 5; c.beginPath(); c.moveTo(60 + dir * 30, 44); c.quadraticCurveTo(60 + dir * 52, 36, 60 + dir * 56, 20); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.moveTo(60 + dir * 36, 26); c.quadraticCurveTo(60 + dir * 26, 16, 60 + dir * 24, 6); c.stroke();
    };
    antler(-1); antler(1);
    c.restore();
    // skull-ish mask
    const path = (q) => blobPath(q, [[38, 70], [44, 54], [60, 48], [76, 54], [82, 70], [74, 96], [60, 110], [46, 96]]);
    paint(c, path, { base: '#e8e2f0', light: '#ffffff', dark: '#7a7090', rim: '#ffffff', rimW: 2, bbox: [36, 46, 84, 112], seed: 'mask', tex: 0.05 });
    // eye holes
    for (const x of [51, 69]) { c.fillStyle = '#0a0610'; blobPath(c, [[x - 6, 70], [x, 64], [x + 6, 70], [x, 78]]); c.fill(); }
    c.strokeStyle = 'rgba(80,60,90,0.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(60, 84); c.lineTo(58, 98); c.lineTo(61, 104); c.stroke();
  });
  A('warden_eye', 24, 24, (c) => { glow(c, 12, 12, 12, '#ff3b4f', 0.9); c.fillStyle = '#ffd0d6'; ell(c, 12, 12, 2.5, 2.5); c.fill(); });
  A('warden_arm', 40, 110, (c) => {
    const path = (q) => blobPath(q, [[8, 4], [30, 4], [32, 60], [36, 96], [22, 106], [8, 98], [10, 60]]);
    paint(c, path, { base: '#1c1622', light: '#4a3c56', dark: '#050407', rim: '#b8a2c8', rimW: 3, bbox: [4, 2, 38, 108], seed: 'arm', tex: 0.05 });
    // pale bony fingers
    c.strokeStyle = '#d9d2e6'; c.lineWidth = 3; c.lineCap = 'round';
    for (const [x, dx] of [[16, -6], [22, 0], [28, 5]]) { c.beginPath(); c.moveTo(x, 100); c.quadraticCurveTo(x + dx, 106, x + dx * 1.3, 109); c.stroke(); }
  });
  A('fx_wave', 64, 48, (c) => {
    const g = c.createLinearGradient(0, 48, 0, 0); g.addColorStop(0, 'rgba(255,90,110,0.9)'); g.addColorStop(1, 'rgba(255,90,110,0)');
    c.fillStyle = g; blobPath(c, [[4, 46], [20, 10], [32, 2], [44, 12], [60, 46]]); c.fill();
    glow(c, 32, 40, 24, '#ff5a6e', 0.5);
  });

  // ====================================================================
  // NPCs
  // ====================================================================
  function mothBody(c, s = 1) {
    const path = (q) => blobPath(q, [[14 * s, 10 * s], [22 * s, 6 * s], [28 * s, 14 * s], [27 * s, 40 * s], [20 * s, 52 * s], [13 * s, 42 * s], [11 * s, 22 * s]]);
    paint(c, path, { base: '#cfc3ad', light: '#fffaf0', dark: '#6a5e50', rim: '#ffffff', rimW: 2 * s, bbox: [8 * s, 4 * s, 30 * s, 54 * s], seed: 'moth', tex: 0.1 });
    c.save(); path(c); c.clip();
    c.strokeStyle = 'rgba(110,95,80,0.45)'; c.lineWidth = 1.5 * s;
    for (let y = 20; y < 52; y += 6) { c.beginPath(); c.moveTo(10 * s, y * s); c.quadraticCurveTo(19 * s, (y + 3) * s, 30 * s, y * s); c.stroke(); }
    c.restore();
    // fluffy collar
    c.fillStyle = '#fff6e6';
    strokes(c, 14, 'fluff', (r) => { ell(c, (12 + r() * 16) * s, (14 + r() * 5) * s, 2.5 * s, 2 * s); c.fill(); });
    // eyes: big dark, glossy
    c.fillStyle = '#16121c'; ell(c, 24 * s, 10 * s, 4.5 * s, 5 * s); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.8)'; ell(c, 22.5 * s, 8.3 * s, 1.3 * s, 1.3 * s); c.fill();
  }
  A('moth_body', 36, 56, (c) => mothBody(c));
  A('moth_wing', 64, 56, (c) => {
    const path = (q) => blobPath(q, [[4, 50], [8, 20], [26, 4], [54, 6], [62, 22], [48, 40], [20, 54]]);
    paint(c, path, { base: '#d9d0c2', light: '#ffffff', dark: '#8a7e70', rim: '#ffffff', rimW: 2, bbox: [2, 2, 62, 56], seed: 'wing', tex: 0.12 });
    c.save(); path(c); c.clip();
    c.strokeStyle = 'rgba(120,100,90,0.35)'; c.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(6, 48); c.quadraticCurveTo(20 + i * 6, 30 - i * 3, 30 + i * 6, 6 + i * 3); c.stroke(); }
    // eye-spot
    c.fillStyle = 'rgba(90,70,60,0.7)'; ell(c, 36, 22, 8, 8); c.fill();
    c.fillStyle = 'rgba(255,207,122,0.8)'; ell(c, 36, 22, 5, 5); c.fill();
    c.fillStyle = 'rgba(30,20,20,0.9)'; ell(c, 36, 22, 2.5, 2.5); c.fill();
    c.restore();
  });
  A('moth_antenna', 22, 26, (c) => {
    c.strokeStyle = '#8a7e70'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(2, 24); c.quadraticCurveTo(6, 8, 18, 3); c.stroke();
    c.strokeStyle = 'rgba(138,126,112,0.7)'; c.lineWidth = 1;
    for (let t = 0.2; t < 1; t += 0.1) { const x = lerp(2, 18, t), y = lerp(24, 3, t) - Math.sin(t * 3) * 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3, y + 2.5); c.stroke(); c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y - 2.5); c.stroke(); }
  });
  A('candle', 16, 34, (c) => {
    paint(c, (q) => blobPath(q, [[4, 10], [12, 10], [12.5, 30], [3.5, 30]]), { base: '#e8dcc0', light: '#ffffff', dark: '#8a7a60', bbox: [3, 9, 13, 31], seed: 'wax', tex: 0.04 });
    c.fillStyle = '#e8dcc0'; blobPath(c, [[11, 11], [13, 16], [12, 19], [11, 14]]); c.fill();
    c.strokeStyle = '#2a2020'; c.lineWidth = 1; c.beginPath(); c.moveTo(8, 10); c.lineTo(8, 7); c.stroke();
    c.fillStyle = '#5a4a3a'; c.fillRect(1, 30, 14, 4);
  });
  A('flame', 16, 24, (c) => {
    glow(c, 8, 14, 9, CANDLE, 0.7);
    c.fillStyle = '#ffe6a8'; blobPath(c, [[8, 2], [11, 12], [10, 18], [6, 18], [5, 12]]); c.fill();
    c.fillStyle = '#ffffff'; ell(c, 8, 15, 1.5, 2.5); c.fill();
  });

  // Nib the mouse
  A('mouse_body', 48, 40, (c) => {
    const path = (q) => blobPath(q, [[6, 30], [10, 14], [24, 6], [40, 12], [44, 28], [34, 38], [14, 38]]);
    paint(c, path, { base: '#6b5e5a', light: '#c8b8b0', dark: '#231c1c', rim: '#f0e0d8', rimW: 2, bbox: [4, 4, 46, 40], seed: 'mouse', tex: 0.08 });
    // patched waistcoat
    c.save(); path(c); c.clip(); c.fillStyle = 'rgba(60,90,110,0.7)'; c.fillRect(20, 14, 20, 26); c.fillStyle = 'rgba(200,160,80,0.9)'; ell(c, 30, 22, 1.5, 1.5); c.fill(); ell(c, 30, 30, 1.5, 1.5); c.fill(); c.restore();
  });
  A('mouse_head', 40, 36, (c) => {
    const path = (q) => blobPath(q, [[4, 20], [10, 10], [22, 8], [36, 20], [38, 24], [22, 30], [8, 28]]);
    paint(c, path, { base: '#6b5e5a', light: '#c8b8b0', dark: '#231c1c', rim: '#f0e0d8', rimW: 2, bbox: [2, 6, 40, 32], seed: 'mhead', tex: 0.06 });
    c.fillStyle = '#e8a0a8'; ell(c, 37, 22, 2.2, 2); c.fill();
    c.fillStyle = '#100c10'; ell(c, 25, 16, 2.4, 2.8); c.fill(); c.fillStyle = '#fff'; ell(c, 24.2, 15, 0.8, 0.8); c.fill();
    c.strokeStyle = 'rgba(255,240,240,0.5)'; c.lineWidth = 0.8; for (const d of [-3, 0, 3]) { c.beginPath(); c.moveTo(34, 23); c.lineTo(40, 22 + d); c.stroke(); }
  });
  A('mouse_ear', 20, 20, (c) => {
    paint(c, (q) => ell(q, 10, 10, 8.5, 8.5), { base: '#6b5e5a', light: '#c8b8b0', rim: '#f0e0d8', rimW: 1.5, bbox: [1, 1, 19, 19], seed: 'mear', tex: 0.04 });
    c.fillStyle = 'rgba(232,160,168,0.7)'; ell(c, 10, 10.5, 5, 5); c.fill();
  });
  A('mouse_pack', 40, 44, (c) => {
    paint(c, (q) => blobPath(q, [[6, 6], [32, 4], [36, 38], [8, 40]]), { base: '#6a4a2a', light: '#c89a6a', dark: '#2a1a0a', rim: '#f0c898', rimW: 2, bbox: [4, 2, 38, 42], seed: 'pack', tex: 0.07 });
    const cols = ['#c8283a', '#e8c040', '#5aa0d0', '#f0e8e0', '#70b070', '#b070c0'];
    strokes(c, 9, 'btns', (r, i) => { const x = 10 + r() * 20, y = 6 + r() * 30; c.fillStyle = cols[i % cols.length]; ell(c, x, y, 3, 3); c.fill(); c.fillStyle = 'rgba(0,0,0,0.5)'; ell(c, x - 0.8, y, 0.6, 0.6); c.fill(); ell(c, x + 0.8, y, 0.6, 0.6); c.fill(); });
  });
  A('mouse_tail', 40, 16, (c) => { c.strokeStyle = '#c89aa0'; c.lineWidth = 2; c.lineCap = 'round'; c.beginPath(); c.moveTo(38, 4); c.bezierCurveTo(24, 16, 14, 0, 2, 10); c.stroke(); });

  // Shade: a lost life — a translucent ghost kitten.
  A('shade', 64, 56, (c) => {
    glow(c, 32, 30, 30, BLUE, 0.35);
    c.save(); c.globalAlpha = 0.85;
    const path = (q) => blobPath(q, [[14, 44], [12, 30], [18, 22], [16, 10], [22, 17], [30, 16], [36, 9], [38, 22], [46, 30], [52, 42], [44, 48], [22, 50]]);
    const g = c.createLinearGradient(0, 8, 0, 50); g.addColorStop(0, 'rgba(235,250,255,0.95)'); g.addColorStop(1, 'rgba(150,210,255,0.3)');
    c.fillStyle = g; path(c); c.fill();
    c.fillStyle = 'rgba(20,40,70,0.8)'; ell(c, 23, 27, 2, 2.6); c.fill(); ell(c, 32, 27, 2, 2.6); c.fill();
    c.strokeStyle = 'rgba(235,250,255,0.8)'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(48, 44); c.bezierCurveTo(60, 40, 56, 22, 50, 20); c.stroke();
    c.restore();
  });

  // ====================================================================
  // PICKUPS & PROPS
  // ====================================================================
  A('button_coin', 16, 16, (c) => {
    paint(c, (q) => ell(q, 8, 8, 6.5, 6.5), { base: '#d8b060', light: '#fff0c0', dark: '#6a4a10', rim: '#ffffff', rimW: 1, bbox: [1, 1, 15, 15], seed: 'coin', tex: 0.02 });
    c.strokeStyle = 'rgba(100,70,20,0.6)'; c.lineWidth = 1; ell(c, 8, 8, 4.2, 4.2); c.stroke();
    c.fillStyle = '#4a3008'; for (const [x, y] of [[6.8, 6.8], [9.2, 6.8], [6.8, 9.2], [9.2, 9.2]]) { ell(c, x, y, 0.8, 0.8); c.fill(); }
  });
  A('button_jar', 44, 52, (c) => {
    c.fillStyle = 'rgba(191,234,255,0.12)'; blobPath(c, [[8, 12], [36, 12], [40, 46], [4, 46]]); c.fill();
    const cols = ['#d8b060', '#c8283a', '#5aa0d0', '#e8e0d0'];
    strokes(c, 16, 'jar', (r, i) => { c.fillStyle = cols[i % 4]; ell(c, 9 + r() * 26, 28 + r() * 16, 3, 3); c.fill(); });
    c.strokeStyle = 'rgba(220,240,255,0.55)'; c.lineWidth = 2; blobPath(c, [[8, 12], [36, 12], [40, 46], [4, 46]]); c.stroke();
    c.fillStyle = '#6a4a2a'; c.fillRect(8, 6, 28, 7);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(10, 16, 3, 22);
  });
  A('relic_dash', 48, 48, (c) => {
    glow(c, 24, 24, 24, '#8a7aff', 0.6);
    c.fillStyle = '#0a0810'; blobPath(c, [[10, 30], [18, 12], [30, 8], [40, 20], [34, 36], [20, 40]]); c.fill();
    c.strokeStyle = 'rgba(190,170,255,0.9)'; c.lineWidth = 2; blobPath(c, [[10, 30], [18, 12], [30, 8], [40, 20], [34, 36], [20, 40]]); c.stroke();
    c.fillStyle = EYE; ell(c, 22, 22, 2, 2.6); c.fill(); ell(c, 30, 22, 2, 2.6); c.fill();
  });
  A('relic_wings', 56, 48, (c) => {
    glow(c, 28, 24, 26, PALE, 0.55);
    c.save(); c.translate(28, 26);
    for (const d of [-1, 1]) { c.save(); c.scale(d, 1); c.fillStyle = 'rgba(240,235,225,0.95)'; blobPath(c, [[0, 0], [6, -14], [22, -18], [26, -6], [14, 6], [4, 10]]); c.fill(); c.fillStyle = 'rgba(255,207,122,0.8)'; ell(c, 15, -8, 3, 3); c.fill(); c.restore(); }
    c.restore();
  });
  A('slipper', 44, 24, (c) => {
    paint(c, (q) => blobPath(q, [[3, 18], [8, 8], [26, 6], [40, 12], [42, 20], [22, 22]]), { base: '#e88aa0', light: '#ffd8e0', dark: '#7a3040', rim: '#ffffff', rimW: 1.5, bbox: [2, 4, 43, 23], seed: 'slip', tex: 0.08 });
    c.fillStyle = '#ffffff'; ell(c, 30, 9, 5, 3.5); c.fill(); // pompom
    c.fillStyle = 'rgba(70,50,40,0.5)'; blobPath(c, [[4, 18], [16, 20], [30, 22], [10, 22]]); c.fill(); // mud
  });

  // Candle shrine (save point)
  A('shrine', 96, 112, (c) => {
    // stone niche
    const path = (q) => blobPath(q, [[8, 110], [10, 40], [24, 14], [48, 6], [72, 14], [86, 40], [88, 110]]);
    paint(c, path, { base: '#2a2634', light: '#6a6480', dark: '#0a0810', rim: '#b0a8d0', rimW: 3, bbox: [6, 4, 90, 110], seed: 'niche', tex: 0.1 });
    c.fillStyle = '#0e0c14'; blobPath(c, [[24, 104], [26, 50], [36, 30], [48, 26], [60, 30], [70, 50], [72, 104]]); c.fill();
    glow(c, 48, 76, 40, CANDLE, 0.35);
    // moth carving
    c.strokeStyle = 'rgba(200,190,230,0.5)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(48, 14); c.lineTo(48, 24); c.stroke();
    for (const d of [-1, 1]) { c.beginPath(); c.moveTo(48, 16); c.quadraticCurveTo(48 + d * 10, 8, 48 + d * 12, 18); c.quadraticCurveTo(48 + d * 8, 22, 48, 20); c.stroke(); }
    // base step
    c.fillStyle = '#3a3448'; c.fillRect(2, 104, 92, 8); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(2, 104, 92, 1.5);
  });
  A('gate_bars', 32, 96, (c) => {
    for (const x of [6, 16, 26]) {
      const g = c.createLinearGradient(x - 3, 0, x + 3, 0); g.addColorStop(0, '#15121c'); g.addColorStop(0.4, '#6a6280'); g.addColorStop(1, '#15121c');
      c.fillStyle = g; c.fillRect(x - 3, 0, 6, 90);
      c.fillStyle = '#8a82a0'; poly(c, [[x - 4, 90], [x, 96], [x + 4, 90]]); c.fill();
    }
    c.fillStyle = '#2a2434'; c.fillRect(0, 10, 32, 5); c.fillRect(0, 60, 32, 5);
  });
  A('crack_wall', 64, 64, (c) => {
    c.strokeStyle = 'rgba(160,150,190,0.55)'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(10, 4); c.lineTo(22, 20); c.lineTo(16, 34); c.lineTo(30, 44); c.lineTo(26, 60); c.stroke();
    c.beginPath(); c.moveTo(22, 20); c.lineTo(40, 24); c.lineTo(52, 12); c.stroke();
    c.beginPath(); c.moveTo(30, 44); c.lineTo(48, 50); c.stroke();
  });
  // Chalk drawings left by Mira
  function chalkText(c, text, x, y, size, rot = 0) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.font = `bold ${size}px "Comic Sans MS", "Chalkboard", "Segoe Print", cursive`;
    c.fillStyle = 'rgba(240,236,255,0.78)'; c.fillText(text, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    strokes(c, text.length * 30, 'chalk' + text, (r) => { c.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.5})`; c.fillRect(r() * size * text.length * 0.6, -size + r() * size * 1.2, 1.5, 1.5); });
    c.restore();
  }
  function chalkLine(c, pts, w = 3) {
    c.save(); c.strokeStyle = 'rgba(240,236,255,0.72)'; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) c.lineTo(p[0], p[1]); c.stroke();
    c.globalCompositeOperation = 'destination-out';
    strokes(c, 200, 'cl' + pts.length, (r) => { c.fillStyle = 'rgba(0,0,0,0.6)'; const p = pts[Math.floor(r() * pts.length)]; c.fillRect(p[0] + (r() - 0.5) * 60, p[1] + (r() - 0.5) * 20, 1.5, 1.5); });
    c.restore();
  }
  A('chalk_arrow', 256, 96, (c) => {
    chalkText(c, 'NIGHTPAW', 8, 38, 30, -0.04);
    chalkText(c, 'THIS WAY', 30, 74, 26, 0.03);
    chalkLine(c, [[170, 60], [236, 56]], 4); chalkLine(c, [[222, 44], [238, 56], [220, 68]], 4);
  });
  A('chalk_dont', 256, 96, (c) => {
    chalkText(c, 'NIGHTPAW DONT', 6, 44, 28, 0.02);
    c.strokeStyle = 'rgba(20,16,26,0.9)'; c.lineWidth = 7;
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(20 + i * 30, 56); c.lineTo(60 + i * 30, 90); c.stroke(); }
    chalkLine(c, [[40, 70], [60, 86], [90, 66], [120, 90], [150, 70]], 3);
  });
  A('chalk_cat', 128, 96, (c) => {
    chalkLine(c, [[20, 80], [22, 44], [30, 30], [36, 44], [56, 44], [62, 30], [68, 44], [72, 80], [20, 80]], 3);
    chalkLine(c, [[72, 70], [100, 60], [104, 40]], 3);
    c.fillStyle = 'rgba(240,236,255,0.7)'; ell(c, 38, 56, 3, 3); c.fill(); ell(c, 54, 56, 3, 3); c.fill();
    chalkText(c, 'MY CAT', 22, 20, 18, -0.05);
  });

  // ====================================================================
  // TILES (THE HOLLOWS)
  // ====================================================================
  A('hol_rock', 512, 512, (c) => {
    const W = 512;
    c.fillStyle = '#17141f'; c.fillRect(0, 0, W, W);
    const r = rng('rock');
    // large soft stones, wrapped for seamless tiling
    for (let i = 0; i < 70; i++) {
      const x = r() * W, y = r() * W, rx = 20 + r() * 60, ry = 14 + r() * 40, col = mix('#1a1724', '#2e2a3c', r());
      for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) {
        c.fillStyle = col; ell(c, x + ox, y + oy, rx, ry, r() * 3); c.fill();
        c.fillStyle = 'rgba(160,150,200,0.05)'; ell(c, x + ox - rx * 0.2, y + oy - ry * 0.3, rx * 0.6, ry * 0.4); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 2; ell(c, x + ox, y + oy, rx, ry); c.stroke();
      }
    }
    for (let i = 0; i < 9000; i++) { c.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.03 * r()})` : `rgba(0,0,0,${0.12 * r()})`; c.fillRect(r() * W, r() * W, 2, 2); }
  });
  A('hol_top', 64, 32, (c) => {
    // ledge lip: pale ash crust with moss & grass. Anchored at y=10 (tile top).
    const g = c.createLinearGradient(0, 6, 0, 24); g.addColorStop(0, '#8e88a0'); g.addColorStop(0.3, '#4a4558'); g.addColorStop(1, 'rgba(23,20,31,0)');
    c.fillStyle = g; c.fillRect(0, 8, 64, 18);
    c.fillStyle = '#a8a2bc'; c.fillRect(0, 8, 64, 2.5);
    const r = rng('grass');
    for (let i = 0; i < 26; i++) { const x = r() * 64, h = 3 + r() * 8; c.strokeStyle = r() < 0.5 ? 'rgba(170,200,190,0.8)' : 'rgba(120,150,150,0.8)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, 10); c.quadraticCurveTo(x + (r() - 0.5) * 3, 10 - h * 0.6, x + (r() - 0.5) * 5, 10 - h); c.stroke(); }
  });
  A('hol_top2', 64, 32, (c) => {
    const g = c.createLinearGradient(0, 6, 0, 24); g.addColorStop(0, '#8e88a0'); g.addColorStop(0.3, '#4a4558'); g.addColorStop(1, 'rgba(23,20,31,0)');
    c.fillStyle = g; c.fillRect(0, 8, 64, 18);
    c.fillStyle = '#a8a2bc'; c.fillRect(0, 8, 64, 2.5);
    const r = rng('grass2');
    for (let i = 0; i < 12; i++) { const x = r() * 64, h = 2 + r() * 5; c.strokeStyle = 'rgba(150,180,170,0.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x, 10); c.lineTo(x + (r() - 0.5) * 4, 10 - h); c.stroke(); }
    c.fillStyle = '#b6b0c8'; for (let i = 0; i < 5; i++) { ell(c, 6 + r() * 52, 9, 2 + r() * 3, 1.6); c.fill(); }
  });
  A('hol_bottom', 64, 28, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 12); g.addColorStop(0, 'rgba(10,8,14,0)'); g.addColorStop(1, '#0c0a12');
    c.fillStyle = g; c.fillRect(0, 0, 64, 10);
    const r = rng('drip');
    c.fillStyle = '#0c0a12';
    for (let i = 0; i < 5; i++) { const x = 4 + r() * 56, h = 6 + r() * 14; poly(c, [[x - 4, 8], [x, 8 + h], [x + 4, 8]]); c.fill(); }
    c.strokeStyle = 'rgba(70,60,90,0.8)'; c.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) { const x = r() * 64; c.beginPath(); c.moveTo(x, 8); c.bezierCurveTo(x + 4, 14, x - 4, 20, x + 2, 26); c.stroke(); }
  });
  A('hol_side', 24, 64, (c) => {
    const g = c.createLinearGradient(0, 0, 24, 0); g.addColorStop(0, 'rgba(160,150,200,0.28)'); g.addColorStop(0.2, 'rgba(60,54,80,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 24, 64);
  });
  A('hol_plank', 64, 24, (c) => {
    paint(c, (q) => blobPath(q, [[0, 3], [64, 2], [64, 12], [0, 13]]), { base: '#3a2e2a', light: '#8a7060', dark: '#120c0a', rim: '#c8a890', rimW: 1.5, bbox: [0, 1, 64, 14], seed: 'plank', tex: 0.08 });
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 8); c.lineTo(64, 7.5); c.stroke();
    c.strokeStyle = '#6a5a4a'; c.lineWidth = 1.5; for (const x of [6, 58]) { c.beginPath(); c.moveTo(x, 13); c.lineTo(x + 1, 22); c.stroke(); }
  });
  A('hol_thorns', 64, 44, (c) => {
    const r = rng('thorn');
    c.strokeStyle = '#0c0a10'; c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = r() * 64; c.lineWidth = 2.5 + r() * 2;
      c.beginPath(); c.moveTo(x, 44); c.bezierCurveTo(x + (r() - 0.5) * 30, 30, x + (r() - 0.5) * 30, 20, x + (r() - 0.5) * 20, 12 + r() * 10); c.stroke();
    }
    for (let i = 0; i < 18; i++) { const x = r() * 64, y = 14 + r() * 28; c.fillStyle = '#0c0a10'; poly(c, [[x - 2, y], [x + (r() - 0.5) * 8, y - 5 - r() * 4], [x + 2, y]]); c.fill(); }
    for (let i = 0; i < 8; i++) { const x = r() * 64, y = 16 + r() * 24; c.fillStyle = 'rgba(255,80,100,0.8)'; ell(c, x, y, 1.1, 1.1); c.fill(); }
    c.strokeStyle = 'rgba(160,150,200,0.25)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 30); c.bezierCurveTo(20, 20, 40, 34, 64, 24); c.stroke();
  });
  // Decorations
  A('deco_mushroom', 32, 32, (c) => {
    for (const [x, h, s] of [[10, 18, 1], [20, 12, 0.7], [25, 8, 0.5]]) {
      c.strokeStyle = '#c8c0d8'; c.lineWidth = 2 * s + 0.5; c.beginPath(); c.moveTo(x, 32); c.lineTo(x, 32 - h); c.stroke();
      glow(c, x, 32 - h, 10 * s, BLUE, 0.5);
      c.fillStyle = '#a0e0ff'; ell(c, x, 32 - h, 6 * s, 3 * s); c.fill();
      c.fillStyle = '#e8f8ff'; ell(c, x - 1.5 * s, 31 - h, 2.4 * s, 1.1 * s); c.fill();
    }
  });
  A('deco_roots', 48, 160, (c) => {
    const r = rng('roots');
    c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      c.strokeStyle = i < 2 ? '#0e0c14' : '#1c1826'; c.lineWidth = 3 - i * 0.4;
      let x = 24 + (r() - 0.5) * 20; c.beginPath(); c.moveTo(x, 0);
      for (let y = 0; y < 150 - i * 20; y += 20) { x += (r() - 0.5) * 10; c.lineTo(x, y + 20); }
      c.stroke();
    }
  });
  A('deco_bones', 48, 20, (c) => {
    c.strokeStyle = '#b8b0c8'; c.lineWidth = 1.5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(4, 14); c.lineTo(36, 14); c.stroke();
    for (let x = 10; x < 34; x += 5) { c.beginPath(); c.moveTo(x, 14); c.lineTo(x - 3, 8); c.stroke(); c.beginPath(); c.moveTo(x, 14); c.lineTo(x - 3, 19); c.stroke(); }
    c.fillStyle = '#b8b0c8'; poly(c, [[36, 14], [46, 8], [46, 20]]); c.fill();
    c.fillStyle = '#0b0a10'; ell(c, 41, 12, 1.2, 1.2); c.fill();
  });
  A('deco_key', 32, 16, (c) => {
    c.strokeStyle = '#8a7a50'; c.lineWidth = 2; ell(c, 7, 8, 5, 5); c.stroke();
    c.beginPath(); c.moveTo(12, 8); c.lineTo(30, 8); c.lineTo(30, 12); c.moveTo(25, 8); c.lineTo(25, 12); c.stroke();
  });
  A('deco_teacup', 32, 24, (c) => {
    paint(c, (q) => blobPath(q, [[4, 6], [26, 6], [24, 18], [16, 22], [8, 18]]), { base: '#d8d0e0', light: '#ffffff', dark: '#6a6078', rim: '#ffffff', rimW: 1, bbox: [3, 5, 27, 22], seed: 'cup', tex: 0.03 });
    c.strokeStyle = '#d8d0e0'; c.lineWidth = 2; c.beginPath(); c.arc(27, 12, 4, -1.4, 1.4); c.stroke();
    c.strokeStyle = 'rgba(30,20,40,0.8)'; c.lineWidth = 1; c.beginPath(); c.moveTo(10, 8); c.lineTo(13, 14); c.lineTo(11, 19); c.stroke();
    c.fillStyle = 'rgba(80,120,200,0.6)'; ell(c, 15, 12, 3, 2); c.fill();
  });
  A('deco_coats', 160, 150, (c) => {
    c.strokeStyle = '#2a2434'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 6); c.lineTo(160, 6); c.stroke();
    const r = rng('coats');
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 38, h = 90 + r() * 50, col = mix('#15121c', '#2e2438', r());
      c.strokeStyle = '#5a5268'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x + 12, 6); c.lineTo(x + 12, 14); c.stroke();
      paint(c, (q) => blobPath(q, [[x + 2, 18], [x + 12, 12], [x + 24, 18], [x + 30, h * 0.6], [x + 28, h], [x + 18, h - 6], [x + 8, h], [x - 2, h * 0.6]]), { base: col, light: '#4a3c56', dark: '#050407', rim: '#8a7a98', rimW: 2, bbox: [x - 4, 10, x + 32, h + 2], seed: 'coat' + i, tex: 0.05 });
    }
  });
  A('deco_umbrella', 64, 72, (c) => {
    c.fillStyle = '#1c1622'; blobPath(c, [[4, 30], [20, 8], [44, 8], [60, 30], [48, 26], [40, 32], [32, 26], [24, 32], [16, 26]]); c.fill();
    c.strokeStyle = 'rgba(184,162,200,0.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(4, 30); c.quadraticCurveTo(32, -2, 60, 30); c.stroke();
    c.strokeStyle = '#5a5268'; c.lineWidth = 2; c.beginPath(); c.moveTo(32, 10); c.lineTo(32, 66); c.arc(28, 66, 4, 0, Math.PI); c.stroke();
    c.fillStyle = '#050407'; ell(c, 22, 18, 3, 2.5); c.fill(); ell(c, 44, 22, 2.5, 2); c.fill();
  });
  A('deco_rockfall', 96, 96, (c) => {
    const r = rng('rockfall');
    for (let i = 0; i < 14; i++) {
      const x = 10 + r() * 76, y = 20 + r() * 70 * (0.4 + i / 20), s = 10 + r() * 14;
      paint(c, (q) => blobPath(q, [[x - s, y], [x - s * 0.4, y - s * 0.8], [x + s * 0.6, y - s * 0.7], [x + s, y + s * 0.2], [x + s * 0.2, y + s * 0.8], [x - s * 0.8, y + s * 0.6]]), { base: mix('#231f2e', '#3a3448', r()), light: '#6a6480', dark: '#0a0810', rim: '#a8a0c8', rimW: 1.5, bbox: [x - s, y - s, x + s, y + s], seed: 'rf' + i, tex: 0.06 });
    }
  });

  // ====================================================================
  // PARALLAX BACKGROUNDS (tile horizontally)
  // ====================================================================
  function arch(c, x, y, w, h, col) {
    c.fillStyle = col;
    c.fillRect(x, y + h * 0.35, w * 0.16, h * 0.65);
    c.fillRect(x + w * 0.84, y + h * 0.35, w * 0.16, h * 0.65);
    c.beginPath(); c.moveTo(x, y + h * 0.4); c.quadraticCurveTo(x + w / 2, y - h * 0.15, x + w, y + h * 0.4); c.lineTo(x + w * 0.84, y + h * 0.42); c.quadraticCurveTo(x + w / 2, y + h * 0.05, x + w * 0.16, y + h * 0.42); c.closePath(); c.fill();
  }
  A('hol_bg_far', 1024, 640, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 640); g.addColorStop(0, '#0d0b14'); g.addColorStop(0.55, '#1b1828'); g.addColorStop(1, '#262236');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 640);
    // shafts of pale light
    for (const x of [180, 610, 880]) { const lg = c.createLinearGradient(x, 0, x + 120, 640); lg.addColorStop(0, 'rgba(190,200,255,0.10)'); lg.addColorStop(1, 'rgba(190,200,255,0)'); c.fillStyle = lg; poly(c, [[x, 0], [x + 70, 0], [x + 220, 640], [x + 60, 640]]); c.fill(); }
    const r = rng('far');
    for (let i = 0; i < 6; i++) { const x = i * 180 + r() * 40; arch(c, x, 180 + r() * 80, 150 + r() * 60, 520, 'rgba(58,52,80,0.55)'); }
    for (let i = 0; i < 12; i++) { const x = r() * 1024, w = 20 + r() * 30; c.fillStyle = 'rgba(45,40,64,0.6)'; c.fillRect(x, 200 + r() * 200, w, 640); }
    c.filter = 'blur(3px)';
    for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(200,210,255,${0.05 + r() * 0.1})`; ell(c, r() * 1024, r() * 640, 1 + r() * 2, 1 + r() * 2); c.fill(); }
    c.filter = 'none';
    // mist at bottom
    const mg = c.createLinearGradient(0, 380, 0, 640); mg.addColorStop(0, 'rgba(120,115,160,0)'); mg.addColorStop(1, 'rgba(120,115,160,0.25)');
    c.fillStyle = mg; c.fillRect(0, 380, 1024, 260);
    // make horizontally seamless: blend edges
    const edge = c.getImageData(0, 0, 32, 640); c.putImageData(edge, 1024 - 32, 0);
  });
  A('hol_bg_mid', 1024, 640, (c) => {
    const r = rng('mid');
    for (let i = 0; i < 7; i++) {
      const x = i * 150 + r() * 60, w = 34 + r() * 40;
      const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#15121e'); g.addColorStop(0.3, '#2a2638'); g.addColorStop(1, '#100e17');
      c.fillStyle = g; c.fillRect(x, 0, w, 640);
      c.fillStyle = '#15121e'; c.fillRect(x - 8, 100 + r() * 300, w + 16, 14);
    }
    c.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      let x = r() * 1024, y = 0; c.strokeStyle = 'rgba(16,14,23,0.9)'; c.lineWidth = 2 + r() * 3; c.beginPath(); c.moveTo(x, 0);
      const len = 120 + r() * 300; while (y < len) { y += 30; x += (r() - 0.5) * 30; c.lineTo(x, y); } c.stroke();
    }
    for (let i = 0; i < 20; i++) { const x = r() * 1024, h = 40 + r() * 120; c.fillStyle = '#100e17'; poly(c, [[x - 12 - r() * 10, 0], [x, h], [x + 12 + r() * 10, 0]]); c.fill(); }
    // floor silhouettes
    c.fillStyle = '#100e17'; c.beginPath(); c.moveTo(0, 640);
    for (let x = 0; x <= 1024; x += 32) c.lineTo(x, 560 + Math.sin(x * 0.013) * 30 + r() * 20);
    c.lineTo(1024, 640); c.closePath(); c.fill();
  });
  A('hol_fg', 1024, 256, (c) => {
    const r = rng('fg');
    c.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      let x = r() * 1024, y = 0; c.strokeStyle = '#050407'; c.lineWidth = 6 + r() * 8; c.beginPath(); c.moveTo(x, 0);
      const len = 60 + r() * 190; while (y < len) { y += 24; x += (r() - 0.5) * 26; c.lineTo(x, y); } c.stroke();
      c.fillStyle = '#050407'; for (let k = 0; k < 4; k++) { ell(c, x + (r() - 0.5) * 20, y - r() * len, 6 + r() * 8, 3 + r() * 4, r() * 3); c.fill(); }
    }
  });
  A('fog', 512, 128, (c) => {
    c.filter = 'blur(12px)';
    const r = rng('fog');
    for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(200,200,255,${0.03 + r() * 0.05})`; ell(c, r() * 512, 64 + (r() - 0.5) * 50, 40 + r() * 70, 14 + r() * 20); c.fill(); }
    c.filter = 'none';
  });

  // ====================================================================
  // STORYBOOK PANELS (prologue) — 1280x720
  // ====================================================================
  function rainOver(c, seed, a = 0.25) {
    const r = rng(seed); c.strokeStyle = `rgba(190,200,240,${a})`; c.lineWidth = 1.2;
    for (let i = 0; i < 500; i++) { const x = r() * 1400, y = r() * 720; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 8, y + 24); c.stroke(); }
  }
  function vignette(c, a = 0.8) {
    const g = c.createRadialGradient(640, 360, 200, 640, 360, 820); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
  }
  function catSilhouette(c, x, y, s, eyes = true, sitting = true) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = '#07060a';
    if (sitting) {
      blobPath(c, [[-18, 0], [-20, -30], [-12, -52], [0, -56], [12, -52], [20, -30], [18, 0]]); c.fill();
      ell(c, 0, -66, 15, 13); c.fill();
      poly(c, [[-13, -72], [-11, -88], [-3, -76]]); c.fill(); poly(c, [[13, -72], [11, -88], [3, -76]]); c.fill();
      c.lineWidth = 7; c.lineCap = 'round'; c.strokeStyle = '#07060a'; c.beginPath(); c.moveTo(16, -4); c.bezierCurveTo(40, 0, 44, -24, 34, -36); c.stroke();
      c.fillStyle = RED; blobPath(c, [[-10, -54], [10, -54], [8, -48], [-8, -48]]); c.fill();
      if (eyes) { glow(c, -6, -67, 7, EYE, 0.8); glow(c, 6, -67, 7, EYE, 0.8); c.fillStyle = EYE; ell(c, -6, -67, 2.8, 2.4); c.fill(); ell(c, 6, -67, 2.8, 2.4); c.fill(); }
    }
    c.restore();
  }
  A('sb_town', 1280, 720, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 720); g.addColorStop(0, '#0c0f1e'); g.addColorStop(1, '#232640'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
    glow(c, 980, 140, 120, '#dfe6ff', 0.25); c.fillStyle = 'rgba(230,236,255,0.85)'; ell(c, 980, 140, 34, 34); c.fill();
    const r = rng('town');
    // far roofs
    for (let layer = 0; layer < 3; layer++) {
      const base = 420 + layer * 90, col = ['#1a1c30', '#121426', '#0a0b16'][layer];
      let x = -40;
      while (x < 1320) {
        const w = 70 + r() * 90, h = 90 + r() * 140 - layer * 20;
        c.fillStyle = col; c.fillRect(x, base - h, w, 720);
        poly(c, [[x - 8, base - h], [x + w / 2, base - h - 40 - r() * 40], [x + w + 8, base - h]]); c.fill();
        if (r() < 0.5) { c.fillRect(x + w * 0.7, base - h - 50, 12, 40); }
        for (let k = 0; k < 3; k++) if (r() < 0.35 + layer * 0.1) { const wx = x + 10 + r() * (w - 30), wy = base - h + 20 + r() * (h - 40); glow(c, wx + 7, wy + 9, 26, CANDLE, 0.25); c.fillStyle = '#ffcf7a'; c.fillRect(wx, wy, 14, 18); c.fillStyle = col; c.fillRect(wx + 6, wy, 2, 18); c.fillRect(wx, wy + 8, 14, 2); }
        x += w + 10 + r() * 20;
      }
    }
    // Mira's house, the lit window
    c.fillStyle = '#07080f'; c.fillRect(700, 380, 300, 400); poly(c, [[680, 380], [850, 250], [1020, 380]]); c.fill();
    glow(c, 850, 470, 120, CANDLE, 0.45); c.fillStyle = '#ffd890'; c.fillRect(815, 430, 70, 90); c.fillStyle = '#07080f'; c.fillRect(847, 430, 6, 90); c.fillRect(815, 472, 70, 6);
    catSilhouette(c, 830, 520, 0.5, true);
    // the well in the garden
    c.fillStyle = '#05060c'; c.fillRect(0, 640, 1280, 80);
    c.fillStyle = '#0a0b14'; ell(c, 400, 640, 70, 16); c.fill(); c.fillRect(330, 600, 140, 40); c.fillStyle = '#05060c'; ell(c, 400, 600, 70, 14); c.fill();
    c.strokeStyle = '#0a0b14'; c.lineWidth = 8; c.beginPath(); c.moveTo(345, 600); c.lineTo(345, 520); c.lineTo(455, 520); c.lineTo(455, 600); c.stroke();
    rainOver(c, 'rain1'); vignette(c);
  });
  A('sb_bedroom', 1280, 720, (c) => {
    c.fillStyle = '#16101a'; c.fillRect(0, 0, 1280, 720);
    // wallpaper
    const r = rng('wall');
    for (let x = 0; x < 1280; x += 64) for (let y = 0; y < 560; y += 64) { c.fillStyle = 'rgba(120,80,110,0.12)'; ell(c, x + 32 + (y % 128 ? 32 : 0), y + 32, 5, 5); c.fill(); }
    c.fillStyle = '#0e0a10'; c.fillRect(0, 560, 1280, 160);
    glow(c, 330, 420, 360, CANDLE, 0.35);
    // bed
    c.fillStyle = '#2a1a22'; c.fillRect(420, 440, 620, 170);
    c.fillStyle = '#3e2632'; blobPath(c, [[420, 470], [700, 440], [1040, 460], [1040, 560], [420, 560]]); c.fill();
    paint(c, (q) => blobPath(q, [[430, 480], [640, 450], [900, 470], [1030, 470], [1030, 560], [430, 560]]), { base: '#5a4a7a', light: '#b8a8e0', dark: '#1a1030', bbox: [420, 440, 1040, 560], seed: 'quilt', tex: 0.06 });
    // quilt patches
    c.save(); blobPath(c, [[430, 480], [640, 450], [900, 470], [1030, 470], [1030, 560], [430, 560]]); c.clip();
    for (let i = 0; i < 12; i++) { c.fillStyle = ['rgba(200,40,58,0.25)', 'rgba(255,207,122,0.2)', 'rgba(90,160,208,0.2)'][i % 3]; c.fillRect(440 + (i % 6) * 100, 460 + Math.floor(i / 6) * 50, 90, 45); }
    c.restore();
    // pillow + Mira (hair and sleeping face)
    paint(c, (q) => ell(q, 520, 450, 80, 34), { base: '#e8e0f0', light: '#ffffff', dark: '#8a80a0', bbox: [440, 416, 600, 484], seed: 'pillow', tex: 0.03 });
    c.fillStyle = '#f0d0b8'; ell(c, 540, 440, 30, 28); c.fill();
    c.fillStyle = '#3a2418'; blobPath(c, [[505, 440], [515, 408], [548, 402], [575, 420], [566, 432], [540, 420], [520, 438], [512, 470]]); c.fill();
    c.fillStyle = RED; blobPath(c, [[512, 422], [522, 410], [528, 426]]); c.fill();
    c.strokeStyle = '#6a4030'; c.lineWidth = 2; c.beginPath(); c.arc(548, 442, 5, 0.2, 2.9); c.stroke(); c.beginPath(); c.arc(530, 444, 5, 0.2, 2.9); c.stroke();
    c.fillStyle = 'rgba(240,120,120,0.35)'; ell(c, 525, 454, 6, 3); c.fill(); ell(c, 556, 452, 6, 3); c.fill();
    // cat curled at foot of bed
    c.fillStyle = '#07060a'; blobPath(c, [[880, 470], [900, 440], [950, 432], [990, 450], [995, 475], [940, 485]]); c.fill();
    ell(c, 895, 450, 22, 18); c.fill(); poly(c, [[880, 440], [884, 418], [896, 436]]); c.fill(); poly(c, [[904, 434], [912, 414], [916, 440]]); c.fill();
    glow(c, 890, 450, 8, EYE, 0.6); c.fillStyle = EYE; ell(c, 890, 450, 3, 1.2); c.fill(); glow(c, 902, 449, 8, EYE, 0.6); ell(c, 902, 449, 3, 1.2); c.fill();
    c.fillStyle = RED; c.fillRect(905, 462, 16, 6);
    // bedside candle & table
    c.fillStyle = '#1e1418'; c.fillRect(260, 470, 140, 140); c.fillStyle = '#2a1c22'; c.fillRect(250, 460, 160, 16);
    c.fillStyle = '#e8dcc0'; c.fillRect(320, 408, 18, 54); glow(c, 329, 396, 50, CANDLE, 0.8); c.fillStyle = '#fff0c0'; blobPath(c, [[329, 380], [335, 398], [329, 404], [323, 398]]); c.fill();
    // window with rain
    c.fillStyle = '#0b1020'; c.fillRect(1080, 120, 160, 240); c.save(); c.beginPath(); c.rect(1080, 120, 160, 240); c.clip(); rainOver(c, 'rain2', 0.35); c.restore();
    c.strokeStyle = '#2a1c22'; c.lineWidth = 10; c.strokeRect(1080, 120, 160, 240); c.beginPath(); c.moveTo(1160, 120); c.lineTo(1160, 360); c.moveTo(1080, 240); c.lineTo(1240, 240); c.stroke();
    // drawing pinned on wall
    c.save(); c.translate(640, 200); c.rotate(-0.05); c.fillStyle = '#e8e2d8'; c.fillRect(0, 0, 150, 110);
    c.strokeStyle = '#222'; c.lineWidth = 3; c.beginPath(); c.moveTo(40, 90); c.lineTo(40, 55); c.lineTo(48, 42); c.lineTo(54, 55); c.lineTo(80, 55); c.lineTo(86, 42); c.lineTo(92, 55); c.lineTo(92, 90); c.closePath(); c.stroke();
    c.fillStyle = '#e8c040'; ell(c, 55, 68, 4, 4); c.fill(); ell(c, 78, 68, 4, 4); c.fill(); c.fillStyle = RED; c.fillRect(46, 78, 42, 6);
    c.restore();
    vignette(c, 0.85);
  });
  A('sb_moth', 1280, 720, (c) => {
    c.fillStyle = '#0b0e1c'; c.fillRect(0, 0, 1280, 720);
    rainOver(c, 'rain3', 0.3);
    // window frame close-up
    c.fillStyle = '#140e12'; c.fillRect(0, 0, 1280, 60); c.fillRect(0, 660, 1280, 60); c.fillRect(0, 0, 90, 720); c.fillRect(1190, 0, 90, 720); c.fillRect(610, 0, 60, 720);
    c.fillStyle = 'rgba(160,190,255,0.06)'; c.fillRect(90, 60, 520, 600); c.fillRect(670, 60, 520, 600);
    // the pale moth pressed against the glass
    glow(c, 420, 330, 220, PALE, 0.35);
    c.save(); c.translate(420, 330); c.scale(4, 4);
    for (const d of [-1, 1]) { c.save(); c.scale(d, 1); c.fillStyle = 'rgba(240,236,226,0.95)'; blobPath(c, [[2, 0], [8, -18], [30, -24], [36, -8], [20, 8], [6, 14]]); c.fill(); c.fillStyle = 'rgba(40,30,30,0.8)'; ell(c, 20, -8, 5, 5); c.fill(); c.fillStyle = 'rgba(255,207,122,0.9)'; ell(c, 20, -8, 2.5, 2.5); c.fill(); c.restore(); }
    c.fillStyle = '#e0d6c4'; ell(c, 0, 2, 4, 14); c.fill();
    c.strokeStyle = '#a89c88'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(-1, -12); c.quadraticCurveTo(-8, -24, -12, -26); c.moveTo(1, -12); c.quadraticCurveTo(8, -24, 12, -26); c.stroke();
    c.restore();
    // the cat's face reflected, watching
    catSilhouette(c, 920, 700, 3.2, true);
    vignette(c, 0.8);
  });
  A('sb_empty', 1280, 720, (c) => {
    c.fillStyle = '#12101a'; c.fillRect(0, 0, 1280, 720);
    c.fillStyle = 'rgba(140,160,220,0.08)'; poly(c, [[1080, 120], [1240, 120], [900, 720], [500, 720]]); c.fill();
    c.fillStyle = '#0c0a10'; c.fillRect(0, 560, 1280, 160);
    // empty bed, quilt thrown back
    c.fillStyle = '#2a1a22'; c.fillRect(420, 440, 620, 170);
    paint(c, (q) => blobPath(q, [[430, 500], [700, 480], [980, 500], [1030, 470], [1030, 560], [430, 560]]), { base: '#3a3050', light: '#7a70a0', dark: '#0a0614', bbox: [420, 460, 1040, 560], seed: 'quilt2', tex: 0.06 });
    paint(c, (q) => ell(q, 520, 450, 80, 34), { base: '#a8a0b8', light: '#d8d0e8', dark: '#403850', bbox: [440, 416, 600, 484], seed: 'pillow2', tex: 0.03 });
    // window open, curtains blowing
    c.fillStyle = '#0b1020'; c.fillRect(1080, 120, 160, 240);
    c.fillStyle = 'rgba(210,200,230,0.35)'; blobPath(c, [[1080, 120], [1040, 200], [1000, 320], [960, 380], [1060, 360], [1080, 250]]); c.fill();
    // muddy little footprints to the window
    const r = rng('prints');
    for (let i = 0; i < 9; i++) { const t = i / 8, x = lerp(600, 1140, t), y = lerp(640, 380, t * t); c.fillStyle = 'rgba(70,50,35,0.85)'; ell(c, x + (i % 2 ? 10 : -10), y, 12 - t * 5, 6 - t * 2.5, -0.3); c.fill(); }
    // the snuffed candle, a thread of smoke
    c.fillStyle = '#1e1418'; c.fillRect(260, 470, 140, 140); c.fillStyle = '#2a1c22'; c.fillRect(250, 460, 160, 16);
    c.fillStyle = '#b8ac90'; c.fillRect(320, 420, 18, 42);
    c.strokeStyle = 'rgba(200,200,220,0.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(329, 418); c.bezierCurveTo(310, 380, 350, 350, 330, 300); c.bezierCurveTo(315, 270, 345, 240, 335, 200); c.stroke();
    // the cat, alone, ears back
    catSilhouette(c, 740, 600, 1.2, true);
    vignette(c, 0.9);
  });
  A('sb_well', 1280, 720, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 720); g.addColorStop(0, '#1a1d30'); g.addColorStop(1, '#07070d'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
    glow(c, 640, 360, 420, '#8a90c0', 0.12);
    // looking down into the well: concentric stone rings
    const r = rng('well');
    for (let i = 0; i < 14; i++) {
      const rx = 560 - i * 38, ry = 330 - i * 22;
      c.fillStyle = mix('#2a2838', '#05050a', i / 13); ell(c, 640, 380, rx, ry); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 3;
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2 + i * 0.2; c.beginPath(); c.moveTo(640 + Math.cos(a) * rx, 380 + Math.sin(a) * ry); c.lineTo(640 + Math.cos(a) * (rx - 38), 380 + Math.sin(a) * (ry - 22)); c.stroke(); }
    }
    c.fillStyle = '#000'; ell(c, 640, 380, 50, 28); c.fill();
    // something glimmering far below
    glow(c, 648, 384, 30, CANDLE, 0.6); c.fillStyle = '#fff0c0'; ell(c, 648, 384, 2, 2); c.fill();
    // Nightpaw's paws on the rim, tail hanging over
    c.fillStyle = '#07060a'; ell(c, 560, 690, 26, 16); c.fill(); ell(c, 720, 690, 26, 16); c.fill();
    c.strokeStyle = '#07060a'; c.lineWidth = 12; c.lineCap = 'round'; c.beginPath(); c.moveTo(900, 720); c.bezierCurveTo(880, 640, 930, 600, 910, 560); c.stroke();
    c.fillStyle = RED; blobPath(c, [[880, 700], [940, 640], [960, 660], [900, 720]]); c.fill();
    vignette(c, 0.85);
  });
  A('title_bg', 1280, 720, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 720); g.addColorStop(0, '#0a0c18'); g.addColorStop(1, '#1c1a2c'); c.fillStyle = g; c.fillRect(0, 0, 1280, 720);
    glow(c, 840, 220, 260, '#dfe6ff', 0.2);
    c.fillStyle = 'rgba(232,236,255,0.92)'; ell(c, 840, 220, 70, 70); c.fill();
    c.fillStyle = 'rgba(180,186,220,0.25)'; ell(c, 820, 205, 16, 12); c.fill(); ell(c, 860, 245, 10, 8); c.fill();
    const r = rng('stars');
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(230,236,255,${0.2 + r() * 0.6})`; ell(c, r() * 1280, r() * 460, r() * 1.4 + 0.3, r() * 1.4 + 0.3); c.fill(); }
    // hills & garden
    c.fillStyle = '#10111e'; c.beginPath(); c.moveTo(0, 560); c.quadraticCurveTo(400, 480, 800, 540); c.quadraticCurveTo(1100, 580, 1280, 520); c.lineTo(1280, 720); c.lineTo(0, 720); c.fill();
    c.fillStyle = '#07070d'; c.fillRect(0, 610, 1280, 110);
    for (let i = 0; i < 60; i++) { const x = r() * 1280; c.strokeStyle = '#07070d'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, 612); c.lineTo(x + (r() - 0.5) * 8, 596 - r() * 14); c.stroke(); }
    // the well
    const wx = 820, wy = 610;
    c.fillStyle = '#0b0a12'; c.fillRect(wx - 110, wy - 80, 220, 90); ell(c, wx, wy + 8, 110, 20); c.fill();
    c.fillStyle = '#14121e'; ell(c, wx, wy - 80, 110, 20); c.fill();
    c.fillStyle = '#000'; ell(c, wx, wy - 80, 94, 14); c.fill();
    c.strokeStyle = 'rgba(40,36,56,0.9)'; c.lineWidth = 2; for (let y = wy - 64; y < wy; y += 16) { c.beginPath(); c.moveTo(wx - 110, y); c.lineTo(wx + 110, y); c.stroke(); }
    c.strokeStyle = '#0b0a12'; c.lineWidth = 12; c.beginPath(); c.moveTo(wx - 96, wy - 80); c.lineTo(wx - 96, wy - 220); c.lineTo(wx + 96, wy - 220); c.lineTo(wx + 96, wy - 80); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.moveTo(wx + 20, wy - 220); c.lineTo(wx + 20, wy - 140); c.stroke();
    c.fillStyle = '#0b0a12'; c.fillRect(wx + 8, wy - 146, 24, 20);
    // glow from the well
    glow(c, wx, wy - 80, 120, CANDLE, 0.22);
    // the cat on the rim
    catSilhouette(c, wx + 44, wy - 84, 0.9, true);
    // house in the distance
    c.fillStyle = '#07070d'; c.fillRect(120, 380, 220, 240); poly(c, [[100, 380], [230, 280], [360, 380]]); c.fill();
    glow(c, 230, 460, 60, CANDLE, 0.3); c.fillStyle = 'rgba(255,207,122,0.5)'; c.fillRect(205, 430, 50, 60);
    vignette(c, 0.7);
  });
  A('sb_card_bg', 1280, 720, (c) => {
    c.fillStyle = '#07060a'; c.fillRect(0, 0, 1280, 720);
    glow(c, 640, 360, 500, '#2a2440', 0.6);
  });

  // ====================================================================
  // DIALOGUE PORTRAITS — 192x192
  // ====================================================================
  function portraitFrame(c) {
    const g = c.createRadialGradient(96, 96, 10, 96, 96, 96); g.addColorStop(0, '#2a2438'); g.addColorStop(1, '#0b0a10');
    c.fillStyle = g; ell(c, 96, 96, 92, 92); c.fill();
  }
  function portraitRing(c) { c.strokeStyle = 'rgba(220,210,255,0.5)'; c.lineWidth = 3; ell(c, 96, 96, 91, 91); c.stroke(); }
  A('pt_nightpaw', 192, 192, (c) => {
    portraitFrame(c);
    c.save(); ell(c, 96, 96, 90, 90); c.clip();
    c.save(); c.translate(40, 60); c.save(); c.translate(20, -26); c.rotate(-0.25); catEar(c, 3); c.restore(); c.save(); c.translate(64, -30); c.rotate(0.1); catEar(c, 3); c.restore(); catHead(c, 3); c.restore();
    c.save(); c.translate(111, 111); catEye(c, 2.2); c.restore(); c.save(); c.translate(135, 110); catEye(c, 2); c.restore();
    c.fillStyle = RED; c.fillRect(50, 168, 90, 20);
    c.restore(); portraitRing(c);
  });
  A('pt_tallow', 192, 192, (c) => {
    portraitFrame(c);
    c.save(); ell(c, 96, 96, 90, 90); c.clip();
    glow(c, 60, 150, 80, CANDLE, 0.4);
    // wings behind
    for (const [dx, rot, sc] of [[-10, -0.5, 2.6], [40, 0.2, 2.4]]) {
      c.save(); c.translate(70 + dx, 70); c.rotate(rot); c.scale(sc, sc); c.globalAlpha = 0.9;
      const path = (q) => blobPath(q, [[4, 50], [8, 20], [26, 4], [54, 6], [62, 22], [48, 40], [20, 54]]);
      paint(c, path, { base: '#d9d0c2', light: '#ffffff', dark: '#8a7e70', bbox: [2, 2, 62, 56], seed: 'wing', tex: 0.1 });
      c.fillStyle = 'rgba(90,70,60,0.7)'; ell(c, 36, 22, 8, 8); c.fill(); c.fillStyle = 'rgba(255,207,122,0.8)'; ell(c, 36, 22, 5, 5); c.fill(); c.fillStyle = 'rgba(30,20,20,0.9)'; ell(c, 36, 22, 2.5, 2.5); c.fill();
      c.restore();
    }
    c.save(); c.translate(36, 16); c.scale(3.2, 3.2); mothBody(c, 1); c.restore();
    c.strokeStyle = '#a89c88'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(110, 40); c.quadraticCurveTo(120, 10, 150, 4); c.stroke();
    c.beginPath(); c.moveTo(118, 44); c.quadraticCurveTo(140, 24, 176, 24); c.stroke();
    c.restore(); portraitRing(c);
  });
  A('pt_nib', 192, 192, (c) => {
    portraitFrame(c);
    c.save(); ell(c, 96, 96, 90, 90); c.clip();
    c.save(); c.translate(-10, 20); c.scale(4, 4);
    c.save(); c.translate(4, -4); c.scale(1, 1); c.restore();
    c.restore();
    c.save(); c.translate(60, 26); c.scale(3.2, 3.2);
    c.save(); c.translate(2, -8); c.scale(0.9, 0.9); paint(c, (q) => ell(q, 10, 10, 8.5, 8.5), { base: '#6b5e5a', light: '#c8b8b0', rim: '#f0e0d8', rimW: 1.5, bbox: [1, 1, 19, 19], seed: 'mear', tex: 0.04 }); c.fillStyle = 'rgba(232,160,168,0.7)'; ell(c, 10, 10.5, 5, 5); c.fill(); c.restore();
    c.restore();
    c.save(); c.translate(0, 30); c.scale(4.2, 4.2);
    const path = (q) => blobPath(q, [[4, 20], [10, 10], [22, 8], [36, 20], [38, 24], [22, 30], [8, 28]]);
    paint(c, path, { base: '#6b5e5a', light: '#c8b8b0', dark: '#231c1c', rim: '#f0e0d8', rimW: 1.2, bbox: [2, 6, 40, 32], seed: 'mhead', tex: 0.06 });
    c.fillStyle = '#e8a0a8'; ell(c, 37, 22, 2.2, 2); c.fill();
    c.fillStyle = '#100c10'; ell(c, 25, 16, 2.4, 2.8); c.fill(); c.fillStyle = '#fff'; ell(c, 24.2, 15, 0.8, 0.8); c.fill();
    c.restore();
    // a jaunty little hat
    c.fillStyle = '#3a5a70'; c.fillRect(60, 40, 70, 10); c.fillRect(74, 14, 42, 28); c.fillStyle = RED; c.fillRect(74, 34, 42, 6);
    c.restore(); portraitRing(c);
  });
  A('pt_warden', 192, 192, (c) => {
    portraitFrame(c);
    c.save(); ell(c, 96, 96, 90, 90); c.clip();
    c.save(); c.translate(-24, 10); c.scale(2, 2);
    c.strokeStyle = '#d9d2e6'; c.lineCap = 'round';
    for (const dir of [-1, 1]) { c.lineWidth = 5; c.beginPath(); c.moveTo(60 + dir * 12, 60); c.bezierCurveTo(60 + dir * 26, 40, 60 + dir * 40, 24, 60 + dir * 38, 0); c.stroke(); }
    paint(c, (q) => blobPath(q, [[38, 70], [44, 54], [60, 48], [76, 54], [82, 70], [74, 96], [60, 110], [46, 96]]), { base: '#e8e2f0', light: '#ffffff', dark: '#7a7090', bbox: [36, 46, 84, 112], seed: 'mask', tex: 0.05 });
    for (const x of [51, 69]) { c.fillStyle = '#0a0610'; blobPath(c, [[x - 6, 70], [x, 64], [x + 6, 70], [x, 78]]); c.fill(); glow(c, x, 71, 8, '#ff3b4f', 0.8); }
    c.restore(); c.restore(); portraitRing(c);
  });
  A('pt_mira', 192, 192, (c) => {
    portraitFrame(c);
    c.save(); ell(c, 96, 96, 90, 90); c.clip();
    // drawn in chalk, like an echo
    c.strokeStyle = 'rgba(240,236,255,0.75)'; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
    ell(c, 96, 90, 40, 42); c.stroke();
    c.beginPath(); c.moveTo(56, 80); c.quadraticCurveTo(70, 40, 110, 48); c.quadraticCurveTo(136, 56, 138, 86); c.stroke();
    c.beginPath(); c.moveTo(60, 70); c.lineTo(46, 110); c.moveTo(134, 70); c.lineTo(146, 110); c.stroke();
    c.fillStyle = 'rgba(240,236,255,0.8)'; ell(c, 80, 92, 3.5, 3.5); c.fill(); ell(c, 112, 92, 3.5, 3.5); c.fill();
    c.beginPath(); c.arc(96, 104, 10, 0.3, 2.8); c.stroke();
    c.fillStyle = 'rgba(200,40,58,0.8)'; blobPath(c, [[60, 62], [72, 50], [78, 66]]); c.fill();
    c.beginPath(); c.moveTo(70, 132); c.lineTo(60, 180); c.moveTo(122, 132); c.lineTo(132, 180); c.stroke();
    c.restore(); portraitRing(c);
  });
  A('pt_shade', 192, 192, (c) => {
    portraitFrame(c);
    c.save(); ell(c, 96, 96, 90, 90); c.clip();
    glow(c, 96, 100, 90, BLUE, 0.35);
    c.save(); c.translate(0, 10); c.scale(3, 3);
    c.globalAlpha = 0.85;
    const g = c.createLinearGradient(0, 8, 0, 50); g.addColorStop(0, 'rgba(235,250,255,0.95)'); g.addColorStop(1, 'rgba(150,210,255,0.3)');
    c.fillStyle = g; blobPath(c, [[14, 44], [12, 30], [18, 22], [16, 10], [22, 17], [30, 16], [36, 9], [38, 22], [46, 30], [52, 42], [44, 48], [22, 50]]); c.fill();
    c.fillStyle = 'rgba(20,40,70,0.8)'; ell(c, 23, 27, 2, 2.6); c.fill(); ell(c, 32, 27, 2, 2.6); c.fill();
    c.restore(); c.restore(); portraitRing(c);
  });
  A('ui_paw', 32, 32, (c) => {
    c.fillStyle = '#f0ecff'; ell(c, 16, 20, 7, 6); c.fill();
    for (const [x, y] of [[8, 11], [13, 7], [19, 7], [24, 11]]) { ell(c, x, y, 3, 3.5); c.fill(); }
  });
  A('ui_paw_empty', 32, 32, (c) => {
    c.strokeStyle = 'rgba(240,236,255,0.45)'; c.lineWidth = 1.5; ell(c, 16, 20, 7, 6); c.stroke();
    for (const [x, y] of [[8, 11], [13, 7], [19, 7], [24, 11]]) { ell(c, x, y, 3, 3.5); c.stroke(); }
  });
  A('ui_orb', 96, 96, (c) => {
    const g = c.createRadialGradient(48, 48, 10, 48, 48, 46); g.addColorStop(0, '#1a1624'); g.addColorStop(1, '#07060a');
    c.fillStyle = g; ell(c, 48, 48, 44, 44); c.fill();
    c.strokeStyle = 'rgba(220,210,255,0.55)'; c.lineWidth = 3; ell(c, 48, 48, 43, 43); c.stroke();
    c.fillStyle = EYE; glow(c, 36, 50, 10, EYE, 0.6); glow(c, 60, 50, 10, EYE, 0.6); ell(c, 36, 50, 4, 5); c.fill(); ell(c, 60, 50, 4, 5); c.fill();
  });

  // ---------- render all ----------
  // `scale` renders every asset at a higher resolution (vector drawing, so it stays crisp);
  // used for store capsule art. Blur radii are scaled to match.
  window.renderAll = function (only, scale = 1) {
    const out = [];
    const proto = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'filter');
    for (const a of assets) {
      if (only && !only.includes(a.key)) continue;
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(a.w * scale); cv.height = Math.ceil(a.h * scale);
      const c = cv.getContext('2d');
      if (scale !== 1) {
        Object.defineProperty(c, 'filter', {
          get() { return proto.get.call(c); },
          set(v) { proto.set.call(c, String(v).replace(/blur\(([\d.]+)px\)/g, (m, n) => `blur(${n * scale}px)`)); },
        });
        c.scale(scale, scale);
      }
      a.draw(c);
      out.push({ key: a.key, w: a.w, h: a.h, data: cv.toDataURL('image/png') });
    }
    return out;
  };
  window.ART_SCALE = S;
})();
