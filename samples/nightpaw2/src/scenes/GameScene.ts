// The main play scene: rooms, entities, camera, combat, transitions, saving.
// Backdrop (parallax), Light (darkness + glows) and UI scenes run alongside it.
import { T, ART, INV_ART, DEPTH, STEP, ZOOM, VIEW_W, VIEW_H, SCREEN_W, SCREEN_H } from '../core/config';
import { clamp, damp, overlap, rand } from '../core/util';
import { Input } from '../core/input';
import { sfx, Audio, Music } from '../core/audio';
import { Game } from '../core/state';
import { Platform } from '../core/platform';
import { World, Room, setCurrentRoom, tileAt, isSolid, groundBelow } from '../world/world';
import { roomTexture } from '../render/roomArt';
import { Fx } from '../render/fx';
import { Player } from '../entities/player';
import { Entity, create, Ctx, Light } from '../entities/entity';
import { Warden } from '../entities/warden';
import { runCutscene, CutsceneHost } from '../story/cutscene';
import '../entities/enemies';
import '../entities/props';

const GROUNDED = new Set(['shrine', 'jar', 'npc', 'pickup', 'warden']);

export class GameScene extends Phaser.Scene implements Ctx, CutsceneHost {
  room!: Room;
  player!: Player;
  ents: Entity[] = [];
  fx!: Fx;
  ui: any; light: any; backdrop: any;
  roomImg: any = null;
  cracks: { img: any; key: string; tx: number; ty: number }[] = [];
  staticLights: Light[] = [];
  lightList: Light[] = [];
  time_ = 0;
  acc = 0;
  hitstopT = 0;
  shakeAmt = 0;
  inCutscene = false;
  paused = false;
  bossActive = false;
  camX = 0; camY = 0;
  camFocus: { x: number; y: number } | null = null;
  camRelease = 0;
  promptTarget: Entity | null = null;
  lastArea = '';
  autosaveT = 0;
  playtimeT = 0;
  emotes: any[] = [];
  startOpts: any = {};

  constructor() { super('game'); }
  // Phaser injects `scene` (the scene plugin) and `time` (the clock); entities use
  // `g.scene` to mean "this scene" so both getters return what each side expects.
  get time(): any { return (this as any).sys.time; }
  set time(_v: any) { /* injected by Phaser; read via sys */ }
  get scene(): any { return this; }
  set scene(_v: any) { /* injected by Phaser; use sys.scenePlugin */ }

  init(data: any) { this.startOpts = data || {}; }

  create() {
    const cam = this.cameras.main;
    cam.setZoom(ZOOM); cam.setRoundPixels(false); cam.transparent = true;
    this.fx = new Fx(this);
    const sp = (this as any).sys.scenePlugin;
    sp.launch('backdrop'); sp.launch('light'); sp.launch('ui');
    this.backdrop = sp.get('backdrop'); this.light = sp.get('light'); this.ui = sp.get('ui');
    (this.ui as any).game_ = this;
    this.started = false;
  }
  started = false;
  /** Runs once the parallel scenes (backdrop, light, ui) have been created. */
  begin() {
    this.started = true;
    this.player = new Player(this);
    this.ents = [];
    const s = Game.save;
    let startRoom = World.def.start.room, sx = World.def.start.x, sy = World.def.start.y;
    if (this.startOpts.continue && s.pos && World.byId.has(s.pos.room)) { startRoom = s.pos.room; }
    const q = new URLSearchParams(location.search);
    if (q.get('room') && World.byId.has(q.get('room')!)) { startRoom = q.get('room')!; sx = Number(q.get('x') ?? 3); sy = Number(q.get('y') ?? 3); }
    const r = World.byId.get(startRoom)!;
    if (this.startOpts.continue && s.pos && s.pos.room === startRoom && !q.get('room')) this.player.place(s.pos.x, s.pos.y);
    else {
      const spawn = r.spawns.find((e) => e.type === 'spawn');
      const tx = q.get('room') ? sx : spawn ? spawn.x! : sx, ty = q.get('room') ? sy : spawn ? spawn.y! : sy;
      this.player.place((r.x + tx) * T + 3, (r.y + ty) * T + 2);
    }
    this.player.hp = this.startOpts.continue ? Math.max(1, s.hp) : s.maxHp;
    this.enterRoom(r, { snap: true, noSave: true });

    Platform.onExit(() => { this.saveNow(); });
    Platform.onPause(() => this.ui?.openPause?.());
    (window as any).__NP = this; (window as any).__NP_GAME = Game; (window as any).__NP_WORLD = World;

    this.events.on('shutdown', () => { Music.stop(); });
    if (this.startOpts.cutscene) this.time.delayedCall(10, () => this.runCutscene(this.startOpts.cutscene));
  }

  // ------------------------------------------------------------------ rooms
  enterRoom(r: Room, o: { snap?: boolean; noSave?: boolean } = {}) {
    for (const e of this.ents) e.destroy();
    this.ents = [];
    for (const c of this.cracks) c.img.destroy();
    this.cracks = [];
    this.emotes.forEach((e) => e.destroy()); this.emotes = [];
    this.fx.clear();
    this.room = r; setCurrentRoom(r);
    const art = roomTexture(this, r);
    if (this.roomImg) this.roomImg.destroy();
    this.roomImg = this.add.image(r.px, r.py, art.key).setOrigin(0, 0).setScale(INV_ART).setDepth(DEPTH.room);
    this.staticLights = art.lights;
    this.spawnAll();
    // cracked walls
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      if (r.grid[y][x] !== 'X') continue;
      const key = `wall:${r.id}:${x},${y}`;
      if (Game.taken.has(key)) continue;
      const img = this.add.image((r.x + x) * T, (r.y + y) * T, `${r.area.tileset}_rock`).setOrigin(0, 0).setCrop(0, 0, 64, 64).setScale(INV_ART).setDepth(DEPTH.room + 1).setTint(0xb8b0d0);
      const crack = this.add.image((r.x + x) * T + T / 2, (r.y + y) * T + T / 2, 'crack_wall').setScale(INV_ART).setDepth(DEPTH.room + 2).setAlpha(0.8);
      this.cracks.push({ img, key, tx: r.x + x, ty: r.y + y }, { img: crack, key, tx: r.x + x, ty: r.y + y });
    }
    const first = !Game.visited.has(r.id);
    Game.visited.add(r.id);
    // music / ambience / backdrop
    const music = this.bossActive ? 'boss' : r.music ?? r.area.music;
    if (music && !this.inCutscene) Music.play(music);
    Audio.ambience(r.ambience ?? r.area.ambience ?? 'hollows');
    this.backdrop?.setArea(r.area, r);
    this.light?.setDark(r.dark ?? r.area.dark);
    if (r.area.id !== this.lastArea) {
      if (this.lastArea) this.ui?.titleCard(r.area.name, r.area.subtitle);
      this.lastArea = r.area.id;
    }
    this.cameras.main.setBounds(r.px, r.py, Math.max(r.pw, VIEW_W), Math.max(r.ph, VIEW_H));
    if (o.snap) this.snapCamera();
    if (!o.noSave) this.saveNow();
    if (r.onEnter && Game.test(r.onEnterIf) && !this.inCutscene) {
      const key = `enter:${r.id}`;
      if (!Game.taken.has(key)) { Game.taken.add(key); this.time.delayedCall(30, () => this.runCutscene(r.onEnter!)); }
    }
    void first;
  }

  spawnAll() {
    const r = this.room;
    for (const d of r.spawns) {
      let x = (r.x + d.x!) * T, y = (r.y + d.y!) * T;
      if (GROUNDED.has(d.type) && d.float !== true) y = (r.y + groundBelow(r, d.x!, d.y!) - 1) * T;
      const e = create(this, d, x, y);
      if (e) this.ents.push(e);
    }
  }
  refreshEntities() {
    // Re-evaluate conditional entities (npcs appearing after story flags) without losing the rest.
    for (const e of this.ents) e.destroy();
    this.ents = [];
    this.spawnAll();
  }
  respawnRoomEnemies() { /* enemies already respawn on room re-entry */ }

  spawn(e: Entity) { this.ents.push(e); }

  // ------------------------------------------------------------------ Ctx services
  burst(x: number, y: number, n: number, color: number, o?: any) { this.fx.burst(x, y, n, color, o); }
  dropCoins(x: number, y: number, n: number) { this.fx.coins(x, y, n); }
  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  hitstop(s: number) { this.hitstopT = Math.max(this.hitstopT, s); }
  prompt(text: string | null, x?: number, y?: number) { this.ui?.prompt(text, x, y); }
  bossBar(e: Entity | null, name?: string) { this.ui?.bossBar(e, name); if (!e) { this.bossActive = false; } }
  get time_s() { return this.time_; }

  hurtPlayer(n: number, fromX: number, hazard = false) {
    const P = this.player;
    if (P.invuln > 0 || P.dead || this.inCutscene || P.hazardT > 0) return;
    P.hp -= n; P.invuln = 1.1; P.resting = false;
    P.knockT = 0.18; P.knockVx = hazard ? 0 : (P.cx < fromX ? -1 : 1) * 150; P.vy = -200; P.dashT = 0;
    sfx.hurt(); this.shake(8); this.hitstop(0.12); this.ui?.hurtFlash();
    this.burst(P.cx, P.cy, 14, 0x0b0a10, { spd: 140, life: 0.5, size: 2.5 });
    if (P.hp <= 0) this.killPlayer();
    else if (hazard) { P.hazardT = 0.35; }
  }
  afterHazard() { this.ui?.flashFade(0.8); }

  killPlayer() {
    const P = this.player;
    P.dead = true; P.deadT = 0; P.vx = 0; sfx.die(); this.shake(10);
    Game.save.deaths++;
    this.burst(P.cx, P.cy, 30, 0x0b0a10, { spd: 180, life: 1, size: 3, grav: 60 });
    this.burst(P.cx, P.cy, 16, 0xbfeaff, { spd: 60, life: 1.4, size: 1.6, glow: true, grav: -60 });
    this.time.delayedCall(1700, async () => {
      await this.ui.fade(1, 500);
      const sh = Game.save.shrine;
      const r = sh && World.byId.get(sh.room) ? World.byId.get(sh.room)! : World.byId.get(World.def.start.room)!;
      this.bossActive = false; this.ui.bossBar(null);
      P.dead = false; P.hp = Game.save.maxHp; P.invuln = 1;
      if (sh) P.place(sh.x, sh.y); else { const sp = r.spawns.find((e) => e.type === 'spawn'); P.place((r.x + (sp?.x ?? 3)) * T + 3, (r.y + (sp?.y ?? 3)) * T + 2); }
      this.enterRoom(r, { snap: true });
      if (sh) P.resting = true;
      await this.ui.fade(0, 700);
    });
  }

  hitWall(tx: number, ty: number, _face: number) {
    const r = this.room;
    const group: [number, number][] = [];
    const seen = new Set<string>();
    const stack: [number, number][] = [[tx - r.x, ty - r.y]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      const k = `${x},${y}`;
      if (seen.has(k) || x < 0 || y < 0 || x >= r.w || y >= r.h || r.grid[y][x] !== 'X') continue;
      seen.add(k); group.push([x, y]);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    for (const [x, y] of group) {
      const key = `wall:${r.id}:${x},${y}`;
      Game.taken.add(key);
      this.burst((r.x + x) * T + 8, (r.y + y) * T + 8, 10, 0x3a3448, { spd: 160, life: 0.7, size: 3, grav: 400, key: 'fx_dust' });
    }
    this.cracks = this.cracks.filter((c) => { if (seen.has(`${c.tx - r.x},${c.ty - r.y}`)) { c.img.destroy(); return false; } return true; });
    sfx.break(); this.shake(6); this.hitstop(0.08);
    this.time.delayedCall(300, () => sfx.pickup());
    Game.achieve('secret_wall');
    this.saveNow();
  }

  // ------------------------------------------------------------------ cutscenes
  async runCutscene(id: string, opts: { entity?: Entity } = {}) {
    if (this.inCutscene) { this.time.delayedCall(100, () => this.runCutscene(id, opts)); return; }
    this.inCutscene = true;
    const P = this.player;
    P.locked = true; P.scripted = null; P.atkT = 0; P.dashT = 0;
    this.ui.prompt(null);
    try { await runCutscene(this, id, opts); }
    catch (e) { console.error('cutscene failed', id, e); }
    P.locked = false; P.scripted = null;
    this.ui.letterbox(false);
    this.camFocus = null;
    this.inCutscene = false;
    Input.swallow();
    this.saveNow();
  }
  cam = {
    focus: (x: number, y: number, ms: number) => new Promise<void>((res) => {
      const from = { x: this.camX, y: this.camY };
      this.camFocus = { ...from };
      this.tweens.add({ targets: this.camFocus, x, y, duration: ms, ease: 'Sine.easeInOut', onComplete: () => res() });
    }),
    release: (ms = 600) => { this.camFocus = null; this.camRelease = ms / 1000; },
  };
  emote(target: any, kind: string) {
    const t = this.add.text(target.cx, target.y - (target === this.player ? 20 : 8), kind, { fontFamily: 'Georgia, serif', fontSize: '48px', color: '#f0ecff', stroke: '#07060a', strokeThickness: 8 }).setOrigin(0.5, 1).setScale(INV_ART * 0.9).setDepth(DEPTH.fx + 5);
    this.emotes.push(t);
    this.tweens.add({ targets: t, y: t.y - 6, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1300, duration: 300, onComplete: () => t.destroy() });
  }
  teleport(room: string, x: number, y: number) {
    const r = World.byId.get(room); if (!r) return;
    this.player.place((r.x + x) * T + 3, (r.y + y) * T + 2);
    this.enterRoom(r, { snap: true, noSave: true });
  }
  wakeBoss(_id: string) {
    const b = this.ents.find((e) => e instanceof Warden) as Warden | undefined;
    if (!b) return;
    b.wake(); this.bossActive = true; this.bossBar(b, b.name); this.bossActive = true;
    Music.play('boss'); Audio.ambience('boss');
  }
  saveNow() {
    const P = this.player;
    if (!P || P.dead) return;
    Game.save.pos = { room: this.room.id, x: P.safeX, y: P.safeY };
    Game.save.hp = Math.max(1, P.hp);
    Game.persist();
    this.ui?.saveIcon();
  }
  async endDemo() {
    await this.ui.fade(1, 1200);
    Music.stop(); Audio.ambience('none');
    this.saveNow();
    await this.ui.storybook([{ image: 'sb_card_bg', title: 'End of the Hollows', lines: ['Nightpaw climbs toward the sound of water,', 'and a music box playing somewhere below.', '', 'The Drowned Nursery is coming soon.'] }], { card: true });
    this.goTitle();
  }
  goTitle() {
    const sp = (this as any).sys.scenePlugin;
    Music.stop();
    sp.stop('ui'); sp.stop('light'); sp.stop('backdrop');
    sp.start('title');
  }

  // ------------------------------------------------------------------ main loop
  update(_time: number, deltaMs: number) {
    if (!this.started) {
      if (this.backdrop?.far && this.light?.rt && this.ui?.fadeRect) this.begin();
      return;
    }
    const dt = Math.min(0.05, deltaMs / 1000);
    Input.poll();
    if (this.ui?.modal) { this.ui.updateModal(dt); Input.endStep(); this.renderAll(dt); return; }
    if (!this.inCutscene && !this.player.dead && Input.pressed('pause')) { this.ui.openPause(); Input.endStep(); return; }
    if (!this.inCutscene && !this.player.dead && Input.pressed('map')) { this.ui.openMap(); Input.endStep(); return; }
    if (this.inCutscene) this.ui.cutsceneInput?.();

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this.acc -= STEP; steps++;
      if (this.hitstopT > 0) { this.hitstopT -= STEP; Input.endStep(); continue; }
      this.step(STEP);
      Input.endStep();
    }
    this.renderAll(dt);
    this.time_ += dt;
    this.playtimeT += dt;
    if (this.playtimeT > 1) { Game.save.playSeconds += Math.floor(this.playtimeT); this.playtimeT %= 1; }
    this.autosaveT += dt;
    if (this.autosaveT > 25 && !this.inCutscene && !this.player.dead) { this.autosaveT = 0; this.saveNow(); Platform.reportPlaytime(); }
  }

  step(dt: number) {
    const P = this.player;
    P.update(dt);
    for (const e of this.ents) {
      if (!e.dead) e.update(dt);
      if (e.harm > 0 && !e.dead && !P.dead && overlap(P, e)) this.hurtPlayer(e.harm, e.cx);
    }
    const dead = this.ents.filter((e) => e.dead);
    if (dead.length) { dead.forEach((e) => e.destroy()); this.ents = this.ents.filter((e) => !e.dead); }
    const got = this.fx.update(dt, P.cx, P.cy, (x, y) => isSolid(tileAt(Math.floor(x / T), Math.floor(y / T))));
    if (got) { Game.save.buttons += got; for (let i = 0; i < got; i++) this.time.delayedCall(i * 30, () => sfx.coin()); this.ui?.coinsChanged(); }

    // interaction prompts
    if (!this.inCutscene && !P.dead) {
      const near = this.ents.find((e) => !e.dead && e.interactLabel() && overlap({ x: P.x - 6, y: P.y - 4, w: P.w + 12, h: P.h + 8 }, e));
      if (near !== this.promptTarget) {
        this.promptTarget = near ?? null;
        this.prompt(near ? near.interactLabel() : null, near ? near.cx : 0, near ? near.y - 4 : 0);
      }
      if (near && Input.pressed('up') && P.onGround && !P.resting) { if (near.interact()) { this.promptTarget = null; this.prompt(null); } }
    } else if (this.promptTarget) { this.promptTarget = null; this.prompt(null); }

    // room transitions
    const cx = P.cx, cy = P.cy, r = this.room;
    if (cx < r.px || cx >= r.px + r.pw || cy < r.py || cy >= r.py + r.ph) {
      const next = World.roomAt(cx, cy);
      if (next && next !== r) {
        const goingUp = cy < r.py;
        this.enterRoom(next, { snap: true });
        this.ui.flashFade(0.55);
        if (goingUp) { P.vy = Math.min(P.vy, -390); P.airJumps = Game.has('wings') ? 1 : 0; }
      } else if (!next) { P.x = P.safeX; P.y = P.safeY; P.vx = P.vy = 0; }
    }
    if (P.dead === false && P.y > r.py + r.ph + 64) { P.x = P.safeX; P.y = P.safeY; }
  }

  // ------------------------------------------------------------------ camera & render
  camTarget() {
    const P = this.player;
    if (this.camFocus) return { x: this.camFocus.x, y: this.camFocus.y };
    return { x: P.cx + P.face * 18, y: P.cy - 10 + clamp(P.vy * 0.06, -10, 24) };
  }
  clampCam(x: number, y: number) {
    const r = this.room;
    const hw = VIEW_W / 2, hh = VIEW_H / 2;
    const cx = r.pw <= VIEW_W ? r.px + r.pw / 2 : clamp(x, r.px + hw, r.px + r.pw - hw);
    const cy = r.ph <= VIEW_H ? r.py + r.ph / 2 : clamp(y, r.py + hh, r.py + r.ph - hh);
    return { x: cx, y: cy };
  }
  snapCamera() { const t = this.clampCam(this.camTarget().x, this.camTarget().y); this.camX = t.x; this.camY = t.y; this.applyCam(); }
  applyCam() {
    const cam = this.cameras.main;
    let sx = 0, sy = 0;
    if (this.shakeAmt > 0.1) { sx = rand(-1, 1) * this.shakeAmt * 0.5; sy = rand(-1, 1) * this.shakeAmt * 0.5; }
    // Keep bounds from fighting the shake: centerOn with manual clamp.
    cam.setScroll(this.camX + sx - SCREEN_W / 2, this.camY + sy - SCREEN_H / 2);
  }

  renderAll(dt: number) {
    const P = this.player;
    P.render(dt);
    for (const e of this.ents) e.render(dt);
    this.fx.render(dt);
    // camera
    const t = this.clampCam(this.camTarget().x, this.camTarget().y);
    const k = this.camFocus ? 100 : this.camRelease > 0 ? 3 : 7;
    this.camRelease = Math.max(0, this.camRelease - dt);
    this.camX = damp(this.camX, t.x, k, dt);
    this.camY = damp(this.camY, t.y, this.camFocus ? 100 : 5, dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
    this.applyCam();
    // lights for the light scene
    const L: Light[] = [...this.staticLights];
    if (!P.dead) L.push({ x: P.cx, y: P.cy - 2, r: 56, color: 0xb8b0ff, a: 0.28 });
    for (const e of this.ents) { const l = e.light(); if (l) L.push(l); }
    L.push(...this.fx.lights());
    this.lightList = L;
    // cracked wall crop fix (images created with setCrop keep display origin)
    this.backdrop?.follow(this.camX, this.camY, dt);
    for (const em of this.emotes) if (!em.active) this.emotes = this.emotes.filter((x) => x.active);
  }
}
export { ART, SCREEN_H, damp };
