# VoltBet — Sportsbook Platform

Full-stack, database-driven sportsbook: customer frontend, admin panel, betting
engine, settlement, crypto + M-Pesa + voucher deposits, multi-currency,
multi-language, RBAC and audit logging. Deploy on **Railway** or any **VPS**.

**Stack:** Next.js 16 (App Router) · TypeScript · Prisma · PostgreSQL · Tailwind 4

**Repo:** [github.com/ashyamctommy-eng/Voltsbet](https://github.com/ashyamctommy-eng/Voltsbet)  
**Branches:** `master` and `main` are kept in sync.

---

## Status (Phase 2 + build pipeline)

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | Pass — zero TypeScript errors |
| `pnpm run lint` | Pass — 0 errors (23 non-blocking warnings in seed/dev files) |
| `pnpm run build` | Pass — production Next.js compile succeeds |
| `installer.sh` / `deploy/install.sh` | Valid bash (syntax-check before deploy) |

Latest release line: **Phase 2** (VPS installer, sync batching, settle coverage,
hydration + slip polish) + lint cleanup (`f90de8d`).

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Quick start (local dev)](#quick-start-local-dev)
4. [Verify the build](#verify-the-build)
5. [Data providers](#data-providers)
6. [Production configuration](#production-configuration)
7. [Cron jobs](#cron-jobs)
8. [Deploy to Railway](#deploy-to-railway)
9. [Deploy to a VPS](#deploy-to-a-vps)
10. [Selling to clients](#selling-to-clients--theming--handover)
11. [Troubleshooting](#troubleshooting)
12. [Security notes](#security-notes)
13. [Pre-launch checklist](#pre-launch-checklist)
14. [Docs & support](#docs--support)

---

## Features

**Customer site** — homepage (banners, featured matches, promos), sports
catalogue (14 sports, DB-driven), match pages with full markets, live betting
with scores/clocks, bet slip (singles + accumulators, odds-change confirmation,
cash-out, parlay reduction), search, results, promotions, responsible gambling,
**voucher deposits**, WhatsApp + Telegram widgets, mobile bottom-nav + desktop
three-column layout.

**Betting engine** (server-side) — validates user status, game/market/outcome
state, odds drift, stake limits, payout caps, wallet balance; debits atomically
with transaction records. CSRF-protected.

**Settlement engine** — outcomes marked WON/LOST/VOID → open bets processed
(win credit / void refund / loss), markets close when settled, users notified,
actions audited. Optional auto-settlement via cron.

**Admin panel** `/admin` — dashboard, sports CRUD, manual games + live scores,
markets/outcomes + inline odds, settlement UI, users, deposits + withdrawals,
**Vouchers** (bulk generate, batches, export/print), currencies, languages,
promotions/banners, website settings (branding, limits, crypto), **API Settings**
(Odds API status + test), **Cronjobs** (scheduler config generator), audit logs,
on-demand sync.

**Data-driven** — statuses, currencies, languages, settings and content are DB
tables editable without code. Site name + primary color are per-install.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| ORM | Prisma 6 + PostgreSQL 14+ |
| Styling | Tailwind 4, dark-first |
| i18n | react-i18next — en / sw / fr / pt / es (DB-overridable) |
| Auth | HttpOnly sessions, bcrypt, CSRF double-submit, RBAC |
| Payments | NOWPayments (crypto) · M-Pesa Daraja · prepaid vouchers |
| Process | PM2 / `next start` (Railway: custom start command) |

See also: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Quick start (local dev)

**Requirements:** Node 22+, pnpm 10+, PostgreSQL (local or Docker).

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL to Postgres, e.g.:
# DATABASE_URL="postgresql://user:pass@localhost:5432/voltsbet"
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev                      # http://localhost:3000
```

> The Prisma schema targets **PostgreSQL**. For a file-based SQLite dev DB,
> change `provider` in `prisma/schema.prisma` to `sqlite` and use
> `DATABASE_URL="file:./dev.db"`.

### Demo accounts (seeded — local dev only)

> In production the seed creates **no demo accounts** and the super admin comes
> from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (no known-password fallback;
> set `SEED_DEMO_USERS=true` to force demo users).

| Role | Login | Password | Notes |
|---|---|---|---|
| Super Admin | `admin@voltbet.test` | `Admin123!` | `/admin` — dev only |
| Customer | `demo@voltbet.test` | `Demo123!` | Wallet KSh 24,800 |
| Customer | `pending@voltbet.test` | `Demo123!` | Pending verification |
| Customer | `suspended@voltbet.test` | `Demo123!` | Fully locked |

---

## Verify the build

Run before tagging a release or handing off to a client:

```bash
pnpm exec tsc --noEmit          # TypeScript — must be clean
pnpm run lint                   # ESLint — 0 errors required
pnpm run build                  # Prisma generate + Next.js production build
bash -n installer.sh            # root VPS installer syntax
bash -n deploy/install.sh       # deploy-folder installer syntax
```

Production build needs a valid `DATABASE_URL` (PostgreSQL). Static page
generation may log Prisma connection warnings if the DB is unreachable during
build — the compile itself still succeeds.

---

## Data providers

One provider for all sports data — **The Odds API (v4)**:

| Job | Endpoint | Config |
|---|---|---|
| Pre-match fixtures + odds | `/api/cron/sync` | `ODDS_API_KEY` |
| 7-day calendar (0-quota) | `/api/cron/schedule` | `ODDS_API_KEY` |
| Live scores / status | `/api/cron/sync` + `/live` | `ODDS_API_KEY` |
| Settlement inputs | `/api/cron/settle` | derived from `/scores` |

Markets fetched: `h2h` (1X2), `spreads`, `totals` — the market set the /odds
list endpoint serves; override via `ODDS_API_MARKETS` when your plan +
bookmaker coverage supports more (extended markets such as `btts`,
`correct_score` and half-time lines are per-event-endpoint only with limited
coverage — unsupported ones are dropped gracefully, never breaking a league).
Derived markets are added locally for free: **Double Chance** and **Draw No
Bet** from every 3-way 1X2. **Live odds** for in-play games are refreshed from
the same endpoint on `/live` (`ODDS_API_LIVE_MARKETS`, default `h2h`). Live
minutes are **estimated** from kickoff — The Odds API has no match clock;
`completed` flag and scores are authoritative.

**Currency resolution** (public `/api/public/currency-resolution`):

1. Admin force-default → `settings.currencyDefault`
2. Signed-in user preference → `displayCurrencyCode`
3. IP detection → ipapi.co, then ipinfo.io fallback
4. Fallback → USD

---

## Production configuration

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NODE_ENV` | ✅ | `production` |
| `APP_URL` | ✅ | Public base URL (cron config generator) |
| `ODDS_API_KEY` | ✅ | the-odds-api.com — free tier 500 req/month |
| `ODDS_API_REGIONS` | — | `us` (free); `us,eu` on paid plans |
| `CRON_SECRET` | ✅ | Guards `/api/cron/*` (`?secret=` or `x-cron-secret`) |
| `SYNC_THROTTLE_MINUTES` | — | default `60` |
| `ODDS_API_RATE_LIMIT_MS` | — | default `1100` (free tier = 1 req/sec) |
| `ODDS_API_MARKETS` | — | /odds list markets (default `h2h,spreads,totals`; unsupported ones auto-dropped) |
| `ODDS_API_LIVE_MARKETS` | — | in-play odds markets on `/live` (default `h2h`) |
| `LIVE_ODDS_THROTTLE_SECONDS` | — | min seconds between live-odds refreshes (default `900`) |
| `PURGE_MAX_AGE_HOURS` | — | default `2` |
| `SHOW_SEEDED_GAMES` | — | **Leave unset in production** |
| `SEED_ADMIN_EMAIL` | — | Super-admin email for the seed (default `admin@voltbet.test`) |
| `SEED_ADMIN_PASSWORD` | — | Super-admin password for the seed — **no production fallback**; skip admin if unset |
| `SEED_DEMO_USERS` | — | `true` to seed demo users in production (default: skipped) |

Full list: [`.env.production.example`](.env.production.example)

### API status

Admin → **API Settings** — Odds API key status, regions, connection test, monthly
quota. No per-provider credentials in the DB.

---

## Cron jobs

All endpoints: `GET /api/cron/<job>?secret=<CRON_SECRET>`

| Endpoint | Purpose | Schedule (UTC) | Credits |
|---|---|---|---|
| `/api/cron/sync` | Odds prices | Free: `0 6 */3 * *`; paid: `0 */8 * * *` | ~44/run |
| `/api/cron/schedule` | 7-day calendar | `0 5 * * *` | 0 |
| `/api/cron/settle` | Auto-settle | `*/12 * * * *` | 0 |
| `/api/cron/purge` | Expired calendar rows | `0 0 * * *` | 0 |

**Admin → Cronjobs** generates copy-paste configs (URL, curl, wget, cron-job.org,
UptimeRobot) with editable schedules and **Run now** per job.

Free-tier math: 500 credits/mo ÷ ~44 ≈ **11 syncs/mo** → every 3 days. Sync is
rate-limited internally; allow ≥60s request timeout on schedulers.

GitHub Actions workflows in `.github/workflows/` also run the cron endpoints on
schedule (set `CRON_SECRET` + `APP_URL` repo secrets).

---

## Deploy to Railway

1. Push to GitHub (`main` / `master` stay identical).
2. Railway → Deploy from GitHub → set env vars from the table above.
3. **Start command:**
   ```bash
   npx prisma migrate deploy && npx prisma db seed && next start
   ```
   The seed needs `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` set (Step 2) to
   create your admin — demo accounts are skipped in production.
4. Post-deploy: hit `/api/cron/sync?secret=…` once, verify Admin → Games, enable
   cron jobs.

Details: [`docs/DEPLOYMENT-RAILWAY.md`](docs/DEPLOYMENT-RAILWAY.md)

---

## Deploy to a VPS

Two equivalent installers — pick one:

| Script | Use when |
|---|---|
| [`installer.sh`](installer.sh) (repo root) | Cloning the repo and running from checkout |
| [`deploy/install.sh`](deploy/install.sh) | Running from the `deploy/` folder (Railway-safe) |

```bash
# Interactive
sudo bash installer.sh

# Non-interactive
DOMAIN=bet.example.com ODDS_API_KEY=xxx \
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='S3cret!' \
  sudo -E bash installer.sh
```

**What it installs:** Node 22, pnpm, PostgreSQL, Nginx, Certbot, PM2, UFW,
the 4 cron jobs, logrotate. Prompts for domain, Odds API key, Telegram bot
token, admin credentials. Generates `.env`, runs migrate + seed + build, optional
SSL.

Post-install rebrand anytime: `deploy/post-install.mjs`

Details: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

---

## Selling to clients — theming & handover

Each install is independently rebrandable via Admin → Website Settings (`site.name`,
`branding.primaryColor`). The VPS installer accepts `SITE_NAME` + `BRAND_COLOR`
at install time.

**Handover package:** private repo or zip · installer scripts · this README ·
[`docs/HANDOVER.md`](docs/HANDOVER.md) · buyer brings their own API keys.

**Rule:** never ship your own `ODDS_API_KEY` or payment credentials.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Home feed shows 0 matches | Run sync once; check `live` flag on rows |
| Cron 401 | `CRON_SECRET` mismatch — DB `cron.secret` wins over env |
| Cron 503 | No secret configured anywhere |
| Sync returns few games | Quota exhausted — check `x-requests-remaining` |
| Login API rejects curl | Body uses `identifier`, not `username` |
| Build Prisma errors | `DATABASE_URL` must be `postgresql://…` for default schema |
| Day windows shifted | Server TZ defines "today" (Railway = UTC) |

---

## Security notes

- Balance changes run in DB transactions with audit records.
- Payments credited only after webhook verification.
- HttpOnly sessions, CSRF on mutations, rate-limited auth, RBAC on admin routes.
- Real-money operation requires licensing, KYC and responsible-gambling compliance.

---

## Pre-launch checklist

- [ ] Rotate all API keys shared during development
- [ ] Set `SEED_ADMIN_PASSWORD` / run `deploy/post-install.mjs` — no seeded admin default reaches production
- [ ] Remove test routes if still present (`/api/test/*`, test preview pages)
- [ ] Paid Odds API plan → `ODDS_API_REGIONS=us,eu`, sync 3–4×/day
- [ ] Wire the 4 cron jobs (Admin → Cronjobs)
- [ ] Verify Admin → Games populated before opening bets
- [ ] Database backups configured (`pg_dump` daily on VPS)

---

## Docs & support

| Doc | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, money flow, settlement |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | VPS install walkthrough |
| [`docs/DEPLOYMENT-RAILWAY.md`](docs/DEPLOYMENT-RAILWAY.md) | Railway-specific steps |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Client handover checklist |

**Developer contact**

- Telegram: [t.me/Poriot_ke](https://t.me/Poriot_ke)
- WhatsApp: [wa.me/254717702563](https://wa.me/254717702563)

## Responsible gambling

Deposit/stake/session limits and self-exclusion at `/responsible-gambling`.
VoltBet is 18+ only.
