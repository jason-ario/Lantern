// Creator guide: how to vibe-code, package, publish and earn with a Vibe-Games game.
// Static content plus a few small interactive bits (earnings calculator, copy
// buttons, a remembered launch checklist, a table-of-contents scroll spy).
import { state } from '../state.js';
import { esc, toast } from '../ui.js';

const money = (c) => `$${(c / 100).toFixed(2)}`;
const CHECK_KEY = 'vibe.devChecklist.v1';
// Mirrors server/ranking.js RANK; shown in the discovery section.
let RANKDOC = state.discovery;

// ---------- tiny syntax highlighter (tokenise raw text, then escape) ----------
const KW = /^(const|let|var|await|async|function|return|if|else|for|of|new|try|catch|true|false|null)$/;
function hl(code, lang) {
  if (lang === 'text') return esc(code);
  const re = lang === 'json'
    ? /("(?:[^"\\\n]|\\.)*")(\s*:)?|(\b\d+(?:\.\d+)?\b)|(true|false|null)/g
    : lang === 'html'
      ? /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][^\s>]*)|("[^"\n]*")/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`[^`]*`)|\b([A-Za-z_]\w*)\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    last = re.lastIndex;
    if (lang === 'json') {
      if (m[1]) out += m[2] ? `<span class="t-key">${esc(m[1])}</span>${esc(m[2])}` : `<span class="t-str">${esc(m[1])}</span>`;
      else out += `<span class="t-num">${esc(m[0])}</span>`;
    } else if (lang === 'html') {
      out += m[1] ? `<span class="t-com">${esc(m[1])}</span>` : m[2] ? `<span class="t-key">${esc(m[2])}</span>` : `<span class="t-str">${esc(m[3])}</span>`;
    } else if (m[1]) out += `<span class="t-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="t-str">${esc(m[2])}</span>`;
    else if (KW.test(m[3])) out += `<span class="t-kw">${m[3]}</span>`;
    else if (m[3] === 'Platform') out += `<span class="t-key">${m[3]}</span>`;
    else out += esc(m[3]);
  }
  return out + esc(code.slice(last));
}
const CODES = [];
function code(src, lang = 'js', label = '') {
  const i = CODES.push(src.replace(/^\n/, '').replace(/\n\s*$/, '')) - 1;
  return `<div class="dv-code"><div class="dv-code-h"><span>${esc(label || lang.toUpperCase())}</span><button type="button" class="dv-copy" data-copy="${i}">Copy</button></div><pre><code>${hl(CODES[i], lang)}</code></pre></div>`;
}

// ---------- content ----------
const TOC = [
  ['earn', 'Earning money'],
  ['quickstart', 'Quick start'],
  ['vibe', 'Vibe it with AI'],
  ['package', 'Package format'],
  ['sdk', 'Platform SDK'],
  ['saves', 'Saves that last'],
  ['sandbox', 'What games can do'],
  ['test', 'Test before you ship'],
  ['publish', 'Publishing'],
  ['updates', 'Updates'],
  ['discovery', 'How discovery works'],
  ['sell', 'Selling well'],
  ['checklist', 'Launch checklist'],
  ['faq', 'Troubleshooting'],
];

const CHECKLIST = [
  ['sdk', 'The entry HTML loads <code>/sdk/v1/platform-sdk.js</code> before your game code'],
  ['ready', 'The game waits for <code>Platform.ready()</code> before loading its save'],
  ['exit', 'Progress is saved at checkpoints and in <code>Platform.game.onExit</code>'],
  ['pause', 'The game pauses on <code>onPause</code> (timers, audio, physics)'],
  ['local', 'Every asset is inside the zip. No CDNs, no external fonts, no API calls'],
  ['classic', 'Scripts are classic <code>&lt;script src&gt;</code>, not <code>type="module"</code>, and nothing uses <code>eval</code>'],
  ['ach', 'Every achievement id you unlock is listed in <code>manifest.json</code>'],
  ['input', 'It plays with mouse <em>and</em> touch, or the store page says which input it needs'],
  ['check', 'The Publish page\'s package check shows no errors'],
  ['media', 'Key art and 3–6 screenshots are ready (16:9, important parts centred)'],
  ['copy', 'Short description sells the game in two sentences'],
  ['demo', 'The first five minutes are good enough to be the demo'],
  ['vibe', 'The store page says what you built it with, and the prompt that started it (if you\'re brave)'],
];

function earnSection(share, pct) {
  const tiers = [299, 499, 799, 999, 1499, 1999];
  return `
  <section id="earn" class="dv-sec">
    <h2>Earning money</h2>
    <div class="dv-split">
      <div>
        <p class="dv-lead">You set the price. Players buy once and own the game forever. <b>You keep ${pct} of every sale.</b> Vibe-Games keeps ${100 - Math.round(share * 100)}% to run the store, hosting, downloads and cloud saves.</p>
        <ul class="dv-list">
          <li><b>One-time purchase.</b> Pick a price tier ($2.99–$19.99) or make it free. There are no subscriptions, ads or per-play fees.</li>
          <li><b>Demos sell games.</b> Turn on the 5-minute demo and anyone can try before they buy. Demo progress carries into the full game.</li>
          <li><b>Updates are free to ship.</b> Publish as many versions as you like. Owners get every update at no extra cost.</li>
          <li><b>Track sales in Publish → Your games.</b> Each game shows its sales and your share.</li>
        </ul>
        <div class="dv-note"><span class="dv-pill">Planned</span><div><b>Payouts aren't live yet.</b> The ${pct}/${100 - Math.round(share * 100)} split is Vibe-Games' planned creator policy. Your share is ${pct} of <em>net</em> revenue: the price minus payment processing fees, sales tax/VAT and refunds. Payouts to your bank account are coming. Until then, sales are recorded per game so nothing gets lost.</div></div>
      </div>
      <div class="dv-calc panel" id="calc">
        <div class="dv-calc-h">Earnings estimate</div>
        <label class="dv-range"><span>Price <b id="cPriceV"></b></span><input type="range" id="cPrice" min="99" max="2999" step="100" value="999"></label>
        <label class="dv-range"><span>Sales per month <b id="cSalesV"></b></span><input type="range" id="cSales" min="10" max="2000" step="10" value="200"></label>
        <div class="dv-calc-out"><small>You'd earn up to</small><b id="cOut"></b><small>per month · <span id="cPer"></span> per sale</small></div>
        <p class="muted small">Before payment fees, taxes and refunds. Card fees are usually a few percent plus a fixed amount per sale, so very cheap games lose a bigger slice to fees.</p>
      </div>
    </div>
    <table class="dv-table dv-tiers"><thead><tr><th>Price</th>${tiers.map((t) => `<th>${money(t)}</th>`).join('')}</tr></thead>
      <tbody><tr><td>You keep up to</td>${tiers.map((t) => `<td>${money(Math.floor(t * share))}</td>`).join('')}</tr></tbody></table>
  </section>`;
}

function body(share, pct) {
  return `
  ${earnSection(share, pct)}

  <section id="quickstart" class="dv-sec">
    <h2>Quick start: your first game in 10 minutes</h2>
    <ol class="dv-steps">
      <li><b>Download the starter kit.</b> <a class="btn btn-buy btn-sm" href="/creator/vibe-games-starter.zip" download>vibe-games-starter.zip</a> <span class="muted small">It contains a small complete game, “Firefly Jar”, with cloud saves, achievements and pause handling.</span></li>
      <li><b>Run it on your computer.</b> Unzip it, open a terminal in the folder and start any static web server, then open <code>http://localhost:8000</code>.
        ${code(`# pick one
npx serve -l 8000
python -m http.server 8000`, 'text', 'Terminal')}
        <span class="muted small">Outside Vibe-Games the SDK can't load, so the included <code>vibe-dev.js</code> stands in for it. Saves go to your browser's localStorage and achievements are logged to the console.</span></li>
      <li><b>Vibe it into your game.</b> Open the folder in your AI tool of choice (Claude Code, Cursor, Copilot, whatever you like), tell it to read <code>VIBE.md</code>, then describe the game you want. Already have a game? Drop it in and keep the three script tags from <code>index.html</code>. Change the name and achievements in <code>manifest.json</code>.</li>
      <li><b>Zip the folder.</b> On Windows: select the files → right-click → <i>Send to → Compressed (zipped) folder</i>. On macOS: select the files → right-click → <i>Compress</i>. On the command line: <code>zip -r ../my-game.zip .</code></li>
      <li><b>Publish.</b> Go to <a href="/publish" data-link>Publish</a>, drop the zip, check the report, fill in the store page and the vibe, and click <b>Ship it</b>. Your store page is live straight away.</li>
    </ol>
  </section>

  <section id="vibe" class="dv-sec">
    <h2>Vibe it with AI</h2>
    <p>Your AI assistant is great at games and has no idea how our sandbox works. Fix that in one step: give it <b>VIBE.md</b>. It's in the starter kit and it explains the package format, the SDK, what the sandbox blocks and the quality bar, in words a coding assistant follows well.</p>
    <div class="dv-cta"><button type="button" class="btn btn-buy btn-sm" id="copyBrief">Copy VIBE.md</button><a class="btn btn-ghost btn-sm" href="/creator/VIBE.md" target="_blank" rel="noopener">Open it</a></div>
    ${code(`Read VIBE.md first and follow it exactly. Then build me:
a one-button game about a paper plane riding thermals between cliffs.
Hold to climb, let go to glide. Calm, warm colours. Save my best flight
with Platform.storage and unlock "first_flight" after the first landing.`, 'text', 'Your first prompt')}
    <div class="dv-tips">
      <div><h4>Feel first, features later</h4><p>Ask for controls that feel great before menus, story or upgrades. A game that's fun to move around in survives every later prompt.</p></div>
      <div><h4>Paste the error, not a summary</h4><p>Copy the console error and the steps that caused it. Your assistant fixes a stack trace far faster than “it's broken”.</p></div>
      <div><h4>Play every build</h4><p>Vibe coding is a loop: prompt, play, react. Five-minute loops beat one giant prompt, every time.</p></div>
      <div><h4>Ask for the boring bits</h4><p>Save migrations, pause on tab hide, touch controls and window resizing are all one prompt away. They're what make a game feel premium.</p></div>
      <div><h4>Keep it bundled</h4><p>If your assistant reaches for a CDN, a Google Font or an API, tell it to download the file into the folder instead. The sandbox blocks the network.</p></div>
      <div><h4>Show your vibe</h4><p>When you publish, pick the tools you used, paste the first prompt and add your build time. Players love the story, and they can find your game by tool.</p></div>
    </div>
    </ol>
  </section>

  <section id="package" class="dv-sec">
    <h2>Package format</h2>
    <p>A Vibe-Games game is an ordinary web game folder, zipped. <code>manifest.json</code> and the entry HTML go at the top level of the zip. A single wrapping folder is also fine, because Vibe-Games strips it.</p>
    <div class="dv-split">
      ${code(`my-game/
  manifest.json     describes the game
  index.html        entry page, loads the SDK
  game.js           your code (bundled into classic scripts)
  assets/           images, audio, fonts, wasm …`, 'text', 'Folder')}
      ${code(`{
  "name": "Firefly Jar",
  "version": "1.0.0",
  "entry": "index.html",
  "sdk": "1",
  "input": ["mouse", "touch"],
  "achievements": [
    { "id": "first_catch", "name": "First Light",
      "description": "Catch your first firefly." }
  ]
}`, 'json', 'manifest.json')}
    </div>
    <table class="dv-table"><thead><tr><th>Field</th><th>Required</th><th>What it means</th></tr></thead><tbody>
      <tr><td><code>name</code></td><td>Yes</td><td>Your game's name. The store title you type when publishing overrides it.</td></tr>
      <tr><td><code>version</code></td><td>Yes</td><td>Three numbers, like <code>1.0.0</code>. Every update needs a higher one.</td></tr>
      <tr><td><code>entry</code></td><td>Yes</td><td>The HTML file to open, relative to the zip root. Usually <code>index.html</code>.</td></tr>
      <tr><td><code>sdk</code></td><td>Yes</td><td>Always <code>"1"</code> for this version of the SDK.</td></tr>
      <tr><td><code>achievements</code></td><td>No</td><td>A list of <code>{ id, name, description }</code>. Ids use <code>lowercase_snake_case</code>, up to 40 characters. Name up to 60 characters, description up to 140.</td></tr>
      <tr><td><code>input</code>, <code>runtime</code></td><td>No</td><td>Informational for now. Listing <code>"mouse"</code>, <code>"touch"</code>, <code>"keyboard"</code> or <code>"gamepad"</code> helps future store filters.</td></tr>
    </tbody></table>
    <div class="dv-limits"><div><b>50 MB</b><span>max zip size</span></div><div><b>2,000</b><span>max files</span></div><div><b>A–Z 0–9 . _ - /</b><span>allowed in file paths (spaces OK)</span></div><div><b>Immutable</b><span>a published version never changes</span></div></div>
    <p class="muted small">A single <code>.html</code> file also works, and Vibe-Games generates a manifest for it. You'll want a real manifest as soon as you add achievements.</p>
  </section>

  <section id="sdk" class="dv-sec">
    <h2>Platform SDK</h2>
    <p>Your game runs in a locked-down sandbox and talks to Vibe-Games only through <code>window.Platform</code>. Load the SDK with this exact path. Vibe-Games serves it, so don't copy it into your zip.</p>
    ${code(`<script src="/sdk/v1/platform-sdk.js"></script>
<script src="vibe-dev.js"></script>  <!-- optional: lets the game run outside Vibe-Games -->
<script src="game.js"></script>`, 'html', 'index.html')}
    <p>Every call returns a Promise. Calls made before the connection is up are queued, but it's good practice to <code>await Platform.ready()</code> first.</p>
    ${code(`const launch = await Platform.ready();
// { gameId, gameTitle, version, mode: 'full' | 'demo', locale, sdk, runtime }

const player = await Platform.user.getCurrentUser();
// { id, displayName }. id is stable for this player in YOUR game only

const save = (await Platform.storage.load('progress')) ?? { level: 1 };
await Platform.storage.save('progress', save);   // { revision, savedAt }

await Platform.achievements.unlock('first_catch'); // { id, newlyUnlocked, unlockedAt }

Platform.game.onPause(() => game.pause());       // overlay opened, tab hidden
Platform.game.onResume(() => game.resume());
Platform.game.onExit(() => Platform.storage.save('progress', save)); // before quit`, 'js', 'game.js')}
    <table class="dv-table dv-api"><thead><tr><th>Call</th><th>Returns</th><th>Notes</th></tr></thead><tbody>
      <tr><td><code>Platform.ready()</code></td><td>launch context</td><td>Resolves once connected to Vibe-Games. <code>mode</code> is <code>'demo'</code> during a free demo.</td></tr>
      <tr><td><code>user.getCurrentUser()</code></td><td><code>{ id, displayName }</code></td><td>The id is pseudonymous and per game. It can't be used to track players across games.</td></tr>
      <tr><td><code>storage.save(key, value)</code></td><td><code>{ revision, savedAt }</code></td><td>Any JSON value up to 256 KB. Keys: <code>A–Z a–z 0–9 _ . -</code>, 1–64 characters. Synced to the cloud.</td></tr>
      <tr><td><code>storage.load(key)</code></td><td>value or <code>null</code></td><td><code>null</code> means there's no save yet.</td></tr>
      <tr><td><code>storage.list()</code></td><td><code>[{ key, sizeBytes, updatedAt }]</code></td><td>Useful for save-slot menus.</td></tr>
      <tr><td><code>storage.remove(key)</code></td><td><code>true</code></td><td>Deletes one save.</td></tr>
      <tr><td><code>achievements.unlock(id)</code></td><td><code>{ id, newlyUnlocked, unlockedAt }</code></td><td>Safe to call again and again; Vibe-Games shows the toast only once. The id must be in your manifest.</td></tr>
      <tr><td><code>achievements.list()</code></td><td><code>[{ id, name, description, unlockedAt }]</code></td><td><code>unlockedAt</code> is <code>null</code> while locked.</td></tr>
      <tr><td><code>game.onExit(fn)</code></td><td>–</td><td>Runs when the player quits. <code>fn</code> may be async. Vibe-Games waits up to about 1.5 s.</td></tr>
      <tr><td><code>game.onPause(fn)</code> / <code>onResume(fn)</code></td><td>–</td><td>Pause game time, audio and input while the Vibe-Games overlay is open.</td></tr>
      <tr><td><code>game.exit()</code></td><td><code>true</code></td><td>Asks Vibe-Games to close the game, for example from your own “Quit” menu item.</td></tr>
      <tr><td><code>game.reportPlaytime()</code></td><td><code>{ sessionSeconds }</code></td><td>Optional. Vibe-Games keeps the official playtime clock itself.</td></tr>
    </tbody></table>
    <p>Failed calls reject with an error that has a <code>code</code>:</p>
    <div class="dv-codes">
      <span><code>invalid_key</code> bad save key</span><span><code>invalid_value</code> not JSON</span><span><code>too_large</code> over 256 KB</span>
      <span><code>save_failed</code> couldn't save</span><span><code>invalid_id</code> bad achievement id</span><span><code>unlock_failed</code> id not in manifest</span>
      <span><code>rate_limited</code> over 30 calls/s</span><span><code>unknown_method</code> typo in a call</span><span><code>closed</code> game is shutting down</span>
    </div>
  </section>

  <section id="saves" class="dv-sec">
    <h2>Saves that last</h2>
    <p>Players trust a game that never loses progress. Cloud saves follow them to any browser and keep working offline, but a few habits make them bulletproof:</p>
    <ul class="dv-list">
      <li><b>Save at checkpoints, not every frame.</b> Save on level end, on a new unlock, every minute or so, and in <code>onExit</code>. The rate limit is generous (30 calls/s), but slow networks aren't.</li>
      <li><b>Put a version number in your save.</b> Updates will change your data shape. A <code>v</code> field lets new builds upgrade old saves instead of crashing on them.</li>
      <li><b>Split big data.</b> Use one key per slot (<code>slot1</code>, <code>slot2</code>) or per system (<code>settings</code>, <code>progress</code>) to stay well under 256 KB each.</li>
      <li><b>Offline is automatic.</b> Games people buy are downloaded to their device. Offline saves are queued and uploaded later. If two devices both played offline, the most recent upload wins.</li>
    </ul>
    ${code(`const DEFAULT = { v: 2, level: 1, coins: 0, settings: { music: 0.8 } };

function migrate(s) {
  if (!s) return structuredClone(DEFAULT);
  if (s.v === 1) s = { ...s, v: 2, settings: { music: 0.8 } };  // added in 1.1.0
  return s;
}

const save = migrate(await Platform.storage.load('progress'));`, 'js', 'Versioned saves')}
  </section>

  <section id="sandbox" class="dv-sec">
    <h2>What games can do (and can't)</h2>
    <p>Vibe-Games treats every game as untrusted code, so it runs isolated from the store, player accounts and other games. That's why players feel safe buying from new developers. In practice:</p>
    <div class="dv-yn">
      <div class="dv-yes"><h4>Works</h4><ul>
        <li>Canvas 2D, WebGL, WebGL2 and WebAssembly</li>
        <li>Web Audio and <code>&lt;audio&gt;</code>. Start audio after the first click or tap, as browsers require</li>
        <li>Web Workers from your own files</li>
        <li>Pointer lock (mouse-look), keyboard, touch, gamepads</li>
        <li><code>fetch()</code> of files inside your own package</li>
        <li>CSS, fonts and images bundled in your package</li>
      </ul></div>
      <div class="dv-no"><h4>Doesn't work</h4><ul>
        <li>Requests to other servers: no CDNs, analytics, ads or external APIs. Bundle everything</li>
        <li><code>localStorage</code>, IndexedDB, cookies. Use <code>Platform.storage</code></li>
        <li>Popups, new tabs, forms, iframes and navigating away</li>
        <li><code>&lt;script type="module"&gt;</code> and <code>eval</code> in downloaded copies. Bundle to classic scripts</li>
        <li>Multithreaded builds that need SharedArrayBuffer / cross-origin isolation</li>
      </ul></div>
    </div>
    <p><b>Bundling tip.</b> If you use npm packages or ES modules, bundle them into one classic script, for example <code>npx esbuild src/main.js --bundle --format=iife --outfile=game.js</code>. Most bundlers have an equivalent “IIFE” output option. Then load it with a plain <code>&lt;script src="game.js"&gt;</code>.</p>
    <p><b>Engines and libraries.</b> Phaser, PixiJS, Three.js, Babylon.js and hand-written canvas games should work once bundled into your package. Engine exports vary. If an export uses ES modules, service workers or multithreading, it may stream fine but fail once downloaded. Upload it, then play the downloaded copy offline before you set a price.</p>
  </section>

  <section id="test" class="dv-sec">
    <h2>Test before you ship</h2>
    <ol class="dv-steps">
      <li><b>Locally, with the dev stand-in.</b> <code>vibe-dev.js</code> applies the same limits as the real runtime (key format, 256 KB, achievement ids), so mistakes show up in the console early.</li>
      <li><b>With the package check.</b> Dropping a zip on the Publish page inspects it before anything is published. It checks the manifest, entry file, file paths and whether the SDK is loaded. Fix every error; read every warning.</li>
      <li><b>On Vibe-Games itself.</b> After publishing, play it from your library. Quit and relaunch to confirm the save loads. Try it on a phone. Download it (Library → Offline), turn off Wi-Fi and play again. That run is exactly what paying players get.</li>
    </ol>
  </section>

  <section id="publish" class="dv-sec">
    <h2>Publishing</h2>
    <ol class="dv-steps">
      <li><b>Get creator access.</b> Publishing is invite-only while Vibe-Games is in early access. Ask the Vibe-Games team for the creator password, then unlock it once on the <a href="/publish" data-link>Publish</a> page.</li>
      <li><b>Upload your build.</b> Drop the zip. The report shows the files, size, SDK detection and achievements it found.</li>
      <li><b>Write the store page.</b> Add a title (2–60 characters), developer name, a price, a short description of one or two sentences, a longer “About this game”, and up to 8 tags.</li>
      <li><b>Share the vibe.</b> Pick the AI tools you built it with (at least one, up to five). Optionally add the prompt that started it and roughly how many hours it took. It shows on your store page as “How it was vibed”.</li>
      <li><b>Add media.</b> One key-art image (PNG, JPG or WebP, up to 8 MB) is used for the capsule, header and banner, cropped to fit each, so keep the title and hero in the centre. Add up to 6 screenshots, 16:9 at 1280×720 or larger. If you skip media, Vibe-Games generates placeholder art.</li>
      <li><b>Choose the demo.</b> The 5-minute demo is on by default. When it ends, players see a buy screen, and their progress carries over when they buy.</li>
      <li><b>Publish.</b> The store page, search listing and checkout go live instantly, and the game joins the <b>Fresh off the prompt</b> shelf. Your developer name is reserved for your account.</li>
    </ol>
  </section>

  <section id="updates" class="dv-sec">
    <h2>Updates</h2>
    <p>Go to Publish → Your games → <b>Publish update</b>. Upload the new zip, give it a higher version (<code>1.0.0 → 1.0.1</code> for fixes, <code>1.1.0</code> for features) and write patch notes. Players see your notes in Library → What's new.</p>
    <ul class="dv-list">
      <li><b>Versions are immutable.</b> Each build is signed and stored forever under its own version number. You can't overwrite a version, only publish a newer one.</li>
      <li><b>Downloads are small.</b> Installed copies fetch only the files whose contents changed, so keep unchanged assets byte-identical between builds.</li>
      <li><b>Saves carry over.</b> The same save keys are read by the new version. Migrate old data (see <a href="#saves">Saves that last</a>).</li>
      <li><b>You can add achievements</b> in an update by adding them to the manifest. Don't rename or remove existing ids, because players have already earned them.</li>
    </ul>
  </section>

  <section id="discovery" class="dv-sec">
    <h2>How discovery works</h2>
    <p>Nobody at Vibe-Games hand-picks the store. Every shelf is built from how players actually play, so a great game from an unknown developer can beat a big name. There's no review queue and no fee to get in.</p>
    <ol class="dv-steps">
      <li><b>Discovery window.</b> Every new game goes on the <b>Fresh off the prompt</b> shelf until it has had ${RANKDOC.windowPlayers} players or ${RANKDOC.windowDays} days pass. Games with the fewest players are shown first, so everyone gets a fair first audience.</li>
      <li><b>Vibe Score.</b> Scores go from 0 to 100 and are built from five signals (below). Until enough people have played, scores start near a neutral middle, so a handful of players can't make or break a game.</li>
      <li><b>Promotion.</b> After the window, games scoring <b>${RANKDOC.promoteAt}+</b> are promoted to the front page, Trending, Hidden gems and recommendations. The rest stay listed: searchable, buyable and with a store page. Scores update continuously, so a great update can get a game promoted later.</li>
      <li><b>Launch health.</b> If most launches fail to connect to Vibe-Games or throw uncaught errors, the game is taken off shelves until a fixed update is published.</li>
    </ol>
    <table class="dv-table"><thead><tr><th>Signal</th><th>Weight</th><th>What it measures</th></tr></thead><tbody>
      <tr><td>Hook</td><td>30%</td><td>Share of players who play 15+ minutes</td></tr>
      <tr><td>Retention</td><td>25%</td><td>Share of players who come back on another day</td></tr>
      <tr><td>Engagement</td><td>20%</td><td>Median minutes per player (full credit at 2 hours)</td></tr>
      <tr><td>Conversion</td><td>15%</td><td>Paid games: demo players who buy. Free games: people who claim it and then actually play</td></tr>
      <tr><td>Reach</td><td>10%</td><td>Players in the last 28 days</td></tr>
    </tbody></table>
    <p><b>Free and paid compete equally.</b> The score uses per-player rates, not revenue, so a free game can top the front page. Revenue only decides the <b>Top Sellers</b> shelf.</p>
    <p><b>Fair counting.</b> Guest players count half, at most 3 players from one network count, and your own plays and purchases are ignored. You can see your game's score, every signal compared with the average promoted game, and your biggest opportunity under <b>Publish → Your games</b>.</p>
  </section>

  <section id="sell" class="dv-sec">
    <h2>Selling well</h2>
    <div class="dv-tips">
      <div><h4>Lead with the screenshot</h4><p>The capsule art and first screenshot do most of the selling. Show real gameplay with the game's best moment on screen.</p></div>
      <div><h4>Make the demo count</h4><p>Put a hook in the first five minutes: a new power, a boss or a twist. A demo that ends on a cliffhanger sells.</p></div>
      <div><h4>Price for the hours</h4><p>Short arcade games do well at $2.99–$4.99, and 3–10 hour indies at $7.99–$14.99. You can go free first and charge for a bigger sequel.</p></div>
      <div><h4>Achievements = goals</h4><p>Five to fifteen achievements that point players at your best content keep them playing, and playing players tell friends.</p></div>
      <div><h4>Ship updates</h4><p>Regular updates with clear patch notes show a living game. Players are notified in their library.</p></div>
      <div><h4>Touch friendly</h4><p>Many players browse on phones. Games that work with touch reach everyone who finds them.</p></div>
    </div>
  </section>

  <section id="checklist" class="dv-sec">
    <h2>Launch checklist</h2>
    <p class="muted small">Your ticks are remembered in this browser.</p>
    <div class="dv-check" id="checklist">${CHECKLIST.map(([id, t]) => `<label><input type="checkbox" data-ck="${id}"><span>${t}</span></label>`).join('')}</div>
    <div class="dv-check-foot"><span id="ckCount"></span><a class="btn btn-buy" href="/publish" data-link>Go to Publish</a></div>
  </section>

  <section id="faq" class="dv-sec">
    <h2>Troubleshooting</h2>
    <details><summary>“Entry does not load /sdk/v1/platform-sdk.js”</summary><p>Your entry HTML needs <code>&lt;script src="/sdk/v1/platform-sdk.js"&gt;&lt;/script&gt;</code> with that exact absolute path. Without it the game still runs, but saves and achievements don't.</p></details>
    <details><summary>“manifest.version must look like 1.0.0” / “Version must be higher”</summary><p>Use three numbers. Every upload of an existing game needs a version higher than the live one, and each version can only be published once.</p></details>
    <details><summary>A black screen, and the console mentions Content Security Policy</summary><p>The game tried to load something from another site: a CDN script, a Google Font or an API. Download the file into your package and use a relative path.</p></details>
    <details><summary>It works when streaming but not after downloading</summary><p>Downloaded copies run from verified local files, which doesn't support ES modules or <code>eval</code>. Bundle to a classic script (see <a href="#sandbox">What games can do</a>). Also check for absolute paths like <code>/assets/x.png</code>; use <code>assets/x.png</code>.</p></details>
    <details><summary><code>unlock_failed</code> when unlocking an achievement</summary><p>The id isn't in the manifest of the version that's live. Add it to <code>manifest.json</code> and publish an update.</p></details>
    <details><summary>My save disappears in local testing</summary><p>The dev stand-in keeps saves in your browser's localStorage for that address (for example <code>localhost:8000</code>). Private windows and a different port each start empty.</p></details>
    <details><summary>Audio doesn't play</summary><p>Browsers block sound until the player interacts. Create or resume your <code>AudioContext</code> inside the first click, tap or key press.</p></details>
  </section>`;
}

// ---------- render ----------
export async function render(root) {
  RANKDOC = state.discovery;
  CODES.length = 0;
  const share = state.features.creatorShare ?? 0.9;
  const pct = `${Math.round(share * 100)}%`;
  root.innerHTML = `<div class="page dev">
    <header class="dv-hero">
      <div class="dv-hero-text">
        <div class="eyebrow">vibe-games for creators</div>
        <h1>You vibed it.<br>Now sell it. Keep <span>${pct}</span>.</h1>
        <p>If you built it with AI and it runs in a browser, it can be a premium game on Vibe-Games: owned forever, playable in one click and offline, with cloud saves and achievements built in. This guide goes from first prompt to first sale.</p>
        <div class="dv-cta"><a class="btn btn-buy btn-lg" href="/creator/vibe-games-starter.zip" download>Download starter kit</a><a class="btn btn-ghost btn-lg" href="#vibe">Get the AI brief</a><a class="btn btn-ghost btn-lg" href="/publish" data-link>Open Publish</a></div>
      </div>
      <div class="dv-hero-stats">
        <div><b>${pct}</b><span>revenue share to you<br><small>(planned policy)</small></span></div>
        <div><b>1 brief</b><span>VIBE.md teaches your AI the rules</span></div>
        <div><b>~10 lines</b><span>of SDK code for saves and achievements</span></div>
        <div><b>Instant</b><span>store page goes live on publish</span></div>
      </div>
    </header>
    <div class="dv-flow">${[['Prompt', 'Describe your game to your AI'], ['Integrate', 'SDK for saves and achievements'], ['Package', 'Zip it with a manifest.json'], ['Ship', 'Store page, demo and checkout'], ['Earn', `${pct} of every sale`]].map(([t, s], i) => `<div><b>${i + 1}</b><span>${t}</span><small>${s}</small></div>`).join('')}</div>
    <div class="dv-layout">
      <nav class="dv-toc" aria-label="On this page">${TOC.map(([id, t]) => `<a href="#${id}" data-toc="${id}">${t}</a>`).join('')}</nav>
      <article class="dv-body">${body(share, pct)}</article>
    </div>
  </div>`;

  // earnings calculator
  const cp = root.querySelector('#cPrice'), cs = root.querySelector('#cSales');
  const calc = () => {
    const p = +cp.value, n = +cs.value, per = Math.floor(p * share);
    root.querySelector('#cPriceV').textContent = money(p);
    root.querySelector('#cSalesV').textContent = n.toLocaleString();
    root.querySelector('#cPer').textContent = money(per);
    root.querySelector('#cOut').textContent = `$${Math.floor((per * n) / 100).toLocaleString()}`;
  };
  cp.oninput = calc; cs.oninput = calc; calc();

  // checklist (per-browser convenience)
  let ticks = {};
  try { ticks = JSON.parse(localStorage.getItem(CHECK_KEY) ?? '{}') ?? {}; } catch { ticks = {}; }
  const boxes = [...root.querySelectorAll('[data-ck]')];
  const count = () => { const n = boxes.filter((b) => b.checked).length; root.querySelector('#ckCount').textContent = n === boxes.length ? 'All set. Ship it!' : `${n} of ${boxes.length} done`; };
  boxes.forEach((b) => { b.checked = !!ticks[b.dataset.ck]; b.onchange = () => { ticks[b.dataset.ck] = b.checked; try { localStorage.setItem(CHECK_KEY, JSON.stringify(ticks)); } catch { /* ignore */ } count(); }; });
  count();

  // copy buttons + in-page anchors (the router owns plain links)
  root.onclick = async (e) => {
    if (e.target.closest('#copyBrief')) {
      const b = e.target.closest('#copyBrief');
      try { await navigator.clipboard.writeText(await (await fetch('/creator/VIBE.md')).text()); b.textContent = 'Copied. Paste it into your AI'; setTimeout(() => { b.textContent = 'Copy VIBE.md'; }, 2200); }
      catch { toast('Copy failed. Open VIBE.md and copy it from there', { kind: 'error' }); }
      return;
    }
    const c = e.target.closest('[data-copy]');
    if (c) {
      try { await navigator.clipboard.writeText(CODES[+c.dataset.copy]); c.textContent = 'Copied'; setTimeout(() => { c.textContent = 'Copy'; }, 1400); }
      catch { toast('Copy failed. Select the text instead', { kind: 'error' }); }
      return;
    }
    const a = e.target.closest('a[href^="#"]');
    if (a) {
      e.preventDefault();
      const t = root.querySelector(a.getAttribute('href'));
      if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState({}, '', `/developers${a.getAttribute('href')}`); }
    }
  };

  // scroll spy
  const links = new Map([...root.querySelectorAll('[data-toc]')].map((a) => [a.dataset.toc, a]));
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { links.forEach((a) => a.classList.remove('on')); links.get(en.target.id)?.classList.add('on'); }
  }, { rootMargin: '-80px 0px -70% 0px' });
  root.querySelectorAll('.dv-sec').forEach((s) => io.observe(s));

  if (location.hash) requestAnimationFrame(() => root.querySelector(location.hash)?.scrollIntoView());
  return () => io.disconnect();
}
