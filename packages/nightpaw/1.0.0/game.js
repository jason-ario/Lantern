// NIGHTPAW — a tiny metroidvania for the Vibe-Games runtime.
// A small black cat with a red scarf and a borrowed sword descends into the deep.
// Persistence and achievements go exclusively through the Vibe-Games Platform SDK.
(() => {
  'use strict';

  // ======================================================================
  // Constants
  // ======================================================================
  const T = 16, VW = 400, VH = 225, STEP = 1 / 120;
  const PH = { G: 1150, JUMP: 345, JUMP2: 305, RUN: 108, MAXFALL: 430, DASH: 330, DASHT: 0.22 };
  const SAVE_KEY = 'save';
  const INK = '#07060a';

  // ======================================================================
  // Canvas & scaling (fixed 480x270 world view, crisp at any resolution)
  // ======================================================================
  const cv = document.getElementById('screen');
  const ctx = cv.getContext('2d');
  const lightCv = document.createElement('canvas');
  lightCv.width = VW; lightCv.height = VH;
  const lctx = lightCv.getContext('2d');
  let CW = 0, CH = 0, S = 1, OX = 0, OY = 0;
  function resize() {
    const d = Math.min(2, window.devicePixelRatio || 1);
    CW = Math.round(window.innerWidth * d); CH = Math.round(window.innerHeight * d);
    cv.width = CW; cv.height = CH;
    S = Math.min(CW / VW, CH / VH);
    OX = Math.round((CW - VW * S) / 2); OY = Math.round((CH - VH * S) / 2);
    rooms.forEach((r) => { r.cache = null; });
  }

  // ======================================================================
  // Utilities
  // ======================================================================
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ======================================================================
  // Input: keyboard + gamepad + touch → one action map
  // ======================================================================
  const BIND = {
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
    jump: ['Space', 'KeyZ', 'KeyK'], attack: ['KeyX', 'KeyJ'], dash: ['KeyC', 'KeyL', 'ShiftLeft', 'ShiftRight'],
    map: ['KeyM', 'Tab'], pause: ['Escape', 'KeyP'], confirm: ['Enter', 'Space', 'KeyZ', 'KeyK', 'KeyX', 'KeyJ'],
  };
  const keys = {}, touch = {}, latch = {};
  let cur = {}, prev = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true; if (!e.repeat) latch[e.code] = true; audioInit();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  function readPad() {
    const out = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) return out;
    const b = (i) => gp.buttons[i]?.pressed;
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    out.left = ax < -0.4 || b(14); out.right = ax > 0.4 || b(15);
    out.up = ay < -0.5 || b(12); out.down = ay > 0.5 || b(13);
    out.jump = b(0); out.attack = b(2); out.dash = b(1) || b(5) || b(7);
    out.map = b(8) || b(3); out.pause = b(9); out.confirm = b(0) || b(9);
    return out;
  }
  // `prev` is only advanced when an update step consumes input, so a press is
  // never lost on frames that run zero fixed steps (high-refresh displays).
  function pollInput() {
    const pad = readPad();
    readPadCache = pad;
    cur = {};
    // latch: a tap shorter than one frame still registers as a press
    for (const a in BIND) cur[a] = BIND[a].some((k) => keys[k] || latch[k]) || !!touch[a] || !!latch[`touch:${a}`] || !!pad[a];
    if (cur.jump && (touch.jump || latch['touch:jump'])) cur.confirm = true;
  }
  let readPadCache = {};
  const held = (a) => !!cur[a];
  const pressed = (a) => !!cur[a] && !prev[a];
  const released = (a) => !cur[a] && !!prev[a];
  function consumeEdges() {
    prev = { ...cur };
    for (const k in latch) delete latch[k];
    // a latched key that is already released must read as released next step
    for (const a in BIND) if (cur[a] && !BIND[a].some((k) => keys[k]) && !touch[a] && !readPadCache[a]) cur[a] = false;
  }

  // Touch controls (shown on coarse pointers)
  const touchUi = document.getElementById('touch');
  if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) touchUi.hidden = false;
  touchUi.querySelectorAll('button').forEach((btn) => {
    const k = btn.dataset.k;
    const on = (e) => { e.preventDefault(); touch[k] = true; latch[`touch:${k}`] = true; btn.classList.add('on'); audioInit(); };
    const off = (e) => { e.preventDefault(); touch[k] = false; btn.classList.remove('on'); };
    btn.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, off));
  });
  cv.addEventListener('pointerdown', (e) => {
    audioInit();
    const x = (e.clientX * (CW / window.innerWidth) - OX) / S, y = (e.clientY * (CH / window.innerHeight) - OY) / S;
    uiClick(x, y);
  });

  // ======================================================================
  // Audio (synthesised — no audio files)
  // ======================================================================
  let AC = null, master = null, noiseBuf = null;
  function audioInit() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new AudioContext();
      master = AC.createGain(); master.gain.value = 0.55; master.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startAmbience();
    } catch { AC = null; }
  }
  function tone(freq, dur, type = 'sine', vol = 0.1, slide = 0, delay = 0) {
    if (!AC) return;
    const t0 = AC.currentTime + delay;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, freq, q, vol, sweep = 0) {
    if (!AC) return;
    const t0 = AC.currentTime;
    const s = AC.createBufferSource(); s.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(master); s.start(t0); s.stop(t0 + dur);
  }
  const sfx = {
    slash: () => noise(0.13, 3200, 1.2, 0.35, -2200),
    hit: () => { tone(160, 0.12, 'square', 0.12, -90); noise(0.09, 900, 1, 0.3); },
    clink: () => tone(1800, 0.08, 'triangle', 0.06, -600),
    jump: () => tone(260, 0.09, 'triangle', 0.05, 180),
    wing: () => { noise(0.18, 1400, 0.6, 0.18, 1200); tone(520, 0.14, 'sine', 0.05, 400); },
    dash: () => noise(0.22, 700, 0.5, 0.35, -400),
    land: () => noise(0.05, 300, 1, 0.12),
    hurt: () => { tone(220, 0.35, 'sawtooth', 0.12, -160); noise(0.2, 400, 0.7, 0.3); },
    glim: () => tone(1500 + Math.random() * 400, 0.06, 'sine', 0.04, 500),
    pickup: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'sine', 0.08, 0, i * 0.09)),
    rest: () => [220, 277, 330, 440].forEach((f) => tone(f, 1.6, 'sine', 0.05)),
    roar: () => { tone(65, 1.4, 'sawtooth', 0.22, -25); noise(1.2, 180, 0.6, 0.35, -100); },
    slam: () => { noise(0.45, 160, 0.8, 0.6, -80); tone(55, 0.4, 'sine', 0.3, -20); },
    die: () => { tone(330, 1.2, 'triangle', 0.1, -260); noise(0.6, 600, 0.5, 0.2, -500); },
    enemyDie: () => { noise(0.25, 500, 0.7, 0.3, -350); tone(120, 0.2, 'square', 0.06, -60); },
    menu: () => tone(880, 0.05, 'sine', 0.04),
  };
  function startAmbience() {
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = AC.createGain(); g.gain.value = 0.05;
    [55, 55.6, 82.4].forEach((hz) => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(); });
    const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 90; lfo.connect(lg).connect(f.frequency); lfo.start();
    f.connect(g).connect(master);
    ambienceGain = g;
    setInterval(() => { if (mode === 'play' && !paused && Math.random() < 0.5) tone(rand(1200, 2400), 0.4, 'sine', 0.012, -200); }, 2300);
  }
  let ambienceGain = null;

  // ======================================================================
  // World
  // ======================================================================
  let rooms = [];
  const ENTITY_CHARS = 'PcwgDAHBS';
  function loadWorld(data) {
    rooms = data.rooms.map((r) => {
      const grid = [], spawns = [], doors = [];
      r.rows.forEach((row, y) => {
        const line = [];
        [...row].forEach((ch, x) => {
          if (ENTITY_CHARS.includes(ch)) { spawns.push({ ch, x, y, id: `${r.id}:${x},${y}` }); line.push('.'); }
          else if (/[0-9]/.test(ch)) { doors.push({ x, y, ch }); line.push('.'); }
          else line.push(ch);
        });
        grid.push(line);
      });
      const w = grid[0].length, h = grid.length;
      return { ...r, grid, spawns, doors, w, h, px: r.ox * T, py: r.oy * T, pw: w * T, ph: h * T, cache: null, layers: makeLayers(r.id, w * T, h * T) };
    });
  }
  function roomAt(px, py) {
    return rooms.find((r) => px >= r.px && px < r.px + r.pw && py >= r.py && py < r.py + r.ph) ?? null;
  }
  function tileAt(tx, ty) {
    let r = room;
    if (!r || tx < r.ox || tx >= r.ox + r.w || ty < r.oy || ty >= r.oy + r.h) r = rooms.find((q) => tx >= q.ox && tx < q.ox + q.w && ty >= q.oy && ty < q.oy + q.h);
    if (!r) return '#';
    return r.grid[ty - r.oy][tx - r.ox];
  }
  const isSolid = (ch) => ch === '#' || ch === 'X';

  // Axis-separated tile collision. Sets e.onGround / e.hitX / e.hitCeil.
  function moveBody(e, dt) {
    e.hitX = false; e.hitCeil = false;
    if (e.vx) {
      e.x += e.vx * dt;
      const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.01) / T);
      if (e.vx > 0) {
        const tx = Math.floor((e.x + e.w) / T);
        for (let ty = y0; ty <= y1; ty++) if (isSolid(tileAt(tx, ty))) { e.x = tx * T - e.w; e.hitX = true; break; }
      } else {
        const tx = Math.floor(e.x / T);
        for (let ty = y0; ty <= y1; ty++) if (isSolid(tileAt(tx, ty))) { e.x = (tx + 1) * T; e.hitX = true; break; }
      }
    }
    const prevBottom = e.y + e.h;
    e.y += e.vy * dt;
    const wasGround = e.onGround;
    e.onGround = false;
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.01) / T);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h) / T);
      for (let tx = x0; tx <= x1; tx++) {
        const ch = tileAt(tx, ty);
        if (isSolid(ch) || (ch === '=' && prevBottom <= ty * T + 0.5 && !(e.dropT > 0))) {
          e.y = ty * T - e.h; e.vy = 0; e.onGround = true; break;
        }
      }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / T);
      for (let tx = x0; tx <= x1; tx++) if (isSolid(tileAt(tx, ty))) { e.y = (ty + 1) * T; e.vy = 0; e.hitCeil = true; break; }
    }
    e.landed = e.onGround && !wasGround;
  }
  function boxHasTile(x, y, w, h, pred) {
    for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - 0.01) / T); tx++)
      for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - 0.01) / T); ty++) if (pred(tileAt(tx, ty), tx, ty)) return true;
    return false;
  }

  // ======================================================================
  // Game state
  // ======================================================================
  let mode = 'boot'; // boot | title | play | message | ending
  let paused = false, showMap = false;
  let room = null, ents = [], parts = [];
  let cam = { x: 0, y: 0 }, shake = 0, hitstop = 0, fade = 0, flash = 0, time = 0;
  let areaTitle = null, message = null, saveIcon = 0, bossBar = null;
  let saved = null;          // last loaded/saved progress (for Continue)
  let prog = null;           // live progress
  let visited = new Set(), taken = new Set();
  let launchMode = 'full';
  let menu = [], menuSel = 0;
  const unlockedAch = new Set();

  function newProgress() {
    return { v: 1, has: { wings: false, dash: false }, maxHp: 5, hp: 5, glimmers: 0, visited: [], taken: [], boss: false, deaths: 0, shrine: null, pos: null, playSeconds: 0, savedAt: 0 };
  }

  const P = {
    x: 0, y: 0, w: 10, h: 14, vx: 0, vy: 0, face: 1, onGround: false, hp: 5,
    coyote: 0, buffer: 0, airJumps: 0, airDash: true, dashT: 0, dashCd: 0, dropT: 0,
    atkT: 0, atkAnim: 0, atkCd: 0, atkDir: 'side', hitSet: null,
    invuln: 0, knockT: 0, knockVx: 0, recoilT: 0, hazardT: 0,
    dead: false, deadT: 0, resting: false, safeX: 0, safeY: 0, runT: 0, blinkT: 3, landT: 0,
  };

  // ======================================================================
  // Achievements & saving (through the Platform SDK only)
  // ======================================================================
  function achieve(id) {
    if (unlockedAch.has(id)) return;
    unlockedAch.add(id);
    Platform.achievements.unlock(id).catch(() => unlockedAch.delete(id));
  }
  let saving = false, saveAgain = false;
  async function save() {
    if (!prog) return;
    if (saving) { saveAgain = true; return; }
    saving = true;
    prog.visited = [...visited]; prog.taken = [...taken];
    prog.pos = { x: P.safeX, y: P.safeY };
    prog.hp = Math.max(1, P.hp);
    prog.savedAt = Date.now();
    try {
      await Platform.storage.save(SAVE_KEY, prog);
      saved = JSON.parse(JSON.stringify(prog));
      saveIcon = 2.2;
    } catch (e) { /* offline — keep playing */ }
    saving = false;
    if (saveAgain) { saveAgain = false; save(); }
  }
  Platform.game.onExit(() => { if (mode === 'play' || mode === 'message' || mode === 'ending') { saving = false; return save(); } return null; });
  Platform.game.onPause(() => { paused = true; });
  setInterval(() => { if (mode === 'play' && !P.dead) save(); }, 20000);

  // ======================================================================
  // Entities
  // ======================================================================
  function spawnRoom(r) {
    ents = [];
    // objects sit on the first floor below their marker
    const ground = (sx, sy) => { for (let yy = sy + 1; yy < r.h; yy++) { const ch = r.grid[yy][sx]; if (ch === '#' || ch === '=') return yy - 1; } return sy; };
    for (const s of r.spawns) {
      const x = (r.ox + s.x) * T;
      const y = (r.oy + ('gDAHS'.includes(s.ch) ? ground(s.x, s.y) : s.y)) * T;
      switch (s.ch) {
        case 'c': ents.push({ type: 'crawler', x: x + 1, y: y + 6, w: 14, h: 10, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, hp: 2, harm: true, flash: 0, kbT: 0, t: rand(0, 5) }); break;
        case 'w': ents.push({ type: 'wisp', x: x + 2, y: y + 2, w: 12, h: 12, vx: 0, vy: 0, hx: x + 2, hy: y + 2, hp: 2, harm: true, flash: 0, t: rand(0, 5) }); break;
        case 'g': if (!taken.has(s.id)) ents.push({ type: 'item', kind: 'glim', id: s.id, x: x + 3, y: y + 4, w: 10, h: 10, t: rand(0, 5) }); break;
        case 'D': if (!taken.has(s.id)) ents.push({ type: 'item', kind: 'wings', id: s.id, x: x + 1, y: y, w: 14, h: 16, t: 0 }); break;
        case 'A': if (!taken.has(s.id)) ents.push({ type: 'item', kind: 'dash', id: s.id, x: x + 1, y: y, w: 14, h: 16, t: 0 }); break;
        case 'H': if (!taken.has(s.id)) ents.push({ type: 'item', kind: 'heart', id: s.id, x: x + 1, y: y, w: 14, h: 16, t: 0 }); break;
        case 'S': ents.push({ type: 'shrine', x: x - 4, y: y - 8, w: 24, h: 24, t: rand(0, 5) }); break;
        case 'B': if (!prog.boss) ents.push(makeBoss(x - 10, y - 24)); break;
        default: break;
      }
    }
  }

  function makeBoss(x, y) {
    return { type: 'boss', x, y, w: 34, h: 38, vx: 0, vy: 0, hp: 26, maxHp: 26, state: 'dormant', t: 0, face: -1, flash: 0, harm: false, onGround: true };
  }

  function burst(x, y, n, color, spd = 120, life = 0.6, size = 2, grav = 300) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(spd * 0.3, spd);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.3, life: rand(life * 0.5, life), max: life, color, size: rand(size * 0.6, size), grav });
    }
  }
  function dropGlimmers(x, y, n) {
    for (let i = 0; i < n; i++) parts.push({ glim: true, x, y, vx: rand(-80, 80), vy: rand(-180, -80), life: 3, max: 3, color: '#9fe9ff', size: 2, grav: 500, homeT: rand(0.35, 0.6) });
  }

  function hurtPlayer(n, fromX, hazard = false) {
    if (P.invuln > 0 || P.dead || P.hazardT > 0) return;
    P.hp -= n; P.resting = false;
    sfx.hurt(); shake = 7; hitstop = 0.09; flash = 0.18;
    burst(P.x + 5, P.y + 7, 14, '#1a1522', 160, 0.5, 3);
    if (P.hp <= 0) { die(); return; }
    P.invuln = 1.2;
    if (hazard) { P.hazardT = 0.45; P.vx = 0; P.vy = 0; return; }
    P.knockT = 0.2; P.knockVx = (P.x + P.w / 2 < fromX ? -1 : 1) * 170; P.vy = -220; P.dashT = 0;
  }

  function die() {
    P.dead = true; P.deadT = 0; P.hp = 0;
    prog.deaths++;
    sfx.die(); shake = 10;
    burst(P.x + 5, P.y + 7, 40, '#0c0a10', 220, 1.2, 3.5, 150);
    burst(P.x + 5, P.y + 7, 16, '#f3ee8a', 160, 0.8, 1.5, 0);
  }

  function respawn() {
    const bossEnt = ents.find((e) => e.type === 'boss');
    if (bossEnt && bossEnt.state !== 'dormant') closeGate(false);
    const pos = prog.shrine ?? startPos();
    placePlayer(pos.x, pos.y);
    P.hp = prog.maxHp; P.dead = false; P.invuln = 1; P.vx = P.vy = 0;
    enterRoom(roomAt(P.x + 5, P.y + 7), { snap: true, quiet: true });
    fade = 1; bossBar = null;
    save();
  }

  function startPos() {
    const r = rooms.find((q) => q.spawns.some((s) => s.ch === 'P'));
    const s = r.spawns.find((q) => q.ch === 'P');
    return { x: (r.ox + s.x) * T + 3, y: (r.oy + s.y) * T + T - 14 };
  }
  function placePlayer(x, y) { P.x = x; P.y = y; P.safeX = x; P.safeY = y; }

  function closeGate(close) {
    const r = rooms.find((q) => q.id === 'throne');
    for (const d of r.doors) r.grid[d.y][d.x] = close ? 'X' : '.';
  }

  function enterRoom(r, { snap = false, quiet = false } = {}) {
    const first = !visited.has(r.id);
    room = r;
    visited.add(r.id);
    spawnRoom(r);
    if (first && !quiet) areaTitle = { name: r.name, t: 0 };
    if (snap) snapCamera();
    if (ambienceGain && AC) ambienceGain.gain.setTargetAtTime(r.id === 'throne' ? 0.08 : 0.05, AC.currentTime, 1);
  }

  // ======================================================================
  // Player update
  // ======================================================================
  function updatePlayer(dt) {
    P.blinkT -= dt; if (P.blinkT < -0.12) P.blinkT = rand(2, 5);
    if (P.dead) {
      P.deadT += dt;
      if (P.deadT > 1.8) respawn();
      return;
    }
    if (P.hazardT > 0) {
      P.hazardT -= dt;
      if (P.hazardT <= 0) {
        P.x = P.safeX; P.y = P.safeY; P.vx = P.vy = 0; fade = 0.8;
        const r = roomAt(P.x + P.w / 2, P.y + P.h / 2);
        if (r && r !== room) enterRoom(r, { snap: true, quiet: true });
      }
      return;
    }
    P.invuln = Math.max(0, P.invuln - dt);
    P.dashCd = Math.max(0, P.dashCd - dt);
    P.atkCd = Math.max(0, P.atkCd - dt);
    P.dropT = Math.max(0, P.dropT - dt);
    P.landT = Math.max(0, P.landT - dt);

    const has = prog.has;
    const dir = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);

    if (P.resting) {
      if (dir || pressed('jump') || pressed('attack') || pressed('down')) P.resting = false;
      else { P.vx = 0; P.vy = 0; return; }
    }

    // --- horizontal ---
    if (P.dashT > 0) {
      P.dashT -= dt; P.vx = P.face * PH.DASH; P.vy = 0;
      if (Math.random() < 0.6) parts.push({ x: P.x + 5, y: P.y + rand(3, 12), vx: -P.face * rand(20, 60), vy: rand(-10, 10), life: 0.35, max: 0.35, color: '#1c1826', size: 3, grav: 0 });
    } else if (P.knockT > 0) {
      P.knockT -= dt; P.vx = P.knockVx;
    } else if (P.recoilT > 0) {
      P.recoilT -= dt; P.vx = -P.face * 110 + dir * 30;
    } else {
      P.vx = dir * PH.RUN;
      if (dir && P.atkAnim <= 0) P.face = dir;
      else if (dir) P.face = dir;
    }

    // --- jump / double jump / drop-through ---
    P.coyote = P.onGround ? 0.09 : P.coyote - dt;
    P.buffer = pressed('jump') ? 0.12 : P.buffer - dt;
    if (P.buffer > 0 && held('down') && P.onGround && boxHasTile(P.x, P.y + P.h, P.w, 1, (ch) => ch === '=') && !boxHasTile(P.x, P.y + P.h, P.w, 1, isSolid)) {
      P.dropT = 0.22; P.buffer = 0; P.onGround = false; P.y += 1;
    } else if (P.buffer > 0 && P.coyote > 0 && P.dashT <= 0) {
      P.vy = -PH.JUMP; P.coyote = 0; P.buffer = 0; P.onGround = false; sfx.jump();
      burst(P.x + 5, P.y + P.h, 5, '#3a3448', 50, 0.35, 2, 100);
    } else if (P.buffer > 0 && !P.onGround && has.wings && P.airJumps > 0 && P.dashT <= 0) {
      P.vy = -PH.JUMP2; P.airJumps--; P.buffer = 0; sfx.wing();
      for (let i = 0; i < 10; i++) parts.push({ x: P.x + 5 + rand(-8, 8), y: P.y + 10, vx: rand(-60, 60), vy: rand(20, 90), life: 0.6, max: 0.6, color: '#e9e2ff', size: 1.6, grav: 60, glow: true });
    }
    if (released('jump') && P.vy < -60) P.vy *= 0.45;

    // --- dash ---
    if (pressed('dash') && has.dash && P.dashCd <= 0 && P.dashT <= 0 && (P.onGround || P.airDash)) {
      P.dashT = PH.DASHT; P.dashCd = 0.45; P.vy = 0; sfx.dash();
      if (dir) P.face = dir;
      if (!P.onGround) P.airDash = false;
    }

    // --- gravity ---
    if (P.dashT <= 0) P.vy = Math.min(PH.MAXFALL, P.vy + PH.G * dt);

    // --- attack ---
    if (pressed('attack') && P.atkCd <= 0) {
      P.atkDir = held('up') ? 'up' : held('down') && !P.onGround ? 'down' : 'side';
      P.atkT = 0.1; P.atkAnim = 0.22; P.atkCd = 0.3; P.hitSet = new Set();
      sfx.slash();
    }
    P.atkAnim = Math.max(0, P.atkAnim - dt);
    if (P.atkT > 0) { P.atkT -= dt; resolveAttack(); }

    // --- move ---
    const vyBefore = P.vy;
    moveBody(P, dt);
    if (P.landed && vyBefore > 250) { sfx.land(); P.landT = 0.12; burst(P.x + 5, P.y + P.h, 6, '#2c2838', 60, 0.4, 2, 80); }
    if (P.onGround) {
      P.airJumps = has.wings ? 1 : 0; P.airDash = true;
      const footL = tileAt(Math.floor(P.x / T), Math.floor((P.y + P.h + 1) / T));
      const footR = tileAt(Math.floor((P.x + P.w - 0.01) / T), Math.floor((P.y + P.h + 1) / T));
      const nearSpike = boxHasTile(P.x - 12, P.y - 4, P.w + 24, P.h + 8, (ch) => ch === '^');
      if (isSolid(footL) && isSolid(footR) && !nearSpike) { P.safeX = P.x; P.safeY = P.y; }
    }
    P.runT += dt * (P.onGround && P.vx ? 1 : 0);

    // --- hazards (thorns) ---
    if (boxHasTile(P.x + 3, P.y + 4, P.w - 6, P.h - 4, (ch, tx, ty) => ch === '^' && P.y + P.h > ty * T + 7)) hurtPlayer(1, P.x, true);

    // --- room transitions ---
    const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
    if (cx < room.px || cx >= room.px + room.pw || cy < room.py || cy >= room.py + room.ph) {
      const next = roomAt(cx, cy);
      if (next && next !== room) {
        const goingUp = cy < room.py;
        enterRoom(next, { snap: true });
        fade = 0.55;
        if (goingUp) { P.vy = Math.min(P.vy, -390); P.airJumps = prog.has.wings ? 1 : 0; }
        save();
      } else if (!next) {
        // Fell out of the world (should not happen) — return to safety.
        P.x = P.safeX; P.y = P.safeY; P.vx = P.vy = 0;
      }
    }

    // --- shrine rest ---
    const shrine = ents.find((e) => e.type === 'shrine' && overlap(P, e));
    if (shrine && pressed('up') && P.onGround && !P.resting) rest(shrine);
  }

  function attackBox() {
    const cx = P.x + P.w / 2;
    if (P.atkDir === 'up') return { x: cx - 13, y: P.y - 26, w: 26, h: 28 };
    if (P.atkDir === 'down') return { x: cx - 13, y: P.y + P.h - 2, w: 26, h: 26 };
    return P.face > 0 ? { x: P.x + P.w - 2, y: P.y - 5, w: 28, h: 22 } : { x: P.x - 26, y: P.y - 5, w: 28, h: 22 };
  }

  function resolveAttack() {
    const box = attackBox();
    let pogo = false;
    for (const e of ents) {
      if (!['crawler', 'wisp', 'boss'].includes(e.type) || P.hitSet.has(e) || e.dead) continue;
      if (e.type === 'boss' && (e.state === 'dormant' || e.state === 'dying')) continue;
      if (!overlap(box, e)) continue;
      P.hitSet.add(e);
      e.hp--; e.flash = 0.12;
      sfx.hit(); hitstop = 0.05; shake = Math.max(shake, 3);
      const hx = clamp(P.x + P.w / 2 + P.face * 14, e.x, e.x + e.w), hy = clamp(P.y + 6, e.y, e.y + e.h);
      burst(hx, hy, 8, '#ffffff', 160, 0.3, 1.6, 0);
      if (e.type === 'crawler') { e.kbT = 0.15; e.kbDir = P.atkDir === 'side' ? P.face : Math.sign(e.x - P.x) || 1; }
      if (e.type === 'wisp') { e.vx = (P.atkDir === 'side' ? P.face : 0) * 160; e.vy = P.atkDir === 'up' ? -160 : P.atkDir === 'down' ? 160 : -30; }
      if (P.atkDir === 'down') pogo = true;
      else if (P.atkDir === 'side') P.recoilT = 0.08;
      if (e.hp <= 0) killEnemy(e);
    }
    if (P.atkDir === 'down' && boxHasTile(box.x, box.y, box.w, box.h, (ch) => ch === '^')) pogo = true;
    if (pogo && !P.hitSet.has('pogo')) {
      P.hitSet.add('pogo');
      P.vy = -300; P.airJumps = prog.has.wings ? 1 : 0; P.airDash = true; P.atkT = 0;
    }
    if (P.atkDir === 'side' && !P.hitSet.has('wall') && boxHasTile(box.x + (P.face > 0 ? 14 : 0), box.y + 6, 14, 10, isSolid)) {
      P.hitSet.add('wall'); sfx.clink();
      burst(P.face > 0 ? box.x + box.w - 6 : box.x + 6, P.y + 6, 6, '#ffe9a8', 120, 0.25, 1.2, 0);
    }
  }

  function killEnemy(e) {
    if (e.type === 'boss') { bossDie(e); return; }
    e.dead = true;
    sfx.enemyDie(); shake = Math.max(shake, 4);
    burst(e.x + e.w / 2, e.y + e.h / 2, 18, e.type === 'wisp' ? '#bfeaff' : '#1b1624', 150, 0.6, 2.5);
    dropGlimmers(e.x + e.w / 2, e.y + e.h / 2, e.type === 'wisp' ? 3 : 2);
    achieve('first_blood');
  }

  function rest(shrine) {
    P.resting = true; P.vx = 0;
    P.hp = prog.maxHp;
    prog.shrine = { x: P.x, y: P.y };
    P.safeX = P.x; P.safeY = P.y;
    sfx.rest();
    for (let i = 0; i < 24; i++) parts.push({ x: shrine.x + 12 + rand(-10, 10), y: shrine.y + rand(0, 20), vx: rand(-10, 10), vy: rand(-40, -15), life: 1.6, max: 1.6, color: '#ffcf7a', size: 1.5, grav: -10, glow: true });
    achieve('rested');
    save();
  }

  // ======================================================================
  // Enemies & boss update
  // ======================================================================
  function updateEnts(dt) {
    const pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    for (const e of ents) {
      e.t = (e.t ?? 0) + dt;
      e.flash = Math.max(0, (e.flash ?? 0) - dt);
      switch (e.type) {
        case 'crawler': {
          e.vy = Math.min(PH.MAXFALL, e.vy + PH.G * dt);
          if (e.kbT > 0) { e.kbT -= dt; e.vx = e.kbDir * 100; } else e.vx = e.dir * 26;
          moveBody(e, dt);
          if (e.kbT <= 0) {
            if (e.hitX) e.dir *= -1;
            else if (e.onGround) {
              const ax = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
              const tx = Math.floor(ax / T);
              const below = tileAt(tx, Math.floor((e.y + e.h + 2) / T));
              if (!(isSolid(below) || below === '=') || tileAt(tx, Math.floor((e.y + e.h - 2) / T)) === '^') e.dir *= -1;
            }
          }
          break;
        }
        case 'wisp': {
          const dx = pcx - (e.x + 6), dy = pcy - (e.y + 6), d = Math.hypot(dx, dy) || 1;
          if (d < 150 && !P.dead) { e.vx += (dx / d) * 150 * dt; e.vy += (dy / d) * 150 * dt; }
          else { e.vx += (e.hx - e.x) * 0.8 * dt; e.vy += (e.hy - e.y) * 0.8 * dt; }
          const sp = Math.hypot(e.vx, e.vy), max = 52;
          if (sp > max) { e.vx *= 0.94; e.vy *= 0.94; }
          e.x += e.vx * dt; e.y += (e.vy + Math.sin(e.t * 3) * 12) * dt;
          break;
        }
        case 'wave': {
          e.x += e.vx * dt; e.life -= dt;
          if (e.life <= 0 || isSolid(tileAt(Math.floor((e.vx > 0 ? e.x + e.w : e.x) / T), Math.floor((e.y + 6) / T)))) { e.dead = true; burst(e.x + 7, e.y + 8, 6, '#ff7a6a', 80, 0.3, 1.5); }
          if (Math.random() < 0.5) parts.push({ x: e.x + rand(0, e.w), y: e.y + e.h, vx: rand(-20, 20), vy: rand(-80, -30), life: 0.4, max: 0.4, color: '#ff8c7a', size: 1.5, grav: 200, glow: true });
          break;
        }
        case 'boss': updateBoss(e, dt, pcx); break;
        case 'item': break;
        case 'shrine': break;
        default: break;
      }
      if (e.harm && !e.dead && !P.dead && overlap(P, e)) hurtPlayer(1, e.x + e.w / 2);
      if (e.type === 'item' && !e.dead && !P.dead && overlap(P, e)) collect(e);
    }
    // Boss activation
    if (room.id === 'throne' && !prog.boss) {
      const b = ents.find((e) => e.type === 'boss');
      if (b && b.state === 'dormant' && P.x > room.px + 5 * T && !P.dead) {
        b.state = 'intro'; b.t = 0; closeGate(true);
        sfx.roar(); shake = 12;
        areaTitle = { name: 'The Hollow Warden', sub: 'Keeper of the Deep', t: 0, boss: true };
        bossBar = b;
      }
    }
    ents = ents.filter((e) => !e.dead);
  }

  function updateBoss(b, dt, pcx) {
    if (b.state === 'dormant') return;
    if (b.state === 'dying') {
      b.vx = 0;
      if (Math.random() < 0.5) burst(b.x + rand(0, b.w), b.y + rand(0, b.h), 3, Math.random() < 0.5 ? '#ff3b4f' : '#140f18', 120, 0.6, 2.5);
      if (b.t > 1.8) {
        b.dead = true; bossBar = null; shake = 14;
        burst(b.x + b.w / 2, b.y + b.h / 2, 70, '#120d16', 260, 1.4, 4, 120);
        burst(b.x + b.w / 2, b.y + b.h / 2, 30, '#ff3b4f', 220, 1, 2, 0);
        dropGlimmers(b.x + b.w / 2, b.y + b.h / 2, 30);
        closeGate(false);
        prog.boss = true; achieve('warden'); save();
        setTimeout(() => { if (mode === 'play') { mode = 'ending'; message = { t: 0 }; } }, 2600);
      }
      return;
    }
    const m = b.hp < b.maxHp / 2 ? 1.35 : 1;
    const bcx = b.x + b.w / 2;
    b.harm = b.state !== 'intro';
    b.vy = Math.min(PH.MAXFALL, b.vy + PH.G * dt);
    const set = (s) => { b.state = s; b.t = 0; };
    switch (b.state) {
      case 'intro': b.vx = 0; if (b.t > 1.6) set('idle'); break;
      case 'idle':
        b.vx = 0; b.face = pcx < bcx ? -1 : 1;
        if (b.t > 0.75 / m) {
          const d = Math.abs(pcx - bcx), r = Math.random();
          set(d > 130 ? (r < 0.5 ? 'windCharge' : 'windLeap') : r < 0.3 ? 'walk' : r < 0.65 ? 'windLeap' : 'windCharge');
        }
        break;
      case 'walk': b.face = pcx < bcx ? -1 : 1; b.vx = b.face * 60 * m; if (b.t > 1.0) set('idle'); break;
      case 'windCharge': b.vx = 0; b.face = pcx < bcx ? -1 : 1; if (b.t > 0.6 / m) { set('charge'); sfx.dash(); } break;
      case 'charge':
        b.vx = b.face * 240 * m;
        if (Math.random() < 0.7) parts.push({ x: bcx - b.face * 16, y: b.y + b.h - 2, vx: -b.face * rand(20, 80), vy: rand(-40, 0), life: 0.4, max: 0.4, color: '#2a2230', size: 3, grav: 100 });
        break;
      case 'stun': b.vx = 0; if (b.t > 0.9 / m) set('idle'); break;
      case 'windLeap': b.vx = 0; if (b.t > 0.45 / m) { set('leap'); b.vy = -410; b.vx = clamp((pcx - bcx) / 0.72, -270, 270); b.onGround = false; } break;
      case 'leap':
        if (b.onGround && b.t > 0.1) {
          set('recover'); sfx.slam(); shake = 11;
          const fy = b.y + b.h - 12;
          ents.push({ type: 'wave', x: b.x - 14, y: fy, w: 14, h: 12, vx: -190 * m, life: 2.4, harm: true });
          ents.push({ type: 'wave', x: b.x + b.w, y: fy, w: 14, h: 12, vx: 190 * m, life: 2.4, harm: true });
          burst(bcx, b.y + b.h, 20, '#3a2f40', 200, 0.6, 3, 400);
        }
        break;
      case 'recover': b.vx = 0; if (b.t > 0.65 / m) set('idle'); break;
      default: break;
    }
    moveBody(b, dt);
    if (b.state === 'charge' && b.hitX) { set('stun'); sfx.slam(); shake = 9; burst(b.face > 0 ? b.x + b.w : b.x, b.y + 10, 16, '#bdb3c6', 180, 0.5, 2); }
  }

  function bossDie(b) {
    b.state = 'dying'; b.t = 0; b.harm = false; hitstop = 0.35; shake = 12;
    sfx.roar();
  }

  function collect(item) {
    item.dead = true;
    taken.add(item.id);
    const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
    if (item.kind === 'glim') { dropGlimmers(cx, cy, 6); save(); return; }
    sfx.pickup(); shake = 4;
    burst(cx, cy, 40, item.kind === 'heart' ? '#ff6b7a' : '#e9e2ff', 200, 1, 2, 0);
    if (item.kind === 'wings') {
      prog.has.wings = true; P.airJumps = 1; achieve('moth_wings');
      message = { title: 'Moth Wings', icon: 'wings', lines: ['Pale wings, dusted with old light.', 'Press JUMP again in mid-air to jump a second time.'], t: 0 };
    } else if (item.kind === 'dash') {
      prog.has.dash = true; achieve('shadow_dash');
      message = { title: 'Shadow Dash', icon: 'dash', lines: ['The dark bends around you.', 'Press DASH (C / Shift) to dash — on the ground or once in the air.'], t: 0 };
    } else if (item.kind === 'heart') {
      prog.maxHp += 1; P.hp = prog.maxHp; achieve('heart_vessel');
      message = { title: 'Heart Vessel', icon: 'heart', lines: ['A ninth life, tucked away in the dark.', 'Your maximum health increases by one.'], t: 0 };
    }
    mode = 'message';
    save();
  }

  // ======================================================================
  // Particles & camera
  // ======================================================================
  function updateParts(dt) {
    const pcx = P.x + P.w / 2, pcy = P.y + P.h / 2;
    for (const p of parts) {
      p.life -= dt;
      if (p.glim) {
        p.homeT -= dt;
        if (p.homeT <= 0 && !P.dead) {
          const dx = pcx - p.x, dy = pcy - p.y, d = Math.hypot(dx, dy) || 1;
          p.vx = lerp(p.vx, (dx / d) * 320, 0.15); p.vy = lerp(p.vy, (dy / d) * 320, 0.15);
          if (d < 8) { p.life = 0; prog.glimmers++; sfx.glim(); }
          p.x += p.vx * dt; p.y += p.vy * dt; continue;
        }
      }
      p.vy += (p.grav ?? 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.glim && isSolid(tileAt(Math.floor(p.x / T), Math.floor(p.y / T)))) { p.vy = -Math.abs(p.vy) * 0.4; p.vx *= 0.6; }
    }
    parts = parts.filter((p) => p.life > 0);
    if (parts.length > 600) parts.splice(0, parts.length - 600);
  }

  function camTarget() {
    let tx = P.x + P.w / 2 - VW / 2 + P.face * 24, ty = P.y + P.h / 2 - VH / 2 - 10;
    tx = room.pw <= VW ? room.px + (room.pw - VW) / 2 : clamp(tx, room.px, room.px + room.pw - VW);
    ty = room.ph <= VH ? room.py + (room.ph - VH) / 2 : clamp(ty, room.py, room.py + room.ph - VH);
    return { x: tx, y: ty };
  }
  function snapCamera() { const t = camTarget(); cam.x = t.x; cam.y = t.y; }
  function updateCamera(dt) {
    const t = camTarget();
    cam.x = lerp(cam.x, t.x, 1 - Math.pow(0.001, dt));
    cam.y = lerp(cam.y, t.y, 1 - Math.pow(0.0005, dt));
  }

  // ======================================================================
  // Main update
  // ======================================================================
  function update(dt) {
    time += dt;
    saveIcon = Math.max(0, saveIcon - dt);
    fade = Math.max(0, fade - dt * 2.2);
    flash = Math.max(0, flash - dt);
    shake *= Math.pow(0.02, dt);
    if (mode === 'title') { updateTitle(); return; }
    if (mode === 'message' || mode === 'ending') {
      message.t += dt;
      if (message.t > 0.4 && (pressed('confirm') || pressed('jump') || pressed('attack'))) { mode = 'play'; message = null; sfx.menu(); }
      updateParts(dt);
      return;
    }
    if (mode !== 'play') return;
    if (pressed('pause')) { paused = !paused; showMap = false; sfx.menu(); }
    if (pressed('map') && !paused) { showMap = !showMap; sfx.menu(); }
    if (paused || showMap) { if (showMap && (pressed('confirm') || pressed('pause'))) showMap = false; return; }
    if (hitstop > 0) { hitstop -= dt; return; }
    prog.playSeconds += dt;
    if (areaTitle) { areaTitle.t += dt; if (areaTitle.t > 3.2) areaTitle = null; }
    updatePlayer(dt);
    updateEnts(dt);
    updateParts(dt);
    updateCamera(dt);
    // ambient ash
    if (Math.random() < dt * 14) parts.push({ x: cam.x + rand(0, VW), y: cam.y - 4, vx: rand(-6, 6), vy: rand(8, 22), life: 12, max: 12, color: '#6f6a86', size: rand(0.6, 1.4), grav: 0, ash: true });
  }

  // ======================================================================
  // Rendering — background layers
  // ======================================================================
  function makeLayers(id, pw, ph) {
    const R = seeded(id);
    const far = [], mid = [], spots = [];
    for (let x = -60; x < pw * 0.5 + VW; x += rand(40, 90) * (0.6 + R())) far.push({ x, w: 10 + R() * 26, h: 0.3 + R() * 0.7, arch: R() < 0.3, broken: R() });
    for (let x = -40; x < pw * 0.75 + VW; x += 18 + R() * 40) mid.push({ x, len: 20 + R() * 80, w: 4 + R() * 12, root: R() < 0.4 });
    for (let i = 0; i < 18; i++) spots.push({ x: R() * (pw * 0.3 + VW), y: R() * VH, r: 0.6 + R() * 1.4, p: R() * 6 });
    return { far, mid, spots };
  }

  function drawBackground(r) {
    const hue = r.hue;
    const grd = ctx.createLinearGradient(0, 0, 0, VH);
    grd.addColorStop(0, `hsl(${hue} 28% 17%)`); grd.addColorStop(0.6, `hsl(${hue} 30% 10%)`); grd.addColorStop(1, `hsl(${hue} 35% 5%)`);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, VW, VH);
    const L = r.layers;
    // faint light shafts
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const sx = ((i * 197 + r.ox * 7) % VW) - (cam.x * 0.15) % VW;
      ctx.fillStyle = `hsla(${hue} 60% 70% / 0.035)`;
      ctx.beginPath(); ctx.moveTo(sx, -10); ctx.lineTo(sx + 40, -10); ctx.lineTo(sx + 140, VH); ctx.lineTo(sx + 60, VH); ctx.fill();
    }
    ctx.restore();
    // far pillars / ruins (parallax 0.3)
    ctx.save(); ctx.translate(-((cam.x - r.px) * 0.3), 0);
    ctx.fillStyle = `hsl(${hue} 20% 20%)`;
    const ybase = VH - ((cam.y - r.py) * 0.15) % 40 + 10;
    for (const f of L.far) {
      const h = VH * f.h;
      ctx.fillRect(f.x, ybase - h, f.w, h);
      ctx.fillRect(f.x - 3, ybase - h, f.w + 6, 4);
      if (f.arch) { ctx.beginPath(); ctx.arc(f.x + f.w + 22, ybase - h + 8, 24, Math.PI, 0); ctx.lineWidth = 6; ctx.strokeStyle = ctx.fillStyle; ctx.stroke(); }
      if (f.broken > 0.6) { ctx.beginPath(); ctx.moveTo(f.x, ybase - h); ctx.lineTo(f.x + f.w * 0.5, ybase - h - 10); ctx.lineTo(f.x + f.w, ybase - h); ctx.fill(); }
    }
    ctx.restore();
    // glowing spores
    ctx.save(); ctx.translate(-((cam.x - r.px) * 0.3) % (VW + 200), 0); ctx.globalCompositeOperation = 'lighter';
    for (const s of L.spots) { ctx.fillStyle = `hsla(${hue + 30} 80% 70% / ${0.25 + Math.sin(time * 1.5 + s.p) * 0.15})`; ctx.beginPath(); ctx.arc(s.x, s.y + Math.sin(time * 0.5 + s.p) * 6, s.r, 0, 7); ctx.fill(); }
    ctx.restore();
    // mid roots / stalactites (parallax 0.6)
    ctx.save(); ctx.translate(-((cam.x - r.px) * 0.6), 0);
    ctx.fillStyle = `hsl(${hue} 22% 11%)`;
    ctx.strokeStyle = `hsl(${hue} 22% 11%)`;
    for (const m of L.mid) {
      if (m.root) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(m.x, 0); ctx.bezierCurveTo(m.x + 8, m.len * 0.4, m.x - 8, m.len * 0.7, m.x + 2 + Math.sin(time + m.x) * 2, m.len * 1.4); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(m.x, 0); ctx.lineTo(m.x + m.w, 0); ctx.lineTo(m.x + m.w / 2, m.len); ctx.fill(); }
    }
    ctx.restore();
  }

  // Pre-rendered tile layer for a room (at device resolution).
  function roomCanvas(r) {
    if (r.cache && r.cacheS === S) return r.cache;
    const c = document.createElement('canvas');
    c.width = Math.ceil(r.pw * S); c.height = Math.ceil(r.ph * S);
    const g = c.getContext('2d');
    g.scale(S, S);
    const R = seeded(`${r.id}-tiles`);
    const hue = r.hue;
    const base = `hsl(${hue} 16% 5%)`, rim = `hsl(${hue} 30% 36%)`, moss = `hsl(${hue + 40} 32% 48%)`;
    const at = (x, y) => (x < 0 || y < 0 || x >= r.w || y >= r.h ? '#' : r.grid[y][x]);
    const solid = (x, y) => at(x, y) === '#';
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const ch = r.grid[y][x], px = x * T, py = y * T;
      if (ch === '#') {
        g.fillStyle = base; g.fillRect(px - 0.5, py - 0.5, T + 1, T + 1);
        if (R() < 0.35) { g.fillStyle = `hsl(${hue} 14% ${R() < 0.5 ? 4 : 9}%)`; g.fillRect(px + R() * 12, py + R() * 12, 2 + R() * 3, 2 + R() * 2); }
        if (!solid(x, y - 1)) {
          g.fillStyle = rim; g.fillRect(px, py, T, 2.5);
          g.strokeStyle = moss; g.lineWidth = 0.8;
          for (let i = 0; i < 4; i++) if (R() < 0.55) { const bx = px + R() * T; g.beginPath(); g.moveTo(bx, py + 1); g.lineTo(bx + rand(-1.5, 1.5), py - 2 - R() * 4); g.stroke(); }
        }
        if (!solid(x, y + 1) && y + 1 < r.h) {
          g.fillStyle = base;
          for (let i = 0; i < 2; i++) if (R() < 0.5) { const sx = px + 2 + R() * 10, len = 3 + R() * 8; g.beginPath(); g.moveTo(sx - 2.5, py + T); g.lineTo(sx + 2.5, py + T); g.lineTo(sx, py + T + len); g.fill(); }
          g.fillStyle = `hsl(${hue} 18% 11%)`; g.fillRect(px, py + T - 1.5, T, 1.5);
        }
        if (!solid(x - 1, y)) { g.fillStyle = `hsl(${hue} 18% 12%)`; g.fillRect(px, py, 1.5, T); }
        if (!solid(x + 1, y)) { g.fillStyle = `hsl(${hue} 18% 12%)`; g.fillRect(px + T - 1.5, py, 1.5, T); }
      } else if (ch === '=') {
        g.fillStyle = '#3a2f24'; g.fillRect(px, py, T, 4);
        g.fillStyle = '#7a6448'; g.fillRect(px, py, T, 1.4);
        g.fillStyle = '#1a140f'; g.fillRect(px + (x % 2 ? 3 : 11), py + 4, 1.5, 4);
      } else if (ch === '^') {
        for (let i = 0; i < 3; i++) {
          const bx = px + 1 + i * 5;
          g.fillStyle = '#1a1620'; g.beginPath(); g.moveTo(bx, py + T); g.lineTo(bx + 5, py + T); g.lineTo(bx + 2.5 + rand(-1, 1), py + 5 + R() * 3); g.fill();
          g.strokeStyle = '#a79fb8'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(bx + 0.5, py + T); g.lineTo(bx + 2.5, py + 7); g.stroke();
        }
      }
    }
    r.cache = c; r.cacheS = S;
    return c;
  }

  // ======================================================================
  // Rendering — characters
  // ======================================================================
  function catShape(g, pose, t, fill, grow = 0) {
    const run = pose === 'run' ? P.runT * 15 : 0;
    const bob = pose === 'run' ? Math.abs(Math.sin(run)) * 1.2 : pose === 'idle' ? Math.sin(t * 2.4) * 0.35 : 0;
    const sit = pose === 'rest';
    g.fillStyle = fill; g.strokeStyle = fill;
    // tail
    g.lineCap = 'round'; g.lineWidth = 2.3 + grow * 2;
    g.beginPath();
    if (sit) { g.moveTo(-4, -2); g.quadraticCurveTo(-9, 1, -2, 0.5); }
    else if (pose === 'jump' || pose === 'fall') { g.moveTo(-5, -6); g.quadraticCurveTo(-11, -4 + (pose === 'fall' ? -6 : 3), -13, -10 + (pose === 'fall' ? -4 : 4)); }
    else { g.moveTo(-5, -5 - bob); g.quadraticCurveTo(-11, -7 + Math.sin(t * 3) * 1.5, -10 + Math.cos(t * 2.2), -15 + Math.sin(t * 3.1) * 1.8); }
    g.stroke();
    // legs
    if (!sit) {
      const legs = [[-4, 0], [-1.5, Math.PI], [2.5, Math.PI * 0.5], [4.5, Math.PI * 1.5]];
      for (const [lx, ph] of legs) {
        const off = pose === 'run' ? Math.sin(run + ph) * 1.6 : 0;
        const lift = pose === 'jump' ? -1.5 : pose === 'fall' ? 0.5 : 0;
        g.fillRect(lx + off - 1 - grow, -4 - bob * 0.5 + lift - grow, 2 + grow * 2, 4 + grow - Math.max(0, -off) * 0.4);
      }
    }
    // body
    g.beginPath(); g.ellipse(sit ? -0.5 : 0, sit ? -4 : -5.5 - bob, 6.8 + grow, sit ? 4.4 + grow : 4 + grow, 0, 0, Math.PI * 2); g.fill();
    // head
    const hx = sit ? 3 : 4, hy = (sit ? -10 : -11) - bob;
    g.beginPath(); g.arc(hx, hy, 5.2 + grow, 0, Math.PI * 2); g.fill();
    // ears
    g.beginPath(); g.moveTo(hx - 4.4 - grow, hy - 1.5); g.lineTo(hx - 2.8, hy - 9 - grow); g.lineTo(hx - 0.2 + grow, hy - 4); g.fill();
    g.beginPath(); g.moveTo(hx + 0.6 - grow, hy - 4.2); g.lineTo(hx + 3.5, hy - 9.2 - grow); g.lineTo(hx + 5 + grow, hy - 1.8); g.fill();
    return { hx, hy, bob };
  }

  function drawCat() {
    if (P.dead && P.deadT > 0.1) return;
    if (P.hazardT > 0 && P.hazardT < 0.3) return;
    if (P.invuln > 0 && Math.floor(P.invuln * 14) % 2 === 0 && P.hazardT <= 0) return;
    const pose = P.resting ? 'rest' : P.dashT > 0 ? 'dash' : !P.onGround ? (P.vy < 0 ? 'jump' : 'fall') : Math.abs(P.vx) > 1 ? 'run' : 'idle';
    const cx = P.x + P.w / 2, fy = P.y + P.h;
    // dash afterimages
    if (pose === 'dash') for (let i = 1; i <= 3; i++) { ctx.save(); ctx.globalAlpha = 0.18 / i; ctx.translate(cx - P.face * i * 7, fy); ctx.scale(P.face * 1.05, 0.95); catShape(ctx, 'run', time, '#3a2f55'); ctx.restore(); }
    ctx.save();
    ctx.translate(cx, fy + (P.landT > 0 ? 0.8 : 0));
    ctx.scale(P.face * (pose === 'dash' ? 1.15 : 1), pose === 'dash' ? 0.88 : P.landT > 0 ? 0.9 : 1);
    // rim light pass for readability against the dark
    catShape(ctx, pose, time, 'rgba(150,160,215,0.38)', 0.9);
    const white = flash > 0.1 && P.invuln > 1;
    const { hx, hy, bob } = catShape(ctx, pose, time, white ? '#f4f0ff' : INK);
    // scarf
    const wave = Math.sin(time * 9) * 1.3, trail = Math.min(1, Math.abs(P.vx) / PH.RUN) * 3 + (pose === 'jump' || pose === 'fall' ? 2 : 0);
    ctx.fillStyle = '#c42f3e';
    ctx.beginPath(); ctx.ellipse(hx - 1.6, hy + 4.2, 3.6, 1.6, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx - 3.5, hy + 4); ctx.quadraticCurveTo(hx - 7 - trail, hy + 3 + wave, hx - 11 - trail * 1.6, hy + 2 + wave * 1.6 - (pose === 'fall' ? 3 : 0));
    ctx.lineTo(hx - 10 - trail * 1.4, hy + 5 + wave); ctx.quadraticCurveTo(hx - 6, hy + 6, hx - 3, hy + 5.6); ctx.fill();
    // eyes
    if (!white) {
      const blink = P.blinkT < 0 || pose === 'rest' ? 0.25 : 1;
      ctx.fillStyle = '#f5ef92';
      ctx.beginPath(); ctx.ellipse(hx + 1.2, hy + 0.2, 1.05, 1.55 * blink, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + 3.9, hy + 0.2, 1.0, 1.5 * blink, 0, 0, Math.PI * 2); ctx.fill();
      if (blink === 1) { ctx.fillStyle = INK; ctx.fillRect(hx + 1.3, hy - 0.6, 0.6, 1.6); ctx.fillRect(hx + 4.0, hy - 0.6, 0.6, 1.6); }
    }
    // sword
    if (P.atkAnim <= 0 && pose !== 'rest') {
      ctx.strokeStyle = '#d9e1ee'; ctx.lineWidth = 1.3; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(5, -4.5 - bob); ctx.lineTo(13, -1.5 - bob); ctx.stroke();
      ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(4.4, -6.2 - bob); ctx.lineTo(5.6, -2.8 - bob); ctx.stroke();
    }
    ctx.restore();
    // slash arc
    if (P.atkAnim > 0) drawSlash(cx, P.y + P.h / 2);
  }

  function drawSlash(cx, cy) {
    const p = 1 - P.atkAnim / 0.22;
    const rot = P.atkDir === 'up' ? -Math.PI / 2 : P.atkDir === 'down' ? Math.PI / 2 : P.face > 0 ? 0 : Math.PI;
    ctx.save();
    ctx.translate(cx, cy - (P.atkDir === 'side' ? 2 : 0));
    ctx.rotate(rot);
    if (P.atkDir !== 'side' && P.face < 0) ctx.scale(1, -1);
    const a0 = -1.15 + p * 0.25, a1 = 1.15 + p * 0.25;
    ctx.globalAlpha = Math.max(0, 1 - p * 1.1);
    ctx.fillStyle = '#f7f5ff';
    ctx.beginPath(); ctx.arc(5, 0, 22, a0, a1); ctx.arc(1, 0, 15, a1 - 0.15, a0 + 0.15, true); ctx.closePath(); ctx.fill();
    ctx.globalAlpha *= 0.5; ctx.fillStyle = '#bcb6ff';
    ctx.beginPath(); ctx.arc(6, 0, 25, a0 + 0.2, a1 - 0.2); ctx.arc(4, 0, 21, a1 - 0.3, a0 + 0.3, true); ctx.closePath(); ctx.fill();
    // blade
    ctx.globalAlpha = 1; ctx.strokeStyle = '#e6ecf5'; ctx.lineWidth = 1.5;
    const ba = lerp(a0, a1, Math.min(1, p * 1.6));
    ctx.beginPath(); ctx.moveTo(Math.cos(ba) * 6, Math.sin(ba) * 6); ctx.lineTo(Math.cos(ba) * 17, Math.sin(ba) * 17); ctx.stroke();
    ctx.restore();
  }

  function drawEnt(e) {
    const white = e.flash > 0;
    switch (e.type) {
      case 'crawler': {
        const cx = e.x + e.w / 2, by = e.y + e.h, f = e.kbT > 0 ? -e.kbDir : e.dir;
        ctx.save(); ctx.translate(cx, by); ctx.scale(f, 1);
        ctx.fillStyle = 'rgba(160,140,200,0.3)'; ctx.beginPath(); ctx.ellipse(0, -4, 9, 7.2, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = white ? '#fff' : '#120f18';
        ctx.beginPath(); ctx.ellipse(0, -1, 8.2, 8.5, 0, Math.PI, 0); ctx.fill();
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 3 - 1.8, -7.5 + Math.abs(i) * 1.5); ctx.lineTo(i * 3 - 0.5, -12.5 + Math.abs(i) * 2); ctx.lineTo(i * 3 + 1.5, -7 + Math.abs(i) * 1.5); ctx.fill(); }
        const leg = Math.sin(e.t * 12) * 1.2;
        ctx.fillRect(-6 + leg, -1.5, 1.4, 2); ctx.fillRect(-1 - leg, -1.5, 1.4, 2); ctx.fillRect(4 + leg, -1.5, 1.4, 2);
        if (!white) { ctx.fillStyle = '#ff9d3b'; ctx.beginPath(); ctx.arc(5, -4.5, 1.5, 0, 7); ctx.fill(); }
        ctx.restore();
        break;
      }
      case 'wisp': {
        const cx = e.x + 6, cy = e.y + 6;
        ctx.save(); ctx.translate(cx, cy);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = white ? '#ffffff' : 'rgba(190,230,255,0.85)';
        ctx.beginPath(); ctx.arc(0, -1, 6, Math.PI, 0);
        for (let i = 0; i <= 4; i++) ctx.lineTo(6 - i * 3, 5 + Math.sin(e.t * 8 + i) * 1.5 + (i % 2 ? 2 : 0));
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0a0d18'; ctx.beginPath(); ctx.ellipse(-2, -1.5, 1.1, 1.8, 0, 0, 7); ctx.ellipse(2, -1.5, 1.1, 1.8, 0, 0, 7); ctx.fill();
        ctx.restore();
        break;
      }
      case 'wave': {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,100,90,0.8)';
        ctx.beginPath(); ctx.moveTo(e.x, e.y + e.h); ctx.quadraticCurveTo(e.x + e.w / 2, e.y - 6, e.x + e.w, e.y + e.h); ctx.fill();
        ctx.restore();
        break;
      }
      case 'item': {
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + Math.sin(time * 2.5 + (e.t ?? 0)) * 2;
        if (e.kind === 'glim') {
          ctx.fillStyle = '#9fe9ff';
          for (let i = 0; i < 3; i++) { const a = time * 1.5 + i * 2.1; ctx.save(); ctx.translate(cx + Math.cos(a) * 3, cy + Math.sin(a) * 2); ctx.rotate(Math.PI / 4); ctx.fillRect(-1.6, -1.6, 3.2, 3.2); ctx.restore(); }
        } else {
          ctx.save(); ctx.translate(cx, cy);
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();
          ctx.strokeStyle = e.kind === 'heart' ? '#ff8a96' : '#e9e2ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 8 + Math.sin(time * 3), 0, 7); ctx.stroke();
          drawIcon(e.kind, 0, 0, 1);
          ctx.restore();
        }
        break;
      }
      case 'shrine': {
        const bx = e.x + 12, by = e.y + 24;
        ctx.fillStyle = '#1b1820'; ctx.fillRect(bx - 10, by - 6, 20, 6); ctx.fillRect(bx - 7, by - 16, 14, 10);
        ctx.fillStyle = '#2b2733'; ctx.fillRect(bx - 11, by - 7, 22, 1.5); ctx.fillRect(bx - 8, by - 17, 16, 1.5);
        ctx.fillStyle = '#e8e0cc'; ctx.fillRect(bx - 1.5, by - 23, 3, 6);
        const fl = Math.sin(time * 9 + e.t) * 0.6;
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.ellipse(bx + fl * 0.3, by - 26, 1.8, 3.2 + fl, 0, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.ellipse(bx, by - 25.5, 0.8, 1.6, 0, 0, 7); ctx.fill();
        if (overlap(P, e) && !P.resting && !P.dead) drawPrompt(bx, by - 38, '▲  Rest');
        break;
      }
      case 'boss': drawBoss(e); break;
      default: break;
    }
  }

  function drawBoss(b) {
    const cx = b.x + b.w / 2, by = b.y + b.h;
    const wind = b.state === 'windCharge' || b.state === 'windLeap';
    const shakeX = wind ? rand(-1, 1) : 0;
    const white = b.flash > 0;
    const dying = b.state === 'dying';
    ctx.save(); ctx.translate(cx + shakeX, by); ctx.scale(b.face, 1);
    if (dying) ctx.globalAlpha = Math.max(0, 1 - b.t / 1.9);
    const body = white ? '#ffffff' : '#0d0a12';
    // rim
    ctx.fillStyle = 'rgba(200,120,140,0.25)';
    ctx.beginPath(); ctx.ellipse(0, -18, 19, 21, 0, 0, 7); ctx.fill();
    // cloak with tattered hem
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(-17, -24);
    ctx.quadraticCurveTo(0, -46, 17, -24);
    for (let i = 0; i <= 8; i++) ctx.lineTo(17 - i * 4.25, (i % 2 ? -1 : -5) + Math.sin(time * 4 + i) * 1.2);
    ctx.closePath(); ctx.fill();
    // arms / claws
    const reach = b.state === 'charge' ? 8 : wind ? -3 : 0;
    ctx.beginPath(); ctx.moveTo(10, -22); ctx.quadraticCurveTo(22 + reach, -18, 20 + reach, -6); ctx.lineTo(17 + reach, -8); ctx.quadraticCurveTo(18, -16, 8, -18); ctx.fill();
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(18 + reach + i * 1.5, -7); ctx.lineTo(22 + reach + i * 2, -1); ctx.lineTo(19 + reach + i * 1.5, -6); ctx.fill(); }
    // head
    ctx.beginPath(); ctx.ellipse(6, -38, 8, 7, 0, 0, 7); ctx.fill();
    // horns
    ctx.fillStyle = white ? '#fff' : '#d5ccbd';
    ctx.beginPath(); ctx.moveTo(1, -42); ctx.bezierCurveTo(-6, -50, -2, -60, -10, -64); ctx.bezierCurveTo(-3, -58, -2, -50, 5, -44); ctx.fill();
    ctx.beginPath(); ctx.moveTo(9, -43); ctx.bezierCurveTo(14, -52, 12, -58, 20, -63); ctx.bezierCurveTo(16, -55, 16, -50, 12, -41); ctx.fill();
    // eyes
    if (!white) {
      const glow = wind || b.state === 'intro' ? 1 : 0.7;
      ctx.fillStyle = `rgba(255,60,80,${glow})`;
      ctx.beginPath(); ctx.ellipse(8, -38, 1.8, 1.2, -0.2, 0, 7); ctx.ellipse(12.5, -38.5, 1.6, 1.1, -0.2, 0, 7); ctx.fill();
    }
    ctx.restore();
  }

  function drawIcon(kind, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (kind === 'wings') {
      ctx.fillStyle = '#ece6ff';
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(d * 7, -7, d * 6, 1); ctx.quadraticCurveTo(d * 5, 5, 0, 1); ctx.fill(); }
      ctx.fillStyle = '#1a1520'; ctx.fillRect(-0.7, -3, 1.4, 6);
    } else if (kind === 'dash') {
      ctx.fillStyle = '#c9b8ff';
      ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(3, -3); ctx.lineTo(3, -5.5); ctx.lineTo(7, 0); ctx.lineTo(3, 5.5); ctx.lineTo(3, 3); ctx.lineTo(-6, 3); ctx.fill();
      ctx.fillStyle = '#1a1520'; ctx.fillRect(-6, -1, 6, 2);
    } else if (kind === 'heart') {
      ctx.fillStyle = '#ff6b7a';
      ctx.beginPath(); ctx.moveTo(0, 5); ctx.bezierCurveTo(-8, -1, -4, -7, 0, -3); ctx.bezierCurveTo(4, -7, 8, -1, 0, 5); ctx.fill();
    }
    ctx.restore();
  }

  function drawPrompt(x, y, text) {
    ctx.save();
    ctx.font = '600 7px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2, y - 6, w, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.5; ctx.strokeRect(x - w / 2, y - 6, w, 12);
    ctx.fillStyle = '#f1ecdf'; ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  // ======================================================================
  // Rendering — lighting (darkness with holes)
  // ======================================================================
  function drawLighting(r) {
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, VW, VH);
    lctx.fillStyle = r.id === 'throne' ? 'rgba(10,2,6,0.62)' : 'rgba(3,3,9,0.64)';
    lctx.fillRect(0, 0, VW, VH);
    lctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, rad, a = 1) => {
      const sx = x - cam.x, sy = y - cam.y;
      if (sx < -rad || sx > VW + rad || sy < -rad || sy > VH + rad) return;
      const gr = lctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.5, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = gr; lctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    };
    if (!P.dead) hole(P.x + 5, P.y + 5, 125 + Math.sin(time * 2) * 3, 1);
    if (P.atkAnim > 0) hole(P.x + 5 + (P.atkDir === 'side' ? P.face * 16 : 0), P.y + 7 + (P.atkDir === 'up' ? -16 : P.atkDir === 'down' ? 16 : 0), 45, 0.7);
    for (const e of ents) {
      if (e.type === 'shrine') hole(e.x + 12, e.y - 2, 95 + Math.sin(time * 7 + e.t) * 4, 1);
      else if (e.type === 'item') hole(e.x + e.w / 2, e.y + e.h / 2, e.kind === 'glim' ? 26 : 60, 0.8);
      else if (e.type === 'wisp') hole(e.x + 6, e.y + 6, 42, 0.8);
      else if (e.type === 'wave') hole(e.x + 7, e.y + 6, 34, 0.8);
      else if (e.type === 'boss' && e.state !== 'dormant') hole(e.x + e.w / 2 + e.face * 8, e.y + 4, 70, 0.6);
    }
    for (const p of parts) if (p.glow || p.glim) hole(p.x, p.y, p.glim ? 10 : 14, 0.35 * Math.min(1, p.life / p.max * 2));
    ctx.drawImage(lightCv, 0, 0, VW, VH);
    // warm/colored glows (additive)
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, rad, color) => {
      const gr = ctx.createRadialGradient(x - cam.x, y - cam.y, 0, x - cam.x, y - cam.y, rad);
      gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - cam.x - rad, y - cam.y - rad, rad * 2, rad * 2);
    };
    for (const e of ents) {
      if (e.type === 'shrine') glow(e.x + 12, e.y - 2, 60, 'rgba(255,170,80,0.22)');
      if (e.type === 'item' && e.kind !== 'glim') glow(e.x + e.w / 2, e.y + e.h / 2, 30, e.kind === 'heart' ? 'rgba(255,90,110,0.3)' : 'rgba(190,180,255,0.3)');
      if (e.type === 'wisp') glow(e.x + 6, e.y + 6, 24, 'rgba(140,210,255,0.25)');
      if (e.type === 'boss' && e.state !== 'dormant') glow(e.x + e.w / 2 + e.face * 9, e.y + 1, 18, 'rgba(255,40,60,0.35)');
    }
    if (!P.dead) glow(P.x + 5 + P.face * 3, P.y + 3, 8, 'rgba(245,239,146,0.18)');
    ctx.restore();
  }

  // ======================================================================
  // Rendering — HUD & overlays
  // ======================================================================
  function paw(x, y, full) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = full ? '#eeeaf7' : 'rgba(255,255,255,0.08)';
    ctx.strokeStyle = full ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(0, 2, 3.4, 2.8, 0, 0, 7); ctx.fill(); ctx.stroke();
    for (const [tx, ty] of [[-3.6, -2.2], [-1.2, -4], [1.2, -4], [3.6, -2.2]]) { ctx.beginPath(); ctx.arc(tx, ty, 1.35, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  function text(t, x, y, size, color, align = 'left', font = 'ui', weight = 600, spacing = 0) {
    ctx.font = `${weight} ${size}px ${font === 'serif' ? '"Cormorant Garamond", "Palatino Linotype", Palatino, Georgia, serif' : '"Segoe UI", system-ui, sans-serif'}`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(t, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawHud() {
    // health: paws
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(18, 18, 16, 14, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(18, 18, 11, 0, 7); ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(18, 18, 9.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#f5ef92'; ctx.beginPath(); ctx.ellipse(16, 18, 1.2, 1.7, 0, 0, 7); ctx.ellipse(20.5, 18, 1.2, 1.7, 0, 0, 7); ctx.fill();
    const shown = Math.min(prog.maxHp, 12);
    for (let i = 0; i < shown; i++) paw(38 + i * 12, 15, i < P.hp);
    if (prog.maxHp > 12) text(`${P.hp}/${prog.maxHp}`, 38 + 12 * 12, 15.5, 7, '#eeeaf7', 'left', 'ui', 700);
    // glimmers
    ctx.save(); ctx.translate(38, 30); ctx.rotate(Math.PI / 4); ctx.fillStyle = '#9fe9ff'; ctx.fillRect(-2.2, -2.2, 4.4, 4.4); ctx.restore();
    text(String(prog.glimmers), 45, 30.5, 8, '#dff6ff', 'left', 'ui', 700);
    // abilities
    let ax = VW - 14;
    if (prog.has.dash) { drawIcon('dash', ax, 14, 0.8); ax -= 16; }
    if (prog.has.wings) { drawIcon('wings', ax, 14, 0.8); }
    // save indicator
    if (saveIcon > 0) {
      ctx.globalAlpha = Math.min(1, saveIcon);
      const fl = Math.sin(time * 9) * 0.5;
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.ellipse(VW - 70, VH - 13, 1.6, 3 + fl, 0, 0, 7); ctx.fill();
      text('Progress saved', VW - 10, VH - 12, 6.5, '#e8dcc0', 'right');
      ctx.globalAlpha = 1;
    }
    // boss health
    if (bossBar && !bossBar.dead) {
      const w = 220, x = VW / 2 - w / 2, y = VH - 20;
      text('THE HOLLOW WARDEN', VW / 2, y - 7, 7, '#e7c9cf', 'center', 'serif', 700, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, w, 4);
      ctx.fillStyle = '#b3243a'; ctx.fillRect(x, y, w * Math.max(0, bossBar.hp / bossBar.maxHp), 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.5; ctx.strokeRect(x, y, w, 4);
    }
    // area title
    if (areaTitle) {
      const t = areaTitle.t, a = t < 0.6 ? t / 0.6 : t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.8) : 1;
      ctx.globalAlpha = a;
      const y = areaTitle.boss ? VH * 0.3 : VH * 0.3;
      text(areaTitle.name.toUpperCase(), VW / 2, y, areaTitle.boss ? 20 : 16, areaTitle.boss ? '#ffd9de' : '#efe8d8', 'center', 'serif', 600, 4);
      ctx.strokeStyle = areaTitle.boss ? 'rgba(255,120,140,0.6)' : 'rgba(239,232,216,0.5)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(VW / 2 - 90, y + 14); ctx.lineTo(VW / 2 + 90, y + 14); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.save(); ctx.translate(VW / 2, y + 14); ctx.rotate(Math.PI / 4); ctx.fillRect(-2, -2, 4, 4); ctx.restore();
      if (areaTitle.sub) text(areaTitle.sub, VW / 2, y + 26, 8, '#d9b3bb', 'center', 'serif', 500, 1);
      ctx.globalAlpha = 1;
    }
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(6,5,10,0.92)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(239,232,216,0.35)'; ctx.lineWidth = 0.7; ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  }

  function drawMessage() {
    const m = message;
    const a = Math.min(1, m.t * 3);
    ctx.fillStyle = `rgba(0,0,0,${0.55 * a})`; ctx.fillRect(0, 0, VW, VH);
    ctx.globalAlpha = a;
    if (mode === 'ending') {
      panel(VW / 2 - 150, VH / 2 - 70, 300, 140);
      text('THE WARDEN FALLS', VW / 2, VH / 2 - 44, 14, '#f3e7d0', 'center', 'serif', 700, 3);
      text('The deep grows quiet. Somewhere below, a bell rings once.', VW / 2, VH / 2 - 16, 7.5, '#bfb6a6', 'center');
      text(`Glimmers ${prog.glimmers}  ·  Deaths ${prog.deaths}  ·  Time ${Math.floor(prog.playSeconds / 60)}m ${Math.floor(prog.playSeconds % 60)}s`, VW / 2, VH / 2 + 4, 7, '#9fe9ff', 'center');
      text('Thank you for playing the Nightpaw demo.', VW / 2, VH / 2 + 24, 8, '#efe8d8', 'center', 'serif', 600);
      if (m.t > 0.6) text('Press JUMP to keep exploring', VW / 2, VH / 2 + 48, 6.5, `rgba(255,255,255,${0.5 + Math.sin(time * 4) * 0.3})`, 'center');
    } else {
      panel(VW / 2 - 130, VH / 2 - 56, 260, 112);
      drawIcon(m.icon, VW / 2, VH / 2 - 30, 2.2);
      text(m.title.toUpperCase(), VW / 2, VH / 2 - 4, 13, '#f3e7d0', 'center', 'serif', 700, 3);
      m.lines.forEach((l, i) => text(l, VW / 2, VH / 2 + 16 + i * 11, 7, i === 0 ? '#bfb6a6' : '#e9e2ff', 'center'));
      if (m.t > 0.6) text('Press JUMP to continue', VW / 2, VH / 2 + 46, 6, `rgba(255,255,255,${0.5 + Math.sin(time * 4) * 0.3})`, 'center');
    }
    ctx.globalAlpha = 1;
  }

  function drawMap() {
    ctx.fillStyle = 'rgba(4,3,8,0.9)'; ctx.fillRect(0, 0, VW, VH);
    text('MAP OF THE DEEP', VW / 2, 20, 10, '#efe8d8', 'center', 'serif', 700, 3);
    const minX = Math.min(...rooms.map((r) => r.ox)), maxX = Math.max(...rooms.map((r) => r.ox + r.w));
    const minY = Math.min(...rooms.map((r) => r.oy)), maxY = Math.max(...rooms.map((r) => r.oy + r.h));
    const sc = Math.min((VW - 60) / (maxX - minX), (VH - 70) / (maxY - minY));
    const ox = (VW - (maxX - minX) * sc) / 2, oy = 38;
    for (const r of rooms) {
      if (!visited.has(r.id)) continue;
      const x = ox + (r.ox - minX) * sc, y = oy + (r.oy - minY) * sc, w = r.w * sc, h = r.h * sc;
      ctx.fillStyle = r === room ? 'rgba(239,232,216,0.16)' : 'rgba(239,232,216,0.07)';
      ctx.fillRect(x, y, w, h);
      // carve walkable space
      ctx.fillStyle = r === room ? 'rgba(239,232,216,0.35)' : 'rgba(239,232,216,0.18)';
      for (let ty = 0; ty < r.h; ty++) for (let tx = 0; tx < r.w; tx++) if (r.grid[ty][tx] !== '#') ctx.fillRect(x + tx * sc, y + ty * sc, sc + 0.05, sc + 0.05);
      ctx.strokeStyle = 'rgba(239,232,216,0.5)'; ctx.lineWidth = 0.6; ctx.strokeRect(x, y, w, h);
      if (r.spawns.some((s) => s.ch === 'S')) { const s = r.spawns.find((q) => q.ch === 'S'); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(x + s.x * sc, y + s.y * sc, 2, 0, 7); ctx.fill(); }
      text(r.name, x + w / 2, y + h + 5, 5, 'rgba(239,232,216,0.6)', 'center');
    }
    const px = ox + ((P.x + 5) / T - minX) * sc, py = oy + ((P.y + 7) / T - minY) * sc;
    ctx.fillStyle = '#f5ef92'; ctx.beginPath(); ctx.arc(px, py, 2.5 + Math.sin(time * 5) * 0.6, 0, 7); ctx.fill();
    text('M / Tab to close   ·   ● shrine   ●  you', VW / 2, VH - 12, 6.5, 'rgba(239,232,216,0.55)', 'center');
  }

  function drawPause() {
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, VW, VH);
    panel(VW / 2 - 130, VH / 2 - 80, 260, 160);
    text('PAUSED', VW / 2, VH / 2 - 58, 13, '#efe8d8', 'center', 'serif', 700, 4);
    const rows = [['Move', '← → / A D'], ['Jump', 'Space / Z  (hold for higher)'], ['Slash', 'X / J  (+↑ or ↓ in air)'], ['Dash', 'C / Shift  (once learned)'], ['Rest at shrine', '↑'], ['Map', 'M / Tab'], ['Drop through ledge', '↓ + Jump']];
    rows.forEach(([a, b], i) => { text(a, VW / 2 - 110, VH / 2 - 32 + i * 13, 7.5, '#bfb6a6'); text(b, VW / 2 + 110, VH / 2 - 32 + i * 13, 7.5, '#efe8d8', 'right'); });
    text('Esc to resume  ·  gamepad supported', VW / 2, VH / 2 + 66, 6.5, 'rgba(239,232,216,0.5)', 'center');
  }

  // ======================================================================
  // Title screen
  // ======================================================================
  const titleAsh = Array.from({ length: 70 }, () => ({ x: Math.random() * VW, y: Math.random() * VH, v: rand(6, 20), s: rand(0.5, 1.5) }));
  function buildMenu() {
    menu = saved ? [{ label: 'Continue', act: continueGame }, { label: 'New Journey', act: newGame }] : [{ label: 'Begin', act: newGame }];
    menuSel = 0;
  }
  function updateTitle() {
    if (pressed('up') || pressed('left')) { menuSel = (menuSel + menu.length - 1) % menu.length; sfx.menu(); }
    if (pressed('down') || pressed('right')) { menuSel = (menuSel + 1) % menu.length; sfx.menu(); }
    if (pressed('confirm')) { sfx.menu(); menu[menuSel].act(); }
  }
  function uiClick(x, y) {
    if (mode === 'title') {
      x *= 480 / VW; y *= 270 / VH;
      const i = menu.findIndex((m) => m.rect && x >= m.rect[0] && x <= m.rect[0] + m.rect[2] && y >= m.rect[1] && y <= m.rect[1] + m.rect[3]);
      if (i >= 0) { menuSel = i; sfx.menu(); menu[i].act(); }
    } else if ((mode === 'message' || mode === 'ending') && message.t > 0.6) { mode = 'play'; message = null; }
    else if (showMap) showMap = false;
    else if (paused) paused = false;
  }
  function drawTitle() {
    ctx.save(); ctx.scale(VW / 480, VH / 270);
    drawTitleInner();
    ctx.restore();
  }
  function drawTitleInner() {
    const VW = 480, VH = 270; // title art is laid out on a 480x270 grid
    const grd = ctx.createLinearGradient(0, 0, 0, VH);
    grd.addColorStop(0, '#0b0a1a'); grd.addColorStop(0.7, '#15112a'); grd.addColorStop(1, '#050409');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, VW, VH);
    // moon
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const mg = ctx.createRadialGradient(360, 70, 0, 360, 70, 120); mg.addColorStop(0, 'rgba(220,215,255,0.35)'); mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg; ctx.fillRect(240, -50, 240, 240);
    ctx.restore();
    ctx.fillStyle = '#e9e6ff'; ctx.beginPath(); ctx.arc(360, 70, 26, 0, 7); ctx.fill();
    ctx.fillStyle = '#0f0d22'; ctx.beginPath(); ctx.arc(371, 64, 24, 0, 7); ctx.fill();
    // spires
    ctx.fillStyle = '#100e1e';
    [[20, 120, 14], [60, 90, 10], [110, 140, 18], [300, 110, 12], [420, 80, 16], [455, 130, 10]].forEach(([x, h, w]) => { ctx.beginPath(); ctx.moveTo(x - w, VH); ctx.lineTo(x - w * 0.4, VH - h); ctx.lineTo(x, VH - h - 18); ctx.lineTo(x + w * 0.4, VH - h); ctx.lineTo(x + w, VH); ctx.fill(); });
    ctx.fillStyle = '#07060c';
    ctx.beginPath(); ctx.moveTo(0, VH); ctx.lineTo(0, 225); for (let x = 0; x <= VW; x += 20) ctx.lineTo(x, 222 + Math.sin(x * 0.05) * 5 + Math.sin(x * 0.13) * 3); ctx.lineTo(VW, VH); ctx.fill();
    // rock + cat
    ctx.beginPath(); ctx.moveTo(318, 226); ctx.quadraticCurveTo(350, 196, 392, 226); ctx.fill();
    ctx.save(); ctx.translate(352, 209); ctx.scale(-1.9, 1.9);
    catShape(ctx, 'rest', time, 'rgba(150,160,215,0.35)', 0.8);
    const h = catShape(ctx, 'rest', time, INK);
    ctx.fillStyle = '#c42f3e'; ctx.beginPath(); ctx.ellipse(h.hx - 1.6, h.hy + 4.2, 3.6, 1.6, 0.3, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(h.hx - 3.5, h.hy + 4); ctx.quadraticCurveTo(h.hx - 8, h.hy + 5 + Math.sin(time * 2) * 1, h.hx - 11, h.hy + 8 + Math.sin(time * 2)); ctx.lineTo(h.hx - 9, h.hy + 9); ctx.quadraticCurveTo(h.hx - 6, h.hy + 6, h.hx - 3, h.hy + 5.6); ctx.fill();
    const blink = (time % 4) < 0.12 ? 0.2 : 1;
    ctx.fillStyle = '#f5ef92'; ctx.beginPath(); ctx.ellipse(h.hx + 1.2, h.hy + 0.2, 1.05, 1.55 * blink, 0, 0, 7); ctx.ellipse(h.hx + 3.9, h.hy + 0.2, 1, 1.5 * blink, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d9e1ee'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-17, -1); ctx.stroke();
    ctx.restore();
    // ash
    ctx.fillStyle = 'rgba(190,185,220,0.5)';
    for (const a of titleAsh) { a.y += a.v / 60; a.x += Math.sin(time + a.y * 0.05) * 0.1; if (a.y > VH) { a.y = -2; a.x = Math.random() * VW; } ctx.fillRect(a.x, a.y, a.s, a.s); }
    // logo
    text('NIGHTPAW', 150, 84, 40, '#efe8d8', 'center', 'serif', 700, 8);
    ctx.strokeStyle = 'rgba(239,232,216,0.45)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(60, 108); ctx.lineTo(240, 108); ctx.stroke();
    text('a small cat  ·  a borrowed sword  ·  a very deep dark', 150, 118, 7, '#a9a2c0', 'center', 'serif', 500, 1);
    // menu
    menu.forEach((m, i) => {
      const y = 150 + i * 22, sel = i === menuSel;
      m.rect = [90, y - 9, 120, 18];
      if (sel) {
        ctx.fillStyle = 'rgba(239,232,216,0.08)'; ctx.fillRect(90, y - 9, 120, 18);
        ctx.fillStyle = '#f5ef92'; ctx.beginPath(); ctx.ellipse(98, y, 1.2, 1.8, 0, 0, 7); ctx.ellipse(102, y, 1.2, 1.8, 0, 0, 7); ctx.fill();
      }
      text(m.label, 150, y + 0.5, 10, sel ? '#ffffff' : '#9d97b5', 'center', 'serif', 700, 2);
    });
    if (saved) text(`${Math.floor(saved.playSeconds / 60)} min played  ·  ${saved.glimmers} glimmers  ·  ${saved.visited.length}/8 areas`, 150, 204, 6.5, '#8f89a8', 'center');
    text(launchMode === 'demo' ? 'DEMO — progress carries over to the full game' : 'Arrows / WASD · Z jump · X slash · Esc help', 150, VH - 14, 6, 'rgba(239,232,216,0.45)', 'center');
  }

  function newGame() {
    prog = newProgress();
    visited = new Set(); taken = new Set();
    closeGate(false);
    const s = startPos();
    placePlayer(s.x, s.y);
    P.hp = prog.maxHp; P.dead = false; P.face = 1; P.vx = P.vy = 0; P.resting = false;
    parts = [];
    enterRoom(roomAt(P.x + 5, P.y + 7), { snap: true });
    mode = 'play'; fade = 1;
    save();
  }
  function continueGame() {
    prog = { ...newProgress(), ...JSON.parse(JSON.stringify(saved)) };
    visited = new Set(prog.visited); taken = new Set(prog.taken);
    closeGate(false);
    const pos = prog.pos ?? prog.shrine ?? startPos();
    placePlayer(pos.x, pos.y);
    P.hp = clamp(prog.hp ?? prog.maxHp, 1, prog.maxHp); P.dead = false; P.vx = P.vy = 0; P.resting = false;
    parts = [];
    const r = roomAt(P.x + 5, P.y + 7) ?? roomAt(startPos().x, startPos().y);
    enterRoom(r, { snap: true, quiet: true });
    areaTitle = { name: r.name, t: 0 };
    mode = 'play'; fade = 1;
  }

  // ======================================================================
  // Frame
  // ======================================================================
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, CW, CH);
    ctx.setTransform(S, 0, 0, S, OX, OY);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
    if (mode === 'boot') {
      text('NIGHTPAW', VW / 2, VH / 2 - 6, 18, '#efe8d8', 'center', 'serif', 700, 6);
      text('lighting the candles…', VW / 2, VH / 2 + 14, 7, '#8f89a8', 'center');
    } else if (mode === 'title') {
      drawTitle();
    } else {
      const sx = shake > 0.3 ? rand(-shake, shake) * 0.5 : 0, sy = shake > 0.3 ? rand(-shake, shake) * 0.5 : 0;
      drawBackground(room);
      ctx.save();
      ctx.translate(Math.round((-cam.x + sx) * S) / S, Math.round((-cam.y + sy) * S) / S);
      // neighbouring rooms' tiles are visible at openings; draw current room only (rooms are separate screens)
      ctx.drawImage(roomCanvas(room), room.px, room.py, room.pw, room.ph);
      // gate bars
      for (const d of room.doors) if (room.grid[d.y][d.x] === 'X') {
        const x = (room.ox + d.x) * T, y = (room.oy + d.y) * T;
        ctx.fillStyle = '#231b26'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 2 + i * 5, y, 2.5, T);
        ctx.fillStyle = '#3a2f3e'; ctx.fillRect(x, y + 7, T, 2);
      }
      for (const e of ents) if (e.type === 'shrine') drawEnt(e);
      for (const p of parts) if (p.ash) { ctx.fillStyle = p.color; ctx.globalAlpha = Math.min(1, p.life); ctx.fillRect(p.x, p.y, p.size, p.size); }
      ctx.globalAlpha = 1;
      for (const e of ents) if (e.type !== 'shrine') drawEnt(e);
      drawCat();
      for (const p of parts) {
        if (p.ash) continue;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.5));
        ctx.fillStyle = p.color;
        if (p.glim) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4); ctx.fillRect(-1.3, -1.3, 2.6, 2.6); ctx.restore(); }
        else ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      ctx.save(); ctx.translate(sx, sy); drawLighting(room); ctx.restore();
      if (P.dead) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, P.deadT / 1.5)})`; ctx.fillRect(0, 0, VW, VH); }
      if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`; ctx.fillRect(0, 0, VW, VH); }
      drawHud();
      if (mode === 'message' || mode === 'ending') drawMessage();
      if (showMap) drawMap();
      if (paused) drawPause();
    }
    if (fade > 0) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`; ctx.fillRect(0, 0, VW, VH); }
    ctx.restore();
  }

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    pollInput();
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      update(STEP);
      if (first) { consumeEdges(); first = false; }
      acc -= STEP;
    }
    render();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') { paused = true; save(); } last = performance.now(); });

  // QA hook (sandboxed; exposes nothing about the platform)
  window.__nightpaw = {
    state: () => ({ mode, room: room?.id, x: P.x, y: P.y, vx: P.vx, vy: P.vy, onGround: P.onGround, hp: P.hp, dead: P.dead, paused, prog: prog && { ...prog, has: { ...prog.has } }, ents: ents.map((e) => ({ type: e.type, state: e.state, hp: e.hp, x: e.x, y: e.y })) }),
    calm: () => { ents = ents.filter((e) => !e.harm || e.type === 'boss'); },
    teleport: (tx, ty) => { P.x = tx * T + 3; P.y = ty * T + T - P.h; P.vx = P.vy = 0; const r = roomAt(P.x + 5, P.y + 7); if (r && r !== room) enterRoom(r, { snap: true, quiet: true }); snapCamera(); },
  };

  // ======================================================================
  // Boot
  // ======================================================================
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
  (async () => {
    const [world, ctxInfo] = await Promise.all([fetch('assets/world.json').then((r) => r.json()), Platform.ready()]);
    launchMode = ctxInfo.mode;
    loadWorld(world);
    resize();
    const [s, ach] = await Promise.all([
      Platform.storage.load(SAVE_KEY).catch(() => null),
      Platform.achievements.list().catch(() => []),
    ]);
    ach.filter((a) => a.unlockedAt).forEach((a) => unlockedAch.add(a.id));
    if (s && s.v === 1) saved = s;
    buildMenu();
    mode = 'title';
  })();
})();
