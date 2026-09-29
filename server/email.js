// EMAIL: transactional mail through Resend's HTTP API (no SDK).
// Without RESEND_API_KEY (local dev, tests) nothing is sent: messages are logged
// and kept in the `outbox` table, which admins can read in Admin → Email outbox.
import * as db from './db.js';
import { RESEND_API_KEY, RESEND_API_BASE, EMAIL_FROM, SUPPORT_EMAIL, COMPANY_NAME } from './config.js';
import { reportError } from './monitoring.js';

export const emailEnabled = () => !!RESEND_API_KEY;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One simple, on-brand layout for every email.
function layout({ heading, paragraphs = [], button, footnote }) {
  const ps = paragraphs.map((p) => `<p style="margin:0 0 14px;color:#cfc6ec;font-size:15px;line-height:1.55">${p}</p>`).join('');
  const btn = button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#ff3ea5;background:linear-gradient(100deg,#ff3ea5,#ff9a3d);color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${esc(button.label)}</a></p><p style="margin:0 0 14px;color:#8278a8;font-size:12px">Or paste this link into your browser:<br><span style="color:#b9c0ff;word-break:break-all">${esc(button.url)}</span></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#0a0614;padding:32px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#150e28;border:1px solid #291f45;border-radius:14px;padding:28px">
    <div style="font-weight:800;font-size:20px;margin-bottom:18px"><span style="color:#ff3ea5">vibe</span><span style="color:#f3eeff">-games</span></div>
    <h1 style="margin:0 0 14px;color:#f3eeff;font-size:22px">${heading}</h1>
    ${ps}${btn}
    ${footnote ? `<p style="margin:18px 0 0;color:#8278a8;font-size:12px">${footnote}</p>` : ''}
  </div>
  <p style="text-align:center;color:#5d5580;font-size:11px;margin-top:16px">${esc(COMPANY_NAME)} · Questions? ${esc(SUPPORT_EMAIL)}</p>
  </body></html>`;
}
const textOf = ({ heading, paragraphs = [], button, footnote }) =>
  [heading, '', ...paragraphs.map((p) => p.replace(/<[^>]+>/g, '')), button ? `${button.label}: ${button.url}` : '', footnote ? footnote.replace(/<[^>]+>/g, '') : ''].filter((x) => x !== undefined).join('\n');

export async function sendEmail(to, subject, content, { tag = 'general' } = {}) {
  if (!to) return { skipped: true };
  const html = layout(content);
  const text = textOf(content);
  const row = db.insert('outbox', { id: db.id('eml'), to, subject, text, tag, provider: emailEnabled() ? 'resend' : 'log', status: 'pending', createdAt: db.now() });
  // Keep the outbox small: it's a debugging aid, not an archive.
  const rows = db.all('outbox');
  if (rows.length > 300) db.remove('outbox', (r) => rows.indexOf(r) < rows.length - 300);
  if (!emailEnabled()) {
    console.log(`[email] (not sent, no RESEND_API_KEY) to=${to} subject="${subject}"\n${text}\n`);
    db.update(row, { status: 'logged' });
    return { logged: true, id: row.id };
  }
  try {
    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html, text, reply_to: SUPPORT_EMAIL, tags: [{ name: 'type', value: tag }] }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message ?? `Resend error ${res.status}`);
    db.update(row, { status: 'sent', providerId: json.id });
    return { sent: true, id: row.id };
  } catch (err) {
    db.update(row, { status: 'failed', error: err.message });
    reportError(err, { where: 'email', subject });
    return { failed: true, error: err.message };
  }
}

// ---------------- templates ----------------
export const emails = {
  verify: (to, name, url) => sendEmail(to, 'Confirm your email for Vibe-Games', {
    heading: `Welcome, ${esc(name)}!`,
    paragraphs: ['Confirm your email address to finish setting up your Vibe-Games account. You need a confirmed email to publish games and get paid.'],
    button: { label: 'Confirm email', url },
    footnote: 'This link works for 48 hours. If you didn’t create an account, you can ignore this email.',
  }, { tag: 'verify' }),

  reset: (to, name, url) => sendEmail(to, 'Reset your Vibe-Games password', {
    heading: 'Reset your password',
    paragraphs: [`Hi ${esc(name)}, someone (hopefully you) asked to reset the password for this account.`],
    button: { label: 'Choose a new password', url },
    footnote: 'This link works for 1 hour and can be used once. If you didn’t ask for this, ignore this email; your password stays the same.',
  }, { tag: 'reset' }),

  receipt: (to, { name, title, amount, orderId, date, url, refundDays }) => sendEmail(to, `Your receipt: ${title}`, {
    heading: `Thanks for buying ${esc(title)}!`,
    paragraphs: [
      `Hi ${esc(name)}, it’s in your library and ready to play.`,
      `<b style="color:#f3eeff">${esc(title)}</b> · ${esc(amount)}<br>Order <span style="font-family:monospace">${esc(orderId)}</span> · ${esc(date)}`,
      `Changed your mind? You can request a refund from your profile within ${refundDays} days if you’ve played less than 2 hours.`,
    ],
    button: { label: 'Play now', url },
  }, { tag: 'receipt' }),

  refund: (to, { name, title, amount }) => sendEmail(to, `Refund issued: ${title}`, {
    heading: 'Your refund is on its way',
    paragraphs: [`Hi ${esc(name)}, we’ve refunded ${esc(amount)} for ${esc(title)}. It usually shows up on your statement within 5–10 business days. The game has been removed from your library.`],
  }, { tag: 'refund' }),

  gameReviewed: (to, { name, title, approved, note, url, isUpdate }) => sendEmail(to, approved ? `${title} is live on Vibe-Games` : `${title} needs changes`, {
    heading: approved ? `${esc(title)} is live 🎉` : `${esc(title)} wasn’t approved yet`,
    paragraphs: [
      approved
        ? `Hi ${esc(name)}, your ${isUpdate ? 'update' : 'game'} passed review and is now live for players.`
        : `Hi ${esc(name)}, we reviewed your ${isUpdate ? 'update' : 'game'} and it needs some changes before it can go live.`,
      note ? `<b style="color:#f3eeff">Reviewer note:</b> ${esc(note)}` : '',
    ].filter(Boolean),
    button: { label: approved ? 'View store page' : 'Open Publish', url },
  }, { tag: 'moderation' }),

  adminNotice: (to, subject, line, url) => sendEmail(to, `[Vibe-Games admin] ${subject}`, {
    heading: esc(subject), paragraphs: [esc(line)], button: { label: 'Open the admin queue', url },
  }, { tag: 'admin' }),

  payoutsReady: (to, name, url) => sendEmail(to, 'Payouts are set up', {
    heading: 'You’re ready to get paid',
    paragraphs: [`Hi ${esc(name)}, your payout account is verified. Your share of every sale is sent automatically, including anything you earned while setup was pending.`],
    button: { label: 'Open your creator dashboard', url },
  }, { tag: 'payouts' }),
};
