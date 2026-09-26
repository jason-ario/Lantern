# Deploying Lantern

Lantern is one Node process with no dependencies. It needs **Node 22+** and, if you want data to survive restarts, **one persistent folder** (`DATA_DIR`).

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `5173` | Port to listen on. Hosts like Render set this for you. |
| `ADMIN_PASSWORD` | *(none)* | Creator password. It unlocks **Publish** and **Reset entire site**. On a real host, publishing is **disabled** until you set it. |
| `DATA_DIR` | `./data` | Where everything the server writes lives: `db.json`, uploaded game builds (`packages/`) and uploaded store images (`media/`). Point it at your persistent disk. |
| `NODE_ENV` | — | Set `production` on a host. This also happens automatically on Render. |
| `ACCOUNT_MODE` | `guest` | `guest` gives every browser its own guest account. `single` is the old shared "Jason" demo account. |
| `TRUST_PROXY` | on in production | Reads `X-Forwarded-Proto` / `X-Forwarded-For` from the host's proxy, so HTTPS, secure cookies and rate limits work correctly. |

`GET /healthz` returns `ok`, for health checks.

## Render: quick start (Free instance, data resets)

1. Render → **New → Web Service** → choose your GitHub repo.
2. Fill in these settings:
   - **Language:** Node
   - **Root Directory:** leave empty
   - **Build Command:** `npm install`
   - **Start Command:** `node server/index.js`
   - **Instance Type:** Free
3. Under **Environment Variables**, add `ADMIN_PASSWORD` with a long password of your choice.
4. Click **Deploy**. Your site is live at `https://<name>.onrender.com`.

Free instances have no persistent disk. Accounts, purchases, saves and published games reset whenever the service restarts, redeploys or falls asleep. That's fine for showing Lantern to people.

## Render: persistent (paid instance + disk)

Option A, a Blueprint:

1. Render → **New → Blueprint**, then pick the repo. It reads `render.yaml`.
2. Enter `ADMIN_PASSWORD` when asked.

Option B, a manual Web Service. Use the settings above, then:

1. Pick a paid instance type.
2. Under **Advanced → Disk**, add a disk with mount path `/var/data`.
3. Add the environment variable `DATA_DIR=/var/data`.

## Any container host (Fly.io, Railway, a VPS)

```bash
docker build -t lantern .
docker run -p 8080:8080 -e ADMIN_PASSWORD=change-me -v lantern-data:/data lantern
```

Put it behind an HTTPS proxy such as Caddy or nginx, or use your host's built-in TLS.

## After deploying

- Open the site. Each visitor automatically gets a guest account with a random name, which they can rename on **Profile**.
- To publish a game, go to **Publish**, enter the creator password, then upload a `.zip`. You can make one with `node scripts/pack.mjs <folder>`.
- To wipe everything back to the seeded catalog, sign in as a creator, then go to **Profile → Reset entire site**.

## Still prototype-grade

- Guest accounts only, with no real sign-in. Clearing cookies means a new account.
- The checkout is fake.
- A single JSON file is the database. That's fine for demos and one instance, but it's not for heavy traffic.
- Games and the store share one domain. They are sandboxed, but production should serve games from a separate domain.
