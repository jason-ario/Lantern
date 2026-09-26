// The Hollow Warden — boss of the Hollows. Once a gentle gatekeeper who caught
// falling lost things. Fight is the 1.0 moveset plus a phase-2 umbrella rain.
import { PH, DEPTH, INV_ART, T } from '../core/config';
import { rand, clamp, damp } from '../core/util';
import { sfx, Music, Audio } from '../core/audio';
import { Game } from '../core/state';
import { moveBody, tileAt, isSolid } from '../world/world';
import { Puppet } from '../render/puppet';
import { wardenRig } from '../render/rigs';
import { Entity, register, Ctx } from './entity';
import type { EntityDef } from '../content/types';

type State = 'dormant' | 'intro' | 'idle' | 'walk' | 'windCharge' | 'charge' | 'stun' | 'windLeap' | 'leap' | 'recover' | 'windRain' | 'rain' | 'dying' | 'gone';

export class Warden extends Entity {
  puppet: Puppet;
  state: State = 'dormant';
  st = 0;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y);
    this.w = 34; this.h = 38; this.hp = this.maxHp = 28; this.face = -1; this.name = 'The Hollow Warden';
    this.puppet = new Puppet(g.scene, wardenRig(), 0.6, DEPTH.enemy);
    this.hittable = true;
  }
  static get defeated() { return !!Game.flag('warden_dead'); }

  wake() { if (this.state === 'dormant') this.set('intro'); }
  set(s: State) { this.state = s; this.st = 0; }

  onHit(dmg: number, _dir: number, _kind: string) {
    if (['dormant', 'intro', 'dying', 'gone'].includes(this.state)) return false;
    this.hp -= dmg; this.flashT = 0.1;
    if (this.hp <= 0) this.die();
    return true;
  }
  die() {
    this.set('dying'); this.harm = 0; this.g.hitstop(0.35); this.g.shake(12); sfx.roar();
    Music.stop(); Audio.ambience('hollows');
  }

  update(dt: number) {
    this.st += dt;
    const P = this.g.player;
    const pcx = P.cx, bcx = this.cx;
    if (this.state === 'dormant' || this.state === 'gone') return;
    if (this.state === 'dying') {
      this.vx = 0;
      if (Math.random() < 0.5) this.g.burst(this.x + rand(0, this.w), this.y + rand(0, this.h), 3, Math.random() < 0.5 ? 0xff3b4f : 0x140f18, { spd: 120, life: 0.6, size: 2.5 });
      if (this.st > 1.8) {
        this.set('gone'); this.g.bossBar(null); this.g.shake(14);
        this.g.burst(bcx, this.cy, 60, 0x120d16, { spd: 240, life: 1.4, size: 4, grav: 120 });
        this.g.burst(bcx, this.cy, 30, 0xff3b4f, { spd: 200, life: 1, size: 2, glow: true, grav: 0 });
        this.g.dropCoins(bcx, this.cy, 30);
        Game.setFlag('warden_dead'); Game.achieve('warden');
        this.g.runCutscene('warden_defeat', { entity: this });
      }
      return;
    }
    const m = this.hp < this.maxHp / 2 ? 1.3 : 1;
    this.harm = this.state === 'intro' ? 0 : 1;
    this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
    const toward = () => { this.face = pcx < bcx ? -1 : 1; };
    switch (this.state) {
      case 'intro': this.vx = 0; if (this.st > 1.2) this.set('idle'); break;
      case 'idle': {
        this.vx = 0; toward();
        if (this.st > 0.8 / m && !P.dead) {
          const d = Math.abs(pcx - bcx), r = Math.random();
          if (m > 1 && r < 0.22 && this.lastAttack !== 'rain') { this.set('windRain'); this.lastAttack = 'rain'; break; }
          const pick = d > 130 ? (r < 0.5 ? 'windCharge' : 'windLeap') : r < 0.3 ? 'walk' : r < 0.65 ? 'windLeap' : 'windCharge';
          this.lastAttack = pick; this.set(pick as State);
        }
        break;
      }
      case 'walk': toward(); this.vx = this.face * 60 * m; if (this.st > 1.0) this.set('idle'); break;
      case 'windCharge': this.vx = 0; toward(); if (this.st > 0.6 / m) { this.set('charge'); sfx.dash(); } break;
      case 'charge':
        this.vx = this.face * 240 * m;
        if (Math.random() < 0.7) this.g.burst(bcx - this.face * 16, this.y + this.h - 2, 1, 0x2a2230, { spd: 60, life: 0.4, size: 3, grav: 100, key: 'fx_dust' });
        break;
      case 'stun': this.vx = 0; if (this.st > 0.9 / m) this.set('idle'); break;
      case 'windLeap': this.vx = 0; if (this.st > 0.45 / m) { this.set('leap'); this.vy = -410; this.vx = clamp((pcx - bcx) / 0.72, -270, 270); this.onGround = false; } break;
      case 'leap':
        if (this.onGround && this.st > 0.1) {
          this.set('recover'); sfx.slam(); this.g.shake(11);
          const fy = this.y + this.h - 12;
          this.g.spawn(new Wave(this.g, { type: 'wave' }, this.x - 14, fy, -190 * m));
          this.g.spawn(new Wave(this.g, { type: 'wave' }, this.x + this.w, fy, 190 * m));
          this.g.burst(bcx, this.y + this.h, 20, 0x3a2f40, { spd: 200, life: 0.6, size: 3, grav: 400, key: 'fx_dust' });
        }
        break;
      case 'recover': this.vx = 0; if (this.st > 0.65 / m) this.set('idle'); break;
      case 'windRain': this.vx = 0; if (this.st > 0.8) { this.set('rain'); sfx.roar(); this.g.shake(6); this.rainN = 0; } break;
      case 'rain': {
        this.vx = 0;
        if (this.st > this.rainN * 0.28 && this.rainN < 7) {
          const r = this.g.room;
          const px = clamp(P.cx + rand(-90, 90), r.px + 24, r.px + r.pw - 24);
          this.g.spawn(new Umbrella(this.g, { type: 'umbrella' }, px, r.py + T * 1.5));
          this.rainN++;
        }
        if (this.st > 2.6) this.set('idle');
        break;
      }
      default: break;
    }
    moveBody(this, dt);
    if (this.state === 'charge' && this.hitX) {
      this.set('stun'); sfx.slam(); this.g.shake(9);
      this.g.burst(this.face > 0 ? this.x + this.w : this.x, this.y + 10, 16, 0xbdb3c6, { spd: 180, life: 0.5, size: 2 });
    }
  }
  lastAttack = ''; rainN = 0;

  render(dt: number) {
    this.t += dt;
    const p = this.puppet;
    this.flashT = Math.max(0, this.flashT - dt);
    p.flash(this.flashT > 0);
    p.setVisible(this.state !== 'gone');
    p.place(this.cx, this.y + this.h + 1, this.face);
    const s = this.state, t = this.t;
    let coatRot = Math.sin(t * 1.3) * 0.03, headRot = Math.sin(t * 0.9) * 0.06, headY = 0, armF = -0.15, armB = 0.15, sy = 1 + Math.sin(t * 2) * 0.015;
    if (s === 'dormant') { headRot = 0.5; headY = 10; armF = 0.1; armB = -0.1; sy = 0.96; }
    if (s === 'intro') { headRot = -0.4 * Math.min(1, this.st * 2); armF = -1.4; armB = 1.2; }
    if (s === 'windCharge') { coatRot = -0.25; headRot = 0.3; armF = 0.9; armB = 0.9; }
    if (s === 'charge') { coatRot = 0.3; headRot = 0.2; armF = 1.3; armB = 1.3; }
    if (s === 'stun') { coatRot = -0.1 + Math.sin(t * 20) * 0.04; headRot = 0.6; headY = 8; }
    if (s === 'windLeap') { sy = 0.82; armF = -0.9; armB = 0.9; }
    if (s === 'leap') { sy = 1.1; armF = -2.2; armB = 2.2; }
    if (s === 'recover') { sy = 0.9; headRot = 0.4; }
    if (s === 'walk') { coatRot = Math.sin(t * 8) * 0.06; }
    if (s === 'windRain' || s === 'rain') { armF = -2.6 + Math.sin(t * 12) * 0.1; armB = 2.6; headRot = -0.5; }
    if (s === 'dying') { coatRot = Math.sin(t * 30) * 0.05; headRot = 0.8; sy = 1 - this.st * 0.15; }
    p.squash(damp(p.inner.scaleX, 1, 10, dt), damp(p.inner.scaleY, sy, 10, dt));
    p.set('coat', { rot: coatRot }); p.set('head', { rot: headRot, y: headY });
    p.set('armF', { rot: armF }); p.set('armB', { rot: armB });
    const eyeA = s === 'dormant' ? 0 : s === 'dying' ? Math.max(0, 1 - this.st) : 0.8 + Math.sin(t * 6) * 0.2;
    p.set('eyeL', { alpha: eyeA }); p.set('eyeR', { alpha: eyeA });
  }
  light() { return this.state === 'dormant' || this.state === 'gone' ? null : { x: this.cx, y: this.y + 4, r: 60, color: 0xff3b4f, a: 0.35 }; }
  destroy() { this.puppet.destroy(); }
}

class Wave extends Entity {
  img: any; life = 2.4;
  constructor(g: Ctx, d: EntityDef, x: number, y: number, vx: number) {
    super(g, d, x, y); this.w = 14; this.h = 12; this.vx = vx; this.harm = 1;
    this.img = g.scene.add.image(x, y, 'fx_wave').setScale(INV_ART * 0.4).setDepth(DEPTH.fx).setBlendMode(Phaser.BlendModes.ADD).setOrigin(0.5, 1);
  }
  update(dt: number) {
    this.x += this.vx * dt; this.life -= dt;
    if (this.life <= 0 || isSolid(tileAt(Math.floor((this.vx > 0 ? this.x + this.w : this.x) / T), Math.floor((this.y + 6) / T)))) { this.dead = true; this.g.burst(this.cx, this.cy, 6, 0xff7a6a, { spd: 80, life: 0.3, size: 1.5, glow: true }); }
    if (Math.random() < 0.5) this.g.burst(this.x + rand(0, this.w), this.y + this.h, 1, 0xff8c7a, { spd: 50, life: 0.4, size: 1.5, grav: -150, glow: true });
  }
  render() { this.img.setPosition(this.cx, this.y + this.h).setScale(INV_ART * 0.4 * (0.9 + Math.sin(this.life * 30) * 0.1)); }
  light() { return { x: this.cx, y: this.cy, r: 22, color: 0xff5a6e, a: 0.5 }; }
  destroy() { this.img.destroy(); }
}

/** Phase 2: hollow umbrellas fall from the ceiling. A shadow warns where. */
class Umbrella extends Entity {
  img: any; warn: any; delay = 0.7;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x - 7, y); this.w = 14; this.h = 16;
    this.img = g.scene.add.image(x, y, 'deco_umbrella').setScale(INV_ART * 0.5).setDepth(DEPTH.enemy).setFlipY(true).setAlpha(0);
    // find floor for the warning shadow
    let fy = y; while (fy < g.room.py + g.room.ph && !isSolid(tileAt(Math.floor(x / T), Math.floor(fy / T)))) fy += T;
    this.warn = g.scene.add.image(x, Math.floor(fy / T) * T, 'fx_shadow').setScale(INV_ART * 0.9).setDepth(DEPTH.fx).setTint(0xff3b4f).setAlpha(0.2);
  }
  update(dt: number) {
    this.delay -= dt;
    if (this.delay > 0) return;
    this.harm = 1;
    this.vy = Math.min(420, this.vy + 900 * dt); this.y += this.vy * dt;
    if (isSolid(tileAt(Math.floor(this.cx / T), Math.floor((this.y + this.h) / T)))) {
      this.dead = true; sfx.land(); this.g.shake(2);
      this.g.burst(this.cx, this.y + this.h, 10, 0x1c1622, { spd: 90, life: 0.5, size: 2.5, grav: 300 });
    }
  }
  render() {
    this.img.setPosition(this.cx, this.cy).setAlpha(this.delay > 0 ? 1 - this.delay / 0.7 : 1).setRotation(Math.sin(this.t++ * 0.3) * 0.1);
    this.warn.setAlpha(0.25 + (this.delay > 0 ? (1 - this.delay / 0.7) * 0.5 : 0.5));
  }
  destroy() { this.img.destroy(); this.warn.destroy(); }
}

register('warden', (g, d, x, y) => (Warden.defeated ? null : new Warden(g, d, x - 10, y - 22)));
