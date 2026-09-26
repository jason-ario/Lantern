// ACCOUNTS: password hashing, guest → account merging, Google OAuth.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import * as db from './db.js';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './config.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, saltB64, keyB64] = String(stored ?? '').split('$');
  if (alg !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = await scrypt(password, Buffer.from(saltB64, 'base64'), key.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(key, test);
}

export const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i;

export function uniqueUsername(base) {
  const clean = String(base).toLowerCase().replace(/[^a-z0-9_]+/g, '').slice(0, 20) || 'player';
  let name = clean;
  while (db.find('users', (u) => u.username === name)) name = `${clean}${crypto.randomInt(1000, 9999)}`;
  return name;
}

// Move a guest's library, saves, achievements, playtime, wishlist and orders
// into a real account, then delete the guest. Nothing the player earned is lost.
export function mergeUsers(fromId, toId) {
  if (fromId === toId) return;
  const from = db.get('users', fromId);
  if (!from || !from.guest) return;
  for (const o of db.filter('ownerships', (r) => r.userId === fromId)) {
    if (db.find('ownerships', (r) => r.userId === toId && r.gameId === o.gameId)) db.remove('ownerships', (r) => r === o);
    else db.update(o, { userId: toId });
  }
  for (const w of db.filter('wishlists', (r) => r.userId === fromId)) {
    if (db.find('wishlists', (r) => r.userId === toId && r.gameId === w.gameId)) db.remove('wishlists', (r) => r === w);
    else db.update(w, { userId: toId });
  }
  for (const s of db.filter('saves', (r) => r.userId === fromId)) {
    const theirs = db.find('saves', (r) => r.userId === toId && r.gameId === s.gameId && r.key === s.key);
    if (!theirs) db.update(s, { userId: toId });
    else if ((s.updatedAt ?? '') > (theirs.updatedAt ?? '')) { db.update(theirs, { value: s.value, sizeBytes: s.sizeBytes, updatedAt: s.updatedAt, revision: theirs.revision + 1 }); db.remove('saves', (r) => r === s); }
    else db.remove('saves', (r) => r === s);
  }
  for (const a of db.filter('userAchievements', (r) => r.userId === fromId)) {
    if (db.find('userAchievements', (r) => r.userId === toId && r.achievementId === a.achievementId)) db.remove('userAchievements', (r) => r === a);
    else db.update(a, { userId: toId });
  }
  for (const t of ['playSessions', 'orders']) for (const r of db.filter(t, (x) => x.userId === fromId)) db.update(r, { userId: toId });
  db.remove('authSessions', (s) => s.userId === fromId);
  db.remove('users', (u) => u.id === fromId);
}

// ---------------- Google OAuth (authorization code flow) ----------------
export const googleEnabled = () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
const pendingStates = new Map(); // state → { guestUserId, createdAt }
setInterval(() => { const now = Date.now(); for (const [k, v] of pendingStates) if (now - v.createdAt > 15 * 60e3) pendingStates.delete(k); }, 60e3).unref();

export function googleStartUrl(redirectUri, guestUserId) {
  const state = crypto.randomBytes(18).toString('base64url');
  pendingStates.set(state, { guestUserId, createdAt: Date.now() });
  const q = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function googleFinish(code, state, redirectUri) {
  const pending = pendingStates.get(state);
  if (!pending) throw new Error('Sign-in expired — please try again');
  pendingStates.delete(state);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokens.error_description ?? 'Google sign-in failed');
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const info = await infoRes.json();
  if (!infoRes.ok || !info.sub) throw new Error('Could not read your Google profile');
  return { profile: info, guestUserId: pending.guestUserId };
}
