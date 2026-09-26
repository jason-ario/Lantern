// Skylark — a paper plane glides between cliffs. Hold to climb.
(() => {
  const c = document.getElementById('c'), g = c.getContext('2d');
  let W, H; const fit = () => { const d = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight; c.width = W * d; c.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };
  addEventListener('resize', fit); fit();
  let best = 0, flights = 0, state = 'ready', y, vy, dist, cols, hold = false, t0 = 0;
  const reset = () => { y = H / 2; vy = 0; dist = 0; cols = []; for (let i = 0; i < 6; i++) cols.push(mk(W + i * 260)); };
  const mk = (x) => ({ x, gap: 170 + Math.random() * 60, cy: H * (0.3 + Math.random() * 0.4) });
  const down = () => { hold = true; if (state !== 'fly') { state = 'fly'; flights++; reset(); } };
  addEventListener('pointerdown', down); addEventListener('pointerup', () => hold = false);
  addEventListener('keydown', (e) => { if (e.code === 'Space') down(); }); addEventListener('keyup', () => hold = false);
  const crash = async () => { state = 'over'; if (dist > best) best = Math.floor(dist); await Platform.storage.save('skylark', { best, flights }); };
  Platform.game.onExit(() => Platform.storage.save('skylark', { best, flights }));
  reset();
  let last = performance.now();
  (function loop(now) {
    const dt = Math.min(0.04, (now - last) / 1000); last = now;
    if (state === 'fly') {
      vy += (hold ? -900 : 700) * dt; vy = Math.max(-320, Math.min(360, vy)); y += vy * dt; dist += 22 * dt;
      for (const k of cols) { k.x -= 210 * dt; if (k.x < -60) Object.assign(k, mk(Math.max(...cols.map((q) => q.x)) + 260)); if (Math.abs(k.x - W * 0.3) < 34 && Math.abs(y - k.cy) > k.gap / 2 - 10) crash(); }
      if (y < 0 || y > H) crash();
      if (dist >= 100) Platform.achievements.unlock('airborne'); if (dist >= 500) Platform.achievements.unlock('long_haul');
    }
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#f7b267'); sky.addColorStop(1, '#f6d9b8'); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.fillStyle = '#6d4c5c';
    for (const k of cols) { g.fillRect(k.x - 30, 0, 60, k.cy - k.gap / 2); g.fillRect(k.x - 30, k.cy + k.gap / 2, 60, H); }
    g.save(); g.translate(W * 0.3, y); g.rotate(vy / 900); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(22, 0); g.lineTo(-16, -10); g.lineTo(-8, 0); g.lineTo(-16, 10); g.fill(); g.restore();
    g.fillStyle = '#3b2a33'; g.font = '700 22px system-ui'; g.fillText(`${Math.floor(dist)} m`, 20, 36); g.font = '14px system-ui'; g.fillText(`best ${best} m · flights ${flights}`, 20, 58);
    if (state !== 'fly') { g.textAlign = 'center'; g.font = '800 44px system-ui'; g.fillText('SKYLARK', W / 2, H / 2 - 20); g.font = '16px system-ui'; g.fillText(state === 'over' ? 'Crashed! Tap to fly again' : 'Hold to climb · tap to start', W / 2, H / 2 + 16); g.textAlign = 'left'; }
    requestAnimationFrame(loop);
  })(last);
  Platform.ready().then(async () => { const s = await Platform.storage.load('skylark'); if (s) { best = s.best; flights = s.flights; } });
})();
