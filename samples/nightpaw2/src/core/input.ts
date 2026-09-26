// Keyboard + gamepad + on-screen touch → one action map.
// `pressed` is edge-triggered per fixed update step; a tap shorter than one frame still registers.
import { Audio } from './audio';

export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'attack' | 'dash' | 'map' | 'pause' | 'confirm' | 'back';

const BIND: Record<Action, string[]> = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ', 'KeyK'], attack: ['KeyX', 'KeyJ'], dash: ['KeyC', 'KeyL', 'ShiftLeft', 'ShiftRight'],
  map: ['KeyM', 'Tab'], pause: ['Escape', 'KeyP'], confirm: ['Enter', 'Space', 'KeyZ', 'KeyK', 'KeyX', 'KeyJ'], back: ['Escape', 'Backspace'],
};
const ACTIONS = Object.keys(BIND) as Action[];

const keys: Record<string, boolean> = {};
const latch: Record<string, boolean> = {};
const touch: Record<string, boolean> = {};
let cur: Partial<Record<Action, boolean>> = {};
let prev: Partial<Record<Action, boolean>> = {};
let padCache: Partial<Record<Action, boolean>> = {};
let usingPad = false;

function readPad(): Partial<Record<Action, boolean>> {
  const out: Partial<Record<Action, boolean>> = {};
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...(pads as any)].find((p: any) => p && p.connected);
  if (!gp) return out;
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
  out.left = ax < -0.4 || b(14); out.right = ax > 0.4 || b(15);
  out.up = ay < -0.5 || b(12); out.down = ay > 0.5 || b(13);
  out.jump = b(0); out.attack = b(2); out.dash = b(1) || b(5) || b(7);
  out.map = b(8) || b(3); out.pause = b(9); out.confirm = b(0) || b(9); out.back = b(1);
  if (Object.values(out).some(Boolean)) usingPad = true;
  return out;
}

export const Input = {
  init() {
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true; if (!e.repeat) latch[e.code] = true; usingPad = false; Audio.unlock();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
    window.addEventListener('pointerdown', () => Audio.unlock());
    const ui = document.getElementById('touch');
    if (ui) {
      if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) ui.hidden = false;
      ui.querySelectorAll('button').forEach((btn) => {
        const k = (btn as HTMLElement).dataset.k!;
        const on = (e: Event) => { e.preventDefault(); touch[k] = true; latch[`touch:${k}`] = true; btn.classList.add('on'); Audio.unlock(); };
        const off = (e: Event) => { e.preventDefault(); touch[k] = false; btn.classList.remove('on'); };
        btn.addEventListener('pointerdown', on);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, off));
      });
    }
  },
  /** Call once per rendered frame before running fixed steps. */
  poll() {
    padCache = readPad();
    cur = {};
    for (const a of ACTIONS) cur[a] = BIND[a].some((k) => keys[k] || latch[k]) || !!touch[a] || !!latch[`touch:${a}`] || !!padCache[a];
    if (touch.jump || latch['touch:jump']) cur.confirm = true;
    if (touch.pause || latch['touch:pause']) cur.back = true;
  },
  /** Call after a fixed step consumed input. */
  endStep() {
    prev = { ...cur };
    for (const k in latch) delete latch[k];
    for (const a of ACTIONS) if (cur[a] && !BIND[a].some((k) => keys[k]) && !touch[a] && !padCache[a]) cur[a] = false;
  },
  held: (a: Action) => !!cur[a],
  pressed: (a: Action) => !!cur[a] && !prev[a],
  released: (a: Action) => !cur[a] && !!prev[a],
  get usingPad() { return usingPad; },
  /** Clear edges so a press that closed a menu doesn't also act in-game. */
  swallow() { prev = { ...cur, ...Object.fromEntries(ACTIONS.map((a) => [a, true])) }; for (const k in latch) delete latch[k]; },
};
