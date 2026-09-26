// TIDEWATER TRADING CO. — incremental harbor game for the Lantern runtime.
// State is saved through Platform.storage ("harbor" key). The game has no idea
// whether that ends up in a browser, a desktop cache or a cloud-save service.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const OFFLINE_CAP_S = 8 * 3600;
  let econ = { buildings: [], upgrades: [] };

  const fresh = () => ({ v: 1, harborName: "Gull's Rest", coins: 0, lifetime: 0, clicks: 0, buildings: {}, upgrades: [], startedAt: Date.now(), savedAt: Date.now(), playSeconds: 0 });
  let S = fresh();
  let dirty = false, saving = false, lastSaveAt = null;
  const unlocked = new Set();

  // ---------- economy ----------
  const count = (id) => S.buildings[id] || 0;
  const has = (id) => S.upgrades.includes(id);
  const cost = (b) => Math.ceil(b.cost * Math.pow(1.15, count(b.id)));
  function mult(id) {
    let m = 1;
    for (const u of econ.upgrades) if (has(u.id)) { if (u.effect[id]) m *= u.effect[id]; if (u.effect.all && id !== 'click') m *= u.effect.all; }
    return m;
  }
  const yieldOf = (b) => b.rate * mult(b.id);
  const rate = () => econ.buildings.reduce((t, b) => t + count(b.id) * yieldOf(b), 0);
  const clickValue = () => Math.max(1, Math.round((1 + rate() * 0.05) * mult('click')));
  const totalOwned = () => Object.values(S.buildings).reduce((a, b) => a + b, 0);

  function fmt(n) {
    if (n < 1000) return n < 10 && n % 1 ? n.toFixed(1) : Math.floor(n).toLocaleString();
    const u = ['K', 'M', 'B', 'T']; let i = -1;
    while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
    return `${n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)}${u[i]}`;
  }
  function dur(s) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; }

  function earn(n) { S.coins += n; S.lifetime += n; dirty = true; checkAchievements(); }

  function achieve(id) {
    if (unlocked.has(id)) return;
    unlocked.add(id);
    Platform.achievements.unlock(id).catch(() => unlocked.delete(id));
  }
  function checkAchievements() {
    if (S.clicks > 0) achieve('first_catch');
    if (count('skiff') > 0) achieve('first_skiff');
    if (totalOwned() >= 10) achieve('fleet_10');
    if (has('lighthouse')) achieve('lighthouse');
    if (S.lifetime >= 1000) achieve('coins_1k');
    if (S.lifetime >= 100000) achieve('coins_100k');
  }

  // ---------- persistence ----------
  async function save(reason) {
    if (saving) return;
    saving = true;
    S.savedAt = Date.now();
    setSaveState('Saving…');
    try {
      await Platform.storage.save('harbor', S);
      dirty = false; lastSaveAt = new Date();
      setSaveState(`✓ Saved to Lantern · ${lastSaveAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}${reason ? ` (${reason})` : ''}`);
    } catch (e) {
      setSaveState(`Save failed: ${e.message}`);
    } finally { saving = false; }
  }
  function setSaveState(t) { $('saveState').textContent = t; }
  let saveDebounce = null;
  const saveSoon = () => { clearTimeout(saveDebounce); saveDebounce = setTimeout(() => save(), 800); };
  Platform.game.onExit(() => { saving = false; return save('on exit'); });
  setInterval(() => { if (dirty) save('autosave'); }, 15000);

  // ---------- actions ----------
  function haul(ev) {
    const v = clickValue();
    S.clicks++; earn(v);
    const f = document.createElement('div');
    f.className = 'float'; f.textContent = `+${fmt(v)}`;
    const r = $('haul').getBoundingClientRect();
    f.style.left = `${(ev?.clientX ?? r.left + r.width / 2) - 12 + (Math.random() - 0.5) * 30}px`;
    f.style.top = `${(ev?.clientY ?? r.top) - 20}px`;
    $('floaters').appendChild(f);
    setTimeout(() => f.remove(), 1000);
    splash();
    render();
  }
  function buy(id) {
    const b = econ.buildings.find((x) => x.id === id);
    const c = cost(b);
    if (S.coins < c) return;
    S.coins -= c; S.buildings[id] = count(id) + 1; dirty = true;
    if (id === 'skiff' || id === 'cog' || id === 'clipper') launchBoat(id);
    checkAchievements(); render(true); saveSoon();
  }
  function upgrade(id) {
    const u = econ.upgrades.find((x) => x.id === id);
    if (has(id) || S.coins < u.cost) return;
    S.coins -= u.cost; S.upgrades.push(id); dirty = true;
    checkAchievements(); render(true); saveSoon();
  }

  // ---------- UI ----------
  let lastListKey = '';
  function render(force) {
    $('coins').textContent = fmt(S.coins);
    $('rate').textContent = fmt(rate());
    $('clickValue').textContent = fmt(clickValue());
    $('harborName').textContent = S.harborName;
    const listKey = JSON.stringify([S.buildings, S.upgrades]);
    if (force || listKey !== lastListKey) {
      lastListKey = listKey;
      const maxSeen = econ.buildings.findIndex((b) => count(b.id) === 0 && S.lifetime < b.cost * 0.5);
      $('buildings').innerHTML = econ.buildings.map((b, i) => {
        const locked = maxSeen >= 0 && i > maxSeen;
        return `<div class="item ${locked ? 'locked' : ''}" data-b="${b.id}">
          <div><div class="name">${locked ? '???' : b.name}<span class="count">${count(b.id) || ''}</span></div>
          <div class="desc">${locked ? 'Keep growing the harbor…' : b.desc}</div>
          <div class="yield">${locked ? '' : `${fmt(yieldOf(b))} coins/sec each`}</div></div>
          <button data-buy="${b.id}" ${locked ? 'disabled' : ''}>Buy · ${fmt(cost(b))}</button></div>`;
      }).join('');
      $('upgrades').innerHTML = econ.upgrades.filter((u, i) => has(u.id) || i <= S.upgrades.length + 1).map((u) => `
        <div class="item ${has(u.id) ? 'owned' : ''}"><div><div class="name">${u.name}</div><div class="desc">${u.desc}</div></div>
        <button data-up="${u.id}" ${has(u.id) ? 'disabled' : ''}>${has(u.id) ? 'Owned' : fmt(u.cost)}</button></div>`).join('');
    }
    document.querySelectorAll('[data-buy]').forEach((btn) => { const b = econ.buildings.find((x) => x.id === btn.dataset.buy); if (!btn.closest('.locked')) btn.disabled = S.coins < cost(b); });
    document.querySelectorAll('[data-up]').forEach((btn) => { const u = econ.upgrades.find((x) => x.id === btn.dataset.up); btn.disabled = has(u.id) || S.coins < u.cost; });
    $('stats').innerHTML = `
      <dt>Lifetime earnings</dt><dd>${fmt(S.lifetime)}</dd>
      <dt>Nets hauled</dt><dd>${S.clicks.toLocaleString()}</dd>
      <dt>Vessels &amp; buildings</dt><dd>${totalOwned()}</dd>
      <dt>Harbor founded</dt><dd>${new Date(S.startedAt).toLocaleDateString()}</dd>
      <dt>Time at the harbor</dt><dd>${dur(S.playSeconds)}</dd>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]'); if (b) return buy(b.dataset.buy);
    const u = e.target.closest('[data-up]'); if (u) return upgrade(u.dataset.up);
  });
  $('haul').addEventListener('click', haul);
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); haul(); } });
  $('saveNow').addEventListener('click', () => save('manual'));
  $('modalOk').addEventListener('click', () => $('modal').classList.add('hidden'));
  $('harborName').addEventListener('click', () => {
    const btn = $('harborName');
    const input = document.createElement('input');
    input.value = S.harborName; input.maxLength = 28; input.className = 'harbor-name';
    input.style.cssText = 'background:#0008;border:1px solid #6b5230;padding:2px 6px;width:220px';
    btn.replaceWith(input); input.focus(); input.select();
    const done = () => { S.harborName = input.value.trim() || S.harborName; dirty = true; input.replaceWith(btn); render(); save('renamed'); };
    input.addEventListener('blur', done, { once: true });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });
  function modal(title, body) { $('modalTitle').textContent = title; $('modalBody').innerHTML = body; $('modal').classList.remove('hidden'); }

  // ---------- harbor scene ----------
  const cv = $('harbor'), g = cv.getContext('2d');
  let W = 0, H = 0;
  const boats = [];
  const gulls = Array.from({ length: 5 }, () => ({ x: Math.random(), y: 0.1 + Math.random() * 0.25, s: 0.01 + Math.random() * 0.02, p: Math.random() * 6 }));
  let splashT = 0;
  const splash = () => { splashT = 0.4; };
  function resize() { const d = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); }
  window.addEventListener('resize', resize);
  function launchBoat(kind) { boats.push({ kind, x: -0.1, lane: 0.62 + Math.random() * 0.25, speed: 0.02 + Math.random() * 0.03, dir: 1 }); }
  function syncBoats() {
    const want = Math.min(14, count('skiff') + count('cog') * 2 + count('clipper') * 3);
    while (boats.length < want) {
      const kinds = [...Array(Math.min(8, count('skiff'))).fill('skiff'), ...Array(Math.min(4, count('cog'))).fill('cog'), ...Array(Math.min(3, count('clipper'))).fill('clipper')];
      boats.push({ kind: kinds[boats.length % Math.max(1, kinds.length)] || 'skiff', x: Math.random(), lane: 0.62 + Math.random() * 0.25, speed: 0.01 + Math.random() * 0.03, dir: Math.random() < 0.5 ? -1 : 1 });
    }
  }
  function drawBoat(b, t) {
    const x = b.x * W, y = b.lane * H + Math.sin(t * 2 + b.x * 20) * 2, s = (0.6 + (b.lane - 0.6) * 1.6) * Math.max(0.7, H / 380);
    g.save(); g.translate(x, y); g.scale(b.dir * s, s);
    g.fillStyle = '#1b120a';
    const L = b.kind === 'clipper' ? 46 : b.kind === 'cog' ? 34 : 20;
    g.beginPath(); g.moveTo(-L, -4); g.lineTo(L, -4); g.lineTo(L - 6, 5); g.lineTo(-L + 4, 5); g.closePath(); g.fill();
    g.fillStyle = '#f3e6cc';
    const masts = b.kind === 'clipper' ? 3 : b.kind === 'cog' ? 1 : 1;
    for (let m = 0; m < masts; m++) {
      const mx = masts === 1 ? 0 : -L * 0.5 + m * L * 0.5;
      const mh = b.kind === 'skiff' ? 16 : 34;
      g.fillRect(mx - 1, -4 - mh, 2, mh);
      g.beginPath(); g.moveTo(mx + 2, -4 - mh); g.quadraticCurveTo(mx + mh * 0.6, -4 - mh * 0.5, mx + 2, -6); g.closePath(); g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x - 20 * s, y + 6 * s, 40 * s, 1.5);
  }
  function drawScene(t) {
    if (!W) resize();
    const hz = H * 0.56;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#0d1b2a'); sky.addColorStop(0.65, '#5a3a4a'); sky.addColorStop(1, '#e0874f');
    g.fillStyle = sky; g.fillRect(0, 0, W, hz);
    const sx = W * 0.72, sy = hz - H * 0.06;
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.6); glow.addColorStop(0, 'rgba(255,196,107,.55)'); glow.addColorStop(1, 'rgba(255,196,107,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd08a'; g.beginPath(); g.arc(sx, sy, H * 0.07, 0, 7); g.fill();
    g.fillStyle = '#2a2433';
    g.beginPath(); g.moveTo(0, hz); for (let x = 0; x <= W; x += 20) g.lineTo(x, hz - 12 - Math.sin(x / 90) * 10 - Math.sin(x / 31) * 4); g.lineTo(W, hz); g.fill();
    const sea = g.createLinearGradient(0, hz, 0, H); sea.addColorStop(0, '#5a4a5a'); sea.addColorStop(0.3, '#1f3547'); sea.addColorStop(1, '#0c1822');
    g.fillStyle = sea; g.fillRect(0, hz, W, H - hz);
    for (let i = 0; i < 22; i++) { const y = hz + (H - hz) * (i / 22) ** 1.4; const w = 20 + i * 7; g.fillStyle = `rgba(255,200,120,${0.5 - i * 0.02})`; g.fillRect(sx - w / 2 + Math.sin(t * 1.5 + i) * 6, y, w, 1 + i * 0.12); }
    // village on the left
    g.fillStyle = '#120d0c';
    const houses = 4 + Math.min(10, count('traps') + count('cannery') * 2 + count('icehouse') * 2);
    for (let i = 0; i < houses; i++) {
      const hx = 10 + i * 26, hh = 18 + ((i * 37) % 17) + (i % 3 === 0 && count('cannery') ? 14 : 0), hy = hz + 10;
      g.fillRect(hx, hy - hh, 22, hh + 10); g.beginPath(); g.moveTo(hx - 3, hy - hh); g.lineTo(hx + 11, hy - hh - 10); g.lineTo(hx + 25, hy - hh); g.fill();
      if ((i + Math.floor(t / 3)) % 3) { g.fillStyle = '#ffcf7a'; g.fillRect(hx + 8, hy - hh + 8, 5, 6); g.fillStyle = '#120d0c'; }
    }
    // pier
    g.fillStyle = '#1b120a'; g.fillRect(0, hz + 14, Math.min(W * 0.45, houses * 26 + 60), 6);
    for (let x = 6; x < Math.min(W * 0.45, houses * 26 + 60); x += 22) g.fillRect(x, hz + 18, 3, 16);
    // lighthouse
    if (has('lighthouse')) {
      const lx = W * 0.9, ly = hz + 4;
      g.fillStyle = '#1a1210'; g.beginPath(); g.moveTo(lx - 40, ly + 14); g.quadraticCurveTo(lx, ly - 16, lx + 60, ly + 14); g.fill();
      g.fillStyle = '#e8dcc4'; g.beginPath(); g.moveTo(lx - 8, ly); g.lineTo(lx - 5, ly - 70); g.lineTo(lx + 5, ly - 70); g.lineTo(lx + 8, ly); g.fill();
      g.fillStyle = '#a33'; g.fillRect(lx - 7, ly - 30, 14, 8); g.fillRect(lx - 6, ly - 55, 12, 7);
      g.fillStyle = '#ffe08a'; g.fillRect(lx - 6, ly - 80, 12, 10);
      const a = t * 0.8;
      g.fillStyle = 'rgba(255,224,138,.13)'; g.beginPath(); g.moveTo(lx, ly - 75); g.lineTo(lx + Math.cos(a) * W, ly - 75 + Math.sin(a) * 40 - 20); g.lineTo(lx + Math.cos(a) * W, ly - 75 + Math.sin(a) * 40 + 20); g.fill();
    }
    for (const b of boats) { b.x += b.speed * b.dir / 60; if (b.x > 1.1) b.dir = -1; if (b.x < -0.1) b.dir = 1; drawBoat(b, t); }
    g.strokeStyle = '#1a1414'; g.lineWidth = 1.5;
    for (const gl of gulls) { gl.x = (gl.x + gl.s / 60) % 1.1; const x = gl.x * W, y = gl.y * H + Math.sin(t + gl.p) * 5, f = Math.sin(t * 6 + gl.p) * 3; g.beginPath(); g.moveTo(x - 7, y - f); g.quadraticCurveTo(x - 3, y - 4, x, y); g.quadraticCurveTo(x + 3, y - 4, x + 7, y - f); g.stroke(); }
    if (splashT > 0) { splashT -= 1 / 60; g.strokeStyle = `rgba(255,255,255,${splashT * 1.5})`; g.beginPath(); g.ellipse(W / 2, H - 70, (0.4 - splashT) * 200, (0.4 - splashT) * 30, 0, 0, 7); g.stroke(); }
  }

  // ---------- loop ----------
  let last = performance.now(), acc = 0, playAcc = 0;
  function tick(now) {
    const dt = Math.min(1, (now - last) / 1000); last = now;
    const r = rate();
    if (r > 0) { S.coins += r * dt; S.lifetime += r * dt; }
    acc += dt; playAcc += dt;
    if (acc > 0.25) { acc = 0; S.playSeconds += playAcc; playAcc = 0; checkAchievements(); render(); syncBoats(); if (r > 0) dirty = true; }
    drawScene(now / 1000);
    requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) save('backgrounded'); });

  // ---------- boot ----------
  (async () => {
    try { econ = await (await fetch('assets/economy.json')).json(); } catch (e) { setSaveState('Failed to load game data'); return; }
    const ctx = await Platform.ready();
    setSaveState('Loading your harbor…');
    const [saved, ach, me] = await Promise.all([
      Platform.storage.load('harbor').catch(() => null),
      Platform.achievements.list().catch(() => []),
      Platform.user.getCurrentUser().catch(() => null),
    ]);
    ach.filter((a) => a.unlockedAt).forEach((a) => unlocked.add(a.id));
    if (saved && saved.v === 1) {
      S = { ...fresh(), ...saved };
      const away = Math.min(OFFLINE_CAP_S, Math.max(0, (Date.now() - (saved.savedAt || Date.now())) / 1000));
      const earned = rate() * away;
      if (away > 20 && earned >= 1) {
        earn(earned);
        modal(`Welcome back to ${S.harborName}`, `You were away for <b>${dur(away)}</b>.<br>Your fleet brought in <b style="color:var(--gold)">${fmt(earned)} coins</b> while you were gone.`);
      } else if (away > 20) {
        modal(`Welcome back to ${S.harborName}`, `Everything is exactly where you left it — ${fmt(S.coins)} coins in the chest.`);
      }
      setSaveState(`✓ Progress restored from Lantern (saved ${new Date(saved.savedAt).toLocaleString()})`);
    } else {
      if (me?.displayName) S.harborName = `${me.displayName}'s Landing`;
      modal('A harbor of your own', `Your uncle left you a rowboat, a net and a quiet cove.${ctx.mode === 'demo' ? '<br><br><i>Demo: your progress carries over if you buy the game.</i>' : ''}<br><br>Haul the nets, buy skiffs, and build the busiest port on the coast.`);
      setSaveState('New harbor — not saved yet');
    }
    resize(); syncBoats(); render(true);
    requestAnimationFrame(tick);
  })();
})();
