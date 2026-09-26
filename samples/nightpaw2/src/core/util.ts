export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const approach = (v: number, target: number, amt: number) => (v < target ? Math.min(target, v + amt) : Math.max(target, v - amt));
/** Frame-rate independent smoothing toward target. k = responsiveness (1/s). */
export const damp = (v: number, target: number, k: number, dt: number) => lerp(v, target, 1 - Math.exp(-k * dt));

export interface Box { x: number; y: number; w: number; h: number }
export const overlap = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function seeded(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sleep = (scene: any, ms: number) => new Promise<void>((res) => scene.time.delayedCall(ms, res));
