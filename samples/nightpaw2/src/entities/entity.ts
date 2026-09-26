// Base entity + registry. Every placeable thing (enemy, npc, pickup, trigger...)
// registers a factory under its `type` name so rooms can place it from JSON.
import type { EntityDef } from '../content/types';
import type { Room } from '../world/world';

/** What entities can ask of the running game (implemented by GameScene). */
export interface Ctx {
  scene: any;
  room: Room;
  player: any;
  ents: Entity[];
  spawn(e: Entity): void;
  burst(x: number, y: number, n: number, color: number, o?: { spd?: number; life?: number; size?: number; grav?: number; glow?: boolean; key?: string }): void;
  dropCoins(x: number, y: number, n: number): void;
  shake(amount: number): void;
  hitstop(secs: number): void;
  hurtPlayer(dmg: number, fromX: number, hazard?: boolean): void;
  runCutscene(id: string, opts?: { entity?: Entity }): Promise<void>;
  prompt(text: string | null, x?: number, y?: number): void;
  inCutscene: boolean;
  bossBar(e: Entity | null, name?: string): void;
}

export interface Light { x: number; y: number; r: number; color: number; a: number }

export abstract class Entity {
  x: number; y: number; w = 12; h = 12;
  vx = 0; vy = 0;
  face = 1;
  dead = false;
  hp = 1; maxHp = 1;
  harm = 0; // contact damage to the player
  hittable = false; // can be hit by the needle
  flashT = 0;
  t = Math.random() * 5;
  id: string;
  name = '';
  onGround = false; hitX = false; hitCeil = false; landed = false;

  constructor(public g: Ctx, public def: EntityDef, x: number, y: number) {
    this.x = x; this.y = y; this.id = def.id ?? `${def.type}:${x},${y}`;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  update(_dt: number) {}
  /** Return true if the hit landed. dir: -1/1 horizontal direction of the hit, kind: side/up/down. */
  onHit(_dmg: number, _dir: number, _kind: string): boolean { return false; }
  /** Called when the player presses UP while overlapping. Return true if handled. */
  interact(): boolean { return false; }
  interactLabel(): string | null { return null; }
  light(): Light | null { return null; }
  destroy() {}
  /** Keep in sync with the camera even while the world is paused for dialogue. */
  render(_dt: number) {}
}

type Factory = (g: Ctx, def: EntityDef, x: number, y: number) => Entity | null;
const registry = new Map<string, Factory>();
export function register(type: string, f: Factory) { registry.set(type, f); }
export function create(g: Ctx, def: EntityDef, x: number, y: number): Entity | null {
  const f = registry.get(def.type);
  if (!f) { console.warn('Unknown entity type', def.type); return null; }
  return f(g, def, x, y);
}
export function registeredTypes() { return [...registry.keys()]; }
