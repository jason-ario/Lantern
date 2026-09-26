// Nightpaw — entry point.
import { SCREEN_W, SCREEN_H } from './core/config';
import { Input } from './core/input';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { BackdropScene } from './scenes/BackdropScene';
import { GameScene } from './scenes/GameScene';
import { LightScene } from './scenes/LightScene';
import { UIScene } from './scenes/UIScene';

Input.init();

// Scene order = draw order: backdrop under the world, light and UI over it.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: SCREEN_W,
  height: SCREEN_H,
  backgroundColor: '#07060a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, pixelArt: false, roundPixels: false, powerPreference: 'high-performance' },
  fps: { target: 60, smoothStep: true },
  input: { gamepad: false },
  audio: { noAudio: true },
  scene: [BootScene, TitleScene, BackdropScene, GameScene, LightScene, UIScene],
});
