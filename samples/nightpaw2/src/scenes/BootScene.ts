// Loads the art manifest + every painted PNG, the content JSON, and the save.
import { SCREEN_W, SCREEN_H } from '../core/config';
import { World } from '../world/world';
import { Platform } from '../core/platform';
import { Game } from '../core/state';
import { FONT } from './UIScene';

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }
  preload() {
    const bar = this.add.rectangle(SCREEN_W / 2 - 200, SCREEN_H / 2, 0, 3, 0xe8e2ff).setOrigin(0, 0.5);
    this.add.rectangle(SCREEN_W / 2, SCREEN_H / 2, 400, 3, 0xffffff, 0.12);
    this.add.text(SCREEN_W / 2, SCREEN_H / 2 - 30, 'NIGHTPAW', { fontFamily: FONT, fontSize: '28px', color: '#8a84a8', letterSpacing: 10 } as any).setOrigin(0.5);
    this.load.on('progress', (p: number) => { bar.width = 400 * p; });
    this.load.json('art', 'assets/art/art.json');
    this.load.once('filecomplete-json-art', (_k: string, _t: string, data: Record<string, any>) => {
      for (const key of Object.keys(data)) this.load.image(key, `assets/art/${key}.png`);
    });
  }
  async create() {
    // procedural rain streaks (tileable) for storybook pages
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const c = cv.getContext('2d')!;
    c.strokeStyle = 'rgba(200,210,255,0.35)'; c.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) { const x = Math.random() * 256, y = Math.random() * 256, l = 14 + Math.random() * 20; for (const ox of [0, 256, -256]) for (const oy of [0, 256, -256]) { c.beginPath(); c.moveTo(x + ox, y + oy); c.lineTo(x + ox - l * 0.3, y + oy + l); c.stroke(); } }
    this.textures.addCanvas('rain_gen', cv);

    try {
      await World.load();
    } catch (e: any) {
      this.add.text(40, 40, 'Could not load game content:\n' + e.message, { fontFamily: 'monospace', fontSize: '20px', color: '#ff8080' });
      return;
    }
    await Platform.init();
    await Game.loadFromPlatform();
    const q = new URLSearchParams(location.search);
    if (q.get('room')) {
      Game.startNew();
      for (const a of (q.get('abilities') ?? '').split(',').filter(Boolean)) Game.give(a);
      for (const f of (q.get('flags') ?? '').split(',').filter(Boolean)) Game.setFlag(f);
      this.scene.start('game', {});
      return;
    }
    this.scene.start('title');
  }
}
