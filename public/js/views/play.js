// Game view: platform chrome around the sandboxed runtime.
import { api } from '../api.js';
import { state, applyUserState } from '../state.js';
import { GameRuntime } from '../runtime/host.js';
import { esc, logo, bytes, icons, toast, hours, price, $ } from '../ui.js';
import { go, previousPath } from '../nav.js';
import { openCheckout } from './checkout.js';

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export async function render(root, [id], query) {
  const g = state.byId.get(id);
  if (!g) { go('/store', { replace: true }); return null; }
  const owned = state.owned.has(id);
  let mode = owned ? 'full' : query.get('demo') ? 'demo' : 'full';
  if (!owned && mode === 'full') {
    if (g.demo) mode = 'demo';
    else { toast(`You don't own <b>${esc(g.title)}</b> yet`); go(`/app/${id}`, { replace: true }); return null; }
  }
  const exitTo = previousPath() ?? (owned ? `/library/${id}` : `/app/${id}`);

  root.innerHTML = `<div class="rt" id="rt">
    <div class="rt-bar">
      <button class="rt-btn rt-quit" id="rtQuit" title="Save and quit">${icons.close}<span>Quit</span></button>
      <div class="rt-title">
        <span class="rt-brand">LANTERN</span><span class="rt-sep"></span>
        <b>${esc(g.title)}</b><span class="rt-ver" id="rtVer"></span>
        ${mode === 'demo' ? '<span class="rt-demo" id="rtDemo">DEMO</span>' : ''}
      </div>
      <div class="rt-status">
        <span class="rt-save" id="rtSave">${icons.cloud}<span>Cloud save ready</span></span>
        <span class="rt-time" id="rtTime">${icons.clock}<span>0:00</span></span>
        ${mode === 'demo' ? `<button class="rt-btn rt-buy" id="rtBuy">Buy · ${price(g.priceCents)}</button>` : ''}
        <button class="rt-btn" id="rtFull" title="Fullscreen">${icons.expand}</button>
      </div>
    </div>
    <div class="rt-stage" id="rtStage">
      <div class="rt-splash" id="rtSplash" style="background-image:url('${esc(g.media.hero)}')">
        <div class="rt-splash-inner">${logo(g, 'xl')}
          <div class="rt-progress"><div></div></div>
          <div class="rt-splash-note" id="rtNote">Preparing sandbox…</div>
        </div>
      </div>
    </div>
    <div class="rt-veil hidden" id="rtVeil"></div>
    <div class="rt-ach-host" id="rtAch"></div>
  </div>`;

  let runtime = null;
  let closed = false;
  let demoLeft = null;
  const splashShownAt = performance.now();
  const setSave = (html, cls = '') => { const el = $('#rtSave', root); el.className = `rt-save ${cls}`; el.innerHTML = `${icons.cloud}<span>${html}</span>`; };

  let launch;
  try {
    launch = await api.runtime.launch(id, mode);
  } catch (err) {
    $('#rtNote', root).textContent = err.message;
    toast(esc(err.message), { kind: 'error' });
    setTimeout(() => go(exitTo), 1500);
    return null;
  }
  $('#rtVer', root).textContent = `v${launch.build.version}`;
  $('#rtNote', root).textContent = `Build ${launch.build.buildHash.slice(0, 8)} · ${bytes(launch.build.sizeBytes)} · ${launch.build.fileCount} files`;
  if (launch.session.demoSeconds) demoLeft = launch.session.demoSeconds;

  const showVeil = (html) => { const v = $('#rtVeil', root); v.innerHTML = html; v.classList.remove('hidden'); return v; };
  const hideVeil = () => $('#rtVeil', root).classList.add('hidden');

  async function quit({ navigate = true } = {}) {
    if (closed) return;
    closed = true;
    runtime?.pause();
    showVeil(`<div class="rt-closing"><div class="spinner lg"></div><div>Saving your progress…</div><small>Waiting for ${esc(g.title)} to sync with Lantern Cloud</small></div>`);
    const played = runtime?.activeSeconds ?? 0;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    await runtime?.close();
    state.running = null;
    api.state().then(applyUserState).catch(() => {});
    toast(`${icons.cloud} <b>${esc(g.title)}</b> — progress saved · ${played < 60 ? `${played}s` : hours(played)} this session`, { kind: 'ok' });
    if (navigate) go(exitTo);
  }

  const endDemo = () => {
    runtime.pause();
    const v = showVeil(`<div class="rt-demo-end">
      <div class="rde-art" style="background-image:url('${esc(g.media.header)}')">${logo(g, 'md')}</div>
      <h2>Your demo has ended</h2>
      <p>Everything you've done so far is saved. Buy ${esc(g.title)} and pick up exactly where you left off.</p>
      <div class="rde-actions"><button class="btn btn-buy btn-lg" data-buy>Buy · ${price(g.priceCents)}</button><button class="btn btn-ghost" data-quit>Save &amp; quit</button></div>
    </div>`);
    v.querySelector('[data-buy]').onclick = () => openCheckout(g, { inGame: true, onPurchased: unlockFull });
    v.querySelector('[data-quit]').onclick = () => quit();
  };
  const unlockFull = () => {
    demoLeft = null;
    $('#rtDemo', root)?.remove();
    $('#rtBuy', root)?.remove();
    hideVeil();
    runtime.resume();
  };

  runtime = new GameRuntime({
    services: api,
    container: $('#rtStage', root),
    launch,
    callbacks: {
      onLoaded() {
        const wait = Math.max(0, 450 - (performance.now() - splashShownAt));
        setTimeout(() => { $('#rtSplash', root)?.classList.add('gone'); runtime.focus(); }, wait);
      },
      onConnected() { setSave('Connected to Lantern Cloud', 'ok'); },
      onSaveState(s, at) {
        if (s === 'saving') setSave('Saving…', 'busy');
        else if (s === 'saved') setSave(`Saved ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`, 'ok');
        else setSave('Save failed', 'err');
      },
      onAchievement(a) {
        const el = document.createElement('div');
        el.className = 'ach-toast';
        el.innerHTML = `<div class="ach-toast-ico">${icons.trophy}</div><div><small>Achievement unlocked</small><b>${esc(a.name)}</b><span>${esc(a.description)}</span></div>`;
        $('#rtAch', root).appendChild(el);
        requestAnimationFrame(() => el.classList.add('in'));
        setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, 4500);
      },
      onTick(secs) {
        $('#rtTime span', root).textContent = clock(secs);
        if (demoLeft !== null && !runtime.paused) {
          const left = demoLeft - secs;
          const d = $('#rtDemo', root);
          if (d) { d.textContent = `DEMO ${clock(Math.max(0, left))}`; d.classList.toggle('warn', left <= 30); }
          if (left <= 0) endDemo();
        }
      },
      onExitRequested() { quit(); },
    },
  });
  state.running = { gameId: id };
  runtime.start();

  $('#rtQuit', root).onclick = () => quit();
  $('#rtBuy', root)?.addEventListener('click', () => { runtime.pause(); openCheckout(g, { inGame: true, onPurchased: unlockFull }); });
  $('#rtFull', root).onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else $('#rt', root).requestFullscreen?.().then(() => runtime.focus()).catch(() => {});
  };
  // Resume if the checkout was dismissed without buying (demo still running).
  const onModalClose = new MutationObserver(() => {
    if (!document.querySelector('.modal-wrap') && runtime.paused && !closed && $('#rtVeil', root).classList.contains('hidden')) runtime.resume();
  });
  onModalClose.observe(document.body, { childList: true });

  // Route change away (e.g. browser Back) → graceful save & close.
  return async () => {
    onModalClose.disconnect();
    await quit({ navigate: false });
    root.innerHTML = '';
  };
}
