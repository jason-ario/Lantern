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
