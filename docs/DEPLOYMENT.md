# Deploying VoltBet

Two supported targets: **Railway** (fastest, managed) and a **VPS** (full control).
Both use PostgreSQL in production.

## VPS quick start — `installer.sh` (Ubuntu/Debian)

The repo root ships a fully automated installer that takes a bare VPS to a
running sportsbook in one command:

```bash
sudo bash installer.sh
```

It installs Node.js LTS, PM2, PostgreSQL, Nginx and Certbot; prompts for the
domain, DB credentials, `THE_ODDS_API_KEY`, Telegram bot token and the initial
Super Admin credentials; then writes a sanitized `.env`, runs
`npm install` → `prisma migrate deploy` → `prisma db seed` → `npm run build`,
generates `ecosystem.config.js` and boots the app under PM2 (`pm2 save` +
systemd startup), configures Nginx as a reverse proxy on 80/443, and issues a
Let's Encrypt certificate when a domain is present. Non-interactive use:

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
     CREATE DATABASE voltbet;
     CREATE USER voltbet WITH PASSWORD 'a-long-random-password';
     GRANT ALL PRIVILEGES ON DATABASE voltbet TO voltbet;
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
git clone https://github.com/you/voltbet /opt/voltbet
cd /opt/voltbet
pnpm install
cp .env.example .env        # set DATABASE_URL=postgresql://voltbet:pass@localhost:5432/voltbet
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm build
```

PM2 (single process — fine for one VPS):

```bash
pm2 start "pnpm start" --name voltbet --cwd /opt/voltbet
pm2 save && pm2 startup
```

For a cron-driven odds sync, add:

```cron
*/15 * * * * cd /opt/voltbet && ODDS_API_KEY=$ODDS_API_KEY node -e "import('./src/lib/sync.ts')" ...
```

(Or run sync inside the app — see `docs/API-INTEGRATION.md`.)

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

## 4. Going live checklist

- [ ] Change demo passwords, delete demo accounts
- [ ] Set `NODE_ENV=production`, HTTPS everywhere
- [ ] Configure a real crypto provider (NOWPayments) + verify webhook signatures
- [ ] Add licensing/KYC/compliance tooling for your jurisdiction
- [ ] Backups: `pg_dump` daily (Railway has automatic backups on paid plans)
- [ ] Monitoring: uptime + error alerting (Sentry etc.)
