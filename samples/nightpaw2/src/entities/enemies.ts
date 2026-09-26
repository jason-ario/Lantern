// Enemies of the Hollows. Each was once someone's lost something.
import { PH, T, DEPTH, INV_ART } from '../core/config';
import { rand, clamp, damp } from '../core/util';
import { sfx } from '../core/audio';
import { Game } from '../core/state';
import { moveBody, tileAt, isSolid } from '../world/world';
import { Puppet } from '../render/puppet';
import { miteRig, sockRig, snailRig, toadRig } from '../render/rigs';
import { Entity, register, Ctx } from './entity';
import type { EntityDef } from '../content/types';

export abstract class Enemy extends Entity {
  puppet!: Puppet;
  kbT = 0; kbDir = 1;
  coins = 2;
  deathColor = 0x1b1624;
  constructor(g: Ctx, def: EntityDef, x: number, y: number) { super(g, def, x, y); this.hittable = true; this.harm = 1; }
  onHit(dmg: number, dir: number, _kind: string) {
    this.hp -= dmg; this.flashT = 0.12; this.kbT = 0.15; this.kbDir = dir;
    if (this.hp <= 0) this.kill();
    return true;
  }
  kill() {
    if (this.dead) return;
    this.dead = true;
    sfx.enemyDie(); this.g.shake(4);
    this.g.burst(this.cx, this.cy, 18, this.deathColor, { spd: 150, life: 0.6, size: 2.5 });
    this.g.burst(this.cx, this.cy, 8, 0xffffff, { spd: 90, life: 0.5, size: 1.5, glow: true, grav: -20 });
    this.g.dropCoins(this.cx, this.cy, this.coins);
    Game.achieve('first_blood');
    Game.save.flags.kills = ((Game.save.flags.kills as number) || 0) + 1;
  }
  renderCommon(dt: number) {
    this.flashT = Math.max(0, this.flashT - dt);
    this.puppet.flash(this.flashT > 0);
  }
  destroy() { this.puppet?.destroy(); }
}

/** Crawls along floors, turns at walls and ledges. */
class Mite extends Enemy {
  dir = Math.random() < 0.5 ? -1 : 1;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y); this.w = 14; this.h = 10; this.hp = this.maxHp = 2; this.name = 'Thimble Mite';
    this.puppet = new Puppet(g.scene, miteRig(), 0.9, DEPTH.enemy);
    this.deathColor = 0x8e8aa0;
  }
  update(dt: number) {
    this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
    if (this.kbT > 0) { this.kbT -= dt; this.vx = this.kbDir * 100; } else this.vx = this.dir * 26;
    moveBody(this, dt);
    if (this.kbT <= 0) {
      if (this.hitX) this.dir *= -1;
      else if (this.onGround) {
        const ax = this.dir > 0 ? this.x + this.w + 1 : this.x - 1;
        const tx = Math.floor(ax / T);
        const below = tileAt(tx, Math.floor((this.y + this.h + 2) / T));
        if (!(isSolid(below) || below === '=') || tileAt(tx, Math.floor((this.y + this.h - 2) / T)) === '^') this.dir *= -1;
      }
    }
    this.face = this.dir;
  }
  render(dt: number) {
    this.t += dt;
    const p = this.puppet, t = this.t * 14;
    p.place(this.cx, this.y + this.h, this.face);
    for (let i = 0; i < 4; i++) p.set(`l${i}`, { rot: Math.sin(t + i * 1.6) * 0.5 });
    p.set('shell', { y: Math.abs(Math.sin(t)) * -1.5, rot: Math.sin(t * 0.5) * 0.05 });
    this.renderCommon(dt);
  }
}

/** A lost sock drifting through the air; homes in when it sees you. */
class SockWisp extends Enemy {
  hx: number; hy: number;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y); this.w = 12; this.h = 12; this.hp = this.maxHp = 2; this.hx = x; this.hy = y; this.name = 'Sock Wisp';
    this.puppet = new Puppet(g.scene, sockRig(), 0.6, DEPTH.enemy);
    this.deathColor = 0xe0d0c8; this.coins = 3;
  }
  onHit(dmg: number, dir: number, kind: string) {
    super.onHit(dmg, dir, kind);
    this.vx = (kind === 'side' ? dir : 0) * 160; this.vy = kind === 'up' ? -160 : kind === 'down' ? 160 : -30;
    return true;
  }
  update(dt: number) {
    const P = this.g.player;
    const dx = P.cx - this.cx, dy = P.cy - this.cy, d = Math.hypot(dx, dy) || 1;
    if (d < 150 && !P.dead && !this.g.inCutscene) { this.vx += (dx / d) * 150 * dt; this.vy += (dy / d) * 150 * dt; }
    else { this.vx += (this.hx - this.x) * 0.8 * dt; this.vy += (this.hy - this.y) * 0.8 * dt; }
    const sp = Math.hypot(this.vx, this.vy), max = 52;
    if (sp > max) { this.vx *= 0.94; this.vy *= 0.94; }
    this.x += this.vx * dt; this.y += (this.vy + Math.sin(this.t * 3) * 12) * dt;
    if (Math.abs(this.vx) > 5) this.face = this.vx > 0 ? -1 : 1;
  }
  render(dt: number) {
    this.t += dt;
    const p = this.puppet;
    p.place(this.cx, this.y + this.h + 4, this.face);
    p.set('cuff', { rot: Math.sin(this.t * 3) * 0.15 - this.vx * 0.003 });
    p.set('mid', { rot: Math.sin(this.t * 3 - 0.8) * 0.3 + this.vx * 0.004 });
    p.set('foot', { rot: Math.sin(this.t * 3 - 1.6) * 0.4 + this.vx * 0.006 });
    p.set('eyes', { sy: Math.sin(this.t * 0.8) > 0.97 ? 0.15 : 1 });
    this.renderCommon(dt);
  }
  light() { return { x: this.cx, y: this.cy, r: 26, color: 0xbfeaff, a: 0.35 }; }
}

/** Sits still and spits buttons at you. Hides in its shell when you get close. */
class Snail extends Enemy {
  cool = rand(1, 2); hide = 0;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y); this.w = 16; this.h = 14; this.hp = this.maxHp = 3; this.name = 'Button Snail';
    this.puppet = new Puppet(g.scene, snailRig(), 0.72, DEPTH.enemy);
    this.deathColor = 0xc46a4a; this.coins = 4;
    this.face = d.face ?? -1;
  }
  onHit(dmg: number, dir: number, kind: string) {
    if (this.hide > 0.5) { sfx.clink(); this.flashT = 0.05; this.g.burst(this.cx, this.cy - 4, 5, 0xffe9a8, { spd: 100, life: 0.25, size: 1.2, glow: true }); return false; }
    return super.onHit(dmg, dir, kind);
  }
  update(dt: number) {
    const P = this.g.player;
    const dx = P.cx - this.cx, dist = Math.abs(dx);
    this.face = dx > 0 ? 1 : -1;
    this.hide = damp(this.hide, dist < 30 && !P.dead ? 1 : 0, 8, dt);
    this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt); this.vx = 0; moveBody(this, dt);
    this.cool -= dt;
    if (this.cool <= 0 && dist < 200 && dist > 30 && Math.abs(P.cy - this.cy) < 80 && !this.g.inCutscene && !P.dead) {
      this.cool = rand(1.8, 2.6);
      sfx.shoot();
      const sp = 120, ang = Math.atan2(P.cy - this.cy + 4, dx);
      this.g.spawn(new ButtonShot(this.g, { type: 'shot' }, this.cx + this.face * 6, this.y + 2, Math.cos(ang) * sp, Math.sin(ang) * sp - 40));
      this.recoil = 0.2;
    }
  }
  recoil = 0;
  render(dt: number) {
    this.t += dt; this.recoil = Math.max(0, this.recoil - dt);
    const p = this.puppet, h = this.hide;
    p.place(this.cx, this.y + this.h, this.face);
    p.set('body', { x: -h * 18 - this.recoil * 20, sx: 1 - h * 0.6 });
    p.set('stalk1', { rot: Math.sin(this.t * 2) * 0.2 - h, sy: 1 - h * 0.9 });
    p.set('stalk2', { rot: Math.sin(this.t * 2 + 1) * 0.2 - h, sy: 1 - h * 0.9 });
    p.set('shell', { rot: Math.sin(this.t) * 0.03 + this.recoil * 0.8, y: h * 3 });
    this.renderCommon(dt);
  }
}

export class ButtonShot extends Entity {
  img: any;
  constructor(g: Ctx, d: EntityDef, x: number, y: number, vx: number, vy: number) {
    super(g, d, x - 4, y - 4); this.w = 8; this.h = 8; this.vx = vx; this.vy = vy; this.harm = 1; this.hittable = true;
    this.img = g.scene.add.image(x, y, 'proj_button').setScale(INV_ART * 1.2).setDepth(DEPTH.enemy + 1);
  }
  life = 3;
  onHit(_d: number, dir: number) { this.vx = dir * 220; this.vy = -60; this.harm = 0; this.deflected = true; return true; }
  deflected = false;
  update(dt: number) {
    this.life -= dt; this.vy += 300 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.life <= 0 || isSolid(tileAt(Math.floor(this.cx / T), Math.floor(this.cy / T)))) { this.dead = true; this.g.burst(this.cx, this.cy, 6, 0xffb070, { spd: 80, life: 0.3, size: 1.5, glow: true }); }
    if (this.deflected) for (const e of this.g.ents) if (e instanceof Enemy && !e.dead && Math.abs(e.cx - this.cx) < 10 && Math.abs(e.cy - this.cy) < 10) { e.onHit(1, Math.sign(this.vx), 'side'); this.dead = true; }
  }
  render(dt: number) { this.t += dt; this.img.setPosition(this.cx, this.cy).setRotation(this.t * 10); }
  light() { return { x: this.cx, y: this.cy, r: 16, color: 0xffb070, a: 0.4 }; }
  destroy() { this.img.destroy(); }
}

/** Waits, then leaps toward you in big arcs. */
class Toad extends Enemy {
  wait = rand(0.6, 1.4); crouch = 0;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y); this.w = 16; this.h = 12; this.hp = this.maxHp = 3; this.name = 'Marble Toad';
    this.puppet = new Puppet(g.scene, toadRig(), 0.62, DEPTH.enemy);
    this.deathColor = 0x2c3a36; this.coins = 4;
  }
  update(dt: number) {
    const P = this.g.player;
    this.vy = Math.min(PH.MAXFALL, this.vy + PH.G * dt);
    if (this.kbT > 0) { this.kbT -= dt; this.vx = this.kbDir * 90; }
    else if (this.onGround) {
      this.vx = 0;
      this.face = P.cx > this.cx ? 1 : -1;
      const near = Math.abs(P.cx - this.cx) < 170 && Math.abs(P.cy - this.cy) < 90 && !this.g.inCutscene && !P.dead;
      this.wait -= dt * (near ? 1 : 0.3);
      this.crouch = this.wait < 0.35 ? 1 : 0;
      if (this.wait <= 0) {
        this.wait = rand(1.1, 1.9);
        this.vy = -rand(300, 360); this.vx = this.face * rand(80, 120); this.onGround = false; sfx.croak();
      }
    }
    moveBody(this, dt);
    if (this.hitX && !this.onGround) this.vx *= -0.5;
    if (this.landed) { this.g.burst(this.cx, this.y + this.h, 4, 0x2c2838, { spd: 40, life: 0.3, size: 2, key: 'fx_dust' }); this.puppet.squash(1.2, 0.8); }
  }
  render(dt: number) {
    this.t += dt;
    const p = this.puppet, air = !this.onGround;
    p.place(this.cx, this.y + this.h, this.face);
    p.squash(damp(p.inner.scaleX, air ? 0.9 : 1 + this.crouch * 0.12, 12, dt), damp(p.inner.scaleY, air ? 1.15 : 1 - this.crouch * 0.15 + Math.sin(this.t * 3) * 0.02, 12, dt));
    p.set('legB', { rot: air ? 0.9 : 0 }); p.set('legF', { rot: air ? 0.8 : 0 });
    p.set('body', { rot: air ? (this.vy < 0 ? -0.2 : 0.2) : 0 });
    this.renderCommon(dt);
  }
  light() { return { x: this.cx + this.face * 4, y: this.y, r: 18, color: 0x7fe3ff, a: 0.35 }; }
}

register('mite', (g, d, x, y) => new Mite(g, d, x + 1, y + 6));
register('sockwisp', (g, d, x, y) => new SockWisp(g, d, x + 2, y + 2));
register('snail', (g, d, x, y) => new Snail(g, d, x, y + 2));
register('toad', (g, d, x, y) => new Toad(g, d, x, y + 4));
export { clamp };
