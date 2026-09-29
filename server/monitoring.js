// ERROR TRACKING: sends server and browser errors to Sentry (or any
// Sentry-compatible service such as GlitchTip) using the plain envelope HTTP API.
// Without SENTRY_DSN errors are only logged to the console.
import crypto from 'node:crypto';
import { SENTRY_DSN, RELEASE, IS_PROD } from './config.js';

let dsn = null;
try {
  if (SENTRY_DSN) {
    const u = new URL(SENTRY_DSN);
    dsn = { key: u.username, host: u.host, protocol: u.protocol, project: u.pathname.replace(/^\//, ''), url: `${u.protocol}//${u.host}/api/${u.pathname.replace(/^\//, '')}/envelope/` };
  }
} catch { console.warn('[monitoring] SENTRY_DSN is not a valid URL'); }
export const monitoringEnabled = () => !!dsn;

const recent = new Map(); // de-duplicate bursts of the same error
function parseStack(stack = '') {
  return stack.split('\n').slice(1, 30).map((l) => {
    const m = /at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/.exec(l.trim());
    return m ? { function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : null;
  }).filter(Boolean).reverse();
}

export function reportError(err, extra = {}, { platform = 'node', tags = {} } = {}) {
  const e = err instanceof Error ? err : new Error(String(err?.message ?? err));
  if (!dsn) { if (!extra.silent) console.error('[error]', e.message, extra.where ? `(${extra.where})` : ''); return; }
  const fp = `${e.message}|${(e.stack ?? '').split('\n')[1] ?? ''}`;
  const last = recent.get(fp);
  if (last && Date.now() - last < 60e3) return;
  recent.set(fp, Date.now());
  if (recent.size > 500) recent.clear();
  const eventId = crypto.randomBytes(16).toString('hex');
  const event = {
    event_id: eventId, timestamp: Date.now() / 1000, platform, level: 'error', release: RELEASE,
    environment: IS_PROD ? 'production' : 'development', server_name: 'vibe-games', tags,
    exception: { values: [{ type: e.name ?? 'Error', value: e.message, stacktrace: { frames: parseStack(e.stack) } }] },
    extra,
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: SENTRY_DSN })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
  fetch(dsn.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=vibe-games/1.0, sentry_key=${dsn.key}` },
    body,
  }).catch(() => {});
}

export function installProcessHandlers() {
  // An uncaught exception leaves the process in an unknown state: report it, then exit
  // so the host restarts a clean instance (pending database writes are flushed first).
  process.on('uncaughtException', (err) => { reportError(err, { where: 'uncaughtException' }); console.error(err); setTimeout(() => process.exit(1), 800).unref(); });
  process.on('unhandledRejection', (err) => { reportError(err, { where: 'unhandledRejection' }); console.error(err); });
}
