# Building a game for Vibe-Games

You are helping build a browser game that will be sold on Vibe-Games
(vibe-games.com), a store for vibe-coded games. Follow these rules so the game
passes the package check and works for paying players, online and offline.

## Package

- The game is a plain folder of static files, zipped with `manifest.json` and
  the entry HTML at the top level of the zip. Max 50 MB, max 2,000 files.
- `manifest.json`:
  ```json
  {
    "name": "My Game",
    "version": "1.0.0",
    "entry": "index.html",
    "sdk": "1",
    "input": ["keyboard", "mouse", "touch"],
    "achievements": [
      { "id": "first_win", "name": "First Win", "description": "Win a round." }
    ]
  }
  ```
  `version` is three numbers and must go up with every update. Achievement ids
  are `lowercase_snake_case`, up to 40 characters, and never renamed later.
- Use relative paths for every file (`assets/cat.png`, not `/assets/cat.png`).

## The runtime (important)

The game runs in a locked-down sandboxed iframe. So:

- **Everything is bundled.** No CDNs, Google Fonts, analytics, ads or network
  APIs. Download libraries and fonts into the folder.
- **Classic scripts only.** Load code with `<script src="game.js"></script>`.
  No `type="module"`, no `eval`, no `new Function`. If you use npm packages or
  ES modules, bundle to one IIFE file, e.g.
  `npx esbuild src/main.js --bundle --format=iife --outfile=game.js`.
- **No browser storage.** `localStorage`, IndexedDB and cookies don't work.
  Use `Platform.storage` (below).
- No popups, new tabs, forms, nested iframes, navigation, or
  SharedArrayBuffer/multithreading.
- Canvas 2D, WebGL/WebGL2, WebAssembly, Web Audio, Workers (from your own
  files), pointer lock, keyboard, touch and gamepads all work. Start audio
  after the first click, tap or key press.

## The SDK

Load it first, with this exact path (the store serves it; don't copy it in):

```html
<script src="/sdk/v1/platform-sdk.js"></script>
<script src="vibe-dev.js"></script>  <!-- lets the game run outside Vibe-Games -->
<script src="game.js"></script>
```

```js
const launch = await Platform.ready();   // { gameId, version, mode: 'full' | 'demo', locale }
const player = await Platform.user.getCurrentUser();   // { id, displayName }

const save = (await Platform.storage.load('progress')) ?? { v: 1, level: 1 };
await Platform.storage.save('progress', save);   // any JSON up to 256 KB per key

await Platform.achievements.unlock('first_win'); // id must be in manifest.json

Platform.game.onPause(() => game.pause());   // stop time, audio, input
Platform.game.onResume(() => game.resume());
Platform.game.onExit(() => Platform.storage.save('progress', save)); // before quit
```

Save keys use `A–Z a–z 0–9 _ . -`, 1–64 characters. Save at checkpoints and in
`onExit`, not every frame. Put a `v` (version) field in saves so later updates
can migrate old data. `launch.mode === 'demo'` means a free 5-minute demo:
make those minutes great, because progress carries over when players buy.

## Quality bar (it's a premium store)

- Feels good in the first 10 seconds: clear goal, responsive controls, sound.
- Works with mouse **and** touch, or say which input it needs.
- Scales to any window size and pauses when the tab is hidden.
- Never loses progress. Never throws uncaught errors on launch: launch health
  affects whether the game gets shelf space.

To test outside the store, serve the folder with any static server
(`npx serve -l 8000`). `vibe-dev.js` fakes the SDK with the same limits and logs
achievements to the console.
