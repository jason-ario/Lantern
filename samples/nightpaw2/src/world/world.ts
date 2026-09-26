// The world: all rooms from all areas placed on one big tile grid.
// Moving past a room's edge puts you in whichever room occupies that spot — so
// adding a room anywhere on the grid "just connects" if the openings line up.
import { T, PH } from '../core/config';
import type { AreaDef, RoomDef, EntityDef, WorldDef, CutsceneDef, SpeakerDef } from '../content/types';
import { Game } from '../core/state';

export const DEFAULT_LEGEND: Record<string, EntityDef> = {
  P: { type: 'spawn' },
  S: { type: 'shrine' },
  c: { type: 'mite' },
  w: { type: 'sockwisp' },
  s: { type: 'snail' },
  t: { type: 'toad' },
  g: { type: 'jar' },
  o: { type: 'coin' },
  B: { type: 'warden' },
  G: { type: 'gate', flag: 'warden_dead' },
};

export interface Room extends RoomDef {
  area: AreaDef;
  grid: string[][];
  w: number; h: number; // tiles
  px: number; py: number; pw: number; ph: number; // world units
  spawns: EntityDef[];
}

export const World = {
  def: null as unknown as WorldDef,
  areas: [] as AreaDef[],
  rooms: [] as Room[],
  byId: new Map<string, Room>(),
  cutscenes: new Map<string, CutsceneDef>(),
  speakers: {} as Record<string, SpeakerDef>,

  async load(base = 'content/') {
    const j = async (p: string) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`Missing content: ${p}`); return r.json(); };
    this.def = await j('world.json');
    this.speakers = await j('speakers.json');
    this.areas = await Promise.all(this.def.areas.map((a) => j(`areas/${a}.json`)));
    const cs: CutsceneDef[][] = await Promise.all(this.def.cutscenes.map((c) => j(`cutscenes/${c}.json`)));
    cs.flat().forEach((c) => this.cutscenes.set(c.id, c));
    this.rooms = [];
    for (const area of this.areas) for (const rd of area.rooms) this.rooms.push(buildRoom(rd, area));
    this.byId = new Map(this.rooms.map((r) => [r.id, r]));
  },

  roomAt(px: number, py: number): Room | null {
    for (const r of this.rooms) if (px >= r.px && px < r.px + r.pw && py >= r.py && py < r.py + r.ph) return r;
    return null;
  },
};

function buildRoom(rd: RoomDef, area: AreaDef): Room {
  const legend = { ...DEFAULT_LEGEND, ...(area.legend || {}), ...(rd.legend || {}) };
  const grid: string[][] = [];
  const spawns: EntityDef[] = [];
  const w = Math.max(...rd.rows.map((r) => r.length));
  rd.rows.forEach((row, y) => {
    const line: string[] = [];
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      if ('#=^.X'.includes(ch)) line.push(ch === 'X' ? 'X' : ch);
      else if (legend[ch]) { spawns.push({ ...legend[ch], x, y, id: legend[ch].id ?? `${rd.id}:${x},${y}` }); line.push('.'); }
      else line.push('.');
    }
    grid.push(line);
  });
  for (const e of rd.entities || []) spawns.push({ ...e, id: e.id ?? `${rd.id}:${e.type}:${e.x},${e.y}` });
  const h = grid.length;
  return { ...rd, area, grid, spawns, w, h, px: rd.x * T, py: rd.y * T, pw: w * T, ph: h * T };
}

// ---------------------------------------------------------------------------
// Tiles & collision
// ---------------------------------------------------------------------------
let current: Room | null = null;
export function setCurrentRoom(r: Room) { current = r; }

/** Tile at world tile coords (searches the current room first, then all rooms). */
export function tileAt(tx: number, ty: number): string {
  let r = current;
  if (!r || tx < r.x || tx >= r.x + r.w || ty < r.y || ty >= r.y + r.h) {
    r = null;
    for (const q of World.rooms) if (tx >= q.x && tx < q.x + q.w && ty >= q.y && ty < q.y + q.h) { r = q; break; }
  }
  if (!r) return '#';
  const ch = r.grid[ty - r.y][tx - r.x];
  if (ch === 'X' && Game.taken.has(`wall:${r.id}:${tx - r.x},${ty - r.y}`)) return '.';
  return ch;
}
export const isSolid = (ch: string) => ch === '#' || ch === 'X';

export interface Body { x: number; y: number; w: number; h: number; vx: number; vy: number; onGround?: boolean; hitX?: boolean; hitCeil?: boolean; landed?: boolean; dropT?: number; noPlatforms?: boolean }

/** Axis-separated tile collision (ported from Nightpaw 1.0). */
export function moveBody(e: Body, dt: number) {
  e.hitX = false; e.hitCeil = false;
  if (e.vx) {
    e.x += e.vx * dt;
    const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.01) / T);
    if (e.vx > 0) {
      const tx = Math.floor((e.x + e.w) / T);
      for (let ty = y0; ty <= y1; ty++) if (isSolid(tileAt(tx, ty))) { e.x = tx * T - e.w; e.hitX = true; break; }
    } else {
      const tx = Math.floor(e.x / T);
      for (let ty = y0; ty <= y1; ty++) if (isSolid(tileAt(tx, ty))) { e.x = (tx + 1) * T; e.hitX = true; break; }
    }
  }
  const prevBottom = e.y + e.h;
  e.y += e.vy * dt;
  const wasGround = e.onGround;
  e.onGround = false;
  const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.01) / T);
  if (e.vy > 0) {
    const ty = Math.floor((e.y + e.h) / T);
    for (let tx = x0; tx <= x1; tx++) {
      const ch = tileAt(tx, ty);
      if (isSolid(ch) || (ch === '=' && !e.noPlatforms && prevBottom <= ty * T + 0.5 && !((e.dropT ?? 0) > 0))) {
        e.y = ty * T - e.h; e.vy = 0; e.onGround = true; break;
      }
    }
  } else if (e.vy < 0) {
    const ty = Math.floor(e.y / T);
    for (let tx = x0; tx <= x1; tx++) if (isSolid(tileAt(tx, ty))) { e.y = (ty + 1) * T; e.vy = 0; e.hitCeil = true; break; }
  }
  e.landed = !!e.onGround && !wasGround;
}

export function boxHasTile(x: number, y: number, w: number, h: number, pred: (ch: string, tx: number, ty: number) => boolean) {
  for (let tx = Math.floor(x / T); tx <= Math.floor((x + w - 0.01) / T); tx++)
    for (let ty = Math.floor(y / T); ty <= Math.floor((y + h - 0.01) / T); ty++) if (pred(tileAt(tx, ty), tx, ty)) return true;
  return false;
}

/** Row index of the first floor at or below (sx, sy) in room-local tiles. */
export function groundBelow(r: Room, sx: number, sy: number) {
  for (let yy = sy + 1; yy < r.h; yy++) { const ch = r.grid[yy][sx]; if (ch === '#' || ch === '=' || ch === 'X') return yy; }
  return sy + 1;
}

export const GRAVITY = PH.G;
