# Selling your game on Lantern

The full, interactive version of this guide is on the Lantern site at **`/developers`**. It includes an earnings calculator and a launch checklist. This file is the same guide for people reading the repo.

If it runs in a browser, it can be a premium game on Lantern. Players own it forever, can play it instantly or offline, and get cloud saves and achievements built in.

---

## 1. Earning money

- **You keep 90% of every sale.** Lantern keeps 10% to run the store, hosting, downloads and cloud saves.
- **One-time purchase.** Choose a price tier from $2.99 to $19.99, or make the game free. There are no subscriptions, ads or per-play fees.
- **Demos sell games.** The optional 5-minute demo lets anyone try the game first. Their progress carries into the full game when they buy.
- **Updates are free to ship.** Owners get every update at no extra cost.
- **Track sales** under **Publish → Your games**. Each game shows its sales and your share.

> **Planned policy.** The 90/10 split is Lantern's planned creator policy. Your share is 90% of *net* revenue: the price minus payment processing fees, sales tax/VAT and refunds. Payouts to creators are not live yet. Sales are recorded per game from day one. Operators can change the split with the `CREATOR_SHARE` environment variable.

| Price | $2.99 | $4.99 | $7.99 | $9.99 | $14.99 | $19.99 |
|---|---|---|---|---|---|---|
| You keep up to | $2.69 | $4.49 | $7.19 | $8.99 | $13.49 | $17.99 |

These amounts are before card fees. Card fees are usually a few percent plus a fixed amount per sale.

## 2. Quick start (about 10 minutes)

1. **Download the starter kit** from `/creator/lantern-starter.zip`. The source is in [`samples/starter`](samples/starter). It's a small complete game, "Firefly Jar", with cloud saves, achievements and pause handling.
2. **Run it locally.** Open a terminal in the unzipped folder, run `npx serve -l 8000` or `python -m http.server 8000`, then open `http://localhost:8000`. Outside Lantern, the included `lantern-dev.js` stands in for the SDK: saves go to localStorage and achievements are logged to the console.
3. **Make it yours.** Edit `game.js`, or drop in your own game and keep the three `<script>` tags from `index.html`.
4. **Zip it.** Zip the folder contents. You can also run `node scripts/pack.mjs path/to/game` from this repo.
5. **Publish.** Go to **Publish**, drop the zip, fill in the store page, then click **Publish to Lantern**.

## 3. Package format

```
my-game/
  manifest.json     describes the game
  index.html        entry page, loads the SDK
  game.js           your code (bundled into classic scripts)
  assets/           images, audio, fonts, wasm …
```

```json
{
  "name": "Firefly Jar",
  "version": "1.0.0",
  "entry": "index.html",
  "sdk": "1",
  "input": ["mouse", "touch"],
  "achievements": [
    { "id": "first_catch", "name": "First Light", "description": "Catch your first firefly." }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The game's name. The store title you enter when publishing takes priority. |
| `version` | yes | `1.0.0` style. Every update needs a higher version. |
| `entry` | yes | The HTML file to open, relative to the zip root. |
| `sdk` | yes | Always `"1"`. |
| `achievements` | no | `{ id, name, description }`. Ids are `lowercase_snake_case`, up to 40 characters. |
| `input`, `runtime` | no | Informational for now. |

Limits:
- Up to 50 MB and 2,000 files.
- File paths may use `A–Z a–z 0–9 . _ - /` and spaces.
- Published versions are immutable.

## 4. Platform SDK

Load the SDK with this exact path. Lantern serves it, so don't bundle it into your zip.

```html
<script src="/sdk/v1/platform-sdk.js"></script>
<script src="lantern-dev.js"></script>  <!-- optional: runs outside Lantern -->
<script src="game.js"></script>
```

```js
const launch = await Platform.ready();          // { gameId, gameTitle, version, mode: 'full'|'demo', locale, sdk, runtime }
const player = await Platform.user.getCurrentUser(); // { id, displayName }, pseudonymous and per game

const save = (await Platform.storage.load('progress')) ?? { level: 1 };
await Platform.storage.save('progress', save);  // { revision, savedAt }

await Platform.achievements.unlock('first_catch'); // { id, newlyUnlocked, unlockedAt }

Platform.game.onPause(() => game.pause());
Platform.game.onResume(() => game.resume());
Platform.game.onExit(() => Platform.storage.save('progress', save)); // up to ~1.5 s before quit
```

| Call | Returns | Notes |
|---|---|---|
| `ready()` | launch context | `mode` is `'demo'` during a demo |
| `user.getCurrentUser()` | `{ id, displayName }` | id is stable per player, per game |
| `storage.save(key, value)` | `{ revision, savedAt }` | Any JSON value up to 256 KB. Keys match `[A-Za-z0-9_.-]{1,64}` |
| `storage.load(key)` | value or `null` | |
| `storage.list()` | `[{ key, sizeBytes, updatedAt }]` | |
| `storage.remove(key)` | `true` | |
| `achievements.unlock(id)` | `{ id, newlyUnlocked, unlockedAt }` | Idempotent. The id must be in the manifest |
| `achievements.list()` | `[{ id, name, description, unlockedAt }]` | |
| `game.onExit / onPause / onResume(fn)` | – | Lifecycle hooks |
| `game.exit()` | `true` | Asks Lantern to close the game |
| `game.reportPlaytime()` | `{ sessionSeconds }` | Optional |

Errors reject with a `code`:

| Code | Meaning |
|---|---|
| `invalid_key` | Bad save key |
| `invalid_value` | Value isn't JSON |
| `too_large` | Save is over 256 KB |
| `save_failed` | The save couldn't be stored |
| `invalid_id` | Bad achievement id |
| `unlock_failed` | Achievement id isn't in the manifest |
| `rate_limited` | More than 30 calls per second |
| `unknown_method` | The method name doesn't exist |
| `closed` | The game is shutting down |

## 5. Saves that last

- Save at checkpoints, such as level ends, unlocks, every minute or so, and in `onExit`. Don't save every frame.
- Put a version number (`v`) in your save data so later builds can migrate old saves.
- Use one key per slot or per system to stay well under 256 KB.
- Offline play is automatic. Offline saves are uploaded later, and if two devices both played offline, the last upload wins.

## 6. What games can and can't do

Games run in a sandbox, isolated from the store, player accounts and other games.

**Works:**
- Canvas, WebGL, WebGL2 and WASM
- Web Audio (start it after the first click or tap)
- Workers from your own files
- Pointer lock, keyboard, touch and gamepad
- `fetch()` of files inside your package
- CSS, fonts and images bundled in your package

**Doesn't work:**
- Requests to other servers, including CDNs, analytics, ads and external APIs
- `localStorage`, IndexedDB and cookies (use `Platform.storage`)
- Popups, forms, iframes and navigating away
- `<script type="module">` and `eval` in downloaded copies
- Multithreaded builds that need SharedArrayBuffer

If you use modules, bundle them into one classic script, for example `npx esbuild src/main.js --bundle --format=iife --outfile=game.js`.

## 7. Test before you ship

1. Test locally with `lantern-dev.js`. It enforces the same limits as the real runtime.
2. Drop the zip on **Publish** to run the package check. Fix every error.
3. After publishing, play from your library. Quit and relaunch to check that the save loads. Try it on a phone. Download it, turn off Wi-Fi and play again.

## 8. Publishing

Publishing is invite-only during early access. Ask the Lantern team for the creator password.

On the Publish page, provide:
- The zip
- A title (2–60 characters) and developer name
- A price, a short description and a longer description
- Up to 8 tags
- Key art: one PNG, JPG or WebP image up to 8 MB, cropped for the capsule, header and banner, so keep the subject centred
- Up to 6 screenshots, 16:9 at 1280×720 or larger
- Whether to offer the demo

The store page goes live instantly.

## 9. Updates

Go to **Publish → Your games → Publish update**, upload a higher version and write patch notes.

- Players see the notes in **Library → What's new**.
- Downloaded copies only fetch files that changed.
- Keep existing achievement ids. You can add new ones.
- Migrate old saves in code.
