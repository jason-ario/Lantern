// Lightweight pooled particles (sparks, dust, glows) and homing button-coins.
import { DEPTH, INV_ART } from '../core/config';
import { lerp, rand } from '../core/util';

interface Part { img: any; x: number; y: number; vx: number; vy: number; life: number; max: number; grav: number; size: number; coin?: boolean; homeT?: number; spin?: number }

export class Fx {
  parts: Part[] = [];
  pool: any[] = [];
  constructor(public scene: any) {}

  private get(key: string, glow: boolean) {
    const img = this.pool.pop() ?? this.scene.add.image(0, 0, key);
    img.setTexture(key).setVisible(true).setAlpha(1).setDepth(DEPTH.fx).setRotation(0).clearTint();
    img.setBlendMode(glow ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    return img;
  }

  burst(x: number, y: number, n: number, color: number, o: { spd?: number; life?: number; size?: number; grav?: number; glow?: boolean; key?: string } = {}) {
    const spd = o.spd ?? 120, life = o.life ?? 0.6, size = o.size ?? 2, grav = o.grav ?? 300;
    const key = o.key ?? (o.glow ? 'fx_dot' : 'fx_dust');
    for (let i = 0; i < n; i++) {
      if (this.parts.length > 600) return;
      const a = Math.random() * Math.PI * 2, s = spd * (0.3 + Math.random() * 0.7);
      const img = this.get(key, !!o.glow);
      img.setTint(color);
      const L = life * (0.6 + Math.random() * 0.6);
      this.parts.push({ img, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: L, max: L, grav, size: size * (0.6 + Math.random() * 0.8), spin: rand(-6, 6) });
    }
  }

  coins(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const img = this.get('button_coin', false);
      const a = -Math.PI / 2 + rand(-1.1, 1.1), s = rand(90, 190);
      this.parts.push({ img, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 6, max: 6, grav: 500, size: 0.5, coin: true, homeT: rand(0.35, 0.6) });
    }
  }

  /** Returns number of coins collected this step. */
  update(dt: number, px: number, py: number, isSolidAt: (x: number, y: number) => boolean): number {
    let got = 0;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.coin) {
        p.homeT! -= dt;
        if (p.homeT! <= 0) {
          const dx = px - p.x, dy = py - p.y, d = Math.hypot(dx, dy) || 1;
          p.vx = lerp(p.vx, (dx / d) * 320, 0.15); p.vy = lerp(p.vy, (dy / d) * 320, 0.15);
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (d < 8) { p.life = 0; got++; }
          continue;
        }
        p.vy += p.grav * dt;
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
        if (isSolidAt(nx, ny)) { p.vx *= -0.4; p.vy *= -0.4; } else { p.x = nx; p.y = ny; }
        continue;
      }
      p.vy += p.grav * dt; p.vx *= 0.985;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (p.life <= 0) { p.img.setVisible(false); this.pool.push(p.img); this.parts.splice(i, 1); }
    }
    return got;
  }

  render(dt: number) {
    for (const p of this.parts) {
      const k = Math.max(0, p.life / p.max);
      p.img.setPosition(p.x, p.y);
      if (p.coin) { p.img.setScale(INV_ART * 0.55).setRotation(p.img.rotation + dt * 8); continue; }
      p.img.setScale((p.size / 16) * (0.4 + k * 0.6) * 2).setAlpha(Math.min(1, k * 1.5));
      p.img.setRotation(p.img.rotation + (p.spin ?? 0) * dt);
    }
  }

  lights() { return this.parts.filter((p) => p.coin).map((p) => ({ x: p.x, y: p.y, r: 10, color: 0xffe0a0, a: 0.35 })); }

  clear() { for (const p of this.parts) { p.img.setVisible(false); this.pool.push(p.img); } this.parts = []; }
}
