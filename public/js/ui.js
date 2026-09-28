// Small UI toolkit: escaping, formatting and shared game "capsule" components.
import { state } from './state.js';
import { TOOL_BY_ID, buildTime } from './vibe.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const price = (cents) => (cents === 0 ? 'Free' : `$${(cents / 100).toFixed(2)}`);
export function hours(sec) {
  if (!sec) return '0 hrs';
  if (sec < 60) return '< 1 min';
  const h = sec / 3600;
  if (h < 1) return `${Math.max(1, Math.round(sec / 60))} min`;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} hrs`;
}
export function ago(iso) {
  if (!iso) return 'Never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 2) return 'Yesterday';
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return date(iso);
}
export const date = (iso) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function ratingLabel(r) {
  if (!r) return { label: 'No reviews yet', cls: 'r-none' };
  const p = r.pct;
  const label = p >= 95 && r.count > 500 ? 'Overwhelmingly Positive' : p >= 85 ? 'Very Positive' : p >= 80 ? 'Positive' : p >= 70 ? 'Mostly Positive' : p >= 40 ? 'Mixed' : 'Mostly Negative';
  return { label, cls: p >= 80 ? 'r-pos' : p >= 40 ? 'r-mixed' : 'r-neg' };
}

// Title treatment laid over key art (the art itself has no text).
export function logo(g, size = 'md') {
  const l = g.logo ?? {};
  const style = [
    `font-family:'${l.font ?? 'Barlow Condensed'}',var(--display)`,
    `font-weight:${l.weight ?? 700}`,
    l.style ? `font-style:${l.style}` : '',
    `color:${l.color ?? '#fff'}`,
    `letter-spacing:${l.spacing ?? '0'}`,
    `text-transform:${l.case === 'upper' ? 'uppercase' : l.case === 'lower' ? 'lowercase' : 'none'}`,
    l.glow ? `text-shadow:0 0 18px ${l.glow}88,0 2px 0 #0008` : 'text-shadow:0 2px 12px #000a',
    `--lw:${Math.max(4, ...g.title.split(/\s+/).map((w) => w.length))}`,
  ].filter(Boolean).join(';');
  return `<div class="logo logo-${size}" style="${style}">${esc(g.title)}</div>`;
}

export function priceTag(g, { compact = false } = {}) {
  if (state.owned.has(g.id)) return `<span class="price owned-tag">${compact ? 'Owned' : 'In Library'}</span>`;
  if (g.status === 'coming_soon') return `<span class="price soon">${compact ? 'Soon' : 'Coming Soon'}</span>`;
  return `<span class="price">${price(g.priceCents)}</span>`;
}

// Landscape capsule (header art)
// Discovery badges (New, Trending, Hidden gem, Top seller) and compact player counts.
const BADGE_CLS = { New: 'b-new', Trending: 'b-trend', 'Hidden gem': 'b-gem', 'Top seller': 'b-top' };
export function rankBadges(g, max = 2) {
  return (g.rank?.badges ?? []).slice(0, max).map((b) => `<span class="rank-badge ${BADGE_CLS[b] ?? ''}">${esc(b)}</span>`).join('');
}
export const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

// "Built with" chips for the AI tools a game was vibe-coded with.
export function vibeChips(ids, { max = 3, link = false, size = '' } = {}) {
  const list = (ids ?? []).map((id) => TOOL_BY_ID.get(id)).filter(Boolean);
  const shown = list.slice(0, max).map((t) => (link
    ? `<a class="vibe-chip ${size}" style="--c:${t.color}" href="/search?tool=${encodeURIComponent(t.id)}" data-link>${esc(t.name)}</a>`
    : `<span class="vibe-chip ${size}" style="--c:${t.color}">${esc(t.name)}</span>`));
  if (list.length > max) shown.push(`<span class="vibe-chip ${size}" style="--c:var(--text-3)">+${list.length - max}</span>`);
  return shown.length ? `<span class="vibe-chips">${shown.join('')}</span>` : '';
}
export const vibeTime = (g) => buildTime(g.vibe?.hours);

export function capsule(g, { size = 'md', showPrice = true, badge = true } = {}) {
  const demo = g.demo && !state.owned.has(g.id) && badge ? '<span class="badge-demo">▶ Instant demo</span>' : '';
  const t = vibeTime(g);
  return `<a class="capsule capsule-${size}" href="/app/${esc(g.id)}" data-link>
    <div class="art" style="background-image:url('${esc(g.media.header)}')">${logo(g, size === 'lg' ? 'lg' : 'sm')}${demo}${badge && g.rank?.badges?.length ? `<span class="art-badges">${rankBadges(g, 1)}</span>` : ''}</div>
    <div class="meta"><div class="t">${esc(g.title)}</div>${showPrice ? priceTag(g, { compact: true }) : ''}</div>
    ${g.builtWith?.length || t ? `<div class="meta-vibe">${vibeChips(g.builtWith, { max: 2, size: 'sm' })}${t ? `<span title="Time to build">⏱ ${esc(t)}</span>` : ''}</div>` : ''}
  </a>`;
}

// Portrait cover (library / trending)
export function cover(g, { href, sub = '' } = {}) {
  return `<a class="cover" href="${href ?? `/app/${esc(g.id)}`}" data-link title="${esc(g.title)}">
    <div class="cover-art" style="background-image:url('${esc(g.media.cover)}')">${logo(g, 'cover')}</div>
    ${sub ? `<div class="cover-sub">${sub}</div>` : ''}
  </a>`;
}

export function tagChips(tags, max = 5) {
  return tags.slice(0, max).map((t) => `<a class="tag" href="/search?tag=${encodeURIComponent(t)}" data-link>${esc(t)}</a>`).join('');
}

export function avatar(user, size = 32) {
  const hue = user?.avatarHue ?? 30;
  const initial = esc((user?.displayName ?? '?')[0]);
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px;background:linear-gradient(135deg,hsl(${hue} 70% 45%),hsl(${hue + 40} 60% 22%))">${initial}</span>`;
}

// ---------- toast / modal ----------
export function toast(html, { kind = 'info', timeout = 3500 } = {}) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.innerHTML = html;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, timeout);
}

export function modal(html, { onMount, dismissable = true, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 180); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  if (dismissable) wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  requestAnimationFrame(() => wrap.classList.add('in'));
  onMount?.(wrap.firstElementChild, close);
  return close;
}

export const icons = {
  play: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  heartOutline: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 19.5s-6.8-4.2-8.7-8.4C2 8.1 3.8 5.5 6.8 5.5c1.9 0 3.3 1.1 5.2 3.2 1.9-2.1 3.3-3.2 5.2-3.2 3 0 4.8 2.6 3.5 5.6-1.9 4.2-8.7 8.4-8.7 8.4z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 3h12v2h3v3a5 5 0 0 1-4.2 4.9A6 6 0 0 1 13 16.9V19h4v2H7v-2h4v-2.1a6 6 0 0 1-3.8-4A5 5 0 0 1 3 8V5h3zm0 4H5v1a3 3 0 0 0 1.4 2.5A6 6 0 0 1 6 9zm12 0v2a6 6 0 0 1-.4 1.5A3 3 0 0 0 19 8V7z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6.5 19a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.3 8.6 5.2 5.2 0 0 1 17.5 19z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
  box: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 2 9 5v10l-9 5-9-5V7zm0 2.3L5.4 8 12 11.7 18.6 8zM5 9.7v6.1l6 3.4v-6.2zm8 9.5 6-3.4V9.7l-6 3.3z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.5 8 11 4.6-1.5 8-6 8-11V5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  expand: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/></svg>',
};
