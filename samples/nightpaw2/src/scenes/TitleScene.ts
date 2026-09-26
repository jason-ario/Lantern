// Title screen: the well in the garden under the moon.
import { SCREEN_W as W, SCREEN_H as H } from '../core/config';
import { Input } from '../core/input';
import { sfx, Music, Audio } from '../core/audio';
import { Game } from '../core/state';
import { World } from '../world/world';
import { FONT } from './UIScene';

export class TitleScene extends Phaser.Scene {
  items: { label: string; act: () => void }[] = [];
  texts: any[] = [];
  sel = 0;
  confirmNew = false;
  motes: any[] = [];
  t = 0;
  hint: any;
  constructor() { super('title'); }
  create() {
    this.cameras.main.fadeIn(1200, 0, 0, 0);
    const bg = this.add.image(W / 2, H / 2, 'title_bg').setScale(1.06);
    this.tweens.add({ targets: bg, scale: 1.0, x: W / 2 - 20, duration: 20000, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
    for (let i = 0; i < 26; i++) {
      const m = this.add.image(Math.random() * W, 300 + Math.random() * 420, 'fx_dot').setTint(0xffcf7a).setBlendMode(Phaser.BlendModes.ADD).setScale(0.3 + Math.random() * 0.4).setAlpha(0);
      (m as any).seed = Math.random() * 100; this.motes.push(m);
    }
    const title = this.add.text(360, 210, 'NIGHTPAW', { fontFamily: FONT, fontSize: '104px', color: '#f0ecff', letterSpacing: 18, stroke: '#07060a', strokeThickness: 4 } as any).setOrigin(0.5).setAlpha(0);
    title.setShadow(0, 0, '#9d8cff', 26, false, true);
    const sub = this.add.text(360, 290, 'a tale from the Underneath', { fontFamily: FONT, fontSize: '28px', color: '#b8b0d8', fontStyle: 'italic' }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, duration: 2200, delay: 400 });
    this.tweens.add({ targets: sub, alpha: 1, duration: 2200, delay: 1200 });

    const saved = Game.loaded && (Game.loaded.visited?.length || Game.loaded.flags?.intro_done);
    this.items = [];
    if (saved) this.items.push({ label: 'Continue', act: () => this.continueGame() });
    this.items.push({ label: 'New Game', act: () => this.newGame(!!saved) });
    this.texts = this.items.map((it, i) => this.add.text(360, 400 + i * 58, it.label, { fontFamily: FONT, fontSize: '32px', color: '#b8b0d0' }).setOrigin(0.5).setAlpha(0).setInteractive({ useHandCursor: true })
      .on('pointerover', () => { this.sel = i; this.draw(); })
      .on('pointerdown', () => { this.sel = i; this.activate(); }));
    this.texts.forEach((t, i) => this.tweens.add({ targets: t, alpha: 1, duration: 1200, delay: 2000 + i * 200 }));
    this.hint = this.add.text(360, H - 60, 'Arrow keys / stick to choose · Z or Enter to begin', { fontFamily: FONT, fontSize: '18px', color: '#7a7498' }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: this.hint, alpha: 1, duration: 1200, delay: 2600 });
    this.draw();
    Music.play('rhyme'); Audio.ambience('rain');
    this.input.keyboard?.on('keydown', () => Audio.unlock());
  }
  draw() {
    this.texts.forEach((t, i) => t.setColor(i === this.sel ? '#ffcf7a' : '#b8b0d0').setText((i === this.sel ? '›  ' : '') + (this.confirmNew && this.items[i].label === 'New Game' ? 'Start over? Press again' : this.items[i].label) + (i === this.sel ? '  ‹' : '')));
  }
  activate() {
    sfx.confirm();
    this.items[this.sel].act();
  }
  newGame(hasSave: boolean) {
    if (hasSave && !this.confirmNew) { this.confirmNew = true; this.draw(); return; }
    Game.startNew();
    this.go({ cutscene: World.def.start.cutscene });
  }
  continueGame() {
    Game.resume(Game.loaded!);
    this.go({ continue: true });
  }
  go(data: any) {
    this.input.enabled = false;
    this.items = [];
    Music.stop();
    this.cameras.main.fadeOut(900, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('game', data));
  }
  update(_t: number, deltaMs: number) {
    const dt = deltaMs / 1000; this.t += dt;
    for (const m of this.motes) { const s = (m as any).seed; m.x += Math.sin(this.t * 0.5 + s) * 0.4; m.y -= 0.15 + Math.sin(s) * 0.05; m.setAlpha(0.3 + Math.sin(this.t * 1.5 + s) * 0.3); if (m.y < 250) m.y = 720; }
    Input.poll();
    if (this.items.length) {
      if (Input.pressed('down')) { this.sel = (this.sel + 1) % this.items.length; this.confirmNew = false; sfx.menu(); this.draw(); }
      if (Input.pressed('up')) { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.confirmNew = false; sfx.menu(); this.draw(); }
      if (Input.pressed('confirm') || Input.pressed('attack')) this.activate();
    }
    Input.endStep();
  }
}
