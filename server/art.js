// Procedural key-art generator (SVG). Used by the seed script for the fictional
// catalog and by the publish flow to auto-generate a cover when a developer
// doesn't upload one. Deterministic per seed.

function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const hex = (c) => c.replace('#', '');
function mix(a, b, t) {
  const pa = parseInt(hex(a), 16), pb = parseInt(hex(b), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
const f = (n) => Math.round(n * 10) / 10;

function ridge(R, w, h, baseY, amp, rough, step = 12) {
  const ph = [R() * 10, R() * 10, R() * 10];
  let d = `M0 ${h} L0 ${f(baseY)}`;
  for (let x = 0; x <= w + step; x += step) {
    const y = baseY - amp * (0.55 * Math.sin(x / (w * 0.21) + ph[0]) + 0.3 * Math.sin(x / (w * 0.07) + ph[1]) + 0.15 * Math.sin(x / (w * 0.023) + ph[2])) - (R() - 0.5) * rough;
    d += ` L${x} ${f(y)}`;
  }
  return `${d} L${w} ${h} Z`;
}

function stars(R, w, h, n, maxY) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${f(R() * w)}" cy="${f(R() * maxY)}" r="${f(R() * 1.3 + 0.2)}" opacity="${f(R() * 0.8 + 0.2)}"/>`;
  return `<g fill="#fff">${s}</g>`;
}

function catFigure(x, y, s) {
  const body = 'M-14 0C-16-10-12-20-4-22C-2-30 2-34 8-34L10-43L14-35.5L18-35.5L22-43L22.5-33C26-30 27-24 24-20C20-16 16-16 14-14C18-8 18-2 16 0Z';
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})">
<circle cx="17" cy="-27" r="16" fill="#f5ef92" opacity=".08"/>
<path d="M-12-2C-27-2-29-17-20-23" stroke="rgba(160,170,230,.4)" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="${body}" fill="none" stroke="rgba(160,170,230,.45)" stroke-width="2.2"/>
<path d="M-12-2C-27-2-29-17-20-23" stroke="#050407" stroke-width="4" fill="none" stroke-linecap="round"/>
<path d="${body}" fill="#050407"/>
<path fill="#c42f3e" d="M5-19C11-15.5 18-16.5 23-19.5L22.5-16C16-12.5 8-12.5 3.5-15.5Z"/>
<path fill="#c42f3e" d="M5-18C-3-16-9-12-17-14L-14-10C-7-9-1-12 6-15Z"/>
<ellipse cx="15.5" cy="-27" rx="1.6" ry="2.5" fill="#f5ef92"/><ellipse cx="20.5" cy="-27" rx="1.5" ry="2.4" fill="#f5ef92"/>
<path d="M17-7L37-33" stroke="#dfe6f0" stroke-width="1.9"/><path d="M14.5-10L19.5-5" stroke="#8a6a3c" stroke-width="2.6"/>
</g>`;
}

function figure(x, y, s, color) {
  // cloaked wanderer silhouette
  return `<path transform="translate(${f(x)} ${f(y)}) scale(${f(s)})" fill="${color}" d="M0-38c4 0 7 3 7 7 0 3-1 5-3 6l8 10 4 15H-12l3-15 5-10c-2-1-3-3-3-6 0-4 4-7 7-7zM8-14l12-10 2 2-11 11z"/>`;
}

const MOTIFS = {
  mountains(R, w, h, p) {
    const sunY = h * (0.3 + R() * 0.15), sunX = w * (0.25 + R() * 0.5);
    let s = `<circle cx="${f(sunX)}" cy="${f(sunY)}" r="${f(h * 0.5)}" fill="url(#glow)"/><circle cx="${f(sunX)}" cy="${f(sunY)}" r="${f(h * 0.09)}" fill="${p.accent}"/>`;
    s += stars(R, w, h, 60, h * 0.4);
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      s += `<path d="${ridge(R, w, h, h * (0.45 + t * 0.35), h * (0.28 - t * 0.14), h * 0.03, 10)}" fill="${mix(p.far, p.near, t)}"/>`;
      if (i === 2) s += `<rect y="${f(h * 0.5)}" width="${w}" height="${f(h * 0.3)}" fill="url(#fog)"/>`;
    }
    s += figure(w * (0.3 + R() * 0.4), h * 0.86, h / 300, p.near);
    return s;
  },
  city(R, w, h, p) {
    let s = `<circle cx="${f(w * 0.75)}" cy="${f(h * 0.2)}" r="${f(h * 0.4)}" fill="url(#glow)"/><circle cx="${f(w * 0.75)}" cy="${f(h * 0.2)}" r="${f(h * 0.06)}" fill="${p.accent}" opacity=".9"/>`;
    s += stars(R, w, h, 30, h * 0.3);
    for (let layer = 0; layer < 3; layer++) {
      const t = layer / 2;
      const col = mix(p.far, p.near, t);
      let x = -10;
      let rects = '', wins = '';
      while (x < w) {
        const bw = (20 + R() * 60) * (h / 600) * (1 + layer * 0.4);
        const bh = h * (0.2 + R() * 0.45) * (1 - layer * 0.18);
        const y = h - bh;
        rects += `<rect x="${f(x)}" y="${f(y)}" width="${f(bw)}" height="${f(bh)}"/>`;
        if (layer > 0) {
          const ws = 3 + layer * 1.5;
          for (let wy = y + 8; wy < h - 6; wy += ws * 2.4) for (let wx = x + 4; wx < x + bw - 4; wx += ws * 2) if (R() < 0.22) wins += `<rect x="${f(wx)}" y="${f(wy)}" width="${f(ws)}" height="${f(ws * 1.2)}"/>`;
          if (R() < 0.15) wins += `<rect x="${f(x + bw * 0.2)}" y="${f(y + bh * 0.2)}" width="${f(bw * 0.6)}" height="${f(h * 0.015)}" fill="${p.accent2}"/>`;
        }
        x += bw + R() * 6;
      }
      s += `<g fill="${col}">${rects}</g><g fill="${p.accent}" opacity="${0.4 + layer * 0.25}">${wins}</g>`;
      if (layer === 0) s += `<rect y="${f(h * 0.55)}" width="${w}" height="${f(h * 0.45)}" fill="url(#fog)"/>`;
    }
    let rain = '';
    for (let i = 0; i < 90; i++) { const x = R() * w, y = R() * h; rain += `M${f(x)} ${f(y)}l-4 ${f(h * 0.04)}`; }
    s += `<path d="${rain}" stroke="#fff" stroke-opacity=".12" stroke-width="1"/>`;
    return s;
  },
  sea(R, w, h, p) {
    const sunX = w * (0.3 + R() * 0.4), hy = h * 0.58;
    let s = `<circle cx="${f(sunX)}" cy="${f(hy - h * 0.08)}" r="${f(h * 0.55)}" fill="url(#glow)"/><circle cx="${f(sunX)}" cy="${f(hy - h * 0.08)}" r="${f(h * 0.1)}" fill="${p.accent}"/>`;
    s += stars(R, w, h, 25, h * 0.35);
    s += `<path d="${ridge(R, w, h, hy - h * 0.02, h * 0.05, 2, 16)}" fill="${p.far}"/>`;
    s += `<rect y="${f(hy)}" width="${w}" height="${f(h - hy)}" fill="${mix(p.far, p.near, 0.5)}"/>`;
    for (let i = 0; i < 26; i++) { const y = hy + (h - hy) * (i / 26) ** 1.5; const ww = 6 + i * 3; s += `<rect x="${f(sunX - ww * 2 + (R() - 0.5) * 20)}" y="${f(y)}" width="${f(ww * 4 * R())}" height="${f(1 + i * 0.2)}" fill="${p.accent}" opacity="${f(0.7 - i * 0.022)}"/>`; }
    for (let i = 0; i < 4; i++) s += `<path d="${ridge(R, w, h, hy + (h - hy) * (0.3 + i * 0.2), h * 0.012, 3, 8)}" fill="${mix(p.far, p.near, 0.6 + i * 0.13)}" opacity=".85"/>`;
    // lighthouse on a rock
    const lx = w * (R() < 0.5 ? 0.12 : 0.82), ly = hy + h * 0.05, ls = h / 500;
    s += `<path d="M${f(lx - 60 * ls)} ${f(ly + 30 * ls)}q${f(60 * ls)} ${f(-40 * ls)} ${f(130 * ls)} 0z" fill="${p.near}"/>`;
    s += `<path d="M${f(lx - 8 * ls)} ${f(ly + 10 * ls)}l${f(4 * ls)} ${f(-90 * ls)}h${f(14 * ls)}l${f(4 * ls)} ${f(90 * ls)}z" fill="${p.near}"/><rect x="${f(lx - 6 * ls)}" y="${f(ly - 95 * ls)}" width="${f(20 * ls)}" height="${f(12 * ls)}" fill="${p.accent}"/>`;
    s += `<path d="M${f(lx + 4 * ls)} ${f(ly - 89 * ls)}L${f(lx + (lx < w / 2 ? 1 : -1) * w * 0.6)} ${f(ly - 160 * ls)}L${f(lx + (lx < w / 2 ? 1 : -1) * w * 0.6)} ${f(ly - 40 * ls)}z" fill="${p.accent}" opacity=".12"/>`;
    return s;
  },
  space(R, w, h, p) {
    let s = stars(R, w, h, 260, h);
    for (let i = 0; i < 5; i++) s += `<circle cx="${f(R() * w)}" cy="${f(R() * h)}" r="${f(h * (0.2 + R() * 0.3))}" fill="${i % 2 ? p.accent2 : p.accent}" opacity=".13" filter="url(#blur)"/>`;
    const px = w * (0.55 + R() * 0.3), py = h * (0.45 + R() * 0.2), pr = h * (0.26 + R() * 0.1);
    s += `<defs><radialGradient id="pl" cx="35%" cy="30%"><stop offset="0" stop-color="${p.accent}"/><stop offset=".55" stop-color="${mix(p.accent, p.far, 0.6)}"/><stop offset="1" stop-color="${p.near}"/></radialGradient></defs>`;
    s += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(pr * 1.9)}" ry="${f(pr * 0.35)}" fill="none" stroke="${p.accent2}" stroke-opacity=".5" stroke-width="${f(pr * 0.08)}" transform="rotate(-14 ${f(px)} ${f(py)})"/>`;
    s += `<circle cx="${f(px)}" cy="${f(py)}" r="${f(pr)}" fill="url(#pl)"/>`;
    s += `<path d="M${f(px - pr * 1.9)} ${f(py)}a${f(pr * 1.9)} ${f(pr * 0.35)} 0 0 0 ${f(pr * 3.8)} 0" fill="none" stroke="${p.accent2}" stroke-opacity=".7" stroke-width="${f(pr * 0.08)}" transform="rotate(-14 ${f(px)} ${f(py)})"/>`;
    // ship
    const sx = w * (0.15 + R() * 0.25), sy = h * (0.3 + R() * 0.4), ss = h / 400;
    s += `<g transform="translate(${f(sx)} ${f(sy)}) rotate(-20) scale(${f(ss)})"><path d="M0 0l46 8-46 8 8-8z" fill="${p.near}" stroke="${p.accent}" stroke-width="1.5"/><path d="M0 4l-40 4 40 4z" fill="${p.accent2}" opacity=".8"/></g>`;
    s += `<path d="${ridge(R, w, h, h * 0.94, h * 0.05, 4, 10)}" fill="${p.near}"/>`;
    return s;
  },
  forest(R, w, h, p) {
    let s = `<circle cx="${f(w * (0.3 + R() * 0.4))}" cy="${f(h * 0.28)}" r="${f(h * 0.45)}" fill="url(#glow)"/><circle cx="${f(w * 0.5)}" cy="${f(h * 0.28)}" r="${f(h * 0.07)}" fill="${p.accent}" opacity=".85"/>`;
    s += stars(R, w, h, 40, h * 0.35);
    for (let layer = 0; layer < 4; layer++) {
      const t = layer / 3;
      const base = h * (0.62 + t * 0.3);
      let d = '';
      for (let x = -20; x < w + 20; x += (8 + R() * 22) * (1 + t) * (h / 600)) {
        const th = h * (0.18 + R() * 0.2) * (0.7 + t * 0.6), tw = th * 0.32;
        d += `M${f(x)} ${f(base - th)}l${f(tw / 2)} ${f(th * 0.45)}h${f(-tw * 0.18)}l${f(tw * 0.35)} ${f(th * 0.35)}h${f(-tw * 0.2)}l${f(tw * 0.4)} ${f(th * 0.3)}h${f(-tw * 2.2)}l${f(tw * 0.4)} ${f(-th * 0.3)}h${f(-tw * 0.2)}l${f(tw * 0.35)} ${f(-th * 0.35)}h${f(-tw * 0.18)}z`;
      }
      s += `<path d="${d}" fill="${mix(p.far, p.near, t)}"/><rect y="${f(base - 4)}" width="${w}" height="${f(h - base + 4)}" fill="${mix(p.far, p.near, t)}"/>`;
      if (layer < 2) s += `<rect y="${f(base - h * 0.15)}" width="${w}" height="${f(h * 0.25)}" fill="url(#fog)"/>`;
    }
    const lx = w * (0.35 + R() * 0.3);
    s += `<circle cx="${f(lx)}" cy="${f(h * 0.88)}" r="${f(h * 0.12)}" fill="url(#glow)"/>${figure(lx, h * 0.93, h / 320, '#050608')}<circle cx="${f(lx + h * 0.05)}" cy="${f(h * 0.88)}" r="${f(h * 0.008)}" fill="${p.accent}"/>`;
    for (let i = 0; i < 30; i++) s += `<circle cx="${f(R() * w)}" cy="${f(h * 0.5 + R() * h * 0.45)}" r="${f(R() * 2 + 0.6)}" fill="${p.accent2}" opacity="${f(R() * 0.8)}"/>`;
    return s;
  },
  dungeon(R, w, h, p) {
    let s = `<rect width="${w}" height="${h}" fill="${p.far}"/>`;
    const cx = w * 0.5, vy = h * 0.5;
    for (let i = 7; i >= 0; i--) {
      const t = i / 7, sc = 0.18 + (1 - t) * 1.1, aw = w * 0.34 * sc, ah = h * 0.7 * sc;
      const col = mix(p.near, p.far, t * 0.9);
      s += `<path fill-rule="evenodd" fill="${col}" d="M${f(cx - aw * 1.6)} ${f(vy - ah)}h${f(aw * 3.2)}v${f(ah * 2)}h${f(-aw * 3.2)}z M${f(cx - aw / 2)} ${f(vy + ah * 0.6)}v${f(-ah * 0.8)}a${f(aw / 2)} ${f(aw / 2)} 0 0 1 ${f(aw)} 0v${f(ah * 0.8)}z"/>`;
      if (i % 2 === 0) for (const side of [-1, 1]) { const tx = cx + side * aw * 0.75, ty = vy - ah * 0.1; s += `<circle cx="${f(tx)}" cy="${f(ty)}" r="${f(aw * 0.5)}" fill="url(#glow)"/><path d="M${f(tx)} ${f(ty - aw * 0.12)}q${f(aw * 0.05)} ${f(aw * 0.08)} 0 ${f(aw * 0.14)}q${f(-aw * 0.05)} ${f(-aw * 0.06)} 0 ${f(-aw * 0.14)}z" fill="${p.accent}"/>`; }
    }
    s += `<ellipse cx="${f(cx)}" cy="${f(vy + h * 0.02)}" rx="${f(w * 0.05)}" ry="${f(h * 0.12)}" fill="${p.accent2}" opacity=".35" filter="url(#blur)"/>`;
    s += figure(cx, h * 0.97, h / 170, '#040405');
    return s;
  },
  desert(R, w, h, p) {
    const sx = w * (0.3 + R() * 0.4);
    let s = `<circle cx="${f(sx)}" cy="${f(h * 0.42)}" r="${f(h * 0.7)}" fill="url(#glow)"/><circle cx="${f(sx)}" cy="${f(h * 0.42)}" r="${f(h * 0.2)}" fill="${p.accent}"/>`;
    for (let i = 0; i < 5; i++) s += `<rect x="${f(sx - h * 0.2)}" y="${f(h * (0.44 + i * 0.035))}" width="${f(h * 0.4)}" height="${f(h * 0.008 + i * 1.5)}" fill="${p.sky1}" opacity=".9"/>`;
    for (let i = 0; i < 4; i++) {
      const t = i / 3, base = h * (0.62 + t * 0.28);
      let d = `M0 ${h}L0 ${f(base)}`;
      const ph = R() * 6;
      for (let x = 0; x <= w + 20; x += 20) d += `L${x} ${f(base - Math.abs(Math.sin(x / (w * 0.18) + ph)) * h * 0.08 * (1 - t * 0.4))}`;
      s += `<path d="${d}L${w} ${h}z" fill="${mix(p.far, p.near, t)}"/>`;
      if (i === 1) { const mx = w * (0.15 + R() * 0.7); s += `<rect x="${f(mx)}" y="${f(base - h * 0.34)}" width="${f(h * 0.05)}" height="${f(h * 0.3)}" fill="${p.near}"/><rect x="${f(mx + h * 0.018)}" y="${f(base - h * 0.3)}" width="${f(h * 0.012)}" height="${f(h * 0.2)}" fill="${p.accent2}" opacity=".8"/>`; }
    }
    s += figure(w * 0.62, h * 0.9, h / 360, p.near);
    return s;
  },
  synth(R, w, h, p) {
    const hy = h * 0.6;
    let s = stars(R, w, h, 80, hy);
    s += `<circle cx="${f(w / 2)}" cy="${f(hy - h * 0.12)}" r="${f(h * 0.6)}" fill="url(#glow)"/>`;
    s += `<defs><linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.accent2}"/></linearGradient></defs>`;
    const r = h * 0.24;
    s += `<circle cx="${f(w / 2)}" cy="${f(hy - h * 0.1)}" r="${f(r)}" fill="url(#sun)"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="${f(w / 2 - r)}" y="${f(hy - h * 0.1 + i * r * 0.16)}" width="${f(r * 2)}" height="${f(2 + i * 1.6)}" fill="${p.sky2}"/>`;
    s += `<path d="${ridge(R, w, h, hy, h * 0.1, h * 0.04, 30)}" fill="${p.far}" stroke="${p.accent2}" stroke-opacity=".6" stroke-width="1.5"/>`;
    s += `<rect y="${f(hy)}" width="${w}" height="${f(h - hy)}" fill="${p.near}"/>`;
    let grid = '';
    for (let i = -30; i <= 30; i++) grid += `M${f(w / 2 + i * w * 0.012)} ${f(hy)}L${f(w / 2 + i * w * 0.12)} ${h}`;
    for (let i = 1; i < 14; i++) { const y = hy + (h - hy) * (i / 14) ** 2; grid += `M0 ${f(y)}H${w}`; }
    s += `<path d="${grid}" stroke="${p.accent2}" stroke-opacity=".55" stroke-width="1.2"/>`;
    s += `<rect y="${f(hy - 2)}" width="${w}" height="${f(h * 0.1)}" fill="url(#fog)"/>`;
    return s;
  },
  crystal(R, w, h, p) {
    let s = `<rect width="${w}" height="${h}" fill="${p.far}"/>`;
    s += `<path d="${ridge(R, w, h, h * 0.2, h * 0.12, h * 0.05, 14)}" transform="scale(1 -1) translate(0 -${h})" fill="${p.near}"/>`;
    for (let i = 0; i < 16; i++) {
      const x = R() * w, base = h * (0.7 + R() * 0.3), ch = h * (0.1 + R() * 0.35), cw = ch * (0.15 + R() * 0.12), tilt = (R() - 0.5) * ch * 0.4;
      const col = R() < 0.5 ? p.accent : p.accent2;
      s += `<circle cx="${f(x + tilt / 2)}" cy="${f(base - ch / 2)}" r="${f(ch * 0.7)}" fill="${col}" opacity=".12" filter="url(#blur)"/>`;
      s += `<path d="M${f(x - cw)} ${f(base)}L${f(x - cw * 0.6 + tilt)} ${f(base - ch * 0.8)}L${f(x + tilt)} ${f(base - ch)}L${f(x + cw * 0.6 + tilt)} ${f(base - ch * 0.8)}L${f(x + cw)} ${f(base)}z" fill="${col}" opacity=".85"/>`;
      s += `<path d="M${f(x)} ${f(base)}L${f(x + tilt)} ${f(base - ch)}L${f(x + cw * 0.6 + tilt)} ${f(base - ch * 0.8)}L${f(x + cw)} ${f(base)}z" fill="#000" opacity=".3"/>`;
    }
    s += `<path d="${ridge(R, w, h, h * 0.95, h * 0.04, 4, 12)}" fill="${p.near}"/>`;
    s += figure(w * 0.5, h * 0.93, h / 330, '#030304');
    return s;
  },
};

function frame(w, h, p, body, seed) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky1}"/><stop offset="1" stop-color="${p.sky2}"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="${p.accent}" stop-opacity=".55"/><stop offset=".4" stop-color="${p.accent}" stop-opacity=".14"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>
<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.fog}" stop-opacity="0"/><stop offset=".5" stop-color="${p.fog}" stop-opacity=".35"/><stop offset="1" stop-color="${p.fog}" stop-opacity="0"/></linearGradient>
<radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(h * 0.04)}"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed.length}"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .09 0"/></filter>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
${body}
<rect width="${w}" height="${h}" fill="url(#vig)"/>
<rect width="${w}" height="${h}" filter="url(#grain)" opacity=".6"/>
</svg>`;
}

function hud(kind, w, h, p, R) {
  const t = (x, y, s, txt, a = 'start', c = '#fff') => `<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${s}" font-weight="600" fill="${c}" text-anchor="${a}">${txt}</text>`;
  if (kind === 'action') {
    return `<g opacity=".92"><rect x="28" y="${h - 58}" width="240" height="12" fill="#000" opacity=".5"/><rect x="28" y="${h - 58}" width="${f(120 + R() * 110)}" height="12" fill="${p.accent}"/>
<rect x="28" y="${h - 40}" width="180" height="6" fill="#000" opacity=".5"/><rect x="28" y="${h - 40}" width="${f(60 + R() * 110)}" height="6" fill="#7fd1ff"/>
<rect x="${w - 168}" y="24" width="144" height="144" fill="#000" opacity=".45" stroke="#fff" stroke-opacity=".3"/><circle cx="${w - 96}" cy="96" r="4" fill="${p.accent}"/>
${t(w - 28, h - 34, 30, `${Math.floor(R() * 90 + 10)} / 120`, 'end')}${t(28, 44, 16, 'OBJECTIVE', 'start', p.accent)}${t(28, 66, 18, 'Reach the old signal tower')}</g>`;
  }
  if (kind === 'strategy') {
    let s = `<rect width="${w}" height="36" fill="#000" opacity=".6"/>`;
    ['◆ 1,240', '▲ 386', '● 72', '☗ 14/20'].forEach((v, i) => { s += t(24 + i * 130, 24, 16, v, 'start', i === 0 ? p.accent : '#e8e8e8'); });
    s += `<rect y="${h - 110}" width="${w}" height="110" fill="#000" opacity=".55"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="${24 + i * 86}" y="${h - 92}" width="72" height="72" fill="${mix(p.far, p.accent, 0.15 + (i % 3) * 0.1)}" stroke="#fff" stroke-opacity=".25"/>`;
    return s + t(w - 24, h - 50, 20, 'DAY 34 · AUTUMN', 'end', p.accent);
  }
  if (kind === 'rpg') {
    return `<rect x="${w * 0.12}" y="${h - 170}" width="${w * 0.76}" height="140" fill="#000" opacity=".72" stroke="${p.accent}" stroke-opacity=".6"/>${t(w * 0.12 + 28, h - 132, 20, 'The Keeper', 'start', p.accent)}${t(w * 0.12 + 28, h - 98, 19, 'Nobody has crossed the old road since the lanterns went out.')}${t(w * 0.12 + 28, h - 70, 19, 'If you mean to go, take this — and do not look back.')}`;
  }
  if (kind === 'puzzle') {
    let s = `<rect x="${w / 2 - 220}" y="${h / 2 - 220}" width="440" height="440" fill="#000" opacity=".45"/>`;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (R() < 0.6) s += `<rect x="${w / 2 - 210 + i * 84}" y="${h / 2 - 210 + j * 84}" width="76" height="76" fill="${R() < 0.5 ? p.accent : p.accent2}" opacity="${f(0.35 + R() * 0.5)}"/>`;
    return s + t(40, 60, 22, 'MOVES 14', 'start', p.accent) + t(w - 40, 60, 22, 'LEVEL 3-7', 'end');
  }
  return '';
}

export function art(kind, { seed, motif, palette, hudKind, cat = false }) {
  const sizes = { cover: [600, 900], header: [920, 430], hero: [1920, 620], shot: [1280, 720] };
  const [w, h] = sizes[kind];
  const R = rng(`${seed}:${kind}`);
  const fn = MOTIFS[motif] ?? MOTIFS.mountains;
  let body = fn(R, w, h, palette);
  if (cat) {
    // swap the generic wanderer for the cat hero, larger and centred-ish
    body = body.replace(/<path transform="translate\([^"]*\) scale\([^"]*\)" fill="[^"]*" d="M0-38[^"]*"\/>/g, '');
    const cx = kind === 'cover' ? w * 0.5 : kind === 'hero' ? w * 0.72 : w * 0.8;
    body += catFigure(cx, h * (kind === 'cover' ? 0.78 : 0.93), h / (kind === 'cover' ? 260 : 190));
  }
  if (kind === 'shot' && hudKind) body += hud(hudKind, w, h, palette, R);
  return frame(w, h, palette, body, seed);
}

// Derive a palette from a string (used when a publisher doesn't upload art).
export function paletteFromSeed(seed) {
  const R = rng(seed);
  const presets = [
    { sky1: '#0b1026', sky2: '#3a1f4d', far: '#2a1a3d', near: '#0a0710', fog: '#9b6cc7', accent: '#ffb35c', accent2: '#ff5e8a' },
    { sky1: '#061a24', sky2: '#1f4b5a', far: '#1b3a44', near: '#050d10', fog: '#7fc4c9', accent: '#f4e3a1', accent2: '#5ce1e6' },
    { sky1: '#1a0b0b', sky2: '#5a2414', far: '#3b170f', near: '#0d0504', fog: '#ff9a62', accent: '#ffcf70', accent2: '#ff6a3d' },
    { sky1: '#07120c', sky2: '#1d3b2a', far: '#163022', near: '#040806', fog: '#9fd9a8', accent: '#e8f59b', accent2: '#7cf0b0' },
  ];
  return presets[Math.floor(R() * presets.length)];
}
export const MOTIF_NAMES = Object.keys(MOTIFS);
