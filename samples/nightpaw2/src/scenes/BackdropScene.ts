// Parallax background layers behind the game world (screen space, zoom 1).
import { SCREEN_W, SCREEN_H, ZOOM } from '../core/config';
import type { AreaDef } from '../content/types';
import type { Room } from '../world/world';

export class BackdropScene extends Phaser.Scene {
  far: any; mid: any; fog: any; fog2: any; tint: any;
  area = '';
  t = 0;
  roomY = 0;
  constructor() { super('backdrop'); }
  create() {
    this.cameras.main.setBackgroundColor('#07060a');
    this.far = this.add.tileSprite(0, 0, SCREEN_W, SCREEN_H, '__DEFAULT').setOrigin(0);
    this.mid = this.add.tileSprite(0, 0, SCREEN_W, SCREEN_H, '__DEFAULT').setOrigin(0).setAlpha(0.95);
    this.fog = this.add.tileSprite(0, SCREEN_H - 300, SCREEN_W, 300, 'fog').setOrigin(0).setAlpha(0.45).setTileScale(2.5, 2.4);
    this.fog2 = this.add.tileSprite(0, SCREEN_H * 0.25, SCREEN_W, 260, 'fog').setOrigin(0).setAlpha(0.22).setTileScale(3, 2);
  }
  setArea(a: AreaDef, r: Room) {
    this.roomY = r.py;
    if (a.id === this.area) return;
    this.area = a.id;
    const scaleFor = (key: string) => { const h = this.textures.get(key).getSourceImage().height; return (SCREEN_H * 1.2) / h; };
    this.far.setTexture(a.backdrop.far); this.far.setTileScale(scaleFor(a.backdrop.far));
    this.mid.setTexture(a.backdrop.mid); this.mid.setTileScale(scaleFor(a.backdrop.mid));
    this.far.setTint(a.backdrop.tint ?? 0x6c6690); this.far.setAlpha(0.8);
    this.mid.setTint(0x55506e); this.mid.setAlpha(0.8);
    this.fog.setVisible(a.backdrop.fog !== false); this.fog2.setVisible(a.backdrop.fog !== false);
  }
  follow(camX: number, camY: number, dt: number) {
    if (!this.far) return;
    this.t += dt;
    const fs = this.far.tileScaleX, ms = this.mid.tileScaleX;
    this.far.tilePositionX = (camX * ZOOM * 0.12) / fs;
    this.mid.tilePositionX = (camX * ZOOM * 0.35) / ms;
    // gentle vertical parallax, limited so the painted layers never tile vertically
    const dy = Math.max(-60, Math.min(60, (camY - this.roomY - 100) * ZOOM * 0.05));
    this.far.tilePositionY = (40 + dy * 0.5) / fs;
    this.mid.tilePositionY = (60 + dy) / ms;
    this.fog.tilePositionX = (camX * ZOOM * 0.6) / 2.5 + this.t * 6;
    this.fog2.tilePositionX = (camX * ZOOM * 0.25) / 3 - this.t * 4;
  }
}
