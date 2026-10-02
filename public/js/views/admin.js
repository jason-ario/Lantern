// Admin console (/admin): review queue, reports, games, orders & refunds,
// accounts, creators, site settings and the email outbox.
import { api } from '../api.js';
import { state, applyUserState, loadCatalog } from '../state.js';
import { esc, toast, modal, date, ago, bytes, price, hours, vibeChips } from '../ui.js';
import { go } from '../nav.js';

const TABS = [['queue', 'Review queue'], ['reports', 'Reports'], ['games', 'Games'], ['orders', 'Orders & refunds'], ['accounts', 'Accounts'], ['creators', 'Creators'], ['settings', 'Settings'], ['outbox', 'Email outbox']];
const LISTING = { pending: 'Awaiting review', live: 'Live', rejected: 'Changes requested', removed: 'Taken down' };
const listingPill = (l) => `<span class="lst lst-${esc(l)}">${esc(LISTING[l] ?? l)}</span>`;
const REASONS = { broken: 'Doesn’t work', malware: 'Malware / suspicious', stolen: 'Stolen content', offensive: 'Offensive', misleading: 'Misleading store page', spam: 'Spam', other: 'Other' };

// Small "note" dialog used for approve / reject / takedown.
function withNote(title, { required = false, label = 'Note to the creator', cta = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    modal(`<form class="confirm"><h3>${esc(title)}</h3>
      <label class="f"><span>${esc(label)}${required ? '' : ' <small>optional</small>'}</span><textarea name="note" rows="4" ${required ? 'required' : ''}></textarea></label>
      <div class="co-actions"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-buy'}">${esc(cta)}</button></div></form>`, {
      onMount(el, close) {
        el.querySelector('[data-close]').onclick = () => { close(); resolve(null); };
        el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = e.target.note.value.trim(); if (required && !v) return; close(); resolve(v); };
      },
    });
  });
}

async function renderQueue(el) {
  const q = await api.admin.queue();
  const card = (g) => `<article class="adm-card">
    <div class="adm-art" style="background-image:url('${esc(g.media?.header ?? '')}')"></div>
    <div class="adm-main">
      <h4>${esc(g.title)} ${listingPill(g.listing)}</h4>
      <div class="muted small">by ${esc(g.creator?.name ?? '—')} ${g.creator?.email ? `· ${esc(g.creator.email)}` : ''} · submitted ${ago(g.submittedAt)} · v${esc(g.version?.version ?? '?')} · ${bytes(g.version?.sizeBytes ?? 0)} · ${price(g.priceCents)}</div>
      <p>${esc(g.shortDescription)}</p>
      <div class="adm-tags">${(g.tags ?? []).map((t) => `<span class="genre">${esc(t)}</span>`).join('')} ${vibeChips(g.builtWith, { max: 5, size: 'sm' })}</div>
    </div>
    <div class="adm-actions">
      <a class="btn btn-ghost btn-sm" href="/app/${esc(g.id)}" data-link>Store page</a>
      <a class="btn btn-ghost btn-sm" href="/play/${esc(g.id)}" data-link>Play it</a>
      <button class="btn btn-ghost btn-sm" data-g="${esc(g.id)}" data-act="reject">Request changes</button>
      <button class="btn btn-play btn-sm" data-g="${esc(g.id)}" data-act="approve">Approve</button>
    </div>
  </article>`;
  const upd = (u) => `<article class="adm-card">
    <div class="adm-art" style="background-image:url('${esc(u.media?.header ?? '')}')"></div>
    <div class="adm-main">
      <h4>${esc(u.title)} <span class="lst lst-pending">Update ${esc(u.currentVersion ?? '')} → ${esc(u.version)}</span></h4>
      <div class="muted small">by ${esc(u.creator?.name ?? '—')} · ${ago(u.submittedAt)} · ${u.fileCount} files · ${bytes(u.sizeBytes)}</div>
      <p class="adm-notes">${esc(u.notes)}</p>
    </div>
    <div class="adm-actions">
      <button class="btn btn-ghost btn-sm" data-playv="${esc(u.id)}" data-game="${esc(u.gameId)}">Play this build</button>
      <button class="btn btn-ghost btn-sm" data-v="${esc(u.id)}" data-act="reject">Request changes</button>
      <button class="btn btn-play btn-sm" data-v="${esc(u.id)}" data-act="approve">Approve update</button>
    </div>
  </article>`;
  el.innerHTML = `
    <h3 class="adm-h">New games <span class="count">${q.games.length}</span></h3>
    ${q.games.map(card).join('') || '<p class="muted">Nothing waiting. 🎉</p>'}
    <h3 class="adm-h">Updates <span class="count">${q.updates.length}</span></h3>
    ${q.updates.map(upd).join('') || '<p class="muted">No updates waiting.</p>'}`;
  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    const pv = e.target.closest('[data-playv]');
    if (pv) { sessionStorage.setItem('vibe.reviewVersion', JSON.stringify({ gameId: pv.dataset.game, versionId: pv.dataset.playv })); go(`/play/${pv.dataset.game}`); return; }
    if (!b) return;
    const approve = b.dataset.act === 'approve';
    const note = await withNote(approve ? 'Approve and go live?' : 'What should the creator change?', { required: !approve, cta: approve ? 'Approve' : 'Send back' });
    if (note === null) return;
    try {
      if (b.dataset.g) await api.admin.gameAction(b.dataset.g, b.dataset.act, note);
      else await api.admin.versionAction(b.dataset.v, b.dataset.act, note);
      toast(approve ? 'Approved and live' : 'Sent back to the creator', { kind: 'ok' });
      await loadCatalog(); renderQueue(el);
    } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  };
}

async function renderReports(el, status = 'open') {
  const rows = await api.admin.reports(status);
  el.innerHTML = `<div class="adm-filter">${['open', 'resolved', 'dismissed', 'all'].map((s) => `<button data-st="${s}" class="${s === status ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
    ${rows.map((r) => `<article class="adm-card slim">
      <div class="adm-main">
        <h4>${r.type === 'game' ? 'Game' : 'Review'} · <a href="/app/${esc(r.game.id)}" data-link>${esc(r.game.title)}</a> <span class="lst lst-pending">${esc(REASONS[r.reason] ?? r.reason)}</span></h4>
        <div class="muted small">${ago(r.createdAt)} · reported by ${esc(r.reporter?.name ?? 'guest')} · ${esc(r.status)}</div>
        ${r.details ? `<p>${esc(r.details)}</p>` : ''}
        ${r.review ? `<blockquote>${r.review.up ? '👍' : '👎'} ${esc(r.review.author ?? '')}: ${esc(r.review.text || '(no text)')}</blockquote>` : ''}
      </div>
      ${r.status === 'open' ? `<div class="adm-actions"><button class="btn btn-ghost btn-sm" data-rep="${esc(r.id)}" data-act="dismiss">Dismiss</button><button class="btn btn-danger btn-sm" data-rep="${esc(r.id)}" data-act="remove">${r.type === 'game' ? 'Take game down' : 'Delete review'}</button></div>` : ''}
    </article>`).join('') || '<p class="muted">No reports here.</p>'}`;
  el.onclick = async (e) => {
    const f = e.target.closest('[data-st]'); if (f) { renderReports(el, f.dataset.st); return; }
    const b = e.target.closest('[data-rep]'); if (!b) return;
    try { await api.admin.resolveReport(b.dataset.rep, b.dataset.act); toast('Report resolved', { kind: 'ok' }); await loadCatalog(); renderReports(el, status); } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  };
}

async function renderGames(el, q = '') {
  const rows = await api.admin.games(q);
  el.innerHTML = `<form class="adm-search" id="gSearch"><input name="q" placeholder="Search games" value="${esc(q)}"><button class="btn btn-ghost btn-sm">Search</button></form>
    <table class="adm-table"><thead><tr><th>Game</th><th>Status</th><th>Creator</th><th>Sales</th><th>Reports</th><th></th></tr></thead><tbody>
    ${rows.map((g) => `<tr>
      <td><a href="/app/${esc(g.id)}" data-link><b>${esc(g.title)}</b></a>${g.sample ? ' <span class="sample-pill">Sample</span>' : ''}<div class="muted small">v${esc(g.version?.version ?? '—')} · ${price(g.priceCents)}</div></td>
      <td>${listingPill(g.listing)}</td>
      <td>${esc(g.creator?.name ?? (g.sample ? 'Sample content' : '—'))}<div class="muted small">${esc(g.creator?.email ?? '')}</div></td>
      <td>${g.sales.count}${g.sales.refunds ? ` <span class="muted small">(${g.sales.refunds} refunded)</span>` : ''}</td>
      <td>${g.openReports || ''}</td>
      <td class="adm-row-actions">${g.listing === 'live' ? `<button class="btn btn-danger btn-sm" data-g="${esc(g.id)}" data-act="takedown">Take down</button>` : g.listing === 'removed' ? `<button class="btn btn-ghost btn-sm" data-g="${esc(g.id)}" data-act="restore">Restore</button>` : `<button class="btn btn-play btn-sm" data-g="${esc(g.id)}" data-act="approve">Approve</button>`}</td>
    </tr>`).join('')}</tbody></table>`;
  el.querySelector('#gSearch').onsubmit = (e) => { e.preventDefault(); renderGames(el, e.target.q.value.trim()); };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const note = b.dataset.act === 'takedown' ? await withNote('Take this game off the store?', { label: 'Reason (kept in the moderation log)', cta: 'Take down', danger: true }) : '';
    if (note === null) return;
    try { await api.admin.gameAction(b.dataset.g, b.dataset.act, note); toast('Done', { kind: 'ok' }); await loadCatalog(); renderGames(el, q); } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  };
}

async function renderOrders(el, q = '') {
  const rows = await api.admin.orders(q);
  el.innerHTML = `<form class="adm-search" id="oSearch"><input name="q" placeholder="Order id, buyer email or game id" value="${esc(q)}"><button class="btn btn-ghost btn-sm">Search</button></form>
    <table class="adm-table"><thead><tr><th>Order</th><th>Game</th><th>Buyer</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((o) => `<tr>
      <td class="mono">${esc(o.id)}<div class="muted small">${date(o.paidAt ?? o.createdAt)} · ${esc(o.provider)}</div></td>
      <td>${esc(o.title)}</td>
      <td>${esc(o.buyer?.name ?? '—')}<div class="muted small">${esc(o.buyer?.email ?? 'guest')}</div></td>
      <td>${price(o.amountCents)}${o.taxCents ? ` <span class="muted small">+ ${price(o.taxCents)} tax</span>` : ''}</td>
      <td>${o.status === 'refunded' ? `<span class="lst lst-removed">Refunded</span><div class="muted small">by ${esc(o.refundedBy ?? '')}</div>` : `<span class="lst lst-live">${esc(o.status)}</span>`}</td>
      <td class="adm-row-actions">${o.status === 'paid' ? `<button class="btn btn-ghost btn-sm" data-refund="${esc(o.id)}">Refund</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No paid orders yet.</td></tr>'}</tbody></table>`;
  el.querySelector('#oSearch').onsubmit = (e) => { e.preventDefault(); renderOrders(el, e.target.q.value.trim()); };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-refund]'); if (!b) return;
    const reason = await withNote('Refund this order?', { label: 'Reason', cta: 'Refund', danger: true });
    if (reason === null) return;
    try { await api.admin.refund(b.dataset.refund, reason); toast('Refunded. The buyer has been emailed.', { kind: 'ok' }); renderOrders(el, q); } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  };
}

const ACCOUNT_FILTERS = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['unconfirmed', 'Unconfirmed'], ['creators', 'Creators']];
async function renderAccounts(el, filter = 'all', q = '') {
  const { summary: s, users, matched } = await api.admin.accounts(filter, q);
  const tile = (n, label, sub = '', f = '') => `<button type="button" class="adm-stat${f === filter ? ' on' : ''}" ${f ? `data-f="${f}"` : 'disabled'}><b>${n}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  el.innerHTML = `<div class="adm-stats">
      ${tile(s.total, 'Accounts set up', s.newThisWeek ? `+${s.newThisWeek} this week` : 'none new this week', 'all')}
      ${tile(s.active30d, 'Active', `last ${s.activeDays} days · ${s.active7d} this week · ${s.active24h} today`, 'active')}
      ${tile(s.inactive, 'Inactive', `no visit in ${s.activeDays}+ days`, 'inactive')}
      ${tile(s.unconfirmed, 'Unconfirmed email', `${s.verified} confirmed`, 'unconfirmed')}
      ${tile(s.creators, 'Creators', 'active creator accounts', 'creators')}
    </div>
    <div class="adm-filter">${ACCOUNT_FILTERS.map(([k, l]) => `<button data-f="${k}" class="${k === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
    <form class="adm-search" id="aSearch"><input name="q" placeholder="Search name, username or email" value="${esc(q)}"><button class="btn btn-ghost btn-sm">Search</button></form>
    <p class="muted small">${matched} account${matched === 1 ? '' : 's'} shown, most recently active first. “Active” means signed in and used the site in the last ${s.activeDays} days.</p>
    <table class="adm-table"><thead><tr><th>Account</th><th>Status</th><th>Last active</th><th>Joined</th><th>Library</th><th>Playtime</th><th>Role</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr>
      <td><b>${esc(u.name)}</b>${u.username ? ` <span class="muted small">@${esc(u.username)}</span>` : ''}<div class="muted small">${esc(u.email ?? '(no email)')}${u.google ? ' · Google' : ''}</div></td>
      <td>${u.active ? '<span class="lst lst-live">Active</span>' : '<span class="lst lst-removed">Inactive</span>'}${u.verified ? '' : '<div><span class="lst lst-pending">Email not confirmed</span></div>'}</td>
      <td>${u.lastActiveAt ? `${ago(u.lastActiveAt)}<div class="muted small">${date(u.lastActiveAt)}</div>` : '—'}</td>
      <td>${u.memberSince ? date(u.memberSince) : '—'}</td>
      <td>${u.games ? `${u.games} game${u.games === 1 ? '' : 's'}` : '<span class="muted small">—</span>'}</td>
      <td>${u.playtimeSeconds ? hours(u.playtimeSeconds) : '<span class="muted small">—</span>'}</td>
      <td>${[u.admin ? 'Admin' : '', u.creator === 'active' ? 'Creator' : u.creator === 'suspended' ? 'Creator (suspended)' : ''].filter(Boolean).join('<br>') || '<span class="muted small">Player</span>'}</td>
      <td class="adm-row-actions"><button class="btn btn-ghost btn-sm" data-acct="${esc(u.id)}">Library</button></td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">No accounts match.</td></tr>'}</tbody></table>`;
  el.querySelector('#aSearch').onsubmit = (e) => { e.preventDefault(); renderAccounts(el, filter, e.target.q.value.trim()); };
  el.onclick = (e) => {
    const a = e.target.closest('[data-acct]'); if (a) { showAccountLibrary(a.dataset.acct); return; }
    const f = e.target.closest('[data-f]'); if (f) renderAccounts(el, f.dataset.f, q);
  };
}

const HOW = { purchase: 'Bought', developer: 'Creator’s own game', demo: 'Demo only', refunded: 'Refunded' };
async function showAccountLibrary(id) {
  let d;
  try { d = await api.admin.account(id); } catch (err) { toast(esc(err.message), { kind: 'error' }); return; }
  const { user: u, totals: t, library } = d;
  const how = (x) => x.owned
    ? `${esc(HOW[x.source] ?? x.source)}${x.source === 'purchase' && x.pricePaidCents != null ? ` · ${price(x.pricePaidCents)}` : ''}${x.acquiredAt ? `<div class="muted small">${date(x.acquiredAt)}</div>` : ''}`
    : `<span class="muted small">${esc(HOW[x.source] ?? 'Not owned')}</span>`;
  modal(`<div class="adm-lib">
      <div class="adm-lib-head"><div><h3>${esc(u.name)}’s library</h3><div class="muted small">${esc(u.email ?? '')}${u.memberSince ? ` · joined ${date(u.memberSince)}` : ''}</div></div><button type="button" class="btn btn-ghost btn-sm" data-close>Close</button></div>
      <div class="adm-stats">
        <div class="adm-stat"><b>${t.owned}</b><span>Games owned</span></div>
        <div class="adm-stat"><b>${hours(t.playtimeSeconds)}</b><span>Total playtime</span><small>${t.sessions} session${t.sessions === 1 ? '' : 's'}</small></div>
        <div class="adm-stat"><b>${t.lastPlayedAt ? esc(ago(t.lastPlayedAt)) : '—'}</b><span>Last played</span></div>
      </div>
      <table class="adm-table"><thead><tr><th>Game</th><th>How they got it</th><th>Playtime</th><th>Sessions</th><th>Last played</th><th>Achievements</th></tr></thead><tbody>
      ${library.map((x) => `<tr>
        <td><a href="/app/${esc(x.gameId)}" data-link data-close-link><b>${esc(x.title)}</b></a>${x.listing !== 'live' ? ` ${listingPill(x.listing)}` : ''}</td>
        <td>${how(x)}</td>
        <td>${x.playtimeSeconds ? hours(x.playtimeSeconds) : '<span class="muted small">Not played</span>'}</td>
        <td>${x.sessions || '—'}</td>
        <td>${x.lastPlayedAt ? `${ago(x.lastPlayedAt)}<div class="muted small">${date(x.lastPlayedAt)}</div>` : '—'}</td>
        <td>${x.achievements.total ? `${x.achievements.unlocked}/${x.achievements.total}` : '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No games yet.</td></tr>'}</tbody></table>
    </div>`, {
    cls: 'modal-wide',
    onMount(el, close) {
      el.querySelector('[data-close]').onclick = close;
      el.querySelectorAll('[data-close-link]').forEach((a) => a.addEventListener('click', close));
    },
  });
}

async function renderCreators(el) {
  const rows = await api.admin.creators();
  el.innerHTML = `<table class="adm-table"><thead><tr><th>Creator</th><th>Since</th><th>Games</th><th>Payouts</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((c) => `<tr>
      <td><b>${esc(c.name)}</b><div class="muted small">${esc(c.email ?? '')}</div></td>
      <td>${c.since ? date(c.since) : '—'}</td>
      <td>${c.games.map((g) => `<a href="/app/${esc(g.id)}" data-link>${esc(g.title)}</a> ${listingPill(g.listing)}`).join('<br>') || '—'}</td>
      <td>${c.payoutsReady ? '<span class="lst lst-live">Ready</span>' : '<span class="muted small">Not set up</span>'}</td>
      <td>${c.creator === 'active' ? '<span class="lst lst-live">Active</span>' : '<span class="lst lst-removed">Suspended</span>'}</td>
      <td class="adm-row-actions">${c.creator === 'active' ? `<button class="btn btn-ghost btn-sm" data-c="${esc(c.id)}" data-act="suspend">Suspend</button>` : `<button class="btn btn-ghost btn-sm" data-c="${esc(c.id)}" data-act="reinstate">Reinstate</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No creators yet.</td></tr>'}</tbody></table>`;
  el.onclick = async (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    try { await api.admin.creatorAction(b.dataset.c, b.dataset.act); toast('Updated', { kind: 'ok' }); renderCreators(el); } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  };
}

async function renderSettings(el) {
  const s = await api.admin.settings();
  el.innerHTML = `<section class="panel">
      <h3>Game review</h3>
      <p class="muted small">When on, new games and updates from creators wait in the review queue before players see them. Admins’ own uploads always go live straight away.</p>
      <div class="seg" id="apprSeg">${[[true, 'Review everything'], [false, 'Go live instantly']].map(([v, l]) => `<button type="button" data-appr="${v}" class="${s.requireApproval === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </section>
    <section class="panel">
      <h3>Sample content</h3>
      <p class="muted small">The fictional demo games and their reviews. Hide them for launch, preview them yourself, or show them to everyone.</p>
      <div class="seg" id="demoSeg">${[['off', 'Hidden'], ['admins', 'Admins only'], ['everyone', 'Everyone']].map(([v, l]) => `<button type="button" data-demo="${v}" class="${s.demoContent === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    </section>`;
  el.onclick = async (e) => {
    const a = e.target.closest('[data-appr]'); const d = e.target.closest('[data-demo]');
    if (!a && !d) return;
    try {
      const r = await api.admin.saveSettings(a ? { requireApproval: a.dataset.appr === 'true' } : { demoContent: d.dataset.demo });
      applyUserState(r.state); await loadCatalog(); toast('Saved', { kind: 'ok' }); renderSettings(el);
    } catch (err) { toast(esc(err.message), { kind: 'error' }); }
  };
}

function confirmDialog(title, body, cta) {
  return new Promise((resolve) => {
    modal(`<div class="confirm"><h3>${esc(title)}</h3><p class="muted">${body}</p>
      <div class="co-actions"><button type="button" class="btn btn-ghost" data-no>Cancel</button><button type="button" class="btn btn-buy" data-yes>${esc(cta)}</button></div></div>`, {
      onMount(el, close) {
        el.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
        el.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
      },
    });
  });
}

async function renderOutbox(el) {
  const [rows, u] = await Promise.all([api.admin.outbox(), api.admin.unverified()]);
  const btnLabel = u.running ? `Sending… ${u.running.sent + u.running.failed}/${u.running.total}` : `Resend verification to all unconfirmed accounts (${u.pending})`;
  const disabled = !u.emailEnabled || !!u.running || !u.pending;
  el.innerHTML = `<section class="panel">
      <h3>Unconfirmed accounts <span class="count">${u.count}</span></h3>
      <p class="muted small">${!u.emailEnabled
        ? 'Email isn’t set up on this server yet (no <code>RESEND_API_KEY</code>), so this button is off. Set the key on your host and redeploy first.'
        : 'Sends each unconfirmed account a fresh 48-hour confirmation link. Everyone gets it at most once, so pressing it again only reaches people it missed or new sign-ups.'}</p>
      <button class="btn btn-buy" id="bulkVerify" ${disabled ? 'disabled' : ''}>${esc(btnLabel)}</button>
      ${u.count ? `<details class="adm-mail"><summary class="muted small">Show accounts</summary><table class="adm-table"><thead><tr><th>Account</th><th>Signed up</th><th>Bulk link</th></tr></thead><tbody>
        ${u.users.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="muted small">${esc(x.email)}</div></td><td>${x.memberSince ? ago(x.memberSince) : '—'}</td><td>${x.bulkSentAt ? `Sent ${ago(x.bulkSentAt)}` : '<span class="muted small">Not yet</span>'}</td></tr>`).join('')}
      </tbody></table></details>` : ''}
    </section>
    <h3 class="adm-h">Email outbox</h3>
    <p class="muted small">The last emails the site sent (or, without a Resend key, would have sent). Useful for checking templates and finding verification links while testing.</p>
    ${rows.map((m) => `<details class="adm-mail"><summary><b>${esc(m.subject)}</b> <span class="muted small">to ${esc(m.to)} · ${ago(m.createdAt)} · ${esc(m.status)}</span></summary><pre>${esc(m.text)}</pre>${m.error ? `<p class="muted small">Error: ${esc(m.error)}</p>` : ''}</details>`).join('') || '<p class="muted">No emails yet.</p>'}`;
  if (u.running) setTimeout(() => { if (el.isConnected && el.querySelector('#bulkVerify')) renderOutbox(el).catch(() => {}); }, 3000);
  const b = el.querySelector('#bulkVerify');
  b.onclick = async () => {
    const ok = await confirmDialog(`Email ${u.pending} unconfirmed account${u.pending === 1 ? '' : 's'}?`, 'Each one gets a fresh link to confirm their email. Older links stop working.', 'Send links');
    if (!ok) return;
    b.disabled = true;
    try {
      const r = await api.admin.resendUnverified();
      toast(r.queued ? `Sending ${r.queued} confirmation email${r.queued === 1 ? '' : 's'}. Results show up below.` : 'Everyone has already been sent a link.', { kind: 'ok' });
      setTimeout(() => renderOutbox(el).catch(() => {}), 1500);
    } catch (err) { b.disabled = false; toast(esc(err.message), { kind: 'error' }); }
  };
}

const RENDER = { queue: renderQueue, reports: renderReports, games: renderGames, orders: renderOrders, accounts: renderAccounts, creators: renderCreators, settings: renderSettings, outbox: renderOutbox };

export async function render(root, _, query) {
  if (!state.creator?.admin) {
    root.innerHTML = `<div class="page empty-state"><h2>Admins only</h2><p>Sign in with an admin account to use this page.</p>${state.creator?.passwordLogin ? '<form id="admLogin" class="pub-lock-form"><input type="password" name="password" placeholder="Admin password" required><button class="btn btn-buy">Unlock</button></form>' : ''}</div>`;
    const f = root.querySelector('#admLogin');
    if (f) f.onsubmit = async (e) => { e.preventDefault(); try { applyUserState(await api.admin.login(f.password.value)); go('/admin'); } catch (err) { toast(esc(err.message), { kind: 'error' }); } };
    return null;
  }
  const tab = RENDER[query.get('tab')] ? query.get('tab') : 'queue';
  root.innerHTML = `<div class="page admin">
    <div class="pub-head"><div><div class="eyebrow">vibe-games admin</div><h1>Admin</h1></div></div>
    <nav class="adm-tabs">${TABS.map(([k, l]) => `<a href="/admin?tab=${k}" data-link class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="admBody"><div class="spinner lg"></div></div>
  </div>`;
  const el = root.querySelector('#admBody');
  // Warn on every tab when uploaded files have vanished from the server's disk.
  api.admin.settings().then((s) => {
    if (!s.missingFiles?.length || !root.isConnected) return;
    const box = document.createElement('section');
    box.className = 'panel adm-alert';
    box.innerHTML = `<h3>Uploaded files are missing on this server</h3>
      <p class="muted small">The database still lists these files, but the server’s disk doesn’t have them, so they show up broken for players. This happens when the server restarts without a persistent disk or object storage. Re-upload them from Publish → Edit store page / Upload update, and set up object storage (S3_BUCKET…) or a persistent disk so it doesn’t happen again.</p>
      <ul>${s.missingFiles.map((m) => `<li><a href="/app/${esc(m.id)}" data-link><b>${esc(m.title)}</b></a>: ${esc(m.missing.join(', '))}</li>`).join('')}</ul>`;
    root.querySelector('.adm-tabs')?.before(box);
  }).catch(() => {});
  try { await RENDER[tab](el); } catch (err) { el.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  return null;
}
