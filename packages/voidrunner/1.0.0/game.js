// VOIDRUNNER — tiny neon arcade shooter for the Lantern runtime.
// All persistence goes through the Lantern Platform SDK (window.Platform).
(() => {
  'use strict';
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, U = 1;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    U = Math.max(0.6, Math.min(W, H) / 720);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- persistent state (via Platform.storage) ----------
  let progress = { bestScore: 0, furthestSector: 1, runs: 0, totalKills: 0 };
  let savedRun = null;
  const unlocked = new Set();
  let saveNote = '', saveNoteT = 0;
  let sectors = [];

  async function saveProgress() {
    try { await Platform.storage.save('progress', progress); note('Progress saved'); } catch (e) { note('Save failed'); }
  }
  async function saveRun() {
    try {
      if (state === 'play' || state === 'clear') {
        await Platform.storage.save('run', { sector, score, lives, savedAt: Date.now() });
      } else {
        await Platform.storage.remove('run');
      }
    } catch (e) { /* non-fatal */ }
  }
  function note(t) { saveNote = t; saveNoteT = 2.2; }
  function achieve(id) {
    if (unlocked.has(id)) return;
    unlocked.add(id);
    Platform.achievements.unlock(id).catch(() => unlocked.delete(id));
  }
  Platform.game.onExit(() => Promise.all([saveProgress(), saveRun()]));

  // ---------- audio ----------
  let ac = null;
  function audio() { if (!ac) { try { ac = new AudioContext(); } catch (e) { ac = null; } } return ac; }
  function tone(freq, dur, type = 'square', vol = 0.05, slide = 0) {
    const a = ac; if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  const sfx = {
    shot: () => tone(880, 0.05, 'square', 0.015, -400),
    boom: () => { tone(160, 0.25, 'sawtooth', 0.05, -120); tone(90, 0.3, 'triangle', 0.06, -60); },
    hit: () => tone(120, 0.4, 'sawtooth', 0.08, -90),
    power: () => { tone(520, 0.1, 'triangle', 0.05, 400); setTimeout(() => tone(880, 0.12, 'triangle', 0.05, 300), 80); },
    clear: () => [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.05), i * 90)),
  };

  // ---------- input ----------
  const keys = {};
  let pointer = null;
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true; audio();
    if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (state === 'title') {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') menuSel = (menuSel + menu.length - 1) % menu.length;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') menuSel = (menuSel + 1) % menu.length;
      if (e.code === 'Enter' || e.code === 'Space') menu[menuSel].act();
    } else if (state === 'over' && stateT > 1 && (e.code === 'Enter' || e.code === 'Space')) toTitle();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  cv.addEventListener('pointerdown', (e) => {
    audio();
    pointer = { x: e.clientX, y: e.clientY };
    if (state === 'title') {
      const hit = menu.findIndex((m) => m.rect && e.clientX >= m.rect[0] && e.clientX <= m.rect[0] + m.rect[2] && e.clientY >= m.rect[1] && e.clientY <= m.rect[1] + m.rect[3]);
      if (hit >= 0) { menuSel = hit; menu[hit].act(); }
      pointer = null;
    } else if (state === 'over' && stateT > 1) { toTitle(); pointer = null; }
  });
  cv.addEventListener('pointermove', (e) => { if (pointer || e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointer = null; });
  cv.addEventListener('pointerleave', () => { pointer = null; });

  // ---------- world ----------
  let state = 'loading', stateT = 0, paused = false;
  let sector = 1, score = 0, lives = 3, sectorKills = 0, hitThisSector = false;
  let spawnT = 0, fireT = 0, combo = 1, comboT = 0, spreadT = 0, shake = 0, invuln = 0;
  let player = { x: 0, y: 0 };
  let bullets = [], enemies = [], ebullets = [], parts = [], pickups = [];
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.9 + 0.1 }));
  let menu = [], menuSel = 0;

  const sec = () => {
    const base = sectors[Math.min(sector - 1, sectors.length - 1)] || { name: 'Sector', hue: 320, kills: 14, spawn: 1, speed: 1, fire: 0.3 };
    const over = Math.max(0, sector - sectors.length);
    return { ...base, name: over ? `${base.name} +${over}` : base.name, kills: base.kills + over * 6, spawn: Math.max(0.25, base.spawn - over * 0.05), speed: base.speed + over * 0.15, fire: base.fire + over * 0.1 };
  };

  function buildMenu() {
    menu = [];
    if (savedRun) menu.push({ label: `RESUME RUN  ·  SECTOR ${savedRun.sector}  ·  ${savedRun.score.toLocaleString()} PTS`, act: () => startRun(savedRun.sector, savedRun.score, savedRun.lives) });
    if (progress.furthestSector > 1) menu.push({ label: `CONTINUE FROM SECTOR ${progress.furthestSector}`, act: () => startRun(progress.furthestSector, 0, 3) });
    menu.push({ label: 'NEW RUN  ·  SECTOR 1', act: () => startRun(1, 0, 3) });
    menuSel = 0;
  }

  function toTitle() { state = 'title'; stateT = 0; buildMenu(); }

  function startRun(fromSector, sc, lv) {
    sector = fromSector; score = sc; lives = lv;
    bullets = []; enemies = []; ebullets = []; pickups = [];
    player = { x: W / 2, y: H * 0.82 };
    sectorKills = 0; hitThisSector = false; spawnT = 1; combo = 1; spreadT = 0; invuln = 1.5;
    state = 'play'; stateT = 0;
    progress.runs++;
    savedRun = null;
    saveProgress(); saveRun();
  }

  function spawnEnemy() {
    const s = sec();
    const r = Math.random();
    const x = 40 * U + Math.random() * (W - 80 * U);
    if (r < 0.55) enemies.push({ type: 'drifter', x, y: -30, vy: (90 + Math.random() * 50) * s.speed * U, ph: Math.random() * 6, amp: (40 + Math.random() * 80) * U, x0: x, hp: 1, r: 13 * U, t: 0 });
    else if (r < 0.85) enemies.push({ type: 'diver', x, y: -30, vy: 70 * s.speed * U, hp: 1, r: 12 * U, t: 0, dove: false });
    else enemies.push({ type: 'gunner', x, y: -30, vy: 80 * U, hp: 3, r: 18 * U, t: 0, stopY: H * (0.12 + Math.random() * 0.2), dir: Math.random() < 0.5 ? -1 : 1, fireT: 1 });
  }

  function burst(x, y, hue, n = 18, spd = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (Math.random() * spd + 40) * U;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, max: 1, hue });
    }
  }

  function killEnemy(e) {
    const s = sec();
    burst(e.x, e.y, s.hue, e.type === 'gunner' ? 34 : 18);
    sfx.boom(); shake = Math.max(shake, e.type === 'gunner' ? 8 : 4);
    score += Math.round((e.type === 'gunner' ? 300 : 100) * sector * combo);
    combo = Math.min(8, combo + 0.25); comboT = 1.6;
    sectorKills++; progress.totalKills++;
    achieve('first_blood');
    if (score >= 25000) achieve('score_25k');
    if (Math.random() < 0.06) pickups.push({ x: e.x, y: e.y, vy: 80 * U, t: 0 });
    if (sectorKills >= s.kills) clearSector();
  }

  function clearSector() {
    state = 'clear'; stateT = 0; sfx.clear();
    ebullets = [];
    enemies.forEach((e) => burst(e.x, e.y, sec().hue, 10)); enemies = [];
    if (!hitThisSector) achieve('untouchable');
    const next = sector + 1;
    if (next > progress.furthestSector) progress.furthestSector = next;
    if (next >= 3) achieve('sector_3');
    if (next >= 5) achieve('sector_5');
    progress.bestScore = Math.max(progress.bestScore, score);
    sector = next; sectorKills = 0; hitThisSector = false;
    saveProgress(); saveRun();
  }

  function playerHit() {
    if (invuln > 0) return;
    lives--; hitThisSector = true; invuln = 1.6; combo = 1; shake = 14; sfx.hit();
    burst(player.x, player.y, 0, 40, 340);
    if (lives <= 0) {
      state = 'over'; stateT = 0;
      progress.bestScore = Math.max(progress.bestScore, score);
      savedRun = null;
      saveProgress(); saveRun();
    }
  }

  // ---------- update ----------
  function update(dt) {
    stateT += dt;
    if (saveNoteT > 0) saveNoteT -= dt;
    const s = sec();
    for (const st of stars) { st.y += dt * st.z * (state === 'play' ? 0.25 * s.speed : 0.05); if (st.y > 1) { st.y = 0; st.x = Math.random(); } }
    for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    parts = parts.filter((p) => p.life > 0);
    shake *= 0.88;
    if (state === 'clear' && stateT > 2.2) { state = 'play'; stateT = 0; spawnT = 1; invuln = 1; }
    if (state !== 'play') return;

    // player
    const sp = 460 * U;
    let dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.KeyA) dx -= 1;
    if (keys.ArrowRight || keys.KeyD) dx += 1;
    if (keys.ArrowUp || keys.KeyW) dy -= 1;
    if (keys.ArrowDown || keys.KeyS) dy += 1;
    if (dx || dy) { const l = Math.hypot(dx, dy); player.x += (dx / l) * sp * dt; player.y += (dy / l) * sp * dt; }
    else if (pointer) {
      const ty = pointer.y - 40 * U; // keep ship above finger
      player.x += (pointer.x - player.x) * Math.min(1, dt * 12);
      player.y += (ty - player.y) * Math.min(1, dt * 12);
    }
    player.x = Math.max(16 * U, Math.min(W - 16 * U, player.x));
    player.y = Math.max(H * 0.3, Math.min(H - 20 * U, player.y));
    invuln = Math.max(0, invuln - dt);
    spreadT = Math.max(0, spreadT - dt);
    comboT -= dt; if (comboT <= 0) combo = Math.max(1, combo - dt * 2);

    // auto-fire
    fireT -= dt;
    if (fireT <= 0) {
      fireT = 0.11;
      const v = -900 * U;
      bullets.push({ x: player.x, y: player.y - 16 * U, vx: 0, vy: v });
      if (spreadT > 0) { bullets.push({ x: player.x, y: player.y - 10 * U, vx: -220 * U, vy: v }); bullets.push({ x: player.x, y: player.y - 10 * U, vx: 220 * U, vy: v }); }
      if (Math.random() < 0.3) sfx.shot();
    }
    for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    bullets = bullets.filter((b) => b.y > -20 && b.x > -20 && b.x < W + 20);

    // spawn
    spawnT -= dt;
    if (spawnT <= 0) { spawnEnemy(); spawnT = s.spawn * (0.6 + Math.random() * 0.8); }

    // enemies
    for (const e of enemies) {
      e.t += dt;
      if (e.type === 'drifter') { e.y += e.vy * dt; e.x = e.x0 + Math.sin(e.t * 2 + e.ph) * e.amp; }
      else if (e.type === 'diver') {
        if (!e.dove && e.y > H * 0.25) { e.dove = true; const a = Math.atan2(player.y - e.y, player.x - e.x); const v = 380 * s.speed * U; e.vx = Math.cos(a) * v; e.vy = Math.sin(a) * v; }
        if (e.dove) { e.x += e.vx * dt; e.y += e.vy * dt; } else e.y += e.vy * dt;
      } else {
        if (e.y < e.stopY) e.y += e.vy * dt;
        else { e.x += e.dir * 90 * U * dt; if (e.x < 30 * U || e.x > W - 30 * U) e.dir *= -1; }
        e.fireT -= dt * s.fire * 1.6;
        if (e.fireT <= 0 && e.y > 0) {
          e.fireT = 1;
          const a = Math.atan2(player.y - e.y, player.x - e.x), v = 260 * U * s.speed;
          for (const o of [-0.18, 0, 0.18]) ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a + o) * v, vy: Math.sin(a + o) * v });
        }
      }
      if (e.type === 'drifter' && Math.random() < dt * s.fire * 0.25 && e.y > 0 && e.y < H * 0.6) {
        const a = Math.atan2(player.y - e.y, player.x - e.x), v = 230 * U * s.speed;
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v });
      }
    }
    // collisions: bullets vs enemies
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < e.r + 4 * U) {
          e.hp--; b.y = -999;
          if (e.hp <= 0) killEnemy(e); else burst(b.x, b.y, s.hue, 4, 120);
          break;
        }
      }
      if (state !== 'play') return;
    }
    enemies = enemies.filter((e) => e.hp > 0 && e.y < H + 40 && e.x > -60 && e.x < W + 60);
    // enemy contact
    for (const e of enemies) if (Math.hypot(e.x - player.x, e.y - player.y) < e.r + 10 * U) { e.hp = 0; burst(e.x, e.y, s.hue); playerHit(); }
    for (const b of ebullets) { b.x += b.vx * dt; b.y += b.vy * dt; if (Math.hypot(b.x - player.x, b.y - player.y) < 9 * U) { b.y = H + 999; playerHit(); } }
    ebullets = ebullets.filter((b) => b.y < H + 20 && b.y > -20 && b.x > -20 && b.x < W + 20);
    for (const p of pickups) { p.t += dt; p.y += p.vy * dt; if (Math.hypot(p.x - player.x, p.y - player.y) < 26 * U) { p.y = H + 999; spreadT = 9; sfx.power(); score += 250 * sector; } }
    pickups = pickups.filter((p) => p.y < H + 30);

    // occasional activity ping for the platform
    if (Math.floor(stateT) % 30 === 0 && Math.floor(stateT - dt) % 30 !== 0) Platform.game.reportPlaytime().catch(() => {});
  }

  // ---------- render ----------
  const hsl = (h, s = 100, l = 60, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  function glowLine(draw, color, width) {
    ctx.strokeStyle = color; ctx.globalAlpha = 0.25; ctx.lineWidth = width * 4; ctx.beginPath(); draw(); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = width; ctx.beginPath(); draw(); ctx.stroke();
  }
  function text(t, x, y, size, color, align = 'center', weight = 700, spacing = 0) {
    ctx.font = `${weight} ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(t, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function drawShip(x, y, hue, s = 1) {
    ctx.lineJoin = 'round';
    glowLine(() => { ctx.moveTo(x, y - 18 * U * s); ctx.lineTo(x + 13 * U * s, y + 12 * U * s); ctx.lineTo(x, y + 5 * U * s); ctx.lineTo(x - 13 * U * s, y + 12 * U * s); ctx.closePath(); }, hsl(hue, 100, 70), 2 * U);
    ctx.fillStyle = hsl(hue + 40, 100, 70, 0.8);
    ctx.beginPath(); ctx.arc(x, y + 10 * U * s, (3 + Math.random() * 3) * U * s, 0, Math.PI * 2); ctx.fill();
  }

  function render() {
    const s = sec();
    ctx.save();
    if (shake > 0.5) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hsl(s.hue + 20, 60, 4)); g.addColorStop(1, hsl(s.hue, 70, 9));
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
    // perspective grid floor
    ctx.strokeStyle = hsl(s.hue, 100, 60, 0.12); ctx.lineWidth = 1;
    const hz = H * 0.55, off = (performance.now() / 20) % 40;
    ctx.beginPath();
    for (let i = -20; i <= 20; i++) { ctx.moveTo(W / 2 + i * 12, hz); ctx.lineTo(W / 2 + i * W * 0.12, H); }
    for (let i = 0; i < 14; i++) { const y = hz + (H - hz) * ((i + off / 40) / 14) ** 2; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    for (const st of stars) { ctx.fillStyle = `rgba(255,255,255,${st.z * 0.8})`; ctx.fillRect(st.x * W, st.y * H, st.z * 2.2, st.z * (state === 'play' ? 6 : 2.2)); }

    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) { ctx.fillStyle = hsl(p.hue, 100, 65, Math.max(0, p.life)); ctx.fillRect(p.x - 2, p.y - 2, 3 * U, 3 * U); }
    ctx.fillStyle = hsl(s.hue + 180, 100, 75);
    for (const b of bullets) { ctx.fillRect(b.x - 1.5 * U, b.y - 9 * U, 3 * U, 14 * U); }
    for (const b of ebullets) { ctx.fillStyle = hsl(40, 100, 60, 0.35); ctx.beginPath(); ctx.arc(b.x, b.y, 8 * U, 0, 7); ctx.fill(); ctx.fillStyle = '#fff4d0'; ctx.beginPath(); ctx.arc(b.x, b.y, 3.5 * U, 0, 7); ctx.fill(); }
    for (const e of enemies) {
      const c = hsl(s.hue, 100, 62);
      if (e.type === 'drifter') glowLine(() => { ctx.moveTo(e.x, e.y + e.r); ctx.lineTo(e.x + e.r, e.y); ctx.lineTo(e.x, e.y - e.r); ctx.lineTo(e.x - e.r, e.y); ctx.closePath(); }, c, 2 * U);
      else if (e.type === 'diver') glowLine(() => { ctx.moveTo(e.x, e.y + e.r * 1.3); ctx.lineTo(e.x + e.r, e.y - e.r); ctx.lineTo(e.x - e.r, e.y - e.r); ctx.closePath(); }, hsl(s.hue + 60, 100, 65), 2 * U);
      else { glowLine(() => { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + e.t; ctx.lineTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r); } ctx.closePath(); }, hsl(s.hue - 40, 100, 65), 2.5 * U); ctx.fillStyle = hsl(s.hue - 40, 100, 70, 0.5 + e.hp * 0.15); ctx.beginPath(); ctx.arc(e.x, e.y, 4 * U, 0, 7); ctx.fill(); }
    }
    for (const p of pickups) { const r = (10 + Math.sin(p.t * 8) * 2) * U; glowLine(() => ctx.arc(p.x, p.y, r, 0, 7), hsl(120, 100, 65), 2 * U); text('S', p.x, p.y + 1, 12 * U, '#caffca'); }
    if (state === 'play' || state === 'clear') {
      if (!(invuln > 0 && Math.floor(invuln * 12) % 2)) drawShip(player.x, player.y, s.hue + 180);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // HUD
    const pad = 18 * U;
    if (state === 'play' || state === 'clear') {
      text(score.toLocaleString(), pad, pad + 8 * U, 26 * U, '#fff', 'left', 800);
      text(`SECTOR ${sector} · ${s.name.toUpperCase()}`, pad, pad + 34 * U, 12 * U, hsl(s.hue, 100, 75), 'left', 700, 2);
      if (combo > 1.2) text(`x${combo.toFixed(1)}`, pad, pad + 56 * U, 14 * U, hsl(50, 100, 65), 'left', 800);
      for (let i = 0; i < lives; i++) drawShip(W - pad - 10 * U - i * 28 * U, pad + 14 * U, s.hue + 180, 0.6);
      const bw = Math.min(W * 0.4, 360 * U);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(W / 2 - bw / 2, H - 14 * U, bw, 4 * U);
      ctx.fillStyle = hsl(s.hue, 100, 65); ctx.fillRect(W / 2 - bw / 2, H - 14 * U, bw * Math.min(1, sectorKills / s.kills), 4 * U);
      if (spreadT > 0) text(`SPREAD ${spreadT.toFixed(0)}s`, W / 2, H - 28 * U, 11 * U, '#9f9', 'center', 700, 2);
    }
    if (state === 'clear') {
      const a = Math.min(1, stateT * 3);
      ctx.globalAlpha = a;
      text(`SECTOR ${sector - 1} CLEAR`, W / 2, H * 0.4, 44 * U, '#fff', 'center', 900, 6);
      text(`ENTERING ${s.name.toUpperCase()}`, W / 2, H * 0.4 + 44 * U, 14 * U, hsl(s.hue, 100, 70), 'center', 700, 4);
      ctx.globalAlpha = 1;
    }
    if (state === 'title' || state === 'loading') drawTitle(s);
    if (state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H);
      text('SIGNAL LOST', W / 2, H * 0.36, 52 * U, hsl(350, 100, 65), 'center', 900, 8);
      text(`${score.toLocaleString()} PTS`, W / 2, H * 0.36 + 56 * U, 24 * U, '#fff', 'center', 800);
      text(`BEST ${progress.bestScore.toLocaleString()}  ·  FURTHEST SECTOR ${progress.furthestSector}`, W / 2, H * 0.36 + 90 * U, 12 * U, '#bbb', 'center', 600, 2);
      if (stateT > 1) text('PRESS ENTER  ·  TAP TO CONTINUE', W / 2, H * 0.36 + 140 * U, 12 * U, `rgba(255,255,255,${0.5 + Math.sin(stateT * 4) * 0.4})`, 'center', 700, 3);
    }
    if (paused && state === 'play') { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H); text('PAUSED', W / 2, H / 2, 40 * U, '#fff', 'center', 900, 8); }
    if (saveNoteT > 0) text(`● ${saveNote}`, W - pad, H - pad, 11 * U, `rgba(160,255,200,${Math.min(1, saveNoteT)})`, 'right', 600, 1);
  }

  function drawTitle(s) {
    const cx = W / 2, ty = H * 0.28;
    ctx.globalCompositeOperation = 'lighter';
    text('VOIDRUNNER', cx + 3, ty + 2, Math.min(86 * U, W / 8), hsl(190, 100, 55, 0.6), 'center', 900, 10 * U);
    text('VOIDRUNNER', cx, ty, Math.min(86 * U, W / 8), hsl(320, 100, 66), 'center', 900, 10 * U);
    ctx.globalCompositeOperation = 'source-over';
    text('A NINEFOLD ARCADE', cx, ty + 60 * U, 12 * U, 'rgba(255,255,255,.6)', 'center', 700, 6);
    if (state === 'loading') { text('CONNECTING TO LANTERN…', cx, H * 0.6, 12 * U, '#aaa', 'center', 600, 3); return; }
    text(`BEST ${progress.bestScore.toLocaleString()}   ·   FURTHEST SECTOR ${progress.furthestSector}   ·   RUNS ${progress.runs}`, cx, ty + 96 * U, 12 * U, hsl(190, 100, 75), 'center', 700, 2);
    const bw = Math.min(W - 40, 520 * U), bh = 46 * U;
    menu.forEach((m, i) => {
      const x = cx - bw / 2, y = H * 0.52 + i * (bh + 12 * U);
      m.rect = [x, y, bw, bh];
      const sel = i === menuSel;
      ctx.fillStyle = sel ? hsl(320, 100, 60, 0.22) : 'rgba(255,255,255,.04)'; ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = sel ? hsl(320, 100, 70) : 'rgba(255,255,255,.18)'; ctx.lineWidth = sel ? 2 : 1; ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
      text(m.label, cx, y + bh / 2 + 1, 14 * U, sel ? '#fff' : '#bbb', 'center', 700, 2);
    });
    text('MOVE: WASD / ARROWS / MOUSE / TOUCH  ·  AUTO-FIRE', cx, H - 30 * U, 11 * U, 'rgba(255,255,255,.4)', 'center', 600, 2);
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { paused = document.hidden; last = performance.now(); if (document.hidden) saveRun(); });
  Platform.game.onPause(() => { paused = true; });
  Platform.game.onResume(() => { paused = false; last = performance.now(); });
  requestAnimationFrame(frame);

  // ---------- boot ----------
  (async () => {
    try {
      const res = await fetch('assets/sectors.json');
      sectors = await res.json();
    } catch (e) { sectors = []; }
    await Platform.ready();
    const [p, run, ach] = await Promise.all([
      Platform.storage.load('progress').catch(() => null),
      Platform.storage.load('run').catch(() => null),
      Platform.achievements.list().catch(() => []),
    ]);
    if (p) progress = { ...progress, ...p };
    if (run && run.lives > 0) savedRun = run;
    ach.filter((a) => a.unlockedAt).forEach((a) => unlocked.add(a.id));
    toTitle();
  })();
})();
