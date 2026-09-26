// Non-enemy entities: shrines, pickups, NPCs, gates, triggers, decals.
import { DEPTH, INV_ART, T } from '../core/config';
import { rand, damp, overlap } from '../core/util';
import { sfx } from '../core/audio';
import { Game } from '../core/state';
import { World } from '../world/world';
import { Puppet } from '../render/puppet';
import { mothRig, mouseRig } from '../render/rigs';
import { Entity, register, Ctx } from './entity';
import type { EntityDef } from '../content/types';

const visible = (d: EntityDef) => Game.test(d.if) && !(d.hideIf && Game.test(d.hideIf));

// ------------------------------------------------------------------ spawn
register('spawn', () => null);

// ------------------------------------------------------------------ shrine (save point)
export class Shrine extends Entity {
  img: any; flames: any[] = []; lit = 0; extra: any[] = [];
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x - 4, y - 8); this.w = 24; this.h = 24;
    const s = g.scene;
    this.img = s.add.image(x + 8, y + T, 'shrine').setOrigin(0.5, 1).setScale(INV_ART * 0.85).setDepth(DEPTH.props);
    this.extra = [];
    for (const [dx, sc] of [[-6, 0.55], [5, 0.7], [0, 0.45]]) {
      const baseY = y + T - 2;
      const cand = s.add.image(x + 8 + dx, baseY, 'candle').setScale(INV_ART * sc).setDepth(DEPTH.props + 1).setOrigin(0.5, 1);
      this.extra.push(cand);
      this.flames.push(s.add.image(x + 8 + dx, baseY - 34 * INV_ART * sc + 8 * INV_ART * sc, 'flame').setScale(INV_ART * sc).setOrigin(0.5, 0.85).setDepth(DEPTH.props + 2).setBlendMode(Phaser.BlendModes.ADD));
    }
  }
  interactLabel() { return 'Rest'; }
  interact() {
    const P = this.g.player;
    if (!P.onGround) return false;
    P.resting = true; P.vx = 0;
    P.hp = Game.save.maxHp; Game.save.hp = P.hp;
    Game.save.shrine = { room: this.g.room.id, x: P.x, y: P.y };
    P.safeX = P.x; P.safeY = P.y;
    sfx.rest(); this.lit = 1;
    this.g.burst(this.cx, this.y + 12, 24, 0xffcf7a, { spd: 30, life: 1.6, size: 1.5, grav: -30, glow: true });
    Game.achieve('rested');
    (this.g as any).respawnRoomEnemies?.();
    (this.g as any).saveNow?.();
    if (this.def.cutscene && Game.test(this.def.cutsceneIf)) this.g.runCutscene(this.def.cutscene);
    return true;
  }
  render(dt: number) {
    this.t += dt; this.lit = damp(this.lit, 0, 1.5, dt);
    this.flames.forEach((f, i) => f.setScale(f.scaleX, f.scaleX * (1 + 0.15 * Math.sin(this.t * 9 + i * 2))).setAlpha(0.85 + Math.sin(this.t * 13 + i) * 0.15));
  }
  light() { return { x: this.cx, y: this.y + 6, r: 70 + this.lit * 50 + Math.sin(this.t * 7) * 3, color: 0xffcf7a, a: 0.75 }; }
  destroy() { this.img.destroy(); this.flames.forEach((f) => f.destroy()); this.extra.forEach((f) => f.destroy()); }
}
register('shrine', (g, d, x, y) => new Shrine(g, d, x, y));

// ------------------------------------------------------------------ button jar (breakable cache)
class Jar extends Entity {
  img: any;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x + 2, y + 4); this.w = 12; this.h = 12; this.hp = 3; this.hittable = true;
    this.img = g.scene.add.image(x + 8, y + T, 'button_jar').setOrigin(0.5, 1).setScale(INV_ART * 0.4).setDepth(DEPTH.props);
  }
  onHit() {
    this.hp--; this.flashT = 0.1; sfx.clink();
    this.g.dropCoins(this.cx, this.cy, 3);
    if (this.hp <= 0) { this.dead = true; Game.taken.add(this.id); sfx.break(); this.g.burst(this.cx, this.cy, 14, 0xbfeaff, { spd: 120, life: 0.5, size: 1.6, glow: true }); this.g.dropCoins(this.cx, this.cy, (this.def.value ?? 12) - 6); }
    return true;
  }
  render(dt: number) { this.flashT = Math.max(0, this.flashT - dt); this.img.setAngle(this.flashT > 0 ? rand(-8, 8) : 0); if (this.flashT > 0) this.img.setTintFill(0xffffff); else this.img.clearTint(); }
  destroy() { this.img.destroy(); }
}
register('jar', (g, d, x, y) => (Game.taken.has(d.id!) ? null : new Jar(g, d, x, y)));

// ------------------------------------------------------------------ pickups (abilities, story items, lost lives)
const PICKUP_ART: Record<string, { key: string; scale: number; glow: number; color: number }> = {
  needle: { key: 'needle', scale: 0.9, glow: 0xffffff, color: 0xffffff },
  dash: { key: 'relic_dash', scale: 0.4, glow: 0x8a7aff, color: 0xbfb0ff },
  wings: { key: 'relic_wings', scale: 0.4, glow: 0xe9e2ff, color: 0xe9e2ff },
  slipper: { key: 'slipper', scale: 0.4, glow: 0xffc0d0, color: 0xffc0d0 },
  shade: { key: 'shade', scale: 0.4, glow: 0xbfeaff, color: 0xbfeaff },
};
class Pickup extends Entity {
  img: any; art: typeof PICKUP_ART[string]; baseY: number;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y); this.w = 14; this.h = 16;
    this.art = PICKUP_ART[d.kind] ?? PICKUP_ART.needle;
    this.baseY = y + 6;
    this.img = g.scene.add.image(x + 7, this.baseY, this.art.key).setScale(INV_ART * this.art.scale).setDepth(DEPTH.props + 3);
    if (d.kind === 'needle') this.img.setRotation(-1.2);
    if (d.kind === 'shade') this.img.setAlpha(0.85);
  }
  update() {
    if (this.g.inCutscene) return;
    if (overlap(this.g.player, this)) this.collect();
  }
  async collect() {
    if (this.dead) return;
    this.dead = true; Game.taken.add(this.id);
    sfx.pickup(); this.g.shake(4);
    this.g.burst(this.cx, this.cy, 40, this.art.color, { spd: 200, life: 1, size: 2, grav: 0, glow: true });
    if (this.def.cutscene) await this.g.runCutscene(this.def.cutscene, { entity: this });
    (this.g as any).saveNow?.();
  }
  render(dt: number) {
    this.t += dt;
    this.img.setY(this.baseY + Math.sin(this.t * 2.2) * 2);
    if (this.def.kind === 'needle') this.img.setRotation(-1.2 + Math.sin(this.t * 1.5) * 0.05);
    if (this.def.kind === 'shade') this.img.setScale(INV_ART * this.art.scale * (1 + Math.sin(this.t * 3) * 0.03)).setAlpha(0.7 + Math.sin(this.t * 2) * 0.15);
  }
  light() { return { x: this.cx, y: this.cy, r: 46 + Math.sin(this.t * 3) * 4, color: this.art.glow, a: 0.7 }; }
  destroy() { this.img.destroy(); }
}
register('pickup', (g, d, x, y) => (Game.taken.has(d.id!) || !visible(d) ? null : new Pickup(g, d, x, y)));

// ------------------------------------------------------------------ single coin
class Coin extends Entity {
  img: any;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x + 4, y + 4); this.w = 8; this.h = 8;
    this.img = g.scene.add.image(x + 8, y + 8, 'button_coin').setScale(INV_ART * 1.0).setDepth(DEPTH.props);
  }
  update() { if (overlap(this.g.player, this)) { this.dead = true; Game.taken.add(this.id); this.g.dropCoins(this.cx, this.cy, this.def.value ?? 1); } }
  render(dt: number) { this.t += dt; this.img.setScale(INV_ART * Math.abs(Math.cos(this.t * 2)), INV_ART); }
  light() { return { x: this.cx, y: this.cy, r: 14, color: 0xffe0a0, a: 0.4 }; }
  destroy() { this.img.destroy(); }
}
register('coin', (g, d, x, y) => (Game.taken.has(d.id!) ? null : new Coin(g, d, x, y)));

// ------------------------------------------------------------------ NPCs
const NPC_RIGS: Record<string, { rig: () => any; scale: number; w: number; h: number; light?: [number, number] }> = {
  moth: { rig: mothRig, scale: 0.8, w: 22, h: 22, light: [0xffcf7a, 60] },
  mouse: { rig: mouseRig, scale: 0.75, w: 22, h: 16 },
};
export class Npc extends Entity {
  puppet: Puppet; kind: string; talking = false; hover = 0;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y);
    this.kind = d.rig ?? 'moth';
    const R = NPC_RIGS[this.kind];
    this.w = R.w; this.h = R.h; this.y = y + T - this.h;
    this.puppet = new Puppet(g.scene, R.rig(), R.scale, DEPTH.npc);
    this.face = d.face ?? -1;
    this.name = d.name ?? World.speakers[d.speaker]?.name ?? '';
  }
  interactLabel() { return this.def.talk ? 'Talk' : null; }
  interact() {
    const talk: { if?: string; cutscene: string }[] = this.def.talk || [];
    const pick = talk.find((t) => Game.test(t.if));
    if (!pick) return false;
    this.face = this.g.player.cx > this.cx ? 1 : -1;
    this.g.runCutscene(pick.cutscene, { entity: this });
    return true;
  }
  update(dt: number) {
    if (!this.g.inCutscene && Math.abs(this.g.player.cx - this.cx) < 60 && this.def.watch !== false) this.face = this.g.player.cx > this.cx ? 1 : -1;
    this.hover = damp(this.hover, this.kind === 'moth' ? 1 : 0, 3, dt);
  }
  render(dt: number) {
    this.t += dt;
    const p = this.puppet, t = this.t;
    const bob = this.kind === 'moth' ? Math.sin(t * 2.4) * 2 - 3 : 0;
    p.place(this.cx, this.y + this.h + bob, this.face);
    if (this.kind === 'moth') {
      const flap = this.talking ? Math.sin(t * 16) * 0.35 : Math.sin(t * 5) * 0.2;
      p.set('wingF', { rot: flap, sy: 1 + flap * 0.2 }); p.set('wingB', { rot: -flap * 0.8 });
      p.set('antF', { rot: Math.sin(t * 3) * 0.12 }); p.set('antB', { rot: Math.sin(t * 3 + 1) * 0.12 });
      p.set('body', { rot: Math.sin(t * 1.6) * 0.06 });
      p.set('flame', { sy: 1 + Math.sin(t * 11) * 0.1, alpha: 0.85 + Math.sin(t * 17) * 0.15 });
    } else {
      p.set('head', { rot: Math.sin(t * 1.2) * 0.05 + (this.talking ? Math.sin(t * 14) * 0.06 : 0) });
      p.set('earF', { rot: Math.sin(t * 0.7) > 0.95 ? 0.3 : 0 });
      p.set('tail', { rot: Math.sin(t * 2) * 0.15 });
      p.set('body', { sy: 1 + Math.sin(t * 2.2) * 0.02 });
    }
  }
  light() { const R = NPC_RIGS[this.kind]; return R.light ? { x: this.cx + this.face * 6, y: this.cy, r: R.light[1] + Math.sin(this.t * 9) * 3, color: R.light[0], a: 0.7 } : null; }
  destroy() { this.puppet.destroy(); }
}
register('npc', (g, d, x, y) => (visible(d) ? new Npc(g, d, x, y) : null));

// ------------------------------------------------------------------ gates (boss bars, story blockers)
class Gate extends Entity {
  img: any; open = 1; tiles: [number, number][] = []; closedGrid = false;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y);
    const n = d.h ?? 3; this.w = T; this.h = n * T;
    const r = g.room;
    for (let i = 0; i < n; i++) this.tiles.push([d.x!, d.y! + i]);
    this.img = g.scene.add.image(x + T / 2, y, d.art ?? 'gate_bars').setOrigin(0.5, 0).setScale(INV_ART * 0.5, (n * T) / 96).setDepth(DEPTH.props + 5);
    if (d.art === 'deco_rockfall') this.img.setScale(INV_ART * 0.75).setOrigin(0.5, 0.15);
    this.open = this.shouldBeOpen() ? 1 : 0;
    this.apply(); void r;
  }
  shouldBeOpen() {
    if (this.def.mode === 'flag') return Game.test(this.def.flag);
    return !(this.g as any).bossActive;
  }
  apply() {
    const closed = this.open < 0.5;
    if (closed === this.closedGrid) return;
    this.closedGrid = closed;
    for (const [lx, ly] of this.tiles) this.g.room.grid[ly][lx] = closed ? '#' : '.';
  }
  update(dt: number) {
    const target = this.shouldBeOpen() ? 1 : 0;
    if (target !== Math.round(this.open)) { if (this.def.art !== 'deco_rockfall') sfx.gate(); this.g.shake(3); }
    this.open = damp(this.open, target, 10, dt);
    if (Math.abs(this.open - target) < 0.02) this.open = target;
    this.apply();
  }
  render() {
    if (this.def.art === 'deco_rockfall') { this.img.setAlpha(1 - this.open); return; }
    this.img.setY(this.y - this.open * this.h).setAlpha(this.open > 0.97 ? 0 : 1);
  }
  destroy() { for (const [lx, ly] of this.tiles) this.g.room.grid[ly][lx] = '.'; this.img.destroy(); }
}
register('gate', (g, d, x, y) => new Gate(g, d, x, y));

// ------------------------------------------------------------------ decals / decor / signs
class Decal extends Entity {
  img: any;
  constructor(g: Ctx, d: EntityDef, x: number, y: number) {
    super(g, d, x, y); this.w = (d.w ?? 2) * T; this.h = (d.h ?? 2) * T;
    const depth = d.layer === 'fg' ? DEPTH.fgDecor : d.layer === 'bg' ? DEPTH.bgDecor : DEPTH.decor;
    this.img = g.scene.add.image(x + (d.ox ?? 0) * T, y + T + (d.oy ?? 0) * T, d.art).setOrigin(d.originX ?? 0.5, d.originY ?? 1).setScale(INV_ART * (d.scale ?? 0.5)).setDepth(depth);
    if (d.alpha !== undefined) this.img.setAlpha(d.alpha);
    if (d.flip) this.img.setFlipX(true);
    if (d.rot) this.img.setRotation(d.rot);
    if (d.tint) this.img.setTint(Number(d.tint));
    this.x = this.img.x - this.w / 2; this.y = y + T - this.h;
  }
  interactLabel() { return this.def.read ? (this.def.label ?? 'Read') : null; }
  interact() { if (!this.def.read) return false; this.g.runCutscene(this.def.read, { entity: this }); return true; }
  render(dt: number) {
    this.t += dt;
    if (this.def.sway) this.img.setRotation((this.def.rot ?? 0) + Math.sin(this.t * (this.def.swaySpeed ?? 0.8) + this.x) * this.def.sway);
  }
  light() { return this.def.glow ? { x: this.img.x, y: this.img.y - 8, r: this.def.glow, color: Number(this.def.glowColor ?? 0xffcf7a), a: 0.6 } : null; }
  destroy() { this.img.destroy(); }
}
register('decal', (g, d, x, y) => (visible(d) ? new Decal(g, d, x, y) : null));

// ------------------------------------------------------------------ triggers (cutscenes, area exits)
class Trigger extends Entity {
  inside = false;
  // The marker is the bottom-left tile; the zone extends right `w` tiles and up `h` tiles.
  constructor(g: Ctx, d: EntityDef, x: number, y: number) { super(g, d, x, y); this.w = (d.w ?? 1) * T; this.h = (d.h ?? 1) * T; this.y = y + T - this.h; }
  update() {
    if (this.g.inCutscene || this.g.player.dead || (this.g as any).bossActive) return;
    if (!overlap(this.g.player, this)) { this.inside = false; return; }
    if (this.inside) return; // repeatable triggers fire once per entry, not every frame
    this.inside = true;
    if (!Game.test(this.def.if)) return;
    if (this.def.once !== false) { if (Game.taken.has(this.id)) return; Game.taken.add(this.id); }
    this.g.runCutscene(this.def.cutscene, { entity: this });
  }
}
register('trigger', (g, d, x, y) => (d.once !== false && Game.taken.has(d.id!) ? null : new Trigger(g, d, x, y)));
