// Nightpaw: movement/combat ported from 1.0 (same feel), drawn as a puppet rig.
import { PH, T, DEPTH, INV_ART } from '../core/config';
import { clamp, damp, rand, overlap, Box } from '../core/util';
import { Input } from '../core/input';
import { sfx } from '../core/audio';
import { Game } from '../core/state';
import { moveBody, boxHasTile, tileAt, isSolid } from '../world/world';
import { Puppet } from '../render/puppet';
import { nightpawRig } from '../render/rigs';
import type { Ctx } from './entity';

export class Player {
  x = 0; y = 0; w = 10; h = 14; vx = 0; vy = 0; face = 1;
  onGround = false; hitX = false; hitCeil = false; landed = false;
  hp = 4;
  coyote = 0; buffer = 0; airJumps = 0; airDash = true; dashT = 0; dashCd = 0; dropT = 0;
  atkT = 0; atkAnim = 0; atkCd = 0; atkDir: 'side' | 'up' | 'down' = 'side'; hitSet = new Set<any>();
  invuln = 0; knockT = 0; knockVx = 0; recoilT = 0; hazardT = 0;
  dead = false; deadT = 0; resting = false; safeX = 0; safeY = 0;
  locked = false; // cutscene control
  scripted: { dir: number; jump?: boolean } | null = null; // cutscene "walk"
  hidden = false;
  landT = 0; stepT = 0; runPhase = 0; blinkT = 3; earT = 2; t = 0;
  puppet: Puppet;
  slash: any;
  shadow: any;
  sleepy = 0; // 0..1 blend toward resting loaf pose

  constructor(public g: Ctx) {
    const s = g.scene;
    this.shadow = s.add.image(0, 0, 'fx_shadow').setScale(INV_ART * 0.8).setDepth(DEPTH.player - 1).setAlpha(0.6);
    this.puppet = new Puppet(s, nightpawRig(), 0.78, DEPTH.player);
    this.slash = s.add.image(0, 0, 'fx_claw').setScale(INV_ART * 0.62).setDepth(DEPTH.fx).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.hp = Game.save.maxHp;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  place(x: number, y: number) { this.x = x; this.y = y; this.safeX = x; this.safeY = y; this.vx = this.vy = 0; }

  input() {
    if (this.locked) {
      const s = this.scripted;
      return { dir: s ? s.dir : 0, jumpP: !!s?.jump, jumpH: !!s?.jump, jumpR: false, dashP: false, atkP: false, up: false, down: false, upP: false };
    }
    return {
      dir: (Input.held('right') ? 1 : 0) - (Input.held('left') ? 1 : 0),
      jumpP: Input.pressed('jump'), jumpH: Input.held('jump'), jumpR: Input.released('jump'),
      dashP: Input.pressed('dash'), atkP: Input.pressed('attack'), up: Input.held('up'), down: Input.held('down'), upP: Input.pressed('up'),
    };
  }

  update(dt: number) {
    this.t += dt;
    if (this.dead) { this.deadT += dt; return; }
    if (this.hazardT > 0) {
      this.hazardT -= dt;
      if (this.hazardT <= 0) { this.x = this.safeX; this.y = this.safeY; this.vx = this.vy = 0; (this.g as any).afterHazard?.(); }
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.dropT = Math.max(0, this.dropT - dt);
    this.landT = Math.max(0, this.landT - dt);
    const I = this.input();
    const dir = I.dir;
    if (this.scripted?.jump) this.scripted.jump = false;

    if (this.resting) {
      if (!this.locked && (dir || I.jumpP || I.atkP || I.down)) this.resting = false;
      else { this.vx = 0; this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt); moveBody(this, dt); return; }
    }

    // horizontal
    if (this.dashT > 0) {
      this.dashT -= dt; this.vx = this.face * PH.DASH; this.vy = 0;
      if (Math.random() < 0.7) this.g.burst(this.cx - this.face * 4, this.y + rand(3, 12), 1, 0x1c1826, { spd: 40, life: 0.35, size: 3, grav: 0 });
    } else if (this.knockT > 0) { this.knockT -= dt; this.vx = this.knockVx; }
    else if (this.recoilT > 0) { this.recoilT -= dt; this.vx = -this.face * 110 + dir * 30; }
    else { this.vx = dir * PH.RUN * (this.locked && this.scripted ? 0.75 : 1); if (dir) this.face = dir; }

    // jump / double jump / drop-through
    this.coyote = this.onGround ? PH.COYOTE : this.coyote - dt;
    this.buffer = I.jumpP ? PH.BUFFER : this.buffer - dt;
    if (this.buffer > 0 && I.down && this.onGround && boxHasTile(this.x, this.y + this.h, this.w, 1, (ch) => ch === '=') && !boxHasTile(this.x, this.y + this.h, this.w, 1, isSolid)) {
      this.dropT = 0.22; this.buffer = 0; this.onGround = false; this.y += 1;
    } else if (this.buffer > 0 && this.coyote > 0 && this.dashT <= 0) {
      this.vy = -PH.JUMP; this.coyote = 0; this.buffer = 0; this.onGround = false; sfx.jump();
      this.g.burst(this.cx, this.y + this.h, 5, 0x3a3448, { spd: 50, life: 0.35, size: 2, grav: 100, key: 'fx_dust' });
      this.puppet.squash(0.8, 1.25); this.stretchT = 0.12;
    } else if (this.buffer > 0 && !this.onGround && Game.has('wings') && this.airJumps > 0 && this.dashT <= 0) {
      this.vy = -PH.JUMP2; this.airJumps--; this.buffer = 0; sfx.wing(); this.wingT = 0.35;
      this.g.burst(this.cx, this.y + 10, 12, 0xe9e2ff, { spd: 70, life: 0.6, size: 1.6, grav: 60, glow: true });
    }
    if ((I.jumpR || (this.locked && !I.jumpH && this.vy < -60 && false)) && this.vy < -60) this.vy *= 0.45;

    // dash
    if (I.dashP && Game.has('dash') && this.dashCd <= 0 && this.dashT <= 0 && (this.onGround || this.airDash)) {
      this.dashT = PH.DASHT; this.dashCd = 0.45; this.vy = 0; sfx.dash();
      if (dir) this.face = dir;
      if (!this.onGround) this.airDash = false;
      this.afterT = 0;
    }

    if (this.dashT <= 0) this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);

    // attack
    if (I.atkP && this.atkCd <= 0) {
      this.atkDir = I.up ? 'up' : I.down && !this.onGround ? 'down' : 'side';
      this.atkT = 0.1; this.atkAnim = 0.22; this.atkCd = 0.3; this.hitSet = new Set();
      sfx.slash(); this.showSlash();
    }
    this.atkAnim = Math.max(0, this.atkAnim - dt);
    if (this.atkT > 0) { this.atkT -= dt; this.resolveAttack(); }

    // move
    const vyBefore = this.vy;
    moveBody(this, dt);
    if (this.landed && vyBefore > 200) {
      sfx.land(); this.landT = 0.12; this.g.burst(this.cx, this.y + this.h, 6, 0x2c2838, { spd: 60, life: 0.4, size: 2, grav: 80, key: 'fx_dust' });
      this.puppet.squash(1.25, 0.72); this.stretchT = 0.14;
    }
    if (this.onGround) {
      this.airJumps = Game.has('wings') ? 1 : 0; this.airDash = true;
      const footL = tileAt(Math.floor(this.x / T), Math.floor((this.y + this.h + 1) / T));
      const footR = tileAt(Math.floor((this.x + this.w - 0.01) / T), Math.floor((this.y + this.h + 1) / T));
      const nearSpike = boxHasTile(this.x - 12, this.y - 4, this.w + 24, this.h + 8, (ch) => ch === '^');
      if (isSolid(footL) && isSolid(footR) && !nearSpike) { this.safeX = this.x; this.safeY = this.y; }
      if (this.vx) { this.stepT -= dt; if (this.stepT <= 0) { sfx.step(); this.stepT = 0.26; } }
    }
    // thorns
    if (boxHasTile(this.x + 3, this.y + 4, this.w - 6, this.h - 4, (ch, _tx, ty) => ch === '^' && this.y + this.h > ty * T + 7)) this.g.hurtPlayer(1, this.cx, true);
  }
  stretchT = 0; wingT = 0; afterT = 0;

  attackBox(): Box {
    const cx = this.cx;
    if (this.atkDir === 'up') return { x: cx - 13, y: this.y - 26, w: 26, h: 28 };
    if (this.atkDir === 'down') return { x: cx - 13, y: this.y + this.h - 2, w: 26, h: 26 };
    return this.face > 0 ? { x: this.x + this.w - 2, y: this.y - 5, w: 28, h: 22 } : { x: this.x - 26, y: this.y - 5, w: 28, h: 22 };
  }

  resolveAttack() {
    const box = this.attackBox();
    let pogo = false;
    for (const e of this.g.ents) {
      if (!e.hittable || e.dead || this.hitSet.has(e) || !overlap(box, e)) continue;
      this.hitSet.add(e);
      const dir = this.atkDir === 'side' ? this.face : Math.sign(e.cx - this.cx) || 1;
      if (!e.onHit(1, dir, this.atkDir)) continue;
      sfx.hit(); this.g.hitstop(0.05); this.g.shake(3);
      const hx = clamp(this.cx + this.face * 14, e.x, e.x + e.w), hy = clamp(this.y + 6, e.y, e.y + e.h);
      this.g.burst(hx, hy, 8, 0xffffff, { spd: 160, life: 0.3, size: 1.6, grav: 0, glow: true });
      if (this.atkDir === 'down') pogo = true; else if (this.atkDir === 'side') this.recoilT = 0.08;
    }
    if (this.atkDir === 'down' && boxHasTile(box.x, box.y, box.w, box.h, (ch) => ch === '^')) pogo = true;
    if (pogo && !this.hitSet.has('pogo')) {
      this.hitSet.add('pogo');
      this.vy = -PH.POGO; this.airJumps = Game.has('wings') ? 1 : 0; this.airDash = true; this.atkT = 0;
    }
    // cracked walls & clink
    if (!this.hitSet.has('wall')) {
      let hitTile: [number, number] | null = null;
      const probe = this.atkDir === 'side' ? { x: box.x + (this.face > 0 ? 14 : 0), y: box.y + 6, w: 14, h: 10 } : box;
      boxHasTile(probe.x, probe.y, probe.w, probe.h, (ch, tx, ty) => { if (ch === 'X') { hitTile = [tx, ty]; return true; } return false; });
      if (hitTile) { this.hitSet.add('wall'); (this.g as any).hitWall(hitTile[0], hitTile[1], this.face); }
      else if (this.atkDir === 'side' && boxHasTile(probe.x, probe.y, probe.w, probe.h, isSolid)) {
        this.hitSet.add('wall'); sfx.clink();
        this.g.burst(this.face > 0 ? box.x + box.w - 6 : box.x + 6, this.y + 6, 6, 0xffe9a8, { spd: 120, life: 0.25, size: 1.2, grav: 0, glow: true });
      }
    }
  }

  showSlash() {
    const s = this.slash;
    s.setVisible(true).setAlpha(1);
    const k = this.atkDir;
    s.setFlipX(false);
    if (k === 'side') { s.setRotation(0); s.setScale(INV_ART * 0.62 * this.face, INV_ART * 0.62); }
    else { s.setScale(INV_ART * 0.62, INV_ART * 0.62); s.setRotation(k === 'up' ? -Math.PI / 2 : Math.PI / 2); }
    this.g.scene.tweens.killTweensOf(s);
    this.g.scene.tweens.add({ targets: s, alpha: 0, duration: 200, ease: 'Quad.easeIn', onComplete: () => s.setVisible(false) });
  }

  // ---------------------------------------------------------------- rendering
  render(dt: number) {
    const p = this.puppet;
    const feetX = this.cx, feetY = this.y + this.h;
    p.place(feetX, feetY + 0.5, this.face);
    const visible = !this.hidden && !(this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0 && !this.dead);
    p.setVisible(visible);
    this.shadow.setVisible(!this.hidden && this.onGround).setPosition(feetX, feetY + 0.5);

    // slash follows the cat
    if (this.slash.visible) {
      const k = this.atkDir;
      if (k === 'side') this.slash.setPosition(this.cx + this.face * 6, this.y + 5);
      else if (k === 'up') this.slash.setPosition(this.cx, this.y - 6);
      else this.slash.setPosition(this.cx, this.y + this.h + 4);
      this.slash.setOrigin(k === 'side' ? 0.1 : 0.1, 0.5);
    }

    // squash & stretch recovery
    this.stretchT = Math.max(0, this.stretchT - dt);
    const inner = p.inner;
    let sx = damp(inner.scaleX, 1, 14, dt), sy = damp(inner.scaleY, 1, 14, dt);
    if (this.dashT > 0) { sx = 1.3; sy = 0.82; }
    p.squash(sx, sy);

    const t = this.t;
    const air = !this.onGround && !this.resting;
    const running = this.onGround && Math.abs(this.vx) > 5 && this.dashT <= 0;
    this.runPhase += dt * (running ? 14 : 0);
    const ph = this.runPhase;
    this.sleepy = damp(this.sleepy, this.resting || this.dead ? 1 : 0, 6, dt);
    const Z = this.sleepy;
    const speed = Math.min(1, Math.abs(this.vx) / PH.RUN);

    // ---- little legs under the cloak, a bob, a lean
    let lean = 0, bodyY = 0, headRot = 0, headY = 0, legN = 0, legF = 0, legLift = 0;
    if (running) {
      legN = Math.sin(ph) * 0.75; legF = Math.sin(ph + Math.PI) * 0.75;
      bodyY = -Math.abs(Math.cos(ph)) * 2.5; lean = 0.1; headRot = Math.sin(ph * 2) * 0.03;
    } else if (air) {
      const up = this.vy < 0;
      legN = up ? -0.5 : 0.25; legF = up ? 0.4 : -0.2; legLift = up ? 6 : 0;
      lean = up ? -0.04 : 0.05; headRot = up ? -0.06 : 0.06;
    } else {
      bodyY = Math.sin(t * 2) * 0.8; headY = Math.sin(t * 2 + 0.6) * 0.7; headRot = Math.sin(t * 0.55) * 0.05;
    }
    if (this.dashT > 0) { lean = 0.45; legN = -0.9; legF = -1.1; legLift = 4; }
    if (this.landT > 0) bodyY += 3;
    // resting: sits down, the cloak pools, eyes close
    bodyY = bodyY * (1 - Z) + 10 * Z; lean *= 1 - Z; headRot = headRot * (1 - Z) + 0.12 * Z; headY *= 1 - Z;

    // ---- the scratch: a paw slips out of the cloak and swipes
    let armA = 0, armRot = 0, armX = 0, armY = 0;
    if (this.atkAnim > 0) {
      const a = this.atkAnim / 0.22, k = 1 - a; // k: 0 → 1 over the swipe
      armA = Math.min(1, a * 3);
      if (this.atkDir === 'side') { armRot = -2.4 + k * 1.9; armX = 3; lean += 0.12 * a; headRot -= 0.06 * a; }
      else if (this.atkDir === 'up') { armRot = -3.0 + k * 0.9; armY = -4; lean -= 0.1 * a; headRot -= 0.18 * a; }
      else { armRot = -0.6 + k * 0.9; armY = 2; lean += 0.12 * a; headRot += 0.15 * a; }
    }

    p.set('body', { y: bodyY, rot: lean });
    p.set('legNear', { rot: legN, y: -legLift, sy: 1 - Z * 0.6 }); p.set('legFar', { rot: legF, y: -legLift, sy: 1 - Z * 0.6 });
    p.set('head', { y: headY, rot: headRot });
    p.set('arm', { alpha: armA, rot: armRot, x: armX, y: armY });

    // ---- cloak: sways, flares when jumping, streams back when running or dashing
    const flow = Math.min(1.3, speed * 0.6 + (this.dashT > 0 ? 0.9 : 0));
    const flare = air ? (this.vy > 0 ? 1 : 0.4) : 0;
    const sway = Math.sin(t * (2 + flow * 6)) * (0.03 + flow * 0.05);
    p.set('cloak', { rot: flow * 0.22 + sway - lean * 0.5, sx: 1 + flare * 0.1 + Z * 0.12 });
    p.set('hem', { rot: flow * 0.35 + Math.sin(t * (2.6 + flow * 7) - 1) * (0.05 + flow * 0.08), sx: 1 + flare * 0.22 + Z * 0.18, sy: 1 - flare * 0.25 - Z * 0.2 });
    p.set('lining', { alpha: Math.min(1, flare * 0.9 + flow * 0.5), rot: flow * 0.3 });

    // ---- tail: stands up behind, sways, flicks when moving
    for (let i = 0; i < 10; i++) {
      const wave = Math.sin(t * (1.6 + speed * 3.5) - i * 0.55) * (0.07 + speed * 0.04);
      const base = i === 0 ? -0.45 - speed * 0.4 - (this.dashT > 0 ? 0.9 : 0) + Z * 1.2 : i > 6 ? 0.2 : 0.01; // tip hooks forward
      p.set(`tail${i}`, { rot: base + wave });
    }

    // ---- ears & blinks
    this.earT -= dt; if (this.earT < -0.15) this.earT = rand(2, 6);
    const twitch = this.earT < 0 ? -0.3 : 0;
    const earsBack = this.dashT > 0 ? -0.55 : air && this.vy > 0 ? -0.3 : 0;
    p.set('earF', { rot: -earsBack * 0.9 + twitch }); p.set('earB', { rot: earsBack * 0.9 });
    this.blinkT -= dt; if (this.blinkT < -0.1) this.blinkT = rand(2.5, 6);
    const eyeS = this.blinkT < 0 || Z > 0.6 || this.dead ? 0.1 : 1;
    p.set('eyeF', { sy: eyeS }); p.set('eyeB', { sy: eyeS * 0.9 });

    // dash afterimages
    if (this.dashT > 0) {
      this.afterT -= dt;
      if (this.afterT <= 0) { this.afterT = 0.04; (this.g as any).afterimage?.(this); }
    }
    if (this.dead) { p.setAlpha(Math.max(0, 1 - this.deadT * 0.8)); p.lean(Math.min(1.4, this.deadT * 3) * -this.face * 0.4); }
    else { p.setAlpha(1); p.lean(0); }
  }

  destroy() { this.puppet.destroy(); this.slash.destroy(); this.shadow.destroy(); }
}
