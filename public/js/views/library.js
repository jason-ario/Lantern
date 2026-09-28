import { api } from '../api.js';
import { state } from '../state.js';
import { esc, logo, hours, ago, date, bytes, icons, toast, $, $$ } from '../ui.js';
import * as packages from '../offline/packages.js';
import { services } from '../offline/sync.js';

const semverDesc = (a, b) => { const x = a.version.split('.').map(Number), y = b.version.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (y[i] || 0) - (x[i] || 0); return 0; };

// Offline copy status + actions for one game (used on the library detail page).
function offlineBlock(g) {
  if (!packages.supported()) return '<div class="inst-row"><span class="inst-dot"></span><div><b>Offline copy</b><small>Not supported in this browser</small></div></div>';
  const st = packages.status(g), inst = packages.installed(g.id);
  if (packages.installing(g.id)) return `<div class="inst-row"><span class="inst-dot busy"></span><div><b>Offline copy</b><small id="instProg">Downloading…</small><div class="inst-bar"><div id="instBar"></div></div></div></div>`;
  if (st === 'none') return `<div class="inst-row"><span class="inst-dot"></span><div><b>Offline copy</b><small>Not downloaded · ${g.version ? bytes(g.version.sizeBytes) : ''}</small></div><button class="btn btn-ghost btn-sm" data-offline="install">Download</button></div>`;
  if (st === 'update') return `<div class="inst-row"><span class="inst-dot warn"></span><div><b>Update available</b><small>v${esc(inst.version)} → v${esc(g.version.version)} · only changed files download</small></div><button class="btn btn-buy btn-sm" data-offline="install">Update</button></div>`;
  return `<div class="inst-row"><span class="inst-dot on"></span><div><b>Ready offline</b><small>v${esc(inst.version)} · ${bytes(inst.sizeBytes)} · ${icons.shield} signature &amp; files verified</small></div><button class="link-btn" data-offline="remove">Remove</button></div>`;
}

function sideItem(g, active) {
  return `<a class="lib-item ${active ? 'on' : ''}" href="/library/${esc(g.id)}" data-link data-title="${esc(g.title.toLowerCase())}">
    <span class="lib-item-ico" style="background-image:url('${esc(g.media.cover)}')"></span><span class="lib-item-t">${esc(g.title)}</span></a>`;
}

export async function render(root, [id]) {
  const lib = await api.library();
  const entries = lib.map((e) => ({ ...e, g: state.byId.get(e.gameId) })).filter((e) => e.g);
  const recent = entries.filter((e) => e.lastPlayedAt).sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
  const alpha = [...entries].sort((a, b) => a.g.title.localeCompare(b.g.title));

  root.innerHTML = `<div class="lib">
    <aside class="lib-side">
      <div class="lib-search">${icons.search}<input id="libFilter" type="search" placeholder="Search your library" aria-label="Search your library"></div>
      <a class="lib-home ${id ? '' : 'on'}" href="/library" data-link>${icons.grid} Library home</a>
      ${recent.length ? `<div class="lib-group">Recent</div>${recent.slice(0, 4).map((e) => sideItem(e.g, e.g.id === id)).join('')}` : ''}
      <div class="lib-group">All games <span>(${entries.length})</span></div>
      ${alpha.map((e) => sideItem(e.g, e.g.id === id)).join('')}
    </aside>
    <section class="lib-main" id="libMain"></section>
  </div>`;

  $('#libFilter', root).addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.lib-item', root).forEach((a) => { a.style.display = !q || a.dataset.title.includes(q) ? '' : 'none'; });
  });

  const main = $('#libMain', root);
  if (!id) return renderHome(main, entries, recent);
  const entry = entries.find((e) => e.gameId === id);
  if (!entry) {
    main.innerHTML = `<div class="empty-state"><h2>Not in your library</h2><p>You don't own this game yet.</p><a class="btn btn-buy" href="/app/${esc(id)}" data-link>View in Store</a></div>`;
    return null;
  }
  return renderDetail(main, entry);
}

function renderHome(main, entries, recent) {
  if (!entries.length) {
    main.innerHTML = `<div class="empty-state"><h2>Your library is waiting</h2><p>Games you buy live here forever and launch in about a second.</p><a class="btn btn-buy" href="/store" data-link>Browse the Store</a></div>`;
    return null;
  }
  const total = entries.reduce((t, e) => t + e.playtimeSeconds, 0);
  const ach = entries.reduce((t, e) => t + e.achievements.unlocked, 0);
  const achTotal = entries.reduce((t, e) => t + e.achievements.total, 0);
  const badge = (g) => { const st = packages.status(g); return st === 'update' ? '<span class="lib-badge upd">Update</span>' : st === 'ready' ? `<span class="lib-badge off" title="Downloaded — plays offline">${icons.box}</span>` : ''; };
  const updates = entries.filter((e) => packages.status(e.g) === 'update');
  const card = (e, big) => `<div class="lib-card ${big ? 'big' : ''}">${badge(e.g)}
      <a class="lib-card-art" href="/library/${esc(e.g.id)}" data-link style="background-image:url('${esc(e.g.media.cover)}')">${logo(e.g, 'cover')}</a>
      <a class="lib-card-play" href="/play/${esc(e.g.id)}" data-link aria-label="Play ${esc(e.g.title)}">${icons.play}</a>
      <div class="lib-card-meta">${big ? `<b>${esc(e.g.title)}</b>` : ''}<span>${e.lastPlayedAt ? `${ago(e.lastPlayedAt)} · ${hours(e.playtimeSeconds)}` : 'Not played yet'}</span></div>
    </div>`;
  main.innerHTML = `<div class="lib-home-wrap">
    ${updates.length ? `<div class="upd-strip"><div>${icons.box}<b>${updates.length} update${updates.length === 1 ? '' : 's'} ready</b><span class="muted">${updates.map((e) => `${esc(e.g.title)} v${esc(packages.installed(e.g.id).version)} → v${esc(e.g.version.version)}`).join(' · ')}</span></div><button class="btn btn-buy btn-sm" id="updAll">Update all</button></div>` : ''}
    <div class="lib-stats">
      <div><b>${entries.length}</b><span>Games</span></div>
      <div><b>${hours(total)}</b><span>Total playtime</span></div>
      <div><b>${ach}<small>/${achTotal}</small></b><span>Achievements</span></div>
      <div><b>${recent.length}</b><span>Played</span></div>
    </div>
    ${recent.length ? `<div class="sec-h"><h2>Recent games</h2></div><div class="lib-shelf">${recent.slice(0, 5).map((e) => card(e, true)).join('')}</div>` : ''}
    <div class="sec-h"><h2>All games <span class="muted">(${entries.length})</span></h2><span class="sec-note">Sorted by name</span></div>
    <div class="lib-grid">${[...entries].sort((a, b) => a.g.title.localeCompare(b.g.title)).map((e) => card(e, false)).join('')}</div>
  </div>`;
  $('#updAll', main)?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Updating…';
    for (const e of updates) {
      try { const r = await packages.install(e.g.id); toast(`<b>${esc(e.g.title)}</b> updated to v${esc(r.version)} · ${bytes(r.downloadedBytes)} downloaded`, { kind: 'ok' }); }
      catch (err) { toast(`${esc(e.g.title)}: ${esc(err.message)}`, { kind: 'error' }); }
    }
    renderHome(main, entries, recent);
  });
  return null;
}

async function renderDetail(main, entry) {
  const g = entry.g;
  main.innerHTML = `<div class="lib-detail">
    <div class="ld-hero" style="background-image:url('${esc(g.media.hero)}')">${logo(g, 'xl')}</div>
    <div class="ld-bar">
      <a class="btn btn-play btn-xl" href="/play/${esc(g.id)}" data-link>${icons.play} Play</a>
      <div class="ld-stat"><small>Last played</small><b>${ago(entry.lastPlayedAt)}</b></div>
      <div class="ld-stat"><small>Play time</small><b>${hours(entry.playtimeSeconds)}</b></div>
      <div class="ld-stat ld-ach"><small>Achievements</small><b>${entry.achievements.unlocked}/${entry.achievements.total}</b>
        <div class="ld-meter"><div style="width:${entry.achievements.total ? (entry.achievements.unlocked / entry.achievements.total) * 100 : 0}%"></div></div></div>
      <div class="ld-stat"><small>Cloud status</small><b class="ok">${icons.cloud} Synced</b></div>
      <div class="ld-links"><a class="btn btn-ghost" href="/app/${esc(g.id)}" data-link>Store page</a></div>
    </div>
    <div class="ld-body">
      <div class="ld-col">
        <section class="panel"><h3>Achievements</h3><div id="ldAch" class="ach-list"><div class="muted">Loading…</div></div></section>
        <section class="panel"><h3>Cloud saves <span class="muted small">— written by the game through Platform.storage</span></h3><div id="ldSaves"><div class="muted">Loading…</div></div></section>
        <section class="panel"><h3>What's new</h3><div id="ldNews"><div class="muted">Loading…</div></div></section>
      </div>
      <div class="ld-col side">
        <section class="panel">
          <h3>Installation</h3>
          <div class="inst-row"><span class="inst-dot on"></span><div><b>Web</b><small>Always the latest version · streams instantly</small></div></div>
          <div id="offlineBlock">${offlineBlock(g)}</div>
          <div class="inst-row"><span class="inst-dot"></span><div><b>Desktop app</b><small>Coming soon · uses the same signed packages</small></div></div>
          ${g.version ? `<dl class="kv"><dt>Version</dt><dd>${esc(g.version.version)}</dd><dt>Package</dt><dd>${bytes(g.version.sizeBytes)} · ${g.version.fileCount} files</dd><dt>Build</dt><dd class="mono">${esc(g.version.buildHash.slice(0, 12))}</dd></dl>` : ''}
        </section>
        <section class="panel">
          <h3>Ownership</h3>
          <dl class="kv"><dt>Acquired</dt><dd>${date(entry.acquiredAt)}</dd><dt>Source</dt><dd>${entry.source === 'developer' ? 'Developer copy' : 'Purchased'}</dd><dt>Sessions</dt><dd>${entry.sessions}</dd><dt>Developer</dt><dd>${esc(g.developer?.name ?? '')}</dd></dl>
        </section>
      </div>
    </div>
  </div>`;

  const block = $('#offlineBlock', main);
  const refreshBlock = () => { if (block.isConnected) block.innerHTML = offlineBlock(g); };
  block.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-offline]');
    if (!b) return;
    if (b.dataset.offline === 'remove') { await packages.remove(g.id); toast(`Removed the offline copy of <b>${esc(g.title)}</b>`); refreshBlock(); return; }
    const p = packages.install(g.id, { onProgress: (x) => { const bar = $('#instBar', main), t = $('#instProg', main); if (bar) bar.style.width = `${x.total ? (x.done / x.total) * 100 : 0}%`; if (t) t.textContent = `${bytes(x.done)} of ${bytes(x.total)}`; } });
    refreshBlock();
    try {
      const r = await p;
      toast(r.previous ? `<b>${esc(g.title)}</b> updated v${esc(r.previous)} → v${esc(r.version)} · downloaded ${bytes(r.downloadedBytes)}, reused ${r.reusedFiles} unchanged file${r.reusedFiles === 1 ? '' : 's'}` : `<b>${esc(g.title)}</b> is ready to play offline`, { kind: 'ok' });
    } catch (err) { toast(esc(err.message), { kind: 'error' }); }
    refreshBlock();
  });

  let detail, saves;
  try { [detail, saves] = await Promise.all([api.game(g.id), services.saves.list(g.id)]); } catch { return null; } // e.g. navigated away
  if (!detail || !main.isConnected) return null;
  const achs = [...detail.achievements].sort((a, b) => (b.unlockedAt ? 1 : 0) - (a.unlockedAt ? 1 : 0));
  $('#ldAch', main).innerHTML = achs.map((a) => `<div class="ach ${a.unlockedAt ? 'got' : ''}"><div class="ach-ico">${icons.trophy}</div><div><div class="ach-n">${esc(a.name)}</div><div class="ach-d">${esc(a.description)}</div></div><div class="ach-when">${a.unlockedAt ? date(a.unlockedAt) : 'Locked'}</div></div>`).join('') || '<div class="muted">This game has no achievements.</div>';
  $('#ldSaves', main).innerHTML = saves.length
    ? `<table class="saves"><thead><tr><th>Key</th><th>Size</th><th>Revision</th><th>Last written</th></tr></thead><tbody>${saves.map((s) => `<tr><td class="mono">${esc(s.key)}</td><td>${bytes(s.sizeBytes)}</td><td>#${s.revision}</td><td>${ago(s.updatedAt)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">No saves yet — play the game and they will appear here.</div>';
  const vers = [...(detail.versions ?? [])].filter((v) => !v.version.includes('placeholder')).sort(semverDesc);
  $('#ldNews', main).innerHTML = vers.length ? vers.slice(0, 5).map((v, i) => `<div class="news ${i === 0 ? 'latest' : ''}"><div class="news-h"><b>v${esc(v.version)}</b>${i === 0 ? '<span class="news-tag">Current</span>' : ''}<span class="muted small">${date(v.releasedAt)}</span></div><p>${esc(v.notes || 'Initial release.')}</p></div>`).join('') : '<div class="muted">No release notes yet.</div>';
  return null;
}
