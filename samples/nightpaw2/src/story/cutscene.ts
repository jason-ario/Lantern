// Cutscene runner. Cutscenes are JSON lists of steps (content/cutscenes/*.json):
//   { "do": "say", "who": "tallow", "text": "Good evening." }
// Add new step types in STEPS below; everything is async so steps can wait on input,
// tweens or timers. The player is locked for the duration unless `free: true`.
import { T } from '../core/config';
import { sleep } from '../core/util';
import { sfx, Music, Audio } from '../core/audio';
import { Game } from '../core/state';
import { World } from '../world/world';
import type { Step } from '../content/types';

export interface CutsceneHost {
  skipping: boolean;
  skipSignal: Promise<void>;
  scene: any; ui: any; player: any; room: any; ents: any[];
  cam: { focus(x: number, y: number, ms: number): Promise<void>; release(ms?: number): void };
  shake(n: number): void;
  emote(target: any, kind: string): void;
  teleport(room: string, x: number, y: number): void;
  wakeBoss(id: string): void;
  saveNow(): void;
  endDemo(): Promise<void>;
  refreshEntities(): void;
}

type StepFn = (h: CutsceneHost, s: Step, ctx: RunCtx) => Promise<void> | void;
interface RunCtx { entity?: any }

const find = (h: CutsceneHost, who: string, ctx: RunCtx) => {
  if (!who || who === 'player' || who === 'nightpaw') return h.player;
  if (who === 'self') return ctx.entity;
  return h.ents.find((e) => e.def?.npcId === who || e.def?.speaker === who || e.id === who) ?? null;
};

const STEPS: Record<string, StepFn> = {
  async say(h, s, ctx) {
    const lines: string[] = s.lines ?? [s.text];
    const npc = find(h, s.who, ctx);
    if (npc && npc !== h.player && 'talking' in npc) npc.talking = true;
    for (const line of lines) await h.ui.say(s.who, line, s);
    if (npc && 'talking' in npc) npc.talking = false;
  },
  async narrate(h, s) { await h.ui.narrate(s.lines ?? [s.text], s); },
  async wait(h, s) { await sleep(h.scene, s.ms ?? 500); },
  letterbox(h, s) { h.ui.letterbox(s.on !== false); },
  async walk(h, s, ctx) {
    const P = h.player;
    const target = s.to !== undefined ? (h.room.x + s.to) * T : P.x + (s.dx ?? 0) * T;
    P.scripted = { dir: Math.sign(target - P.x) };
    const start = h.scene.time.now;
    await new Promise<void>((res) => {
      const ev = h.scene.time.addEvent({ delay: 16, loop: true, callback: () => {
        if (Math.abs(P.x - target) < 2 || P.hitX || h.scene.time.now - start > 6000) { ev.remove(); res(); }
      } });
    });
    P.scripted = null; P.vx = 0;
    if (s.face) P.face = s.face;
    void ctx;
  },
  jump(h) { const P = h.player; P.scripted = { dir: P.scripted?.dir ?? 0, jump: true }; },
  face(h, s, ctx) {
    const e = find(h, s.who, ctx); if (!e) return;
    if (s.dir) e.face = s.dir;
    else if (s.at) { const o = find(h, s.at, ctx); if (o) e.face = o.cx > e.cx ? 1 : -1; }
  },
  async camera(h, s, ctx) {
    if (s.release || s.to === 'player') { h.cam.release(s.ms ?? 600); if (s.wait !== false) await sleep(h.scene, s.ms ?? 600); return; }
    let x: number, y: number;
    if (typeof s.to === 'string') { const e = find(h, s.to, ctx); if (!e) return; x = e.cx; y = e.cy; }
    else { x = (h.room.x + s.to.x) * T; y = (h.room.y + s.to.y) * T; }
    const p = h.cam.focus(x + (s.dx ?? 0) * T, y + (s.dy ?? 0) * T, s.ms ?? 800);
    if (s.wait !== false) await p;
  },
  shake(h, s) { h.shake(s.amount ?? 6); },
  sfx(_h, s) { sfx[s.id]?.(); },
  music(_h, s) { if (s.stop) Music.stop(); else Music.play(s.id); },
  ambience(_h, s) { Audio.ambience(s.id); },
  async fade(h, s) { await h.ui.fade(s.to ?? 1, s.ms ?? 500, s.color); },
  flag(h, s) { Game.setFlag(s.set, s.value ?? true); if (s.refresh) h.refreshEntities(); },
  unflag(h, s) { delete Game.save.flags[s.name]; if (s.refresh) h.refreshEntities(); },
  give(h, s) {
    Game.give(s.ability);
    if (s.achievement) Game.achieve(s.achievement);
    if (s.ability === 'wings') h.player.airJumps = 1;
  },
  heal(h) { h.player.hp = Game.save.maxHp; },
  shade(h, s) {
    if (!Game.save.shades.includes(s.id)) Game.save.shades.push(s.id);
    Game.save.maxHp += 1; h.player.hp = Game.save.maxHp;
    Game.achieve('heart_vessel');
    if (Game.save.shades.length >= 2) Game.achieve('two_lives');
  },
  achieve(_h, s) { Game.achieve(s.id); },
  async item(h, s) { sfx.ability(); await h.ui.itemCard(s.title, s.text, s.icon, s.hint); },
  title(h, s) { h.ui.titleCard(s.name, s.sub, s.boss); },
  async memory(h, s) {
    const prev = Music.current;
    Music.play('memory'); sfx.memory();
    await h.ui.memory(s.title, s.lines ?? [s.text], s.image);
    if (prev) Music.play(prev); else Music.stop();
  },
  async storybook(h, s) { await h.ui.storybook(s.pages, s); },
  async if(h, s, ctx) { await runSteps(h, Game.test(s.cond) ? s.then ?? [] : s.else ?? [], ctx); },
  boss(h, s) { if (s.action === 'wake') h.wakeBoss(s.id ?? 'warden'); },
  emote(h, s, ctx) { const e = find(h, s.who, ctx); if (e) h.emote(e, s.kind ?? '!'); },
  player(h, s) {
    const P = h.player;
    if (s.hidden !== undefined) P.hidden = s.hidden;
    if (s.x !== undefined) { P.x = (h.room.x + s.x) * T + 3; P.y = (h.room.y + (s.y ?? 0)) * T + 2; P.vx = 0; P.vy = s.vy ?? 0; }
    if (s.face) P.face = s.face;
    if (s.rest !== undefined) P.resting = s.rest;
  },
  teleport(h, s) { h.teleport(s.room, s.x, s.y); },
  save(h) { h.saveNow(); },
  refresh(h) { h.refreshEntities(); },
  async waitLand(h) {
    await new Promise<void>((res) => { const ev = h.scene.time.addEvent({ delay: 16, loop: true, callback: () => { if (h.player.onGround) { ev.remove(); res(); } } }); });
  },
  async end(h) { await h.endDemo(); },
  async run(h, s, ctx) { await runCutscene(h, s.id, ctx); },
  hint(h, s) { h.ui.hint(s.text, s.ms ?? 4000); },
  npc(h, s, ctx) {
    const e = find(h, s.id, ctx); if (!e) return;
    if (s.hide) { e.dead = true; h.scene.tweens.add({ targets: e.puppet?.root, alpha: 0, duration: 600 }); }
  },
};

// While skipping, presentation-only steps are dropped; everything that changes the game
// (flags, abilities, lives, positions, music) still runs, so a skipped cutscene leaves the
// world in exactly the state the full one would.
const PRESENTATION = new Set(['say', 'narrate', 'wait', 'emote', 'shake', 'sfx', 'item', 'memory', 'storybook', 'title', 'camera', 'waitLand', 'hint', 'jump', 'face']);

export async function runSteps(h: CutsceneHost, steps: Step[], ctx: RunCtx) {
  for (const s of steps) {
    const fn = STEPS[s.do];
    if (!fn) { console.warn('Unknown cutscene step', s.do); continue; }
    if (h.skipping) {
      if (PRESENTATION.has(s.do)) continue;
      if (s.do === 'walk') { const P = h.player; const tx = s.to !== undefined ? (h.room.x + s.to) * T : P.x + (s.dx ?? 0) * T; P.x = tx; P.scripted = null; if (s.face) P.face = s.face; continue; }
      await fn(h, s, ctx);
      continue;
    }
    // Long steps race the skip signal so a skip takes effect immediately.
    await (s.do === 'end' ? fn(h, s, ctx) : Promise.race([fn(h, s, ctx), h.skipSignal]));
  }
}

export async function runCutscene(h: CutsceneHost, id: string, ctx: RunCtx = {}) {
  const def = World.cutscenes.get(id);
  if (!def) { console.warn('Missing cutscene', id); return; }
  await runSteps(h, def.steps, ctx);
}
