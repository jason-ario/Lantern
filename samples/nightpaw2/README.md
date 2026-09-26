# Nightpaw 2.0 — source

A story-driven metroidvania for Lantern, built with Phaser 3 + TypeScript.
The story bible is in [STORY.md](STORY.md).

```
src/          game code (TypeScript)
content/      everything data-driven: areas, rooms, cutscenes, speakers (JSON)
assets/art/   every painted part as its own PNG (+ art.json)
tools/        art generator, build, world validator, automated playtest
vendor/       phaser.min.js (3.90)
dist/         the built Lantern package (created by the build)
```

## Build & run

```
node tools/build.cjs            # → dist/  (needs bun or esbuild; --check also type-checks)
cd dist && python -m http.server 8123
open http://localhost:8123      # outside Lantern, saves go to localStorage
```

Debug URL parameters: `?room=coat_cellar&x=6&y=14` starts in a room (tile coords),
`&abilities=dash,wings` grants abilities, `&flags=met_tallow,warden_dead` sets story flags.

To ship: copy `dist/` to `packages/nightpaw/<version>/` (or zip it and publish an update).

## Adding content

**A new room.** Add an object to an area's `rooms` array in `content/areas/<area>.json`:

```json
{ "id": "my_room", "name": "My Room", "x": 186, "y": 18,
  "rows": ["##########", "#........#", "#..c..S..#", "##########"] }
```

`x`/`y` place the room on the world grid, in tiles. Rooms connect automatically: walking off
an edge puts you in whichever room is there, so line the openings up.
Tiles: `#` rock, `=` one-way platform, `^` thorns, `X` cracked wall (breakable), `.` air.
Any other character is an entity from the legend (defaults are in `src/world/world.ts`:
`P` spawn, `S` shrine, `c` mite, `w` sock wisp, `s` snail, `t` toad, `g` button jar,
`o` coin, `B` warden, `G` gate). Add your own per room or per area:

```json
"legend": { "T": { "type": "npc", "rig": "moth", "npcId": "tallow", "speaker": "tallow",
                   "talk": [ { "if": "!met_tallow", "cutscene": "meet_tallow" }, { "cutscene": "tallow_idle" } ] } }
```

Entities with explicit tile positions go in `"entities": [...]` (good for decals and triggers).

**A new area.** Create `content/areas/<id>.json` (copy `hollows.json` for the shape), list it
in `content/world.json`, and paint its tileset: `<prefix>_rock`, `_top`, `_top2`, `_bottom`,
`_side`, `_plank`, `_thorns`, plus backdrop layers. Area `dark`, `music` and `ambience` set the mood.

**A cutscene.** Add to any file in `content/cutscenes/` (listed in `world.json`):

```json
{ "id": "meet_tallow", "steps": [
  { "do": "letterbox" },
  { "do": "camera", "to": "tallow", "ms": 900 },
  { "do": "say", "who": "tallow", "lines": ["Oh! Good evening.", "You've fallen."] },
  { "do": "flag", "set": "met_tallow" } ] }
```

Steps: `say`, `narrate`, `wait`, `letterbox`, `walk`, `jump`, `face`, `camera`, `shake`, `sfx`,
`music`, `ambience`, `fade`, `flag`, `unflag`, `give` (ability), `heal`, `shade` (a lost life),
`achieve`, `item` (item card), `title` (area/boss card), `memory`, `storybook`, `if`, `boss`,
`emote`, `player`, `teleport`, `save`, `refresh`, `waitLand`, `run` (another cutscene), `hint`,
`npc`, `end`. Add new step types in `src/story/cutscene.ts`.

Players can **hold Esc / Start** to skip any cutscene. Skipping drops the presentation steps
(`say`, `narrate`, `camera`, `item`, `memory`, `storybook`, `wait`...) but still runs every step
that changes the game (`flag`, `give`, `shade`, `boss`, `player`, `music`...), so a skipped
cutscene leaves the world exactly as the full one would. Keep story effects in those steps.

Triggers fire once by default. Add `"once": false` for ones that must re-arm, like a boss
intro that has to play again after the player dies (it fires once per entry, never mid-fight).
Conditions (`if`, entity `if`/`hideIf`, talk options) read like `"warden_dead & !has:wings"`.

**A new enemy or prop.** Write a class extending `Entity` (see `src/entities/enemies.ts`),
build its puppet in `src/render/rigs.ts`, and `register('mytype', ...)`. Then it can be
placed from JSON.

**Art.** `node tools/art/build-art.cjs [key,key]` repaints the stand-in art from
`tools/art/painter.js`. To use real art, drop a PNG over the same name in `assets/art/`. If
the size changes, update `assets/art/art.json` and the pivot in `src/render/rigs.ts`.

## Checking your work

```
node tools/validate-world.cjs   # structure + simulated-physics reachability per ability stage
node tools/playtest.cjs         # drives the real game headless (needs Playwright + dist/ served on :8123)
```

The validator simulates the player's actual jump arcs, so it will tell you if a platform is
one pixel out of reach, or if a pickup can only be reached with an ability found later.
