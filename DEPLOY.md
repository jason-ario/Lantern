# Deploying Vibe-Games

Vibe-Games is one Node process with no dependencies. It needs **Node 22+** and, if you want data to survive restarts, **one persistent folder** (`DATA_DIR`).

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `5173` | Port to listen on. Hosts like Render set this for you. |
| `PUBLIC_URL` | derived | The site's public address, e.g. `https://vibe-games.com`. Needed for Stripe and Google redirects and for the separate games domain. |
| `ADMIN_EMAILS` | *(none)* | Comma-separated emails of admins. An account with one of these emails becomes an admin once its email is confirmed: review queue, reports, refunds, creators, settings (`/admin`). |
| `ADMIN_PASSWORD` | *(none)* | Break-glass admin unlock for one browser session (Publish → Admin sign-in, or `/admin`). Keep it long, or leave it unset. |
| `DATABASE_URL` | *(none)* | PostgreSQL connection string. When set, all data is stored in Postgres (an existing `DATA_DIR/db.json` is imported on first start). When unset, the JSON file is used. |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | *(none)* | S3-compatible object storage (Cloudflare R2 recommended; `S3_REGION=auto`). Uploaded game builds and store images are copied there and restored from it if the disk is lost; backups are uploaded there too. |
| `RESEND_API_KEY` | *(none)* | Sends email (verification, password reset, receipts, refunds, review results, admin notices) through Resend. Without it, emails are only logged and shown in **Admin → Email outbox**. |
| `EMAIL_FROM` / `SUPPORT_EMAIL` / `COMPANY_NAME` | `Vibe-Games <hello@vibe-games.com>` / `support@vibe-games.com` / `Vibe-Games` | Sender, reply-to and footer of every email. `EMAIL_FROM` must use a domain verified in Resend. |
| `REQUIRE_APPROVAL` | on (off in open local dev) | New games and updates wait in the admin review queue. Admins can also switch this in **Admin → Settings**. |
| `STRIPE_TAX` | off | `1` turns on Stripe Tax for Checkout (register your tax obligations in Stripe first). |
| `STRIPE_PLATFORM_COUNTRY` | `US` | Country of your Stripe account. Creators elsewhere are onboarded as payout-only "recipients". |
| `REFUND_WINDOW_DAYS` / `REFUND_MAX_PLAY_MINUTES` | `14` / `120` | Player self-serve refund rule. Keep it in line with the Refund Policy text (`public/js/legal.js`). |
| `SENTRY_DSN` | *(none)* | Sends server and browser errors to Sentry (or GlitchTip). |
| `DATA_DIR` | `./data` | Where everything the server writes lives: `db.json`, uploaded builds, uploaded images and the signing key. Point it at your persistent disk. |
| `PACKAGE_SIGNING_KEY` | generated | ECDSA P-256 private key that signs every game build. Create one with `npm run gen:signing-key` and keep it **stable**: players' browsers pin the matching public key. If it's unset, a key is generated into `DATA_DIR/keys`, which is fine only if `DATA_DIR` is persistent. |
| `STRIPE_SECRET_KEY` | *(none)* | Turns on real payments with Stripe Checkout. Use a test key (`sk_test_…`) first. When unset, the fake "Vibe Wallet" is used. |
| `STRIPE_WEBHOOK_SECRET` | *(none)* | Signing secret (`whsec_…`) for the webhook endpoint `PUBLIC_URL/api/stripe/webhook`. |
| `CURRENCY` | `usd` | Checkout currency. |
| `CREATOR_SHARE` | `0.9` | The creators' share of each sale, shown in the creator guide and on the Publish page. `0.9` means a 90/10 split. |
| `DEMO_CONTENT` | `everyone` locally, `off` on a real host | Sample content: the fictional demo games and their reviews. `off` hides them, `admins` shows them only to people with creator access (marked "Sample"), `everyone` shows them to all. Once an admin changes it in **Admin → Settings**, the saved choice wins over this variable. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(none)* | Enable "Continue with Google". |
| `GAMES_ORIGIN` | *(none)* | Serve untrusted game files from a separate domain, e.g. `https://play.vibe-games.net`. Requires `PUBLIC_URL`. |
| `NODE_ENV` | — | Set `production` on a host. This also happens automatically on Render. |
| `ACCOUNT_MODE` | `guest` | `guest`: every browser gets a guest account and can upgrade it to a real one. `single`: the old shared demo account. |
| `TRUST_PROXY` | on in production | Reads `X-Forwarded-*` from the host's proxy, so HTTPS, secure cookies and rate limits work correctly. |

`GET /healthz` returns `ok`, for health checks.

## Accounts

- Email and password sign-in works out of the box. Passwords are hashed with scrypt.
- Guests keep everything when they create an account, because the guest is upgraded in place. When someone signs in to an existing account from a browser where they played as a guest, that guest progress is merged into the account.
- Email verification and password reset links are sent by email (see Email below). Creators and admins must confirm their email.

**Google sign-in:**

1. In Google Cloud Console, go to **APIs & Services → Credentials → Create OAuth client ID** and choose Web application.
2. Set the authorised redirect URI to `https://YOUR-SITE/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL` on your host.

## Payments (Stripe)

1. In the Stripe dashboard, in test mode, copy the secret key and set it as `STRIPE_SECRET_KEY`. Also set `PUBLIC_URL`.
2. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-SITE/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`
   - Add a **second endpoint** with the same URL that listens to **events on Connected accounts**, with the event `account.updated` (tells us when a creator's payout account is verified).
3. Copy the signing secrets into `STRIPE_WEBHOOK_SECRET`. With two endpoints, separate them with a comma: `whsec_aaa,whsec_bbb`.
4. Test with card number `4242 4242 4242 4242`, any future expiry date and any CVC.

**Creator payouts (Stripe Connect):** in the Stripe dashboard enable **Connect** and choose Express accounts. The platform (you) is the seller of record: players pay you, and each creator's share (90% of price minus tax and the Stripe fee) is sent with a Transfer as soon as their payout account is verified; earlier earnings are held and sent then. Refunds reverse the transfer. Creators set this up under **Publish → Payouts**.

**Tax:** set `STRIPE_TAX=1` after registering where you owe tax in **Stripe → Tax**. Games use the "video games (downloaded)" tax code.

**Refunds:** players refund themselves from **Profile → Purchase history** within 14 days and under 2 hours played; admins can refund any order in **Admin → Orders & refunds**.

With Stripe on, buying a game requires an account, not a guest, because purchases must survive cleared cookies. Free games are claimed without checkout. Orders show up under **Profile → Purchase history**.

## Separate games domain

Game code is untrusted, so in production it should come from a different site from the store.

1. Add a second custom domain to the same Render service, e.g. `play.yourgames.net`. It should be a different registrable domain from the store.
2. Set `GAMES_ORIGIN=https://play.yourgames.net` and `PUBLIC_URL=https://store.yourdomain.com`.

After that:
- The games domain serves **only** `/games`, `/sdk` and `/media`. It never serves the store or the API.
- The store no longer serves `/games`.
- Game files can only be framed by `PUBLIC_URL`.

## Offline play and signed packages

- **Pre-download.** After a purchase, the store downloads the game into the browser's Cache Storage. Files are stored by their sha256 hash, so an update only downloads the files that changed.
- **Signed builds.** Every build has a manifest (the list of files with their hashes) signed with `PACKAGE_SIGNING_KEY`. The browser checks the signature and every file's hash both when downloading and before each launch. A tampered or corrupted file is refused.
- **Playing offline.** A service worker keeps the store itself and your library data available offline. Installed games run from the local copy inside the same sandbox. Saves, achievements and playtime are queued while offline and uploaded on reconnect.
- **Settings.** Players can turn auto-download off, or remove downloads, under **Profile → Offline & downloads**.

## Publishing updates

1. Go to **Publish → Your games → Publish update**.
2. Upload the new build with a higher version number and patch notes.

What players see:
- Web players get the new version on their next launch.
- Players with a downloaded copy see an **Update** badge. The update is applied automatically at launch, and only the changed files download.
- Patch notes appear under **Library → What's new**.

## Render: quick start (Free instance, data resets)

1. Render → **New → Web Service** → choose your GitHub repo.
2. Fill in these settings:
   - **Language:** Node
   - **Root Directory:** leave empty
   - **Build Command:** `npm install`
   - **Start Command:** `node server/index.js`
   - **Instance Type:** Free
3. Under **Environment Variables**, add:
   - `ADMIN_PASSWORD`: a long password of your choice.
   - `PUBLIC_URL`: your `https://….onrender.com` address.
   - `PACKAGE_SIGNING_KEY`: the output of `npm run gen:signing-key`.
4. Click **Deploy**. Your site is live at `https://<name>.onrender.com`.

Free instances have no persistent disk. Accounts, purchases, saves and published games reset whenever the service restarts, redeploys or falls asleep. That's fine for showing Vibe-Games to people.

## Render: persistent (paid instance + disk)

Option A, a Blueprint:

1. Render → **New → Blueprint**, then pick the repo. It reads `render.yaml`.
2. Enter `ADMIN_PASSWORD` when asked.

Option B, a manual Web Service. Use the settings above, then:

1. Pick a paid instance type.
2. Under **Advanced → Disk**, add a disk with mount path `/var/data`.
3. Add the environment variable `DATA_DIR=/var/data`.

> **Coming from the Lantern blueprint?** `render.yaml` now names the service `vibe-games` and the disk `vibe-games-data`. Syncing an existing Blueprint with those names creates a *new* service and an empty disk. To keep your data, either rename the existing service in the Render dashboard, or change those two names in `render.yaml` back to `lantern` / `lantern-data` before syncing.

## Custom domain: vibe-games.com

1. In Render → your service → **Settings → Custom Domains**, add `vibe-games.com` and `www.vibe-games.com`.
2. At your registrar, add the DNS records Render shows (an `A`/`ALIAS` record for the apex, a `CNAME` for `www`). Render issues the TLS certificate automatically.
3. Set `PUBLIC_URL=https://vibe-games.com` and redeploy. Update Stripe's webhook URL and Google's OAuth redirect URI to the new domain too.
4. Optional, recommended for production: serve game files from a separate domain, e.g. `play.vibe-games.net`, pointed at the same service, and set `GAMES_ORIGIN=https://play.vibe-games.net`. A different registrable domain keeps untrusted game code away from player sessions.

## Any container host (Fly.io, Railway, a VPS)

```bash
docker build -t vibe-games .
docker run -p 8080:8080 -e ADMIN_PASSWORD=change-me -v vibe-games-data:/data vibe-games
```

Put it behind an HTTPS proxy such as Caddy or nginx, or use your host's built-in TLS.

## After deploying

- Open the site. Each visitor automatically gets a guest account with a random name, which they can rename on **Profile**.
- To publish a game, go to **Publish**: create an account, confirm your email, accept the Creator Agreement, then upload a `.zip` (make one with `node scripts/pack.mjs <folder>`). Admins' own uploads go live straight away; everyone else's wait in **Admin → Review queue**.
- To wipe everything back to the seeded catalog, open **Profile → Reset entire site** as an admin.

## Email (Resend)

1. Create a Resend account, add the domain `vibe-games.com` and add the DNS records it shows (SPF, DKIM) at your registrar.
2. Create an API key and set `RESEND_API_KEY`. Set `EMAIL_FROM` to an address on the verified domain.
3. Check **Admin → Email outbox** after signing up: every email and its delivery status is listed there.

## Database, uploads and backups

- **Postgres:** set `DATABASE_URL` (the Blueprint wires Render Postgres up for you). On first start with an empty database, the existing `DATA_DIR/db.json` is imported. The server keeps data in memory and writes changes through, so run **one** instance.
- **Object storage:** create a Cloudflare R2 bucket (or S3), an API token with read/write on it, and set the `S3_*` variables. Endpoint for R2: `https://<account-id>.r2.cloudflarestorage.com`.
- **Backups:** `npm run backup` writes a gzipped snapshot to `backups/` and uploads it to the bucket; the Blueprint runs it daily as a cron job. Restore with `npm run restore -- backups/<file>` (or just the file name, to fetch it from the bucket) while the server is stopped. Also keep your database provider's own backups on.

## Error tracking

Create a project in Sentry (platform: Node.js), copy its DSN into `SENTRY_DSN`. Server errors (500s, crashes) and browser errors are reported with the release (`RENDER_GIT_COMMIT`). For uptime, point a monitor (Better Stack, UptimeRobot) at `https://vibe-games.com/healthz`.

## Launch checklist

1. Company + Stripe account in a supported country; Connect (Express) and Tax set up; live keys in `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`.
2. Blueprint deployed; `PUBLIC_URL`, `PACKAGE_SIGNING_KEY`, `ADMIN_EMAILS` set; `DEMO_CONTENT=off`.
3. Resend domain verified; `RESEND_API_KEY` set. Sign up with your admin email and confirm it: `/admin` should open.
4. R2 bucket + `S3_*` set; run the backup job once from the Render dashboard and check `backups/` in the bucket.
5. `SENTRY_DSN` set; uptime monitor on `/healthz`.
6. Legal texts reviewed by a lawyer and the `[bracketed]` details filled in (`public/js/legal.js`), bump `LEGAL_VERSIONS` if the text changed.
7. Custom domain + `GAMES_ORIGIN` domain live over HTTPS; Stripe webhook and Google redirect URLs point at vibe-games.com.
8. Do a real £/$1 test purchase with a live card, refund it, and check the transfer and reversal in Stripe.

## Still prototype-grade

- The server holds data in memory (persisted to Postgres or the JSON file), so it runs as a single instance.
- Offline saves use last-write-wins when they sync.
- Games in local (offline) mode can't use `<script type="module">` or `eval`. Classic scripts, WASM, workers, images and audio all work.
- Without `STRIPE_SECRET_KEY` the checkout is the fake wallet, and without `GAMES_ORIGIN` games share the store's domain. They are still sandboxed either way.
