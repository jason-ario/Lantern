// Puppet rigs: characters built from separate painted parts in a hierarchy
// (e.g. body → head → ear), posed every frame by code. This gives the soft,
// tween-driven "paper puppet" animation style and lets artists replace any part PNG.
import { INV_ART } from '../core/config';

export interface PartDef {
  name: string;
  key?: string; // texture key; omit for an empty pivot
  x: number; y: number; // position in art px relative to parent pivot
  ox?: number; oy?: number; // texture origin (0..1)
  rot?: number; sx?: number; sy?: number;
  alpha?: number;
  add?: boolean; // additive blend (glows)
  behind?: PartDef[]; // children drawn behind this part's image
  front?: PartDef[]; // children drawn in front
}

interface PartRuntime { obj: any; img: any | null; base: { x: number; y: number; rot: number; sx: number; sy: number } }

export class Puppet {
  root: any;
  inner: any; // extra container for squash/stretch around the feet
  parts: Record<string, PartRuntime> = {};
  images: any[] = [];
  face = 1;
  scale: number;

  constructor(public scene: any, def: PartDef, scale = 1, depth = 0) {
    this.scale = scale;
    this.root = scene.add.container(0, 0).setDepth(depth);
    this.inner = scene.add.container(0, 0);
    this.root.add(this.inner);
    this.inner.add(this.build(def));
    this.root.setScale(INV_ART * scale);
  }

  private build(d: PartDef): any {
    const s = this.scene;
    const hasKids = (d.behind?.length || 0) + (d.front?.length || 0) > 0;
    let img: any = null;
    if (d.key) {
      img = s.add.image(0, 0, d.key).setOrigin(d.ox ?? 0.5, d.oy ?? 0.5);
      if (d.add) img.setBlendMode(Phaser.BlendModes.ADD);
      if (d.alpha !== undefined) img.setAlpha(d.alpha);
      this.images.push(img);
    }
    let obj: any;
    if (hasKids || !img) {
      obj = s.add.container(d.x, d.y);
      (d.behind || []).forEach((c) => obj.add(this.build(c)));
      if (img) obj.add(img);
      (d.front || []).forEach((c) => obj.add(this.build(c)));
    } else {
      obj = img; img.setPosition(d.x, d.y);
    }
    obj.setRotation(d.rot ?? 0);
    obj.setScale(d.sx ?? 1, d.sy ?? 1);
    this.parts[d.name] = { obj, img, base: { x: d.x, y: d.y, rot: d.rot ?? 0, sx: d.sx ?? 1, sy: d.sy ?? 1 } };
    return obj;
  }

  /** Pose a part relative to its rest pose. */
  set(name: string, p: { x?: number; y?: number; rot?: number; sx?: number; sy?: number; alpha?: number; visible?: boolean }) {
    const r = this.parts[name]; if (!r) return;
    const b = r.base;
    if (p.x !== undefined || p.y !== undefined) r.obj.setPosition(b.x + (p.x ?? 0), b.y + (p.y ?? 0));
    if (p.rot !== undefined) r.obj.setRotation(b.rot + p.rot);
    if (p.sx !== undefined || p.sy !== undefined) r.obj.setScale(b.sx * (p.sx ?? 1), b.sy * (p.sy ?? 1));
    if (p.alpha !== undefined) r.obj.setAlpha(p.alpha);
    if (p.visible !== undefined) r.obj.setVisible(p.visible);
  }
  get(name: string) { return this.parts[name]?.obj; }

  place(x: number, y: number, face = this.face) {
    this.face = face;
    this.root.setPosition(x, y);
    this.root.setScale(INV_ART * this.scale * face, INV_ART * this.scale);
  }
  /** Squash & stretch around the feet. */
  squash(sx: number, sy: number) { this.inner.setScale(sx, sy); }
  lean(rot: number) { this.inner.setRotation(rot); }

  flash(on: boolean, color = 0xffffff) {
    for (const i of this.images) { if (on) i.setTintFill(color); else i.clearTint(); }
  }
  tint(color: number | null) { for (const i of this.images) { if (color === null) i.clearTint(); else i.setTint(color); } }
  setAlpha(a: number) { this.root.setAlpha(a); }
  setVisible(v: boolean) { this.root.setVisible(v); }
  setDepth(d: number) { this.root.setDepth(d); }
  destroy() { this.root.destroy(); }
}

/** Build a tail/rope of nested segments; each child hangs off the previous one. */
export function chain(prefix: string, key: string, n: number, step: number, scale0 = 1, scale1 = 0.6, ox = 0.5, oy = 0.5, vertical = false): PartDef {
  let node: PartDef | null = null;
  for (let i = n - 1; i >= 0; i--) {
    const s = scale0 + (scale1 - scale0) * (i / Math.max(1, n - 1));
    const d: PartDef = { name: `${prefix}${i}`, key, x: i === 0 || vertical ? 0 : -step, y: i > 0 && vertical ? step : 0, ox, oy, sx: s / (i === 0 ? 1 : (scale0 + (scale1 - scale0) * ((i - 1) / Math.max(1, n - 1)))), sy: 0 };
    d.sy = d.sx;
    if (node) d.behind = [node];
    node = d;
  }
  return node!;
}
