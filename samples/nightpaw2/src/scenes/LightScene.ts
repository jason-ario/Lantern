// Darkness + light: a screen-sized render texture filled with darkness, with soft holes
// erased at every light, plus an additive colour glow. Foreground silhouettes sit on top.
import { SCREEN_W, SCREEN_H, ZOOM } from '../core/config';
import { damp } from '../core/util';

const RES = 2;

export class LightScene extends Phaser.Scene {
  rt: any; glow: any; brush: any; fg: any; vig: any;
  dark = 0.55; darkTarget = 0.55;
  constructor() { super('light'); }
  create() {
    // Lights are soft, so both buffers render at half resolution and are scaled up.
    this.rt = this.add.renderTexture(0, 0, SCREEN_W / RES, SCREEN_H / RES).setOrigin(0).setScale(RES);
    this.glow = this.add.renderTexture(0, 0, SCREEN_W / RES, SCREEN_H / RES).setOrigin(0).setScale(RES).setBlendMode(Phaser.BlendModes.ADD);
    this.brush = this.make.image({ key: 'fx_light', add: false });
    this.fg = this.add.tileSprite(0, -20, SCREEN_W, 256, 'hol_fg').setOrigin(0).setTileScale(1.4).setAlpha(0.95);
    // vignette
    const key = 'vignette_gen';
    if (!this.textures.exists(key)) {
      const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
      const c = cv.getContext('2d')!;
      const g = c.createRadialGradient(320, 180, 120, 320, 180, 380);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
      c.fillStyle = g; c.fillRect(0, 0, 640, 360);
      this.textures.addCanvas(key, cv);
    }
    this.vig = this.add.image(0, 0, key).setOrigin(0).setDisplaySize(SCREEN_W, SCREEN_H);
  }
  setDark(d: number) { this.darkTarget = d; }
  pool: any[][] = [];
  brushPair(i: number) {
    if (!this.pool[i]) this.pool[i] = [this.make.image({ key: 'fx_light', add: false }), this.make.image({ key: 'fx_light', add: false })];
    return this.pool[i];
  }
  update(_t: number, deltaMs: number) {
    const game: any = this.scene.get('game');
    if (!game || !game.lightList) return;
    const dt = deltaMs / 1000;
    this.dark = damp(this.dark, this.darkTarget, 2, dt);
    const cam = game.cameras.main;
    const mx = cam.midPoint.x, my = cam.midPoint.y;
    const toX = (x: number) => ((x - mx) * ZOOM + SCREEN_W / 2) / RES;
    const toY = (y: number) => ((y - my) * ZOOM + SCREEN_H / 2) / RES;
    this.rt.clear();
    this.rt.fill(0x05040a, this.dark);
    this.glow.clear();
    // Batch every light into one erase + one draw call (per-call flushes are expensive).
    const holes: any[] = [], glows: any[] = [];
    let n = 0;
    for (const l of game.lightList) {
      const sx = toX(l.x), sy = toY(l.y), r = (l.r * ZOOM) / RES;
      if (sx < -r || sy < -r || sx > SCREEN_W / RES + r || sy > SCREEN_H / RES + r) continue;
      const scale = (r * 2) / 256;
      const [h, g] = this.brushPair(n++);
      h.setPosition(sx, sy).setScale(scale).setAlpha(Math.min(1, l.a * 1.3));
      g.setPosition(sx, sy).setScale(scale * 0.8).setAlpha(l.a * 0.28).setTint(l.color);
      holes.push(h); glows.push(g);
    }
    if (holes.length) { this.rt.erase(holes); this.glow.draw(glows); }
    const room = game.room;
    const showFg = room && room.area && room.area.backdrop.fg;
    this.fg.setVisible(!!showFg);
    if (showFg) {
      this.fg.tilePositionX = (mx * ZOOM * 1.25) / 1.4;
      // only hang from the ceiling near the top of the room
      const topScreen = toY(room.py) * RES;
      this.fg.setY(topScreen - 40); this.fg.setVisible(topScreen > -220);
    }
  }
}
