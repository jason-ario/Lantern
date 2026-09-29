// Runtime configuration (environment variables). See DEPLOY.md.
import path from 'node:path';

const env = process.env;

// Running on a real host? Render sets RENDER=true automatically.
export const IS_PROD = env.NODE_ENV === 'production' || !!env.RENDER;
export const PORT = Number(env.PORT ?? 5173);

// Everything the server writes lives under DATA_DIR, so one persistent disk covers it:
//   DATA_DIR/db.json        database
//   DATA_DIR/packages/...   builds uploaded through Publish
//   DATA_DIR/media/...      store images uploaded through Publish
export const DATA_DIR = path.resolve(env.DATA_DIR ?? 'data');
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const PUBLISHED_PACKAGES_DIR = path.join(DATA_DIR, 'packages');
export const USER_MEDIA_DIR = path.join(DATA_DIR, 'media');
export const BUILTIN_PACKAGES_DIR = path.resolve('packages'); // shipped with the code, read-only

// Creator/admin access (Publish, site reset). Locally with no password set,
// it's open for convenience; on a real host it is locked unless ADMIN_PASSWORD is set.
export const ADMIN_PASSWORD = env.ADMIN_PASSWORD ?? '';
export const ADMIN_OPEN = !ADMIN_PASSWORD && !IS_PROD;

// 'guest' (default): every browser gets its own guest account.
// 'single': everyone shares the seeded demo account "Jason" (original local demo).
export const ACCOUNT_MODE = env.ACCOUNT_MODE === 'single' ? 'single' : 'guest';

// Behind a hosting proxy (Render, Fly, nginx) trust X-Forwarded-Proto / -For.
export const TRUST_PROXY = env.TRUST_PROXY ? env.TRUST_PROXY === '1' : IS_PROD;

// Public URL of the platform (e.g. https://vibe-games.com). Used for OAuth /
// Stripe redirect URLs and as the only allowed parent of game frames. Optional
// locally (derived from the request).
const trimSlash = (s) => (s ? s.replace(/\/+$/, '') : '');
export const PUBLIC_URL = trimSlash(env.PUBLIC_URL ?? '');

// Serve untrusted game packages from a different site, e.g. https://play.vibe-games.net
// (point that domain at this same server). When unset, games are served from the
// platform origin inside an opaque-origin sandbox.
export const GAMES_ORIGIN = trimSlash(env.GAMES_ORIGIN ?? '');

// Package signing (ECDSA P-256). Provide a PEM private key, or one is generated
// and kept at DATA_DIR/keys/package-signing.pem.
export const PACKAGE_SIGNING_KEY = env.PACKAGE_SIGNING_KEY ?? '';

// Accounts: Google sign-in is enabled when both are set.
export const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID ?? '';
export const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET ?? '';

// Payments: Stripe Checkout is enabled when STRIPE_SECRET_KEY is set (use a test
// key, sk_test_…, while trying it). Otherwise the fake "Vibe Wallet" is used.
export const STRIPE_SECRET_KEY = env.STRIPE_SECRET_KEY ?? '';
export const STRIPE_WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET ?? '';
export const STRIPE_API_BASE = trimSlash(env.STRIPE_API_BASE ?? 'https://api.stripe.com');
export const CURRENCY = (env.CURRENCY ?? 'usd').toLowerCase();
// Sample content (the fictional demo catalog and its reviews): 'off' hides it,
// 'admins' shows it only to signed-in admins/creators, 'everyone' shows it to all.
// Admins can change it at runtime (Profile → Site admin); that choice is stored in
// the database and wins over this default.
const DEMO_MODES = ['off', 'admins', 'everyone'];
export const DEMO_CONTENT_DEFAULT = DEMO_MODES.includes(env.DEMO_CONTENT) ? env.DEMO_CONTENT : (IS_PROD ? 'off' : 'everyone');
export const DEMO_CONTENT_MODES = DEMO_MODES;

// Creator revenue share (planned payout policy): creators keep this fraction of
// each sale's net revenue (after payment processing fees, taxes and refunds).
export const CREATOR_SHARE = Math.min(1, Math.max(0, Number(env.CREATOR_SHARE ?? 0.9)));

// ---------------- launch settings ----------------
// Database: PostgreSQL when set (e.g. Render's internal database URL); JSON file otherwise.
export const DATABASE_URL = env.DATABASE_URL ?? '';

// Object storage (S3-compatible: Cloudflare R2, AWS S3, Backblaze B2…) for uploads and backups.
export const S3_BUCKET = env.S3_BUCKET ?? '';
export const S3_ENDPOINT = env.S3_ENDPOINT ?? '';            // e.g. https://<account>.r2.cloudflarestorage.com
export const S3_REGION = env.S3_REGION ?? 'auto';            // 'auto' for R2, e.g. 'us-east-1' for AWS
export const S3_ACCESS_KEY_ID = env.S3_ACCESS_KEY_ID ?? '';
export const S3_SECRET_ACCESS_KEY = env.S3_SECRET_ACCESS_KEY ?? '';

// Email (Resend). Without a key, emails are logged and kept in the admin "Email outbox".
export const RESEND_API_KEY = env.RESEND_API_KEY ?? '';
export const RESEND_API_BASE = trimSlash(env.RESEND_API_BASE ?? 'https://api.resend.com');
export const EMAIL_FROM = env.EMAIL_FROM ?? 'Vibe-Games <hello@vibe-games.com>';
export const SUPPORT_EMAIL = env.SUPPORT_EMAIL ?? 'support@vibe-games.com';
export const COMPANY_NAME = env.COMPANY_NAME ?? 'Vibe-Games';

// Admins: accounts with these (verified) emails get the admin role. Comma separated.
export const ADMIN_EMAILS = (env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// Moderation: new games and updates wait for admin approval. Default: on, except in
// open local dev. Admins can change it at runtime (Admin → Settings).
export const REQUIRE_APPROVAL_DEFAULT = env.REQUIRE_APPROVAL ? env.REQUIRE_APPROVAL !== '0' : !ADMIN_OPEN;

// Payments: Stripe Tax on Checkout (register for tax in the Stripe dashboard first).
export const STRIPE_TAX = env.STRIPE_TAX === '1';
// Player self-serve refunds: within this many days of purchase and under this much playtime.
export const REFUND_WINDOW_DAYS = Number(env.REFUND_WINDOW_DAYS ?? 14);
export const REFUND_MAX_PLAY_MINUTES = Number(env.REFUND_MAX_PLAY_MINUTES ?? 120);

// Error tracking (Sentry-compatible DSN).
export const SENTRY_DSN = env.SENTRY_DSN ?? '';
export const RELEASE = env.RENDER_GIT_COMMIT ?? env.RELEASE ?? 'dev';
