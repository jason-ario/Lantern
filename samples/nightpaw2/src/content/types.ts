// Content schema. Areas, rooms, cutscenes and speakers are JSON files under content/.
// See README "Adding content" for how to extend the map.

/** An entity placed in a room. Positions are in tiles, relative to the room's top-left. */
export interface EntityDef {
  type: string;
  x?: number;
  y?: number;
  id?: string; // unique id for one-shot things (pickups, npcs); auto-generated if missing
  [prop: string]: any;
}

export interface RoomDef {
  id: string;
  name?: string; // shown on the map
  x: number; // world position in tiles
  y: number;
  rows: string[]; // tile map. '#' rock, '=' one-way platform, '^' thorns, 'X' cracked wall, '.' air; other chars = legend entities
  legend?: Record<string, EntityDef>; // per-room legend, merged over the area + default legend
  entities?: EntityDef[]; // extra entities with explicit tile coords
  dark?: number; // 0..1 darkness override
  music?: string;
  ambience?: string;
  onEnter?: string; // cutscene id, runs once per visit when condition passes
  onEnterIf?: string;
  decor?: number; // amount of automatic decoration (0 = none, 1 = default)
  camera?: { lockY?: boolean };
}

export interface AreaDef {
  id: string;
  name: string;
  subtitle?: string;
  tileset: string; // art prefix, e.g. "hol" → hol_rock, hol_top, ...
  backdrop: { far: string; mid: string; fg?: string; tint?: number; fog?: boolean };
  dark: number; // default darkness 0..1
  music?: string;
  ambience?: string;
  legend?: Record<string, EntityDef>;
  rooms: RoomDef[];
}

export interface WorldDef {
  title: string;
  areas: string[]; // files in content/areas/
  cutscenes: string[]; // files in content/cutscenes/
  start: { room: string; x: number; y: number; cutscene?: string };
  demoEndFlag?: string;
}

export type Step = { do: string; [k: string]: any };
export interface CutsceneDef { id: string; steps: Step[]; skippable?: boolean }

export interface SpeakerDef { name: string; portrait?: string; pitch: number; voice?: 'soft' | 'squeak' | 'deep' | 'echo'; color?: string; italic?: boolean }
