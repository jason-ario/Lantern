# Vibe-Games: the premium store for vibe-coded games (prototype)

**[vibe-games.com](https://vibe-games.com)** · *Prompted into existence. Polished enough to pay for.*

A working vertical slice of a Steam-style marketplace for games built with AI. You can discover a game, see how it was vibed (the tools it was built with, the prompt that started it and how long it took), **try it instantly**, buy it, see it in your library, play it, save, quit, return, and continue where you left off.

> Formerly *Lantern*. The rebrand kept every internal contract working: old sessions, offline downloads and saved settings carry over automatically (see `public/js/migrate.js` and `authenticate()` in `server/api.js`).

```bash
node server/index.js          # Node 22+, zero dependencies → http://localhost:5173
npm run reset                 # wipe data/ (re-seeded on next start)
```

Everything runs from one process. `data/db.json` is created on first start.

Locally, publishing and site reset are open to you. Every browser gets its own guest account; set `ACCOUNT_MODE=single` for the old shared "Jason" demo account.

**Sample content vs. real content:** the fictional catalog (16 games, their ratings and a few written reviews) is *sample content*. Admins switch it between **Hidden**, **Admins only** and **Everyone** in *Profile → Sample content* (default from `DEMO_CONTENT`: shown locally, hidden on a real host). Hidden sample games disappear from the catalog, shelves, search, rankings and game pages; with nothing published yet, the store shows a "shelves are being stocked" launch page.

**Player reviews:** any signed-in player who owns a game can leave one thumbs-up/down review (with optional text, editable, deletable); developers can't review their own games; admins can remove reviews. Ratings come from real reviews only (sample games add real reviews on top of their sample rating). Tests: `npm run test:content`.

**Vibe-coding features:** every game declares the AI tools it was **built with** (Claude Code, Cursor, ChatGPT, Copilot, …; the list lives in `public/js/vibe.js`), plus optional **vibe metadata**: the prompt that started it and the hours it took. The store shows them on capsules and game pages ("How it was vibed"), has a *Browse by what built it* shelf, and search filters by tool (`/search?tool=claude-code`) or sorts by fastest build. The starter kit ships **`VIBE.md`**, a brief you hand to your AI assistant so it builds within the sandbox rules.

**Features added since the prototype:** real accounts (email + password, Google), Stripe Checkout, signed game packages, a separate games domain, offline play from a verified local cache, publishing updates with delta downloads, and algorithmic store curation: shelves are built from player behaviour (hook, retention, engagement, conversion, reach) with a discovery window for new games. See [CREATORS.md](CREATORS.md#10-how-discovery-works). See [DEPLOY.md](DEPLOY.md) for how to switch each on.

**Tests:** `npm run test:e2e` (platform), `npm run test:nightpaw` (plays through Nightpaw) `npm run test:features` (accounts, offline, updates, Stripe against a fake API, games origin, discovery) and `npm run test:ranking` (the ranking algorithm on synthetic play data). The first two need a running server; the other two start what they need.

**Deploying:** see [DEPLOY.md](DEPLOY.md). In short: Render Web Service, start command `node server/index.js`, and an `ADMIN_PASSWORD` environment variable. For data that survives restarts, also add a disk and set `DATA_DIR`.

## Architecture

```
┌──────────────── PLATFORM (trusted, platform origin) ─────────────────┐
│ public/js/views/*   Store · Game page · Library · Wishlist · Profile │
│                     · Publish                                        │
│ public/js/api.js    the ONLY module that knows services are HTTP     │
│ public/js/runtime/host.js   GAME RUNTIME HOST (broker + sandbox)     │
└───────────────┬───────────────────────────────▲──────────────────────┘
                │ MessageChannel RPC (private port) │
┌───────────────▼───────────────────────────────┴──────────────────────┐
│ GAME (untrusted, opaque origin): <iframe sandbox="allow-scripts">    │
│   /games/{gameId}/{version}/index.html + /sdk/v1/platform-sdk.js     │
└──────────────────────────────────────────────────────────────────────┘
server/api.js   PLATFORM SERVICES: identity, catalog, commerce, library,
                sessions, cloud saves, achievements, publishing
server/db.js    PERSISTENCE: JSON file today; swap for Postgres later
```

The four boundaries that will become separate systems:

| Boundary | Where | Contract |
|---|---|---|
| Store / Platform | `public/js/views`, `state.js` | Talks only to `api.js` |
| Game Runtime | `public/js/runtime/host.js` | Gets an injected `services` object, so it never calls `fetch` itself |
| Platform SDK | `sdk/v1/platform-sdk.js` | `Platform.storage/achievements/user/game`; async RPC only |
| Persistence | `server/db.js` + `server/api.js` | REST, authorised per user and per game |

### Game packages (designed for the desktop client)

- Builds are **immutable and versioned**: `packages/{gameId}/{version}/` (manifest.json, index.html, game.js, assets/…), served at `/games/{gameId}/{version}/` with `Cache-Control: immutable`. Relaunching on the web never re-downloads.
- On ingest, every file is sha256-hashed and the file list and build hash are stored on the `GameVersion`. A future Tauri/Electron client can use the same list to download once, verify, launch offline, and apply **delta updates** by fetching only changed hashes.
- `manifest.json` declares entry, SDK version, runtime features, input and achievements.
- The runtime host takes its storage and sessions as injected `services`. A desktop shell supplies local-cache + sync implementations and games stay byte-for-byte identical. On desktop, the shell would serve packages from disk under a custom scheme with the same sandbox.

### Data model (`data/db.json`)

`users`, `authSessions`, `developers`, `games` (incl. `builtWith: string[]` and `vibe: { prompt, hours } | null`), `gameVersions` (files + hashes), `achievements` (definitions), `ownerships`, `wishlists`, `saves` (user × game × key, with `revision` for future conflict resolution), `userAchievements`, `playSessions` (host-clocked, heartbeat every 30 s).

### Platform SDK

```js
await Platform.ready();                        // launch context {gameId, mode:'full'|'demo', version…}
await Platform.user.getCurrentUser();          // { id: per-game pseudonymous id, displayName }
await Platform.storage.save('harbor', state);  // → { revision, savedAt }
await Platform.storage.load('harbor');         // → value | null
Platform.achievements.unlock('first_skiff');
Platform.game.onExit(() => Platform.storage.save('harbor', state)); // flushed before the frame is destroyed
Platform.game.reportPlaytime(); Platform.game.exit(); onPause / onResume
```

## Demo content

- **Nightpaw** (`packages/nightpaw/1.0.0/`): a small metroidvania. A black cat with a red scarf and a sword explores 8 connected areas. It has Moth Wings (double jump) and Shadow Dash as ability gates, candle shrines that heal and save, pogo down-slashes, crawlers and wisps, a hidden heart vessel, a map (M / Tab), and a boss called the Hollow Warden. It supports keyboard, gamepad and touch, uses the SDK for saves and 6 achievements, and has a 5-minute demo. The world is authored in `samples/nightpaw/build-world.mjs`, which also checks that every opening lines up with a neighbouring room. `scripts/qa-nightpaw.mjs` plays through the whole game with real key input (21 checks).

- **Voidrunner** (arcade shooter): remembers best score and furthest sector, and saves an in-progress run on quit. The title menu then offers "Resume run".
- **Tidewater Trading Co.** (incremental): full harbor state, renameable harbor, autosave, save on exit, and offline earnings on return ("While you were away…").
- **Skylark**: a sample package (`public/creator/skylark-1.0.0.zip`) for the Publish flow. Click *Use sample package* → *Publish* and it's live and playable.
- The other released titles launch a clearly labelled **placeholder build** (it counts launches through the SDK), so the buy → library → play flow works for every game.
- Demos run for a fixed time. Demo saves use the same slot, so **progress carries over when you buy**, including buying from inside the running game.

## Making your own game

**Selling a game on Vibe-Games?** Read the creator guide. It's in the app at `/developers` and in [CREATORS.md](CREATORS.md). It covers the starter kit, the SDK reference, packaging, publishing, updates and the 90/10 revenue share.

1. Build any HTML/JS game and load `/sdk/v1/platform-sdk.js` in `index.html`.
2. Add a `manifest.json` with `name`, `version`, `entry`, `"sdk": "1"` and an optional `achievements` list.
3. Run `node scripts/pack.mjs path/to/my-game`, which writes `my-game-1.0.0.zip`.
4. Go to **Publish**, drop in the zip, pick the tools you built it with and click **Ship it**.

Building with an AI assistant? Give it [`samples/starter/VIBE.md`](samples/starter/VIBE.md) first. It explains the package format, SDK and sandbox limits so your assistant doesn't reach for CDNs, ES modules or `localStorage`. Run `npm run build:starter` after editing the starter kit.

Everything must ship inside the zip (no CDN scripts or web fonts). Use `Platform.storage` instead of `localStorage`, and relative paths for assets.

## Security model (games are untrusted)

- `<iframe sandbox="allow-scripts allow-pointer-lock">` with no `allow-same-origin` gives the game an **opaque origin**. It cannot read platform cookies or storage, touch the parent DOM, navigate the top window, open popups or submit forms.
- The server sends a CSP `sandbox` header on every game file, so even a game opened directly by URL is opaque. The CSP is also **path-scoped**: a game can only fetch its own package and the SDK. Other games, `/api` and external hosts are all blocked.
- The session cookie is `HttpOnly; SameSite=Strict; Path=/api`. The API requires an `X-Vibe-Client` header (which forces a CORS preflight that is never granted) and a matching `Origin`. Sandboxed frames send `Origin: null` and are rejected.
- The SDK talks over a `MessageChannel` port handed over only after verifying `event.source`. The host **binds every call to the launched gameId**, allowlists methods, validates keys and ids, caps saves at 256 KB and 64 keys, and rate-limits calls to 30/s.
- Games see a **per-game pseudonymous player id**, never the account id.
- Achievement unlocks are checked against the ids declared in the manifest. The playtime clock belongs to the host, and games can only ping activity.
- Uploaded store media is limited to PNG, JPEG and WebP and served with `CSP: sandbox`. Zip paths are checked for traversal.

`scripts/e2e.mjs` probes these boundaries from inside a running game (37 checks).

## Compromises made for the MVP

- **Guest accounts**: every browser gets an automatic guest account (cookie-based). There's no real sign-in, and creator/admin access is a single shared password (`ADMIN_PASSWORD`).
- **Mock payments**: a "Vibe Wallet" confirms instantly. Seeded reviews and ratings are placeholder data.
- **Same host for games and platform.** Isolation relies on sandbox plus CSP. Production should serve packages from a separate registrable domain (e.g. `play.vibe-games.net`) as defence in depth.
- A sandboxed iframe may share a process with the platform, so a runaway game loop can make the store UI janky. On desktop each game gets its own webview process.
- Saves are last-write-wins. `revision` is stored but not yet enforced.
- The JSON-file database is single-process with no migrations.
- Achievement unlocks are trusted from the game (normal for platforms without server-authoritative games).
- Uploads travel as base64 JSON (≤50 MB) instead of multipart or resumable uploads.
- Store fonts load from Google Fonts. The desktop build should bundle them.
- Demo limits are enforced by the platform UI clock, not the server.

## What I'd build next

1. A Service Worker that pre-caches the current version's file list after purchase, giving offline web play. This is the same code path the desktop client needs.
2. A Tauri shell: local package cache keyed by build hash, custom-scheme serving, background updates, and a save-sync queue that replays `storage.save` with revision checks.
3. Real accounts (OAuth/passkeys), a payments provider, and entitlement tokens.
4. A separate game-content origin, signed package manifests, and upload-time scanning.
5. A creator portal: new versions for existing games, a staged → live pipeline, sales and playtime basics, and an AI-assisted path from prompt to game package to store page.

## Files

```
server/index.js       HTTP server, security headers, static & package serving
server/api.js         platform services (REST) + authorisation
server/db.js          persistence layer
server/packages.js    package validation, zip reader, hashing, install
server/art.js         procedural key art (also used when publishers skip art)
server/seed.js        seed data wiring
catalog/games.js      fictional catalog (+ built-with tools and vibe metadata)
public/js/vibe.js     AI tool list + vibe metadata validation (shared by server and UI)
public/js/migrate.js  one-time carry-over of pre-rebrand browser storage
sdk/v1/platform-sdk.js
public/js/runtime/host.js   game runtime host / broker
public/js/views/*.js  store, game, search, library, wishlist, profile, publish, play, checkout
packages/             game builds (voidrunner, tidewater, _placeholder)
samples/skylark/      source for the publish-flow sample package
scripts/              e2e test, screenshot capture, art + sample builders
```
