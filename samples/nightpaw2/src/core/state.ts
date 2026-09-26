// Persistent game progress. Everything the player keeps between sessions lives in `SaveData`.
// Story progress uses free-form string flags so new areas can add beats without schema changes.
import { SAVE_KEY, SAVE_VERSION } from './config';
import { Platform } from './platform';

export interface SaveData {
  v: number;
  flags: Record<string, boolean | number | string>;
  abilities: Record<string, boolean>; // needle, dash, wings, ...
  maxHp: number;
  hp: number;
  buttons: number; // currency
  visited: string[]; // room ids
  taken: string[]; // collected pickup ids / broken walls / one-shot things
  shades: string[]; // lost lives recovered
  shrine: { room: string; x: number; y: number } | null;
  pos: { room: string; x: number; y: number } | null;
  deaths: number;
  playSeconds: number;
  savedAt: number;
}

export function newSave(): SaveData {
  return {
    v: SAVE_VERSION, flags: {}, abilities: {}, maxHp: 4, hp: 4, buttons: 0,
    visited: [], taken: [], shades: [], shrine: null, pos: null, deaths: 0, playSeconds: 0, savedAt: 0,
  };
}

function migrate(d: any): SaveData | null {
  if (!d || typeof d !== 'object') return null;
  const base = newSave();
  return { ...base, ...d, flags: { ...(d.flags || {}) }, abilities: { ...(d.abilities || {}) } };
}

const unlocked = new Set<string>();

export const Game = {
  save: newSave(),
  loaded: null as SaveData | null,
  visited: new Set<string>(),
  taken: new Set<string>(),
  saving: false,
  saveAgain: false,
  onSaved: [] as (() => void)[],

  startNew() {
    this.save = newSave();
    this.visited = new Set();
    this.taken = new Set();
  },
  resume(d: SaveData) {
    this.save = JSON.parse(JSON.stringify(d));
    this.visited = new Set(d.visited);
    this.taken = new Set(d.taken);
  },
  async loadFromPlatform() {
    try { this.loaded = migrate(await Platform.load(SAVE_KEY)); } catch { this.loaded = null; }
    return this.loaded;
  },
  async persist() {
    if (this.saving) { this.saveAgain = true; return; }
    this.saving = true;
    const s = this.save;
    s.visited = [...this.visited]; s.taken = [...this.taken]; s.savedAt = Date.now();
    try {
      await Platform.save(SAVE_KEY, s);
      this.loaded = JSON.parse(JSON.stringify(s));
      this.onSaved.forEach((f) => f());
    } catch { /* offline — keep playing */ }
    this.saving = false;
    if (this.saveAgain) { this.saveAgain = false; this.persist(); }
  },
  flag(name: string) { return this.save.flags[name]; },
  setFlag(name: string, v: boolean | number | string = true) { this.save.flags[name] = v; },
  has(ability: string) { return !!this.save.abilities[ability]; },
  give(ability: string) { this.save.abilities[ability] = true; },
  achieve(id: string) {
    if (unlocked.has(id)) return;
    unlocked.add(id);
    Platform.unlock(id).catch(() => unlocked.delete(id));
  },
  /** Evaluate a condition string: "flag", "!flag", "has:dash", "!has:dash", "a & b". */
  test(cond?: string | null): boolean {
    if (!cond) return true;
    return cond.split('&').every((raw) => {
      let c = raw.trim(); let neg = false;
      if (c.startsWith('!')) { neg = true; c = c.slice(1); }
      let v: boolean;
      if (c.startsWith('has:')) v = this.has(c.slice(4));
      else if (c.startsWith('taken:')) v = this.taken.has(c.slice(6));
      else if (c.startsWith('shades>=')) v = this.save.shades.length >= Number(c.slice(8));
      else v = !!this.save.flags[c];
      return neg ? !v : v;
    });
  },
};
