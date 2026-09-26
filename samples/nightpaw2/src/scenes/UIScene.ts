// Screen-space UI: HUD, dialogue, storybook pages, memories, item cards, map, pause.
// Anything modal registers `this.modal`; GameScene then routes input here and
// freezes the world. Dialogue is *not* modal: the world keeps breathing while you talk.
import { SCREEN_W, SCREEN_H, ZOOM } from '../core/config';
import { damp, clamp, sleep } from '../core/util';
import { Input } from '../core/input';
import { sfx, voiceBlip, Audio } from '../core/audio';
import { Game } from '../core/state';
import { World } from '../world/world';

export const FONT = '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif';
const W = SCREEN_W, H = SCREEN_H;
const DY = 76; // dialogue box top: kept high so it never covers characters on the floor

type Modal = { update(dt: number): void; close?(): void };

export class UIScene extends Phaser.Scene {
  game_: any;
  modal: Modal | null = null;
  // hud
  orb: any; paws: any[] = []; coinIcon: any; coinText: any; hud: any; hudAlpha = 1;
  shownCoins = 0;
  // overlays
  fadeRect: any; flashRect: any; hurtRect: any; barTop: any; barBot: any; letterOn = false;
  promptText: any; promptWorld: { x: number; y: number } | null = null;
  titleGroup: any; saveIco: any; bossGroup: any; bossTarget: any = null; bossFill: any;
  // dialogue
  dlg: any; dlgPortrait: any; dlgName: any; dlgText: any; dlgArrow: any;
  typing: { full: string; shown: number; speaker: any; done: () => void; resolve: () => void; waiting: boolean } | null = null;

  constructor() { super('ui'); }

  create() {
    // ---------- HUD
    this.hud = this.add.container(0, 0);
    this.orb = this.add.image(62, 62, 'ui_orb').setScale(0.95);
    this.hud.add(this.orb);
    this.coinIcon = this.add.image(122, 100, 'button_coin').setScale(1.3);
    this.coinText = this.add.text(140, 100, '0', { fontFamily: FONT, fontSize: '24px', color: '#f0ecff' }).setOrigin(0, 0.5);
    this.hud.add([this.coinIcon, this.coinText]);
    this.shownCoins = Game.save.buttons;
    this.rebuildPaws();

    // ---------- prompt
    this.promptText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '22px', color: '#f0ecff', stroke: '#07060a', strokeThickness: 5 }).setOrigin(0.5, 1).setAlpha(0);

    // ---------- boss bar
    this.bossGroup = this.add.container(W / 2, H - 46).setAlpha(0);
    const bname = this.add.text(0, -22, '', { fontFamily: FONT, fontSize: '22px', color: '#e8d8e0', letterSpacing: 6 } as any).setOrigin(0.5);
    const bbg = this.add.rectangle(0, 4, 640, 10, 0x000000, 0.6).setStrokeStyle(1, 0xffffff, 0.2);
    this.bossFill = this.add.rectangle(-320, 4, 640, 10, 0xc8283a).setOrigin(0, 0.5);
    this.bossGroup.add([bname, bbg, this.bossFill]);

    // ---------- dialogue box
    this.dlg = this.add.container(0, 0).setAlpha(0);
    const panel = this.add.graphics();
    panel.fillStyle(0x07060a, 0.88); panel.fillRoundedRect(110, DY, W - 220, 164, 18);
    panel.lineStyle(2, 0xd8d0f0, 0.35); panel.strokeRoundedRect(110, DY, W - 220, 164, 18);
    this.dlgPortrait = this.add.image(190, DY + 82, 'pt_tallow').setScale(0.72);
    this.dlgName = this.add.text(272, DY + 16, '', { fontFamily: FONT, fontSize: '22px', color: '#ffcf7a', fontStyle: 'bold' });
    this.dlgText = this.add.text(272, DY + 48, '', { fontFamily: FONT, fontSize: '25px', color: '#f0ecff', wordWrap: { width: W - 420 }, lineSpacing: 6 });
    this.dlgArrow = this.add.text(W - 140, DY + 138, '▼', { fontFamily: FONT, fontSize: '20px', color: '#ffcf7a' }).setOrigin(0.5);
    this.dlg.add([panel, this.dlgPortrait, this.dlgName, this.dlgText, this.dlgArrow]);

    // ---------- title card, letterbox, fades
    this.titleGroup = this.add.container(W / 2, 150).setAlpha(0);
    this.barTop = this.add.rectangle(0, -60, W, 60, 0x000000).setOrigin(0);
    this.barBot = this.add.rectangle(0, H, W, 60, 0x000000).setOrigin(0);
    this.hurtRect = this.add.rectangle(0, 0, W, H, 0x8a0a1a, 0).setOrigin(0).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.flashRect = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0);
    this.saveIco = this.add.image(W - 50, H - 50, 'ui_paw').setAlpha(0).setScale(1.1);
    this.fadeRect = this.add.rectangle(0, 0, W, H, 0x000000, 0).setOrigin(0).setDepth(1000);
  }

  // ------------------------------------------------------------------ HUD
  rebuildPaws() {
    this.paws.forEach((p) => p.destroy()); this.paws = [];
    for (let i = 0; i < Game.save.maxHp; i++) {
      const p = this.add.image(128 + i * 34, 52, 'ui_paw').setScale(0.95);
      this.paws.push(p); this.hud.add(p);
    }
  }
  coinsChanged() { this.tweens.add({ targets: this.coinIcon, scale: 1.7, duration: 80, yoyo: true }); }
  hurtFlash() { this.hurtRect.setAlpha(0.8); this.tweens.add({ targets: this.hurtRect, alpha: 0, duration: 400 }); }
  flashFade(a: number) { this.flashRect.setAlpha(a); this.tweens.killTweensOf(this.flashRect); this.tweens.add({ targets: this.flashRect, alpha: 0, duration: 260 }); }
  saveIcon() { this.saveIco.setAlpha(0.9); this.tweens.killTweensOf(this.saveIco); this.tweens.add({ targets: this.saveIco, alpha: 0, delay: 900, duration: 700 }); }

  update(_t: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    const g = this.game_;
    if (!g || !g.player) return;
    const P = g.player;
    if (this.paws.length !== Game.save.maxHp) this.rebuildPaws();
    this.paws.forEach((p, i) => {
      const full = i < P.hp;
      p.setTexture(full ? 'ui_paw' : 'ui_paw_empty');
      p.setScale(full ? 0.95 + (i === P.hp - 1 && P.hp <= 1 ? Math.sin(this.time.now / 150) * 0.08 : 0) : 0.9);
    });
    this.shownCoins = Math.round(damp(this.shownCoins, Game.save.buttons, 10, dt));
    if (Math.abs(this.shownCoins - Game.save.buttons) < 1) this.shownCoins = Game.save.buttons;
    this.coinText.setText(String(this.shownCoins));
    this.hudAlpha = damp(this.hudAlpha, g.inCutscene || this.letterOn ? 0 : 1, 6, dt);
    this.hud.setAlpha(this.hudAlpha);
    // prompt follows its entity
    if (this.promptWorld) {
      const cam = g.cameras.main;
      this.promptText.setPosition((this.promptWorld.x - cam.midPoint.x) * ZOOM + W / 2, (this.promptWorld.y - cam.midPoint.y) * ZOOM + H / 2 - 10);
    }
    // boss bar
    if (this.bossTarget) {
      const k = clamp(this.bossTarget.hp / this.bossTarget.maxHp, 0, 1);
      this.bossFill.width = damp(this.bossFill.width, 640 * k, 8, dt);
    }
    // dialogue typewriter
    const ty = this.typing;
    if (ty && ty.shown < ty.full.length) {
      const before = Math.floor(ty.shown);
      ty.shown = Math.min(ty.full.length, ty.shown + dt * 48);
      const now = Math.floor(ty.shown);
      if (now !== before) {
        this.dlgText.setText(ty.full.slice(0, now));
        const ch = ty.full[now - 1];
        if (ch && /[a-z0-9]/i.test(ch) && now % 2 === 0) voiceBlip(ty.speaker.pitch ?? 400, ty.speaker.voice);
        if (ch && '.!?'.includes(ch)) ty.shown -= 0.2; // tiny pause on punctuation
      }
      if (ty.shown >= ty.full.length) ty.done();
    }
    this.dlgArrow.setAlpha(ty && ty.waiting ? 0.6 + Math.sin(this.time.now / 180) * 0.4 : 0);
  }

  prompt(text: string | null, x?: number, y?: number) {
    this.tweens.killTweensOf(this.promptText);
    if (!text) { this.promptWorld = null; this.tweens.add({ targets: this.promptText, alpha: 0, duration: 150 }); return; }
    this.promptWorld = { x: x!, y: y! };
    this.promptText.setText(`▲  ${text}`);
    this.tweens.add({ targets: this.promptText, alpha: 1, duration: 200 });
  }

  bossBar(e: any, name?: string) {
    this.bossTarget = e;
    if (e) { (this.bossGroup.list[0] as any).setText((name ?? '').toUpperCase()); this.bossFill.width = 640; this.tweens.add({ targets: this.bossGroup, alpha: 1, duration: 800 }); }
    else this.tweens.add({ targets: this.bossGroup, alpha: 0, duration: 800 });
  }

  hint(text: string, ms = 4000) {
    const t = this.add.text(W / 2, H - 70, text, { fontFamily: FONT, fontSize: '22px', color: '#d8d0f0', fontStyle: 'italic', stroke: '#07060a', strokeThickness: 5 }).setOrigin(0.5).setAlpha(0).setDepth(700);
    this.tweens.add({ targets: t, alpha: 1, duration: 600, yoyo: true, hold: ms, onComplete: () => t.destroy() });
  }

  // ------------------------------------------------------------------ cutscene helpers
  letterbox(on: boolean) {
    this.letterOn = on;
    this.tweens.add({ targets: this.barTop, y: on ? 0 : -60, duration: 500, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: this.barBot, y: on ? H - 60 : H, duration: 500, ease: 'Sine.easeInOut' });
  }
  fade(to: number, ms: number, color?: string) {
    if (color) this.fadeRect.setFillStyle(Phaser.Display.Color.HexStringToColor(color).color);
    else this.fadeRect.setFillStyle(0x000000);
    this.tweens.killTweensOf(this.fadeRect);
    if (ms <= 0) { this.fadeRect.setAlpha(to); return Promise.resolve(); }
    return new Promise<void>((res) => {
      this.tweens.add({ targets: this.fadeRect, alpha: to, duration: ms, onComplete: () => res() });
    });
  }
  titleCard(name: string, sub?: string, boss = false) {
    const g = this.titleGroup; g.removeAll(true);
    const t = this.add.text(0, 0, name.toUpperCase(), { fontFamily: FONT, fontSize: boss ? '58px' : '46px', color: boss ? '#e6c8d0' : '#e8e2ff', letterSpacing: boss ? 14 : 10 } as any).setOrigin(0.5);
    const line = this.add.rectangle(0, 44, Math.min(600, t.width * 0.9), 2, boss ? 0xc8283a : 0xd8d0f0, 0.6);
    g.add([t, line]);
    if (sub) g.add(this.add.text(0, 76, sub, { fontFamily: FONT, fontSize: '24px', color: '#b8b0d0', fontStyle: 'italic' }).setOrigin(0.5));
    g.setAlpha(0).setY(boss ? 170 : 150);
    this.tweens.killTweensOf(g);
    this.tweens.add({ targets: g, alpha: 1, duration: 1100, yoyo: true, hold: 2400, ease: 'Sine.easeInOut' });
  }

  /** Called by GameScene every frame during cutscenes, before input edges are consumed. */
  cutsceneInput() {
    const ty = this.typing;
    if (!ty) return;
    if (Input.pressed('confirm') || Input.pressed('attack') || Input.pressed('jump')) {
      if (ty.shown < ty.full.length) { ty.shown = ty.full.length; this.dlgText.setText(ty.full); ty.done(); }
      else if (ty.waiting) { sfx.menu(); const r = ty.resolve; this.typing = null; r(); }
    }
  }

  say(who: string, text: string, opts: any = {}) {
    const sp = World.speakers[who] ?? { name: who, pitch: 400 };
    this.dlgName.setText(sp.name ?? '').setColor(sp.color ?? '#ffcf7a');
    if (sp.portrait) this.dlgPortrait.setTexture(sp.portrait).setVisible(true); else this.dlgPortrait.setVisible(false);
    this.dlgText.setX(sp.portrait ? 272 : 160).setFontStyle(sp.italic || opts.italic ? 'italic' : 'normal');
    this.dlgName.setX(sp.portrait ? 272 : 160);
    this.dlgText.setText('');
    if (this.dlg.alpha < 1) this.tweens.add({ targets: this.dlg, alpha: 1, duration: 180 });
    return new Promise<void>((resolve) => {
      const ty = { full: text, shown: 0, speaker: sp, waiting: false, resolve: () => {}, done: () => { ty.waiting = true; } };
      ty.resolve = () => { resolve(); if (!opts.keepOpen) this.time.delayedCall(10, () => { if (!this.typing) this.tweens.add({ targets: this.dlg, alpha: 0, duration: 160 }); }); };
      this.typing = ty;
    });
  }

  async narrate(lines: string[], opts: any = {}) {
    const txt = this.add.text(W / 2, H / 2, '', { fontFamily: FONT, fontSize: '30px', color: '#e8e2ff', fontStyle: 'italic', align: 'center', wordWrap: { width: W - 300 }, lineSpacing: 10 }).setOrigin(0.5).setAlpha(0).setDepth(1001);
    for (const line of lines) {
      txt.setText(line);
      await new Promise<void>((r) => this.tweens.add({ targets: txt, alpha: 1, duration: 700, onComplete: () => r() }));
      await this.waitConfirm(opts.auto ?? 0);
      await new Promise<void>((r) => this.tweens.add({ targets: txt, alpha: 0, duration: 500, onComplete: () => r() }));
    }
    txt.destroy();
  }

  /** Wait for a confirm press (or `auto` ms). Uses a modal so the world pauses. */
  waitConfirm(auto = 0) {
    return new Promise<void>((res) => {
      let t = 0;
      this.modal = {
        update: (dt) => {
          t += dt;
          if ((t > 0.25 && (Input.pressed('confirm') || Input.pressed('attack'))) || (auto && t * 1000 > auto)) { this.modal = null; res(); }
        },
      };
    });
  }
  updateModal(dt: number) { this.modal?.update(dt); }

  async itemCard(title: string, text: string, icon?: string, hint?: string) {
    const c = this.add.container(W / 2, H / 2).setAlpha(0).setDepth(900);
    const bg = this.add.rectangle(0, 0, W, H, 0x000000, 0.6);
    const glow = this.add.image(0, -90, 'fx_light').setScale(1.3).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35).setTint(0xe9e2ff);
    const ic = icon ? this.add.image(0, -90, icon).setScale(icon === 'needle' ? 1.8 : 2.2) : null;
    if (icon === 'needle') ic!.setRotation(-0.8);
    const t1 = this.add.text(0, 10, title, { fontFamily: FONT, fontSize: '46px', color: '#f0ecff', letterSpacing: 4 } as any).setOrigin(0.5);
    const t2 = this.add.text(0, 70, text, { fontFamily: FONT, fontSize: '24px', color: '#c8c0e0', fontStyle: 'italic', align: 'center', wordWrap: { width: 800 } }).setOrigin(0.5, 0);
    const t3 = hint ? this.add.text(0, 170, hint, { fontFamily: FONT, fontSize: '22px', color: '#ffcf7a', align: 'center', wordWrap: { width: 800 } }).setOrigin(0.5, 0) : null;
    c.add([bg, glow, ...(ic ? [ic] : []), t1, t2, ...(t3 ? [t3] : [])]);
    this.tweens.add({ targets: c, alpha: 1, duration: 500 });
    this.tweens.add({ targets: glow, scale: 1.5, alpha: 0.5, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    await this.waitConfirm();
    await new Promise<void>((r) => this.tweens.add({ targets: c, alpha: 0, duration: 400, onComplete: () => r() }));
    c.destroy();
  }

  /** A remembered life: the screen goes pale and quiet, the Shade speaks in italics. */
  async memory(title: string, lines: string[], image?: string) {
    const c = this.add.container(0, 0).setAlpha(0).setDepth(950);
    const bg = this.add.rectangle(0, 0, W, H, 0x0a1424, 0.92).setOrigin(0);
    const pic = image ? this.add.image(W / 2, H / 2, image).setDisplaySize(W, H).setAlpha(0.35).setTint(0x9ad0ff) : null;
    const glow = this.add.image(W / 2, 250, 'fx_light').setScale(2.5).setTint(0xbfeaff).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD);
    const shade = this.add.image(W / 2, 250, 'shade').setScale(2.6).setAlpha(0.9);
    const t1 = this.add.text(W / 2, 110, title, { fontFamily: FONT, fontSize: '34px', color: '#dff6ff', fontStyle: 'italic', letterSpacing: 3 } as any).setOrigin(0.5);
    const t2 = this.add.text(W / 2, 430, '', { fontFamily: FONT, fontSize: '28px', color: '#dff6ff', fontStyle: 'italic', align: 'center', wordWrap: { width: 900 }, lineSpacing: 10 }).setOrigin(0.5, 0);
    c.add([bg, ...(pic ? [pic] : []), glow, shade, t1, t2]);
    this.tweens.add({ targets: c, alpha: 1, duration: 1200 });
    this.tweens.add({ targets: shade, y: 240, duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    await sleep(this, 1000);
    for (const line of lines) {
      t2.setAlpha(0).setText(line);
      await new Promise<void>((r) => this.tweens.add({ targets: t2, alpha: 1, duration: 900, onComplete: () => r() }));
      await this.waitConfirm();
      await new Promise<void>((r) => this.tweens.add({ targets: t2, alpha: 0, duration: 500, onComplete: () => r() }));
    }
    await new Promise<void>((r) => this.tweens.add({ targets: c, alpha: 0, duration: 1000, onComplete: () => r() }));
    c.destroy();
  }

  /** Full-screen painted pages with narration. `pages: {image, lines[], title?, rain?, moth?, pan?}` */
  async storybook(pages: any[], opts: any = {}) {
    const c = this.add.container(0, 0).setDepth(1100);
    const black = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0);
    c.add(black);
    let skip = false;
    for (const pg of pages) {
      if (skip) break;
      const img = this.add.image(W / 2, H / 2, pg.image).setAlpha(0);
      const pan = pg.pan ?? [1.08, 1.0, 0, 0];
      img.setScale(pan[0]);
      c.add(img);
      let rain: any = null;
      if (pg.rain) {
        rain = this.add.tileSprite(0, 0, W, H, 'rain_gen').setOrigin(0).setAlpha(0.5);
        c.add(rain);
      }
      let moth: any = null;
      if (pg.moth) { moth = this.add.image(pg.moth[0], pg.moth[1], 'relic_wings').setScale(1.4).setAlpha(0); c.add(moth); this.tweens.add({ targets: moth, alpha: 0.95, duration: 1500 }); }
      if (pg.sfx) sfx[pg.sfx]?.();
      const title = pg.title ? this.add.text(W / 2, opts.card ? H / 2 - 110 : 70, pg.title, { fontFamily: FONT, fontSize: '40px', color: '#e8e2ff', letterSpacing: 6 } as any).setOrigin(0.5).setAlpha(0) : null;
      const txt = this.add.text(W / 2, opts.card ? H / 2 - 30 : H - 110, '', { fontFamily: FONT, fontSize: '28px', color: '#f0ecff', fontStyle: 'italic', align: 'center', stroke: '#000000', strokeThickness: 6, wordWrap: { width: W - 260 }, lineSpacing: 8 }).setOrigin(0.5, opts.card ? 0 : 0.5);
      if (title) c.add(title);
      c.add(txt);
      await new Promise<void>((r) => this.tweens.add({ targets: [img, ...(title ? [title] : [])], alpha: 1, duration: 1200, onComplete: () => r() }));
      this.tweens.add({ targets: img, scale: pan[1], x: W / 2 + (pan[2] ?? 0), y: H / 2 + (pan[3] ?? 0), duration: 9000, ease: 'Sine.easeInOut' });
      const t0 = this.time.now;
      const lines: string[] = pg.lines ?? [];
      if (opts.card) { txt.setText(lines.join('\n')); txt.setAlpha(0); this.tweens.add({ targets: txt, alpha: 1, duration: 1400 }); }
      for (let i = 0; !opts.card && i < lines.length; i++) {
        txt.setAlpha(0).setText(lines[i]);
        await new Promise<void>((r) => this.tweens.add({ targets: txt, alpha: 1, duration: 700, onComplete: () => r() }));
        const res = await this.waitStory(rain, moth, t0);
        if (res === 'skip') { skip = true; break; }
        if (i < lines.length - 1) await new Promise<void>((r) => this.tweens.add({ targets: txt, alpha: 0, duration: 350, onComplete: () => r() }));
      }
      if (opts.card || !lines.length) { const res = await this.waitStory(rain, moth, t0); if (res === 'skip') skip = true; }
      await new Promise<void>((r) => this.tweens.add({ targets: c.list.filter((o: any) => o !== black), alpha: 0, duration: 700, onComplete: () => r() }));
      c.list.filter((o: any) => o !== black).forEach((o: any) => o.destroy());
    }
    // reveal the game underneath
    this.fadeRect.setAlpha(1);
    c.destroy();
  }
  private waitStory(rain: any, moth: any, t0: number) {
    return new Promise<'next' | 'skip'>((res) => {
      let t = 0;
      this.modal = {
        update: (dt) => {
          t += dt;
          if (rain) { rain.tilePositionY -= dt * 900; rain.tilePositionX += dt * 280; }
          if (moth) { const k = (this.time.now - t0) / 1000; moth.setScale(1.4, 1.4 * (0.75 + Math.abs(Math.sin(k * 7)) * 0.25)); }
          if (t > 0.4 && (Input.pressed('confirm') || Input.pressed('attack'))) { this.modal = null; sfx.menu(); res('next'); }
          else if (t > 0.2 && Input.pressed('back')) { this.modal = null; res('skip'); }
        },
      };
    });
  }

  // ------------------------------------------------------------------ map & pause
  openMap() {
    const g = this.game_;
    const c = this.add.container(0, 0).setDepth(800);
    const bg = this.add.rectangle(0, 0, W, H, 0x05040a, 0.92).setOrigin(0);
    c.add(bg);
    const area = g.room.area;
    const rooms = World.rooms.filter((r) => r.area.id === area.id);
    const minX = Math.min(...rooms.map((r) => r.x)), maxX = Math.max(...rooms.map((r) => r.x + r.w));
    const minY = Math.min(...rooms.map((r) => r.y)), maxY = Math.max(...rooms.map((r) => r.y + r.h));
    const s = Math.min((W - 200) / (maxX - minX), (H - 260) / (maxY - minY));
    const ox = W / 2 - ((maxX + minX) / 2) * s, oy = H / 2 + 20 - ((maxY + minY) / 2) * s;
    const gfx = this.add.graphics();
    c.add(gfx);
    for (const r of rooms) {
      const seen = Game.visited.has(r.id);
      if (!seen) continue;
      const cur = r === g.room;
      gfx.fillStyle(cur ? 0x3a3458 : 0x1e1a2c, 1);
      gfx.lineStyle(2, cur ? 0xffcf7a : 0xb8b0d8, cur ? 0.9 : 0.5);
      // draw the room's open space rather than a box, so shapes read like the real map
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (r.grid[y][x] !== '#') gfx.fillRect(ox + (r.x + x) * s, oy + (r.y + y) * s, Math.ceil(s), Math.ceil(s));
      gfx.strokeRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
      if (r.name) c.add(this.add.text(ox + (r.x + r.w / 2) * s, oy + (r.y + r.h) * s + 4, r.name, { fontFamily: FONT, fontSize: '14px', color: cur ? '#ffcf7a' : '#8a84a8' }).setOrigin(0.5, 0));
      for (const e of r.spawns) if (e.type === 'shrine') c.add(this.add.image(ox + (r.x + e.x! + 0.5) * s, oy + (r.y + e.y!) * s, 'flame').setScale(0.9).setBlendMode(Phaser.BlendModes.ADD));
    }
    const P = g.player;
    const dot = this.add.image(ox + (P.cx / 16) * s, oy + (P.cy / 16) * s, 'ui_paw').setScale(0.6).setTint(0xffcf7a);
    c.add(dot);
    this.tweens.add({ targets: dot, scale: 0.8, duration: 500, yoyo: true, repeat: -1 });
    c.add(this.add.text(W / 2, 50, area.name.toUpperCase(), { fontFamily: FONT, fontSize: '38px', color: '#e8e2ff', letterSpacing: 8 } as any).setOrigin(0.5));
    c.add(this.add.text(W / 2, H - 50, `Lives remembered: ${Game.save.shades.length} / 8     ·     Buttons: ${Game.save.buttons}     ·     M / Esc to close`, { fontFamily: FONT, fontSize: '20px', color: '#a8a0c8' }).setOrigin(0.5));
    sfx.menu();
    let t = 0;
    this.modal = { update: (dt) => { t += dt; if (t > 0.15 && (Input.pressed('map') || Input.pressed('back') || Input.pressed('pause'))) { this.modal = null; c.destroy(); sfx.menu(); Input.swallow(); } } };
  }

  openPause() {
    const g = this.game_;
    const c = this.add.container(0, 0).setDepth(800);
    c.add(this.add.rectangle(0, 0, W, H, 0x05040a, 0.8).setOrigin(0));
    c.add(this.add.text(W / 2, 170, 'PAUSED', { fontFamily: FONT, fontSize: '48px', color: '#e8e2ff', letterSpacing: 12 } as any).setOrigin(0.5));
    const items = ['Resume', 'Map', 'Music volume', 'Quit to title'];
    let sel = 0; let musicVol = 0.55;
    const texts = items.map((s, i) => { const t = this.add.text(W / 2, 290 + i * 60, s, { fontFamily: FONT, fontSize: '30px', color: '#b8b0d0' }).setOrigin(0.5); c.add(t); return t; });
    c.add(this.add.text(W / 2, H - 90, 'Move: ← →   Jump: Z / Space   Scratch: X   Dash: C / Shift   Rest & talk: ↑   Map: M', { fontFamily: FONT, fontSize: '19px', color: '#8a84a8' }).setOrigin(0.5));
    const draw = () => texts.forEach((t, i) => {
      t.setColor(i === sel ? '#ffcf7a' : '#b8b0d0').setText((i === sel ? '›  ' : '') + items[i] + (i === 2 ? `  ${'●'.repeat(Math.round(musicVol * 10))}${'○'.repeat(10 - Math.round(musicVol * 10))}` : '') + (i === sel ? '  ‹' : ''));
    });
    draw(); sfx.menu();
    let t = 0;
    const close = () => { this.modal = null; c.destroy(); Input.swallow(); };
    this.modal = {
      update: (dt) => {
        t += dt; if (t < 0.15) return;
        if (Input.pressed('down')) { sel = (sel + 1) % items.length; sfx.menu(); draw(); }
        if (Input.pressed('up')) { sel = (sel + items.length - 1) % items.length; sfx.menu(); draw(); }
        if (sel === 2 && (Input.pressed('left') || Input.pressed('right'))) { musicVol = clamp(musicVol + (Input.pressed('right') ? 0.1 : -0.1), 0, 1); Audio.setVolume('music', musicVol); draw(); }
        if (Input.pressed('pause') || Input.pressed('back')) { close(); return; }
        if (Input.pressed('confirm') || Input.pressed('attack')) {
          sfx.confirm();
          if (sel === 0) close();
          else if (sel === 1) { close(); this.openMap(); }
          else if (sel === 3) { close(); g.saveNow(); g.goTitle(); }
        }
      },
    };
  }
}
