// Firefly Jar: a tiny Lantern starter game.
// Shows the whole SDK surface you normally need: ready, user, storage (cloud saves),
// achievements, pause/resume and saving on exit.
(async function () {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---- 1. Wait for the platform, then load the save -------------------------
  const launch = await Platform.ready();          // { gameId, version, mode, locale, ... }
  const player = await Platform.user.getCurrentUser(); // { id, displayName }
  console.log(`[Firefly Jar] v${launch.version} (${launch.mode}) for ${player.displayName}`);

  // Saves are plain JSON under a key you choose. null means "no save yet".
  const save = (await Platform.storage.load('progress')) ?? { total: 0, best: 0 };

  // ---- 2. Game state ----------------------------------------------------------
  const NIGHT = 60;                                // seconds per round
  let flies = [], score = 0, timeLeft = NIGHT, paused = false, last = performance.now();

  function resize() { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; }
  addEventListener('resize', resize); resize();

  function spawn() {
    flies.push({ x: Math.random() * canvas.width, y: canvas.height * (0.2 + Math.random() * 0.7),
      vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, phase: Math.random() * 6.28 });
  }
  for (let i = 0; i < 8; i++) spawn();

  // ---- 3. Saving: cheap, so save at natural checkpoints ------------------------
  async function persist() {
    save.best = Math.max(save.best, score);
    await Platform.storage.save('progress', save);
  }

  async function caught() {
    score++; save.total++;
    if (score === 1) Platform.achievements.unlock('first_catch');
    if (score === 25) Platform.achievements.unlock('jar_full');
    if (save.total >= 100) Platform.achievements.unlock('collector'); // safe to call repeatedly
    if (save.total % 10 === 0) persist();          // checkpoint every 10 catches
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (paused || timeLeft <= 0) { if (timeLeft <= 0) { score = 0; timeLeft = NIGHT; } return; }
    const x = e.clientX * devicePixelRatio, y = e.clientY * devicePixelRatio, r = 34 * devicePixelRatio;
    const i = flies.findIndex((f) => Math.hypot(f.x - x, f.y - y) < r);
    if (i >= 0) { flies.splice(i, 1); spawn(); caught(); }
  });

  // ---- 4. Lifecycle hooks -----------------------------------------------------
  Platform.game.onPause(() => { paused = true; });   // player opened the overlay / switched tab
  Platform.game.onResume(() => { paused = false; last = performance.now(); });
  Platform.game.onExit(() => persist());             // runs before Lantern closes the game

  // ---- 5. Loop ----------------------------------------------------------------
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused && timeLeft > 0) {
      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; persist(); }
      for (const f of flies) {
        f.phase += dt * 3; f.vx += (Math.random() - 0.5) * 40 * dt; f.vy += (Math.random() - 0.5) * 40 * dt;
        f.x = (f.x + f.vx * dt * devicePixelRatio + canvas.width) % canvas.width;
        f.y = Math.min(canvas.height * 0.95, Math.max(canvas.height * 0.1, f.y + f.vy * dt * devicePixelRatio));
      }
    }
    ctx.fillStyle = '#070a10'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const f of flies) {
      const glow = 0.55 + 0.45 * Math.sin(f.phase), r = 18 * devicePixelRatio;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 2.2);
      g.addColorStop(0, `rgba(255,225,120,${glow})`); g.addColorStop(1, 'rgba(255,200,80,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r * 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(f.x, f.y, 3 * devicePixelRatio, 0, 7); ctx.fill();
    }
    if (timeLeft <= 0) {
      ctx.fillStyle = '#e9e3cf'; ctx.textAlign = 'center'; ctx.font = `${22 * devicePixelRatio}px system-ui`;
      ctx.fillText(`Dawn! ${score} fireflies. Best: ${Math.max(save.best, score)}. Tap to play again.`, canvas.width / 2, canvas.height / 2);
    }
    $('score').textContent = score; $('total').textContent = save.total; $('time').textContent = `${Math.ceil(timeLeft)}s`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
