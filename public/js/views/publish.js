// Creator portal (prototype): package → metadata → publish → live store page.
import { api } from '../api.js';
import { applyUserState, loadCatalog, state } from '../state.js';
import { go } from '../nav.js';
import { openAuth } from './auth.js';
import { esc, price, bytes, icons, toast, modal, date, vibeChips, $, $$ } from '../ui.js';
import { TOOLS, MAX_TOOLS, MAX_PROMPT, buildTime } from '../vibe.js';

const PRICES = [0, 299, 499, 799, 999, 1499, 1999];
const money = (c) => `$${(c / 100).toFixed(2)}`;
const share = () => state.features.creatorShare ?? 0.9;
const pct = () => `${Math.round(share() * 100)}%`;
const SUGGESTED_TAGS = ['Arcade', 'Casual', 'Puzzle', 'Action', 'Platformer', 'Strategy', 'Cozy', 'Roguelike', 'Narrative', 'Minimalist', 'Score Attack', 'Relaxing'];

const readAs = (file, how) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  how === 'dataurl' ? r.readAsDataURL(file) : r.readAsArrayBuffer(file);
});
const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// Not a creator yet: walk the player through account → verified email → creator agreement.
function renderLocked(root) {
  const c = state.creator;
  const step = c.blocker;
  const steps = [['account', 'Create an account'], ['verify', 'Confirm your email'], ['join', 'Accept the Creator Agreement']];
  const idx = steps.findIndex(([k]) => k === step);
  root.innerHTML = `<div class="page publish">
    <div class="pub-head"><div><div class="eyebrow">vibe-games publish</div><h1>Ship your vibe-coded game</h1>
    <p class="muted">Anyone can sell their AI-built games here. Set up your creator account once, then every game gets a store page after a quick review.</p>
    <p><a class="btn btn-ghost btn-sm" href="/developers" data-link>Read the creator guide</a></p></div></div>
    <div class="panel pub-lock">
      ${step === 'suspended' ? '<h3>Creator account suspended</h3><p class="muted">Your creator account is suspended. Contact support@vibe-games.com if you think this is a mistake.</p>' : `
      <ol class="join-steps">${steps.map(([k, l], i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}"><b>${i < idx ? '✓' : i + 1}</b>${l}</li>`).join('')}</ol>
      ${step === 'account' ? `<p class="muted">Creators need a real account so we can pay you and so players know who made the game.</p><button class="btn btn-buy" id="joinSignup">Create account</button> <button class="btn btn-ghost" id="joinLogin">Sign in</button>` : ''}
      ${step === 'verify' ? `<p class="muted">We sent a confirmation link to <b>${esc(state.user.email ?? '')}</b>. Click it, then come back here.</p><button class="btn btn-buy" id="joinResend">Resend the link</button> <button class="btn btn-ghost" id="joinRecheck">I’ve confirmed it</button>` : ''}
      ${step === 'join' ? `<p class="muted">The short version: you keep ownership and set the price, you get <b>${pct()} of net revenue</b> paid out through Stripe, every game is reviewed before it goes live, and you promise you have the rights to everything in your game, AI-generated parts included.</p>
        <label class="f check"><input type="checkbox" id="joinAgree"><span>I’ve read and agree to the <a href="/legal/creators" data-link>Creator Agreement</a></span></label>
        <button class="btn btn-buy" id="joinGo" disabled>Become a creator</button>` : ''}`}
      ${c.passwordLogin && step !== 'suspended' ? `<details class="pub-admin-login"><summary class="muted small">Admin sign-in</summary><form id="loginForm" class="pub-lock-form"><input type="password" name="password" placeholder="Admin password" autocomplete="current-password" required><button class="btn btn-ghost">Unlock</button></form></details>` : ''}
    </div>
  </div>`;
  const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);
  on('#joinSignup', () => openAuth({ mode: 'signup', onDone: () => go('/publish') }));
  on('#joinLogin', () => openAuth({ mode: 'login', onDone: () => go('/publish') }));
  on('#joinResend', async (e) => { e.target.disabled = true; try { await api.auth.resendVerification(); toast('Link sent. Check your inbox (and spam folder).', { kind: 'ok' }); } catch (err) { e.target.disabled = false; toast(esc(err.message), { kind: 'error' }); } });
  on('#joinRecheck', async () => { applyUserState(await api.state()); if (state.creator.blocker === 'verify') toast('Not confirmed yet. Click the link in the email first.'); go('/publish'); });
  const agree = root.querySelector('#joinAgree');
  if (agree) agree.onchange = () => { root.querySelector('#joinGo').disabled = !agree.checked; };
  on('#joinGo', async (e) => { e.target.disabled = true; try { applyUserState(await api.creator.join()); toast('Welcome aboard, creator ✦', { kind: 'ok' }); go('/publish'); } catch (err) { e.target.disabled = false; toast(esc(err.message), { kind: 'error' }); } });
  const f = root.querySelector('#loginForm');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try { applyUserState(await api.admin.login(f.elements.password.value)); toast('Admin access unlocked', { kind: 'ok' }); go('/publish'); }
    catch (err) { btn.disabled = false; toast(esc(err.message), { kind: 'error' }); f.elements.password.select(); }
  };
  return null;
}

export async function render(root, _, query) {
  applyUserState(await api.state());
  if (!state.creator.canPublish) return renderLocked(root);
  if (query?.get('payouts') === 'done') toast('Payout details saved. Stripe may take a few minutes to verify them.', { kind: 'ok', timeout: 6000 });
  const form = { pkg: null, report: null, cover: null, header: null, hero: null, shots: [] };
  root.innerHTML = `<div class="page publish">
    <div class="pub-head">
      <div><div class="eyebrow">vibe-games publish --prototype</div><h1>Ship your vibe-coded game</h1>
      <p class="muted">You prompted it, you played it, you fixed the weird bug at 2am. Now sell it. Any HTML/JS/WebGL game becomes a premium, ownable title that plays in one click. Zip it, tell us how it was vibed, publish.</p>
      <p class="pub-guide-link"><a href="/developers" data-link>New here? Read the creator guide →</a> <span class="muted small">SDK reference, packaging, pricing and the ${pct()} revenue share.</span></p></div>
      <ol class="pub-steps"><li class="on" data-s="1"><b>1</b>Vibe it<small>Your AI + our SDK</small></li><li data-s="2"><b>2</b>Package<small>.zip with manifest.json</small></li><li data-s="3"><b>3</b>Describe<small>Store page + the vibe</small></li><li data-s="4"><b>4</b>Ship<small>Reviewed, then live</small></li></ol>
    </div>
    <section class="my-games" id="myGames"></section>
    <div class="sec-h pub-new-h"><h2>Publish a new game</h2></div>
    <div class="pub-grid">
      <form class="pub-form" id="pubForm" novalidate>
        <section class="panel">
          <h3>Game package</h3>
          <label class="drop" id="drop">
            <input type="file" id="pkgInput" accept=".zip,.html,.htm" hidden>
            <div class="drop-ico">${icons.box}</div>
            <div><b id="dropTitle">Drop your build (.zip) here, or click to choose</b><small id="dropSub">A folder with index.html, your JS/assets and a manifest.json. Up to 50 MB.</small></div>
          </label>
          <div class="pub-sample"><span class="muted small">No build handy?</span> <button type="button" class="btn btn-ghost btn-sm" id="useSample">Use sample package — “Skylark” (4 KB)</button></div>
          <div id="report"></div>
          <details class="pub-ref"><summary>How to make a Vibe-Games package</summary>
<pre><code>my-game/
  index.html        ← entry, loads the SDK:
                      &lt;script src="/sdk/v1/platform-sdk.js"&gt;&lt;/script&gt;
  game.js
  assets/…
  manifest.json     ← { "name": "My Game", "version": "1.0.0",
                        "entry": "index.html", "sdk": "1",
                        "achievements": [{ "id": "win", "name": "Winner" }] }

// in game.js
await Platform.ready();
const save = await Platform.storage.load('save');
Platform.storage.save('save', { level: 3 });
Platform.achievements.unlock('win');
Platform.game.onExit(() =&gt; Platform.storage.save('save', state));</code></pre></details>
        </section>

        <section class="panel">
          <h3>Store page</h3>
          <div class="fgrid">
            <label class="f span2"><span>Game title</span><input name="title" maxlength="60" required placeholder="e.g. Skylark"></label>
            <label class="f"><span>Developer</span><input name="developerName" maxlength="40" placeholder="Your studio name"></label>
            <label class="f"><span>Version</span><input name="version" value="1.0.0" pattern="\\d+\\.\\d+\\.\\d+"></label>
            <label class="f"><span>Price <small id="earnHint"></small></span><select name="price">${PRICES.map((p) => `<option value="${p}" ${p === 499 ? 'selected' : ''}>${price(p)}</option>`).join('')}</select></label>
            <label class="f check"><input type="checkbox" name="demo" checked><span>Offer a 5-minute instant demo</span></label>
            <label class="f span2"><span>Short description <small>shown on capsules &amp; search</small></span><input name="shortDescription" maxlength="300" placeholder="One or two sentences that sell the game."></label>
            <label class="f span2"><span>About this game</span><textarea name="description" rows="5" placeholder="Separate paragraphs with a blank line."></textarea></label>
            <label class="f span2"><span>Tags <small>comma separated, up to 8</small></span><input name="tags" placeholder="Arcade, Casual"></label>
            <div class="span2 tag-suggest">${SUGGESTED_TAGS.map((t) => `<button type="button" class="tag" data-addtag="${t}">+ ${t}</button>`).join('')}</div>
          </div>
        </section>

        <section class="panel vibe-panel">
          <h3>The vibe</h3>
          <p class="muted small">Players love seeing how a game was made. This shows on your store page and lets people find your game by tool.</p>
          <div class="fgrid">
            <div class="f span2"><span>Built with <small>pick up to ${MAX_TOOLS}</small></span>
              <div class="tool-pick" id="toolPick">${TOOLS.map((t) => `<label><input type="checkbox" name="builtWith" value="${t.id}"><span class="vibe-chip" style="--c:${t.color}">${esc(t.name)}</span></label>`).join('')}</div></div>
            <label class="f span2"><span>The prompt that started it <small>optional · up to ${MAX_PROMPT} characters</small></span><textarea name="vibePrompt" rows="3" maxlength="${MAX_PROMPT}" placeholder="e.g. A one-button game about a paper plane riding thermals between cliffs. Make it feel calm."></textarea></label>
            <label class="f"><span>Time to build <small>hours, roughly</small></span><input name="vibeHours" type="number" min="0.1" max="5000" step="0.5" placeholder="e.g. 6"></label>
          </div>
        </section>

        <section class="panel">
          <h3>Media</h3>
          <div class="fgrid">
            <label class="f"><span>Cover / key art <small>portrait, 600×900 · PNG, JPG or WebP</small></span><input type="file" name="cover" accept="image/png,image/jpeg,image/webp"></label>
            <label class="f"><span>Screenshots <small>up to 6 · 16:9</small></span><input type="file" name="shots" accept="image/png,image/jpeg,image/webp" multiple></label>
            <label class="f"><span>Header capsule <small>optional · 920×430</small></span><input type="file" name="header" accept="image/png,image/jpeg,image/webp"></label>
            <label class="f"><span>Store banner <small>optional · 1920×620</small></span><input type="file" name="hero" accept="image/png,image/jpeg,image/webp"></label>
          </div>
          <p class="muted small">Leave media empty and Vibe-Games generates placeholder key art for you. Without the wide images the cover stands in for them. Real screenshots sell much better, though.</p>
        </section>

        <div class="pub-actions">
          <span class="muted small" id="pubHint">Add a valid package, a title and at least one tool to publish.</span>
          <button class="btn btn-buy btn-xl" id="publishBtn" type="submit" disabled>Ship it</button>
        </div>
      </form>

      <aside class="pub-preview">
        <div class="side-h">Live store preview</div>
        <div class="pv-capsule" id="pvCap"><div class="pv-cap-art" id="pvArt"><div class="logo logo-md" id="pvLogo">Your game</div></div>
          <div class="pv-cap-meta"><b id="pvTitle">Your game</b><span class="price" id="pvPrice">$4.99</span></div></div>
        <p class="pv-short muted" id="pvShort">Your short description appears here.</p>
        <div class="pv-tags" id="pvTags"></div>
        <div class="pv-vibe" id="pvVibe"></div>
        <div class="pv-facts" id="pvFacts"></div>
      </aside>
    </div>
  </div>`;

  const f = $('#pubForm', root);
  const val = (n) => f.elements[n].value.trim();
  const pickedTools = () => [...f.querySelectorAll('#toolPick input:checked')].map((i) => i.value); // form may be detached while publishing
  const setStep = (n) => $$('.pub-steps li', root).forEach((li) => li.classList.toggle('on', +li.dataset.s <= n));

  const updatePreview = () => {
    const t = val('title') || 'Your game';
    $('#pvTitle', root).textContent = t;
    $('#pvLogo', root).textContent = t;
    $('#pvPrice', root).textContent = price(+val('price'));
    $('#earnHint', root).textContent = +val('price') ? `you earn up to ${money(Math.floor(+val('price') * share()))} per sale` : 'free games earn nothing';
    $('#pvShort', root).textContent = val('shortDescription') || 'Your short description appears here.';
    $('#pvTags', root).innerHTML = val('tags').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => `<span class="tag">${esc(x)}</span>`).join('');
    $('#pvFacts', root).innerHTML = form.report ? `<dl class="kv"><dt>Version</dt><dd>${esc(val('version'))}</dd><dt>Package</dt><dd>${bytes(form.report.sizeBytes)} · ${form.report.fileCount} files</dd><dt>SDK</dt><dd>${form.report.usesSdk ? 'Vibe-Games SDK v1' : 'Not detected'}</dd><dt>Achievements</dt><dd>${form.report.manifest?.achievements?.length ?? 0}</dd><dt>Demo</dt><dd>${f.elements.demo.checked ? '5 minutes' : 'None'}</dd></dl>` : '';
    const tools = pickedTools();
    const bt = buildTime(+val('vibeHours') || null);
    $('#pvVibe', root).innerHTML = tools.length || bt || val('vibePrompt') ? `${tools.length ? `<div class="gp-vibe-label">// built with${bt ? ` · ${esc(bt)}` : ''}</div>${vibeChips(tools, { max: MAX_TOOLS, size: 'sm' })}` : ''}${val('vibePrompt') ? `<div class="pv-prompt"><span>&gt;</span> ${esc(val('vibePrompt'))}</div>` : ''}` : '';
    $$('#toolPick input', root).forEach((i) => { i.disabled = !i.checked && tools.length >= MAX_TOOLS; });
    const ready = form.report?.ok && val('title').length >= 2 && tools.length > 0;
    $('#publishBtn', root).disabled = !ready;
    $('#pubHint', root).textContent = ready ? 'Ready. Shipping creates version ' + val('version') + ' and a live store page.' : !form.report?.ok || val('title').length < 2 ? 'Add a valid package and a title to publish.' : 'Pick at least one tool you built it with.';
    if (form.report?.ok) setStep(val('title') ? 3 : 2);
  };
  f.addEventListener('input', updatePreview);
  f.addEventListener('change', updatePreview);

  async function usePackage(filename, buf) {
    form.pkg = { filename, dataBase64: b64(buf) };
    $('#dropTitle', root).textContent = filename;
    $('#dropSub', root).textContent = `${bytes(buf.byteLength)} · inspecting…`;
    try {
      form.report = await api.publishing.inspect(filename, form.pkg.dataBase64);
    } catch (err) {
      form.report = { ok: false, errors: [err.message], warnings: [], files: [], fileCount: 0, sizeBytes: buf.byteLength };
    }
    const r = form.report;
    $('#dropSub', root).textContent = `${bytes(buf.byteLength)} compressed · ${r.fileCount} files`;
    $('#report', root).innerHTML = `<div class="report ${r.ok ? 'ok' : 'bad'}">
      <div class="rep-h">${r.ok ? '✓ Package is valid' : '✕ Package has problems'}</div>
      <ul>
        ${r.manifest ? `<li class="ok">manifest.json — <b>${esc(r.manifest.name)}</b> v${esc(r.manifest.version)}, entry <code>${esc(r.manifest.entry)}</code></li>` : ''}
        ${r.usesSdk ? '<li class="ok">Vibe-Games Platform SDK v1 detected</li>' : ''}
        ${r.manifest?.achievements?.length ? `<li class="ok">${r.manifest.achievements.length} achievements declared</li>` : ''}
        ${r.errors.map((e) => `<li class="err">${esc(e)}</li>`).join('')}
        ${r.warnings.map((e) => `<li class="warn">${esc(e)}</li>`).join('')}
      </ul>
      ${r.files?.length ? `<div class="rep-files">${r.files.slice(0, 12).map((x) => `<span><code>${esc(x.path)}</code><small>${bytes(x.size)}</small></span>`).join('')}</div>` : ''}
    </div>`;
    if (r.ok && r.manifest) {
      if (!val('title') && r.manifest.name && r.manifest.name !== 'Untitled') f.elements.title.value = r.manifest.name;
      if (r.manifest.version) f.elements.version.value = r.manifest.version;
    }
    updatePreview();
  }

  $('#pkgInput', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await usePackage(file.name, await readAs(file, 'buffer'));
  });
  const drop = $('#drop', root);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file) await usePackage(file.name, await readAs(file, 'buffer'));
  });
  $('#useSample', root).onclick = async () => {
    const buf = await (await fetch('/creator/skylark-1.0.0.zip')).arrayBuffer();
    if (!val('shortDescription')) f.elements.shortDescription.value = 'Fold a paper plane and ride the evening thermals between sandstone cliffs. One button, endless sky.';
    if (!val('description')) f.elements.description.value = 'Skylark is a tiny one-button flight game, vibe-coded in an afternoon.\n\nHold to climb, release to glide, and see how far the wind will carry you. Your best flight is saved to your Vibe-Games account.';
    if (!pickedTools().length) $$('#toolPick input', root).forEach((i) => { i.checked = i.value === 'claude-code'; });
    if (!val('vibePrompt')) f.elements.vibePrompt.value = 'One-button game: a paper plane riding the evening thermals between sandstone cliffs. Hold to climb, let go to glide. Calm, warm colours, remember my best flight.';
    if (!val('vibeHours')) f.elements.vibeHours.value = '3';
    if (!val('tags')) f.elements.tags.value = 'Arcade, Casual, Minimalist, Score Attack';
    if (!val('developerName')) f.elements.developerName.value = 'Afternoon Games';
    f.elements.price.value = '299';
    await usePackage('skylark-1.0.0.zip', buf);
  };
  root.querySelector('.tag-suggest').onclick = (e) => {
    const t = e.target.dataset.addtag; if (!t) return;
    const cur = val('tags').split(',').map((x) => x.trim()).filter(Boolean);
    if (!cur.includes(t)) f.elements.tags.value = [...cur, t].join(', ');
    updatePreview();
  };
  f.elements.cover.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    form.cover = file ? await readAs(file, 'dataurl') : null;
    $('#pvArt', root).style.backgroundImage = form.cover ? `url('${form.cover}')` : '';
  });
  f.elements.shots.addEventListener('change', async (e) => {
    form.shots = await Promise.all([...e.target.files].slice(0, 6).map((x) => readAs(x, 'dataurl')));
  });
  for (const k of ['header', 'hero']) {
    f.elements[k].addEventListener('change', async (e) => { const file = e.target.files[0]; form[k] = file ? await readAs(file, 'dataurl') : null; });
  }

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.report?.ok) return;
    setStep(4);
    const steps = ['Uploading package', 'Validating manifest & files', `Hashing ${form.report.fileCount} files`, `Creating version ${val('version')}`, 'Generating store page', 'Adding to your library', 'Vibe check'];
    const panel = document.createElement('div');
    panel.className = 'pub-progress';
    panel.innerHTML = `<h3>Shipping ${esc(val('title'))}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    f.replaceWith(panel);
    const lis = $$('li', panel);
    let i = 0;
    const tick = setInterval(() => { if (i < lis.length - 1) { lis[i]?.classList.add('done'); i++; lis[i]?.classList.add('doing'); } }, 280);
    lis[0].classList.add('doing');
    try {
      const [r] = await Promise.all([
        api.publishing.publish({
          title: val('title'), developerName: val('developerName'), version: val('version'),
          priceCents: +val('price'), demo: f.elements.demo.checked,
          shortDescription: val('shortDescription'), description: f.elements.description.value,
          tags: val('tags').split(',').map((x) => x.trim()).filter(Boolean),
          builtWith: pickedTools(), vibe: { prompt: val('vibePrompt'), hours: val('vibeHours') || null },
          cover: form.cover, header: form.header, hero: form.hero, screenshots: form.shots, package: form.pkg,
        }),
        new Promise((res) => setTimeout(res, 1800)),
      ]);
      clearInterval(tick);
      lis.forEach((li) => { li.classList.remove('doing'); li.classList.add('done'); });
      await loadCatalog();
      applyUserState(r.state);
      panel.insertAdjacentHTML('beforeend', `<div class="pub-live">
        <div class="co-check">✓</div>
        <div><h3>${r.listing === 'pending' ? `${esc(val('title'))} is in the review queue` : `${esc(val('title'))} is live. Vibe check passed ✦`}</h3>${r.listing === 'pending' ? '<p>We review every new game before it goes live, usually within a couple of days. We’ll email you the moment it’s approved. Meanwhile you can play it and check the store page; only you can see them.</p>' : ''}<p class="muted">Version ${esc(r.version)} · build <span class="mono">${esc(r.buildHash.slice(0, 12))}</span> · immutable URL <span class="mono">/games/${esc(r.gameId)}/${esc(r.version)}/</span></p></div>
        <div class="co-actions"><a class="btn btn-ghost" href="/app/${esc(r.gameId)}" data-link>View store page</a><a class="btn btn-play btn-lg" href="/play/${esc(r.gameId)}" data-link>${icons.play} Play now</a></div>
      </div>`);
    } catch (err) {
      clearInterval(tick);
      toast(esc(err.message), { kind: 'error', timeout: 6000 });
      panel.insertAdjacentHTML('beforeend', `<div class="report bad"><div class="rep-h">Publish failed</div><p>${esc(err.message)}</p><a class="btn btn-ghost" href="/publish" data-link>Start over</a></div>`);
    }
  });
  updatePreview();
  renderMyGames($('#myGames', root));
  return null;
}

// ---------------- Discovery: how the algorithm sees each game ----------------
const STATUS = {
  new: ['New', 'In its discovery window on the “Fresh off the prompt” shelf'],
  promoted: ['Promoted', 'On the front page, shelves and recommendations'],
  listed: ['Listed', 'In search and on its store page, not promoted yet'],
  needs_fix: ['Needs fixing', 'Pulled from shelves: many launches fail or crash'],
};
const pctTxt = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
function rankChip(r) {
  const [label] = STATUS[r.status] ?? ['—'];
  return `<b>${label}</b><span>${r.status === 'new' && r.window ? `${Math.floor(r.window.players)}/${r.window.target} players` : `Score ${Math.round(r.score)}`}</span>`;
}
function rankDetail(r) {
  const [label, desc] = STATUS[r.status] ?? ['', ''];
  const obs = (f) => (f.key === 'engagement' ? (f.observed == null ? '—' : `${f.observed} min`) : f.key === 'reach' ? `${Math.round(f.observed)}` : pctTxt(f.observed));
  const weakest = [...r.factors].filter((f) => f.key !== 'reach' && f.platform != null).sort((a, b) => (a.value - a.platform) - (b.value - b.platform))[0];
  const h = r.health;
  return `<div class="rk">
    <div class="rk-head">
      <div class="rk-score"><b>${Math.round(r.score)}</b><small>Vibe Score</small></div>
      <div class="rk-status"><span class="rk-pill st-${esc(r.status)}">${label}</span><p>${desc}.</p>
        ${r.window ? `<div class="rk-window"><div class="bar"><i style="width:${Math.min(100, (r.window.players / r.window.target) * 100)}%"></i></div><small>${Math.floor(r.window.players)} of ${r.window.target} players · ${r.window.daysLeft} days left in the discovery window. After that it's promoted if its score is ${r.promoteAt}+.</small></div>`
          : r.status === 'listed' ? `<small class="muted">Promotion happens automatically at a score of ${r.promoteAt}. Scores update as people play.</small>` : ''}
        ${r.status === 'needs_fix' ? `<small class="rk-warn">Only ${pctTxt(h.connectRate)} of recent launches connected to Vibe-Games and ${pctTxt(h.errorRate)} hit uncaught errors. Fix the build and publish an update; it's re-checked automatically.</small>` : ''}
      </div>
      <div class="rk-conf"><small>Confidence</small><b>${Math.round(r.confidence * 100)}%</b><small>more players = more certain</small></div>
    </div>
    <table class="rk-table"><thead><tr><th>Signal</th><th>Weight</th><th>Your game</th><th>Contribution</th><th>Promoted avg</th></tr></thead><tbody>
      ${r.factors.map((f) => `<tr><td><b>${esc(f.label)}</b><small>${esc(f.description)}</small></td><td>${Math.round(f.weight * 100)}%</td><td>${obs(f)}</td>
        <td><div class="rk-bar"><i style="width:${Math.round(f.value * 100)}%"></i>${f.platform != null ? `<em style="left:${Math.round(f.platform * 100)}%"></em>` : ''}</div></td><td>${f.platform == null ? '—' : Math.round(f.platform * 100)}</td></tr>`).join('')}
    </tbody></table>
    ${weakest && r.confidence >= 0.3 ? `<p class="rk-tip"><b>Biggest opportunity: ${esc(weakest.label)}.</b> ${esc(weakest.tip)}</p>`
      : r.confidence < 0.3 ? '<p class="rk-tip"><b>Not enough players yet to judge.</b> Share your store page link. The demo and the New shelf bring players in, and the score firms up after about 10 players.</p>' : ''}
    <p class="muted small">Scores blend your real numbers with a neutral starting point until enough people have played, so a few players can't make or break a game. Guests count half, your own plays don't count, and at most 3 players per network count.${r.baseline ? ' This is a demo-catalog game: its numbers include a seeded baseline.' : ''} <a href="/developers#discovery" data-link>How discovery works</a></p>
  </div>`;
}

// ---------------- Your games: publish updates ----------------
const bump = (v) => { const [a, b, c] = v.split('.').map((n) => parseInt(n, 10) || 0); return `${a}.${b}.${c + 1}`; };
async function renderMyGames(host) {
  let all;
  try { all = await api.creator.games(); } catch { host.innerHTML = ''; return; }
  const mine = all.filter((g) => g.mine);
  const catalog = all.filter((g) => !g.mine && !g.placeholder); // local dev: seeded games with real builds
  const showAll = host.dataset.all === '1';
  const games = showAll ? [...mine, ...catalog] : mine;
  if (!games.length && !catalog.length) { host.innerHTML = '<div id="payouts"></div>'; renderPayouts(host.querySelector('#payouts')); return; }
  host.innerHTML = `<div id="payouts"></div><div class="sec-h"><h2>Your games</h2><span class="sec-note">Ship an update and every player gets it — installed copies download only the files that changed.</span>${catalog.length ? `<a href="#" id="mgAll">${showAll ? 'Only my games' : `Also show ${catalog.length} catalog games (local admin)`}</a>` : ''}</div>
    ${games.length ? '' : '<p class="muted small">You haven\'t published a game yet — use the form below.</p>'}
    <div class="mg-list">${games.map((g) => `<div class="mg-row">
      <span class="mg-art" style="background-image:url('${esc(g.media.header)}')"></span>
      <div class="mg-body"><b>${esc(g.title)} ${modPill(g)}</b>${g.moderation?.lastNote && g.moderation.listing !== 'live' ? `<span class="mg-modnote">Reviewer: ${esc(g.moderation.lastNote.note)}</span>` : ''}<span class="muted small">v${esc(g.currentVersion)} · ${g.owners} player${g.owners === 1 ? '' : 's'} · ${g.versions.length} version${g.versions.length === 1 ? '' : 's'}</span>
        <span class="mg-notes muted small">${esc((g.versions[0]?.notes ?? '').slice(0, 120))}</span></div>
      ${g.priceCents ? `<div class="mg-sales" title="${g.sales.testCount ? `${g.sales.testCount} of these were demo-wallet test purchases. ` : ''}Your ${pct()} share of net revenue: after sales tax and the card fee, and minus refunds.">
        <b>${money(g.sales.creatorCents)}</b><span class="muted small">your share · ${g.sales.count} sale${g.sales.count === 1 ? '' : 's'}${g.sales.testCount ? ` (${g.sales.testCount} test)` : ''}</span></div>` : '<div class="mg-sales"><b>Free</b><span class="muted small">' + g.owners + ' claimed</span></div>'}
      ${g.ranking ? `<button class="mg-rank st-${esc(g.ranking.status)}" data-rank="${esc(g.id)}" title="How Vibe-Games is ranking this game">${rankChip(g.ranking)}</button>` : ''}
      <div class="mg-actions"><a class="btn btn-ghost btn-sm" href="/app/${esc(g.id)}" data-link>Store page</a>${g.store ? `<button class="btn btn-ghost btn-sm" data-edit="${esc(g.id)}">Edit page</button>` : ''}<button class="btn btn-buy btn-sm" data-update="${esc(g.id)}">Publish update</button></div>
    </div>${g.ranking ? `<div class="mg-detail" id="rank-${esc(g.id)}" hidden>${rankDetail(g.ranking)}</div>` : ''}`).join('')}</div>`;
  host.onclick = (e) => {
    const rk = e.target.closest('[data-rank]');
    if (rk) { const d = host.querySelector(`#rank-${CSS.escape(rk.dataset.rank)}`); d.hidden = !d.hidden; rk.classList.toggle('open', !d.hidden); return; }
    if (e.target.id === 'mgAll') { e.preventDefault(); host.dataset.all = showAll ? '0' : '1'; renderMyGames(host); return; }
    const b = e.target.closest('[data-update]');
    if (b) openUpdate(all.find((g) => g.id === b.dataset.update), () => renderMyGames(host));
    const ed = e.target.closest('[data-edit]');
    if (ed) openEdit(all.find((g) => g.id === ed.dataset.edit), () => renderMyGames(host));
  };
  renderPayouts(host.querySelector('#payouts'));
}

const MOD = { pending: ['Awaiting review', 'pending'], rejected: ['Changes requested', 'removed'], removed: ['Taken down', 'removed'] };
function modPill(g) {
  const m = g.moderation;
  if (!m) return '';
  if (m.listing !== 'live') { const [l, c] = MOD[m.listing] ?? [m.listing, 'pending']; return `<span class="lst lst-${c}">${l}</span>`; }
  return m.pendingVersions?.length ? `<span class="lst lst-pending">Update ${esc(m.pendingVersions[0].version)} in review</span>` : '<span class="lst lst-live">Live</span>';
}

// ---------------- Payouts (Stripe Connect) ----------------
const COUNTRIES = [['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'], ['IE', 'Ireland'], ['SE', 'Sweden'], ['PL', 'Poland'], ['PT', 'Portugal'], ['EE', 'Estonia'], ['JP', 'Japan'], ['SG', 'Singapore'], ['NZ', 'New Zealand'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['IN', 'India']];
async function renderPayouts(el) {
  if (!el) return;
  let p;
  try { p = await api.creator.payouts(); } catch { el.innerHTML = ''; return; }
  const t = p.totals;
  el.innerHTML = `<section class="panel payouts">
    <div class="po-head"><h3>Payouts</h3>
      ${!p.enabled ? '<span class="lst lst-pending">Stripe not configured on this server</span>' : p.ready ? '<span class="lst lst-live">Ready: you’re paid automatically</span>' : p.connected ? '<span class="lst lst-pending">Finish setup with Stripe</span>' : '<span class="lst lst-pending">Not set up</span>'}
    </div>
    <div class="po-stats">
      <div><small>Paid to you</small><b>${money(t.paidCents)}</b></div>
      <div><small>Waiting to be paid</small><b>${money(t.pendingCents)}</b></div>
      ${t.reversedCents ? `<div><small>Refunded</small><b>${money(t.reversedCents)}</b></div>` : ''}
      ${t.testCents ? `<div><small>Test sales (demo wallet)</small><b>${money(t.testCents)}</b></div>` : ''}
    </div>
    ${p.enabled ? (p.ready
      ? '<button class="btn btn-ghost btn-sm" id="poDash">Open Stripe dashboard</button>'
      : `<p class="muted small">You get ${pct()} of net revenue on every sale, sent by Stripe to your bank. ${t.pendingCents ? 'Money you’ve already earned is waiting and goes out as soon as setup is done.' : ''}</p>
        <div class="po-setup">${p.connected ? '' : `<label class="f"><span>Country you’ll be paid in</span><select id="poCountry">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === p.platformCountry ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`}
        <button class="btn btn-buy" id="poGo">${p.connected ? 'Continue setup with Stripe' : 'Set up payouts with Stripe'}</button></div>`)
      : '<p class="muted small">Sales are being recorded. Payouts switch on once the site owner connects Stripe.</p>'}
  </section>`;
  el.querySelector('#poGo')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api.creator.onboard(el.querySelector('#poCountry')?.value); location.href = r.url; } catch (err) { e.target.disabled = false; toast(esc(err.message), { kind: 'error' }); }
  });
  el.querySelector('#poDash')?.addEventListener('click', async () => {
    try { const r = await api.creator.payoutDashboard(); window.open(r.url, '_blank', 'noopener'); } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  });
}

// ---------------- Edit store page ----------------
function openEdit(g, onDone) {
  const st = g.store;
  modal(`<form class="upd" id="editForm">
    <div class="co-head"><h3>Edit ${esc(g.title)}</h3><button type="button" class="icon-btn" data-close aria-label="Close">${icons.close}</button></div>
    <p class="muted small">Changes to the store page go live straight away.</p>
    <div class="fgrid">
      <label class="f"><span>Price</span><select name="price">${PRICES.map((c) => `<option value="${c}" ${c === st.priceCents ? 'selected' : ''}>${price(c)}</option>`).join('')}</select></label>
      <label class="f check"><input type="checkbox" name="demo" ${st.demo ? 'checked' : ''}><span>Offer a 5-minute instant demo</span></label>
      <label class="f span2"><span>Short description</span><input name="short" maxlength="300" value="${esc(st.shortDescription)}"></label>
      <label class="f span2"><span>About this game</span><textarea name="description" rows="6">${esc((st.description ?? []).join('\n\n'))}</textarea></label>
      <label class="f span2"><span>Tags <small>comma separated, up to 8</small></span><input name="tags" value="${esc((st.tags ?? []).join(', '))}"></label>
      <div class="f span2"><span>Built with</span><div class="tool-pick">${TOOLS.map((t) => `<label><input type="checkbox" name="tool" value="${t.id}" ${st.builtWith.includes(t.id) ? 'checked' : ''}><span class="vibe-chip" style="--c:${t.color}">${esc(t.name)}</span></label>`).join('')}</div></div>
      <label class="f span2"><span>The prompt that started it</span><textarea name="prompt" rows="2" maxlength="${MAX_PROMPT}">${esc(st.vibe?.prompt ?? '')}</textarea></label>
      <label class="f"><span>Time to build (hours)</span><input name="hours" type="number" min="0.1" step="0.5" value="${esc(st.vibe?.hours ?? '')}"></label>
      <div class="f span2"><span>Store art <small>leave empty to keep the current images</small></span></div>
      <label class="f"><span>Cover <small>600×900</small></span><input type="file" name="mCover" accept="image/png,image/jpeg,image/webp"></label>
      <label class="f"><span>Screenshots <small>replaces all · up to 6</small></span><input type="file" name="mShots" accept="image/png,image/jpeg,image/webp" multiple></label>
      <label class="f"><span>Header capsule <small>920×430</small></span><input type="file" name="mHeader" accept="image/png,image/jpeg,image/webp"></label>
      <label class="f"><span>Store banner <small>1920×620</small></span><input type="file" name="mHero" accept="image/png,image/jpeg,image/webp"></label>
    </div>
    <div class="co-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-buy">Save changes</button></div>
  </form>`, {
    onMount(el, close) {
      el.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
      const f = el.querySelector('#editForm');
      f.onsubmit = async (e) => {
        e.preventDefault();
        const tools = [...f.querySelectorAll('input[name=tool]:checked')].map((i) => i.value);
        if (!tools.length) { toast('Pick at least one tool you built it with', { kind: 'error' }); return; }
        const one = (input) => (input.files[0] ? readAs(input.files[0], 'dataurl') : null);
        const media = {
          cover: await one(f.mCover), header: await one(f.mHeader), hero: await one(f.mHero),
          screenshots: await Promise.all([...f.mShots.files].slice(0, 6).map((x) => readAs(x, 'dataurl'))),
        };
        const hasMedia = media.cover || media.header || media.hero || media.screenshots.length;
        try {
          await api.creator.edit(g.id, {
            ...(hasMedia ? { media } : {}),
            priceCents: +f.price.value, demo: f.demo.checked, shortDescription: f.short.value, description: f.description.value,
            tags: f.tags.value.split(',').map((x) => x.trim()).filter(Boolean), builtWith: tools.slice(0, MAX_TOOLS),
            vibe: { prompt: f.prompt.value, hours: f.hours.value || null },
          });
          await loadCatalog(); close(); toast('Store page updated', { kind: 'ok' }); onDone?.();
        } catch (err) { toast(esc(err.message), { kind: 'error' }); }
      };
    },
  });
}

function openUpdate(g, onDone) {
  const cur = g.versions[0]?.placeholder ? '1.0.0' : g.currentVersion;
  const upd = { pkg: null, report: null };
  const sample = /skylark/i.test(g.title) ? '<button type="button" class="btn btn-ghost btn-sm" id="updSample">Use sample update — Skylark 1.1.0</button>' : '';
  modal(`<form class="upd" id="updForm" novalidate>
    <div class="co-head"><h3>Update ${esc(g.title)}</h3><button type="button" class="icon-btn" data-close aria-label="Close">${icons.close}</button></div>
    <p class="muted small">Currently live: v${esc(g.currentVersion)}. Versions are immutable — the new build gets its own signed, cache-forever URL.</p>
    <label class="drop" id="updDrop"><input type="file" accept=".zip,.html,.htm" hidden id="updFile"><div class="drop-ico">${icons.box}</div><div><b id="updDropT">Drop the new build (.zip)</b><small id="updDropS">Same format as a new game.</small></div></label>
    ${sample ? `<div class="pub-sample">${sample}</div>` : ''}
    <div id="updReport"></div>
    <div class="fgrid" style="margin-top:12px">
      <label class="f"><span>New version</span><input name="version" value="${esc(bump(cur))}" pattern="\\d+\\.\\d+\\.\\d+"></label>
      <div></div>
      <label class="f span2"><span>Patch notes <small>shown to players in their library</small></span><textarea name="notes" rows="4" placeholder="What changed in this version?"></textarea></label>
    </div>
    <div class="co-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-buy btn-lg" id="updGo" disabled>Publish update</button></div>
  </form>`, {
    onMount(el, close) {
      el.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
      const f = el.querySelector('#updForm');
      const use = async (name, buf) => {
        upd.pkg = { filename: name, dataBase64: b64(buf) };
        el.querySelector('#updDropT').textContent = name;
        try { upd.report = await api.publishing.inspect(name, upd.pkg.dataBase64); } catch (err) { upd.report = { ok: false, errors: [err.message], warnings: [] }; }
        const r = upd.report;
        el.querySelector('#updDropS').textContent = r.ok ? `${r.fileCount} files · ${bytes(r.sizeBytes)} · manifest v${r.manifest?.version ?? '?'}` : 'Package has problems';
        el.querySelector('#updReport').innerHTML = r.ok ? '' : `<div class="report bad"><ul>${r.errors.map((x) => `<li class="err">${esc(x)}</li>`).join('')}</ul></div>`;
        if (r.ok && r.manifest?.version && r.manifest.version !== cur) f.elements.version.value = r.manifest.version;
        el.querySelector('#updGo').disabled = !r.ok;
      };
      el.querySelector('#updFile').onchange = async (e) => { const file = e.target.files[0]; if (file) use(file.name, await readAs(file, 'buffer')); };
      // drag & drop onto the drop area (clicking it opens the file picker)
      const drop = el.querySelector('#updDrop');
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', async (e) => {
        e.preventDefault(); drop.classList.remove('over');
        const file = e.dataTransfer?.files?.[0];
        if (file) use(file.name, await readAs(file, 'buffer'));
      });
      // a file dropped anywhere else in the dialog shouldn't make the browser open it
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => e.preventDefault());
      el.querySelector('#updSample')?.addEventListener('click', async () => {
        f.elements.notes.value = 'The dusk update: Skylark now flies at sunset, and there is a new achievement — High Flyer — for flying 1,000 metres.';
        use('skylark-1.1.0.zip', await (await fetch('/creator/skylark-1.1.0.zip')).arrayBuffer());
      });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#updGo'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Publishing…';
        try {
          const r = await api.creator.publishVersion(g.id, { version: f.elements.version.value.trim(), releaseNotes: f.elements.notes.value, package: upd.pkg });
          await loadCatalog();
          el.innerHTML = `<div class="co co-done"><div class="co-check">✓</div><h3>${esc(g.title)} v${esc(r.version)} ${r.pendingReview ? 'is waiting for review' : 'is live'}</h3>${r.pendingReview ? '<p>Players keep the current version until we approve this update. We’ll email you when it’s live.</p>' : ''}
            <p class="muted">${r.previousVersion ? `Updated from v${esc(r.previousVersion)}. ` : ''}${r.delta.changedFiles} of ${r.delta.totalFiles} files changed — players with a downloaded copy fetch just <b>${bytes(r.delta.downloadBytes)}</b> instead of ${bytes(r.delta.totalBytes)}.</p>
            <div class="co-actions center"><a class="btn btn-ghost" href="/app/${esc(g.id)}" data-link data-close>View store page</a><button class="btn btn-buy" data-close>Done</button></div></div>`;
          el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
          onDone?.();
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Publish update';
          toast(esc(err.message), { kind: 'error', timeout: 6000 });
        }
      };
    },
  });
}
