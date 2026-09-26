// Global tuning. World units: 1 tile = 16 units. Art is painted at ART px per unit.
export const T = 16;
export const ART = 4; // art pixels per world unit
export const INV_ART = 1 / ART;
export const SCREEN_W = 1280;
export const SCREEN_H = 720;
export const ZOOM = 4.2; // screen px per world unit → view ≈ 305 x 171 units
export const VIEW_W = SCREEN_W / ZOOM;
export const VIEW_H = SCREEN_H / ZOOM;
export const STEP = 1 / 120;

// Player physics (ported from Nightpaw 1.0 so the feel is unchanged).
export const PH = {
  G: 1150, JUMP: 345, JUMP2: 305, RUN: 108, MAXFALL: 430, DASH: 330, DASHT: 0.22,
  COYOTE: 0.09, BUFFER: 0.12, POGO: 300,
};

export const SAVE_KEY = 'save2';
export const SAVE_VERSION = 2;

// Depth layers inside the game scene.
export const DEPTH = {
  bgDecor: 0, room: 10, decor: 20, props: 30, npc: 40, enemy: 50, player: 60, fx: 70, fgDecor: 80, lightGlow: 90,
};
