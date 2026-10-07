# Deploying Voltbets

Two supported targets: **Railway** (fastest, managed) and a **VPS** (full control).
Both use PostgreSQL in production.

## VPS quick start — `installer.sh` (Ubuntu/Debian)

The repo root ships a fully automated installer that takes a bare VPS to a
running sportsbook in one command:

```bash
sudo bash installer.sh
```

It installs Node.js LTS, PM2, pnpm (pinned to the repo's `packageManager`),
PostgreSQL, Nginx and Certbot; prompts for the domain, DB credentials,
`THE_ODDS_API_KEY`, Telegram bot token and the initial Super Admin
credentials; then writes a sanitized `.env`, runs
`pnpm install --frozen-lockfile` → `prisma migrate deploy` → `prisma db seed`
→ `pnpm build` (full deps — the devDependencies include the `prisma` CLI,
`tsx` seed runner and `typescript`, so a prod-only install cannot migrate,
seed or build), generates `ecosystem.config.js` and boots the app under PM2
(`pm2 save` + systemd startup), configures Nginx as a reverse proxy on
80/443, issues a Let's Encrypt certificate when a domain is present, and
INSTALLS THE CRON JOBS — the HTTP ones plus the **settlement worker** — into
the `voltsbet` user's crontab (see below).
Non-interactive use:

```bash
DOMAIN=bet.example.com THE_ODDS_API_KEY=xxx \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='S3cret!' \
  sudo -E bash installer.sh
```

Re-running is idempotent (existing `.env` is preserved unless `FORCE_ENV=1`).

## 0. Prepare

1. Create a GitHub repo and push the contents of `app/` (the Next.js project).
2. Create a Postgres database:
   - Railway: add a **PostgreSQL** plugin when creating the service (gives you `DATABASE_URL`).
   - VPS: `sudo apt install postgresql`, then:
     ```sql
     CREATE DATABASE voltbets;
     CREATE USER voltbets WITH PASSWORD 'a-long-random-password';
     GRANT ALL PRIVILEGES ON DATABASE voltbets TO voltbets;
     ```

## 1. Railway

1. **New Project → Deploy from GitHub repo** (detects Next.js automatically).
2. Add variables (Variables tab):
   - `DATABASE_URL` = from the Postgres plugin
   - `NODE_ENV=production`
   - `ODDS_API_KEY` = your The Odds API key (optional, for live data)
   - `SESSION_SECRET`-style secrets: none currently required (session tokens are
     random 256-bit), but keep env vars private.
3. **Start command** (Settings → Deploy → Custom start command):
   ```
   npx prisma migrate deploy && npx prisma db seed && next start
   ```
   - First deploy only: `prisma migrate deploy` creates tables. `db seed` fills demo
     data. Remove `db seed` from the command after the first deploy (or it will just
     no-op — the seed is idempotent).
4. Deploy. Add a custom domain when ready.

> SQLite → Postgres: set `provider = "postgresql"` in `prisma/schema.prisma` before
> pushing. `url = env("DATABASE_URL")` stays the same.

## 2. VPS (Ubuntu example)

```bash
# Install Node 20+ and build tools
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm i -g pnpm pm2

# Get the code
git clone https://github.com/you/voltbets /opt/voltbets
cd /opt/voltbets
pnpm install
cp .env.example .env        # set DATABASE_URL=postgresql://voltbets:pass@localhost:5432/voltbets
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm build
```

PM2 (single process — fine for one VPS):

```bash
pm2 start "pnpm start" --name voltsbet --cwd /opt/voltbets
pm2 save && pm2 startup
```

### Size the PM2 memory limit above the app's real baseline

`ecosystem.config.js` sets `max_memory_restart`. It **must sit comfortably
above the app's steady-state RSS, not below it.** The production Next.js
process idles around 500-650 MB, so a `600M` cap kills it roughly every 1-2
hours — and, worse, kills it *mid-sync*, which reaches operators as a generic
`"Something went wrong."` plus a stale "Odds last synced …h ago" banner (see
§4 Troubleshooting below). Size it at roughly 2.5x the baseline:

```jsonc
"max_memory_restart": "1536M"
```

Editing the file is not enough — a bare `pm2 restart <name>` keeps the old
value. Re-read the config:

```bash
pm2 reload ecosystem.config.js --update-env
pm2 describe voltsbet | grep -i 'max memory restart'
```

### Odds sync cron

Drive the sync over HTTP so the scheduler and the Admin "Run now" button share
one code path (do **not** invoke the TS module directly). Install into the app
user's crontab:

```cron
0 6 */3 * * curl -fsS -m 300 "http://127.0.0.1:3000/api/cron/sync?secret=<CRON_SECRET>" >> /var/log/voltsbet/cron-sync.log 2>&1
```

Keep nginx's `proxy_read_timeout` above the sync's worst-case runtime: a full
~48-league pass takes ~2 minutes, so the 300s default is fine today — but if the
league/market set grows, raise it or move the paid pass off the request path.

NGINX reverse proxy:

```nginx
server {
  listen 80;
  server_name bet.yourdomain.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then `sudo certbot --nginx` for HTTPS. **HTTPS is required** in production —
secure cookies are only sent over HTTPS (`secure: process.env.NODE_ENV === "production"`).

## 3. Multi-instance notes

The built-in rate limiter and settings/currency caches are per-process (in-memory).
For horizontal scaling, replace `src/lib/rate-limit.ts` with a Redis-backed limiter
and invalidate caches via pub/sub. SQLite is single-writer — switch to Postgres
before scaling out.

## 4. Troubleshooting: odds sync

**Symptom:** the Admin Panel reports a generic
`{"error":{"code":"ERROR","message":"Something went wrong."}}` and the Cron
Settings banner reads "Odds last synced 80h ago".

Work outward-in. A generic client-side error almost always means the API
returned something that was **not JSON** — an empty reply, or an nginx 502/504
while the app was killed/restarting. The API credential is the *last* thing to
suspect.

1. **Validate the key directly from the host** (quota-free):
   ```bash
   curl -i "https://api.the-odds-api.com/v4/sports/?apiKey=$ODDS_API_KEY"
   ```
   Expect `200` plus `x-requests-remaining` / `x-requests-used` headers.

2. **Check whether the process is being killed:**
   ```bash
   pm2 describe voltsbet | grep -iE 'restarts|uptime'
   grep -i 'max-memory-restart' ~/.pm2/pm2.log | tail
   tail -5 /var/log/voltsbet/cron-sync.log   # look for: curl: (52) Empty reply from server
   ```
   A `curl: (52)` whose timestamp matches a "restarted because it exceeds
   --max-memory-restart" line **is** the root cause — fix the memory cap above.

3. **Read the upstream reason.** Sync failures surface the specific cause at the
   top level of `GET/POST /api/cron/sync` (`ok:false`, `error:"The Odds API …"`)
   and persist it for later inspection:
   ```bash
   psql "$DATABASE_URL" -c "SELECT key,value FROM \"Setting\" WHERE key IN ('odds.lastSyncAt','odds.lastSyncError');"
   ```
   `401` → bad/renewed key; `402`/`403` → lapsed subscription;
   `OUT_OF_USAGE_CREDITS` → quota exhausted; `429` → rate limited (raise
   `ODDS_API_RATE_LIMIT_MS`).

4. **Re-run and confirm freshness:**
   ```bash
   curl -s "http://127.0.0.1:3000/api/cron/sync?secret=$CRON_SECRET&force=1" | jq
   ```
   A healthy run returns `ok:true` with `created`/`updated` counts; the Admin
   banner clears because `odds.lastSyncAt` is now recent.

## 5. Going live checklist

- [ ] Change demo passwords, delete demo accounts
- [ ] Set `NODE_ENV=production`, HTTPS everywhere
- [ ] Configure a real crypto provider (NOWPayments) + verify webhook signatures
- [ ] Add licensing/KYC/compliance tooling for your jurisdiction
- [ ] Backups: `pg_dump` daily (Railway has automatic backups on paid plans)
- [ ] Monitoring: uptime + error alerting (Sentry etc.)
- [ ] Size `max_memory_restart` above steady-state RSS (≥1.5 GB for the current
      app) and alert on PM2 restart count — a rising count means the process is
      being OOM-restarted
