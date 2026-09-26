// Creator portal (prototype): package → metadata → publish → live store page.
import { api } from '../api.js';
import { applyUserState, loadCatalog, state } from '../state.js';
import { go } from '../nav.js';
import { esc, price, bytes, icons, toast, $, $$ } from '../ui.js';

const PRICES = [0, 299, 499, 799, 999, 1499, 1999];
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
    <p class="muted">Upload an HTML/JS game package and it gets a live store page instantly.</p></div></div>
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
      <p class="muted">Any HTML/JS/WebGL game becomes a premium, ownable, instantly playable title. Package it, describe it, publish — the store page is live immediately.</p></div>
      <ol class="pub-steps"><li class="on" data-s="1"><b>1</b>Build<small>Web game + Lantern SDK</small></li><li data-s="2"><b>2</b>Package<small>.zip with manifest.json</small></li><li data-s="3"><b>3</b>Describe<small>Store metadata</small></li><li data-s="4"><b>4</b>Publish<small>Live instantly</small></li></ol>
    </div>
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
            <label class="f"><span>Price</span><select name="price">${PRICES.map((p) => `<option value="${p}" ${p === 499 ? 'selected' : ''}>${price(p)}</option>`).join('')}</select></label>
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
  return null;
}
