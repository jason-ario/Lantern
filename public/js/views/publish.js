// Creator portal (prototype): package → metadata → publish → live store page.
import { api } from '../api.js';
import { applyUserState, loadCatalog, state } from '../state.js';
import { go } from '../nav.js';
import { esc, price, bytes, icons, toast, modal, date, $, $$ } from '../ui.js';

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

function renderLocked(root) {
  const c = state.creator;
  root.innerHTML = `<div class="page publish">
    <div class="pub-head"><div><div class="eyebrow">Lantern Creator</div><h1>Publish a web game</h1>
    <p class="muted">Upload an HTML/JS game package and it gets a live store page instantly.</p>
    <p><a class="btn btn-ghost btn-sm" href="/developers" data-link>Read the creator guide</a></p></div></div>
    <div class="panel pub-lock">
      ${c.enabled ? `<h3>Creator access</h3>
      <p class="muted">Publishing on this server is limited to creators. Enter the creator password to continue.</p>
      <form id="loginForm" class="pub-lock-form">
        <input type="password" name="password" placeholder="Creator password" autocomplete="current-password" required>
        <button class="btn btn-buy">Unlock publishing</button>
      </form>` : `<h3>Publishing is turned off</h3>
      <p class="muted">This server has no creator password configured. The owner can enable publishing by setting the <code>ADMIN_PASSWORD</code> environment variable and restarting.</p>`}
    </div>
  </div>`;
  const f = root.querySelector('#loginForm');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true;
    try { applyUserState(await api.admin.login(f.elements.password.value)); toast('Creator access unlocked', { kind: 'ok' }); go('/publish'); }
    catch (err) { btn.disabled = false; toast(esc(err.message), { kind: 'error' }); f.elements.password.select(); }
  };
  return null;
}

export async function render(root) {
  applyUserState(await api.state());
  if (!state.creator.admin) return renderLocked(root);
  const form = { pkg: null, report: null, cover: null, shots: [] };
  root.innerHTML = `<div class="page publish">
    <div class="pub-head">
      <div><div class="eyebrow">Lantern Creator · Prototype</div><h1>Publish a web game</h1>
      <p class="muted">Any HTML/JS/WebGL game becomes a premium, ownable, instantly playable title. Package it, describe it, publish — the store page is live immediately.</p>
      <p class="pub-guide-link"><a href="/developers" data-link>New here? Read the creator guide →</a> <span class="muted small">SDK reference, packaging, pricing and the ${pct()} revenue share.</span></p></div>
      <ol class="pub-steps"><li class="on" data-s="1"><b>1</b>Build<small>Web game + Lantern SDK</small></li><li data-s="2"><b>2</b>Package<small>.zip with manifest.json</small></li><li data-s="3"><b>3</b>Describe<small>Store metadata</small></li><li data-s="4"><b>4</b>Publish<small>Live instantly</small></li></ol>
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
            <div><b id="dropTitle">Drop your build (.zip) here or click to choose</b><small id="dropSub">A folder with index.html, your JS/assets and a manifest.json. Up to 50 MB.</small></div>
          </label>
          <div class="pub-sample"><span class="muted small">No build handy?</span> <button type="button" class="btn btn-ghost btn-sm" id="useSample">Use sample package — “Skylark” (4 KB)</button></div>
          <div id="report"></div>
          <details class="pub-ref"><summary>How to make a Lantern package</summary>
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

        <section class="panel">
          <h3>Media</h3>
          <div class="fgrid">
            <label class="f"><span>Cover / key art <small>PNG, JPG or WebP</small></span><input type="file" name="cover" accept="image/png,image/jpeg,image/webp"></label>
            <label class="f"><span>Screenshots <small>up to 6</small></span><input type="file" name="shots" accept="image/png,image/jpeg,image/webp" multiple></label>
          </div>
          <p class="muted small">Leave media empty and Lantern generates placeholder key art — a stand-in for future AI-assisted store assets.</p>
        </section>

        <div class="pub-actions">
          <span class="muted small" id="pubHint">Add a valid package and a title to publish.</span>
          <button class="btn btn-buy btn-xl" id="publishBtn" type="submit" disabled>Publish to Lantern</button>
        </div>
      </form>

      <aside class="pub-preview">
        <div class="side-h">Live store preview</div>
        <div class="pv-capsule" id="pvCap"><div class="pv-cap-art" id="pvArt"><div class="logo logo-md" id="pvLogo">Your game</div></div>
          <div class="pv-cap-meta"><b id="pvTitle">Your game</b><span class="price" id="pvPrice">$4.99</span></div></div>
        <p class="pv-short muted" id="pvShort">Your short description appears here.</p>
        <div class="pv-tags" id="pvTags"></div>
        <div class="pv-facts" id="pvFacts"></div>
      </aside>
    </div>
  </div>`;

  const f = $('#pubForm', root);
  const val = (n) => f.elements[n].value.trim();
  const setStep = (n) => $$('.pub-steps li', root).forEach((li) => li.classList.toggle('on', +li.dataset.s <= n));

  const updatePreview = () => {
    const t = val('title') || 'Your game';
    $('#pvTitle', root).textContent = t;
    $('#pvLogo', root).textContent = t;
    $('#pvPrice', root).textContent = price(+val('price'));
    $('#earnHint', root).textContent = +val('price') ? `you earn up to ${money(Math.floor(+val('price') * share()))} per sale` : 'free games earn nothing';
    $('#pvShort', root).textContent = val('shortDescription') || 'Your short description appears here.';
    $('#pvTags', root).innerHTML = val('tags').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => `<span class="tag">${esc(x)}</span>`).join('');
    $('#pvFacts', root).innerHTML = form.report ? `<dl class="kv"><dt>Version</dt><dd>${esc(val('version'))}</dd><dt>Package</dt><dd>${bytes(form.report.sizeBytes)} · ${form.report.fileCount} files</dd><dt>SDK</dt><dd>${form.report.usesSdk ? 'Lantern SDK v1' : 'Not detected'}</dd><dt>Achievements</dt><dd>${form.report.manifest?.achievements?.length ?? 0}</dd><dt>Demo</dt><dd>${f.elements.demo.checked ? '5 minutes' : 'None'}</dd></dl>` : '';
    const ready = form.report?.ok && val('title').length >= 2;
    $('#publishBtn', root).disabled = !ready;
    $('#pubHint', root).textContent = ready ? 'Ready. Publishing creates version ' + val('version') + ' and a live store page.' : 'Add a valid package and a title to publish.';
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
        ${r.usesSdk ? '<li class="ok">Lantern Platform SDK v1 detected</li>' : ''}
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
    if (!val('description')) f.elements.description.value = 'Skylark is a tiny one-button flight game built in an afternoon.\n\nHold to climb, release to glide, and see how far the wind will carry you. Your best flight is saved to your Lantern account.';
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

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.report?.ok) return;
    setStep(4);
    const steps = ['Uploading package', 'Validating manifest & files', `Hashing ${form.report.fileCount} files`, `Creating version ${val('version')}`, 'Generating store page', 'Adding to your library'];
    const panel = document.createElement('div');
    panel.className = 'pub-progress';
    panel.innerHTML = `<h3>Publishing ${esc(val('title'))}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
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
          cover: form.cover, screenshots: form.shots, package: form.pkg,
        }),
        new Promise((res) => setTimeout(res, 1800)),
      ]);
      clearInterval(tick);
      lis.forEach((li) => { li.classList.remove('doing'); li.classList.add('done'); });
      await loadCatalog();
      applyUserState(r.state);
      panel.insertAdjacentHTML('beforeend', `<div class="pub-live">
        <div class="co-check">✓</div>
        <div><h3>${esc(val('title'))} is live on Lantern</h3><p class="muted">Version ${esc(r.version)} · build <span class="mono">${esc(r.buildHash.slice(0, 12))}</span> · immutable URL <span class="mono">/games/${esc(r.gameId)}/${esc(r.version)}/</span></p></div>
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
  new: ['New', 'In its discovery window on the “New on Lantern” shelf'],
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
      <div class="rk-score"><b>${Math.round(r.score)}</b><small>Lantern Score</small></div>
      <div class="rk-status"><span class="rk-pill st-${esc(r.status)}">${label}</span><p>${desc}.</p>
        ${r.window ? `<div class="rk-window"><div class="bar"><i style="width:${Math.min(100, (r.window.players / r.window.target) * 100)}%"></i></div><small>${Math.floor(r.window.players)} of ${r.window.target} players · ${r.window.daysLeft} days left in the discovery window. After that it's promoted if its score is ${r.promoteAt}+.</small></div>`
          : r.status === 'listed' ? `<small class="muted">Promotion happens automatically at a score of ${r.promoteAt}. Scores update as people play.</small>` : ''}
        ${r.status === 'needs_fix' ? `<small class="rk-warn">Only ${pctTxt(h.connectRate)} of recent launches connected to Lantern and ${pctTxt(h.errorRate)} hit uncaught errors. Fix the build and publish an update; it's re-checked automatically.</small>` : ''}
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
  if (!games.length && !catalog.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="sec-h"><h2>Your games</h2><span class="sec-note">Ship an update and every player gets it — installed copies download only the files that changed.</span>${catalog.length ? `<a href="#" id="mgAll">${showAll ? 'Only my games' : `Also show ${catalog.length} catalog games (local admin)`}</a>` : ''}</div>
    ${games.length ? '' : '<p class="muted small">You haven\'t published a game yet — use the form below.</p>'}
    <div class="mg-list">${games.map((g) => `<div class="mg-row">
      <span class="mg-art" style="background-image:url('${esc(g.media.header)}')"></span>
      <div class="mg-body"><b>${esc(g.title)}</b><span class="muted small">v${esc(g.currentVersion)} · ${g.owners} player${g.owners === 1 ? '' : 's'} · ${g.versions.length} version${g.versions.length === 1 ? '' : 's'}</span>
        <span class="mg-notes muted small">${esc((g.versions[0]?.notes ?? '').slice(0, 120))}</span></div>
      ${g.priceCents ? `<div class="mg-sales" title="${g.sales.testCount ? `${g.sales.testCount} of these were demo-wallet test purchases. ` : ''}Your ${pct()} share is before payment processing fees, taxes and refunds.">
        <b>${money(g.sales.creatorCents)}</b><span class="muted small">your share · ${g.sales.count} sale${g.sales.count === 1 ? '' : 's'}${g.sales.testCount ? ` (${g.sales.testCount} test)` : ''}</span></div>` : '<div class="mg-sales"><b>Free</b><span class="muted small">' + g.owners + ' claimed</span></div>'}
      ${g.ranking ? `<button class="mg-rank st-${esc(g.ranking.status)}" data-rank="${esc(g.id)}" title="How Lantern is ranking this game">${rankChip(g.ranking)}</button>` : ''}
      <div class="mg-actions"><a class="btn btn-ghost btn-sm" href="/app/${esc(g.id)}" data-link>Store page</a><button class="btn btn-buy btn-sm" data-update="${esc(g.id)}">Publish update</button></div>
    </div>${g.ranking ? `<div class="mg-detail" id="rank-${esc(g.id)}" hidden>${rankDetail(g.ranking)}</div>` : ''}`).join('')}</div>`;
  host.onclick = (e) => {
    const rk = e.target.closest('[data-rank]');
    if (rk) { const d = host.querySelector(`#rank-${CSS.escape(rk.dataset.rank)}`); d.hidden = !d.hidden; rk.classList.toggle('open', !d.hidden); return; }
    if (e.target.id === 'mgAll') { e.preventDefault(); host.dataset.all = showAll ? '0' : '1'; renderMyGames(host); return; }
    const b = e.target.closest('[data-update]');
    if (b) openUpdate(all.find((g) => g.id === b.dataset.update), () => renderMyGames(host));
  };
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
          el.innerHTML = `<div class="co co-done"><div class="co-check">✓</div><h3>${esc(g.title)} v${esc(r.version)} is live</h3>
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
