# VoltBet — Sportsbook Platform

A full-stack, database-driven sportsbook: customer frontend, admin backend,
betting engine, settlement engine, crypto deposits, multi-currency,
multi-language, RBAC and audit logging. Ready for **Railway** or any **VPS**.

Built with **Next.js 16 (App Router) + TypeScript + Prisma + PostgreSQL + Tailwind 4**.

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Quick start (local dev)](#quick-start-local-dev)
4. [Data providers](#data-providers)
5. [Production configuration](#production-configuration)
6. [Cron jobs](#cron-jobs)
7. [Deploy to Railway](#deploy-to-railway)
8. [Deploy to a VPS (installer)](#deploy-to-a-vps-installer)
9. [Selling to clients — theming & handover](#selling-to-clients--theming--handover)
10. [Troubleshooting](#troubleshooting)
11. [Security notes](#security-notes)
12. [Pre-launch checklist](#pre-launch-checklist)
13. [Developer contact](#developer-contact)

---

## Features

**Customer site** — homepage (hero banners, featured matches, promos),
sports catalogue (14 sports, DB-driven), match pages with full markets, live
betting with scores/clocks, bet slip (singles + accumulators, instant calc,
odds-change confirmation), search, results, promotions, responsible gambling,
floating WhatsApp + Telegram widgets, mobile bottom-nav + desktop three-column
layout.

**Betting engine** (server-side only) — validates user status, game/market/
outcome state, current odds vs displayed odds, stake limits, payout caps,
wallet balance; debits atomically with a transaction record. CSRF-protected.

**Settlement engine** — admin marks outcomes WON/LOST/VOID → open bets
processed automatically (win credit / void refund / loss), market closes when
fully settled, users notified, every action audited. Settlements can be
reopened (guarded). Optional auto-settlement via cron.

**Admin panel** `/admin` — dashboard stats, sports CRUD, manual games + live
score control, markets/outcomes with inline odds editing, settlement UI, user
management, crypto deposits + withdrawals review, currencies, languages +
translations, promotions/banners, announcements, website settings (branding
colors, limits, support links, crypto config), **API Settings** (The
Odds API status + connection test), **Cronjobs** (scheduler config generator), audit logs, on-demand API
sync button.

**Data-driven everything** — statuses, currencies, languages, settings and
content are all DB tables the admin can edit without touching code. **Branding
(site name + primary color) is DB-driven too** — each install is independently
rebrandable.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| ORM | Prisma 6 + PostgreSQL 14+ (SQLite for dev) |
| Styling | Tailwind 4, dark-first theme |
| i18n | react-i18next — en / sw / fr / pt / es (DB-overridable) |
| Auth | HttpOnly cookie sessions, bcrypt, CSRF double-submit, RBAC |
| Payments | NOWPayments (crypto) + M-Pesa Daraja (STK Push / B2C), provider-swappable |
| Process | PM2 / `next start` (Railway: custom start command) |

---

## Quick start (local dev)

```bash
pnpm install
cp .env.example .env          # dev: DATABASE_URL="file:./dev.db"
pnpm prisma migrate dev       # create schema
pnpm prisma db seed           # demo data
pnpm dev                      # http://localhost:3000
```

### Demo accounts (seeded)

| Role | Login | Password | Notes |
|---|---|---|---|
| Super Admin | `admin@voltbet.test` | `Admin123!` | Full admin panel at `/admin` — change before going live |
| Customer | `demo@voltbet.test` | `Demo123!` | Wallet KSh 24,800, betting history |
| Customer | `pending@voltbet.test` | `Demo123!` | Pending verification → betting/withdrawal locked |
| Customer | `suspended@voltbet.test` | `Demo123!` | Fully locked account |

---

## Data providers

One provider, every job — The Odds API (v4) powers the whole sports data
surface; no other provider is used:

| Job | Endpoint | Where configured |
|---|---|---|
| Pre-match fixtures + **odds** (expanded markets) | `/api/cron/sync` | `ODDS_API_KEY` env var |
| Free **7-day calendar** (0-quota `/events`) | `/api/cron/schedule` | `ODDS_API_KEY` env var |
| **Live in-play** scores/status (no sockets needed) | `/api/cron/sync` + `/live` (throttled `/scores` sweep) | `ODDS_API_KEY` env var |
| Settlement inputs (finished scores) | `/api/cron/settle` | derived from `/scores` |

Expanded market set requested on every pre-match fetch: `h2h, spreads,
totals, h2h_h1, totals_h1, h2h_h2, totals_h2, correct_score` — the UI renders
1st Half / 2nd Half / Totals / Correct Score tabs whenever prices exist.
Live scores come from `GET /v4/sports/{sport}/scores?daysFrom=1` (at most one
sweep per active league per 5-min window; match minutes are ESTIMATED from
kickoff — The Odds API exposes no match clock; the `completed` flag and
scores are authoritative).

**League priority:** UEFA → EFL → La Liga → rest of the big five, then the
verified priced additions (Serie B, Bundesliga 2, Ligue 2, Segunda, Eredivisie,
Primeira Liga, SPL, MLS, Brazil Serie A, Turkey Super Lig). No league trimming —
the full set syncs on the paid plan.

**Currency resolution hierarchy:** admin force-default → user display
preference → IP detection (ipapi.co → ipinfo.io fallback, ~160-country map) → USD.

---

## Production configuration

### 1. Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `NODE_ENV` | ✅ | — | `production` |
| `APP_URL` | ✅ | — | Public base URL (also powers the Admin Cronjobs copy-configs) |
| `ODDS_API_KEY` | ✅ | — | the-odds-api.com key. Free = 500 req/month |
| `ODDS_API_REGIONS` | — | `us` | `us,eu` once on a paid plan (more books + leagues) |
| `CRON_SECRET` | ✅ | — | Guards every `/api/cron/*` endpoint (`?secret=` or `x-cron-secret` header) |
| `SYNC_THROTTLE_MINUTES` | — | `60` | Min minutes between odds-sync runs (route self-throttles) |
| `ODDS_API_CACHE_TTL_SECONDS` | — | `300` | Provider response cache TTL |
| `ODDS_API_RATE_LIMIT_MS` | — | `1100` | Min spacing between Odds API calls (free tier = 1 req/sec; paid: ~250) — auto-retries 429s |
| `PURGE_MAX_AGE_HOURS` | — | `2` | Calendar purge deletes games kicked off this long ago (non-in-play) |
| `ODDS_API_FALLBACK_LEAGUES` | — | all | Comma-separated sport keys to sync. **Unset = every active soccer league is queried** for the landing feed (priority-ordered, see `ODDS_API_FEED_MAX_LEAGUES`) — the feed is never hardcoded to EFL/LaLiga only |
| `ODDS_API_FEED_MAX_LEAGUES` | — | `60` | Max leagues queried per feed refresh when no `ODDS_API_FALLBACK_LEAGUES` override (1 request each; feed is TTL-cached, cold-DB bootstrap only — free tier safe) |
| `SHOW_SEEDED_GAMES` | — | **unset** | **Leave UNSET in production** — setting it to `true` reveals demo games |
| `SPORTMONKS_API_TOKEN` | — | — | **No longer needed** (calendar moved to The Odds API `/events`) |

### 2. API status — Admin

Admin → **API Settings** shows the The Odds API provider status (key from the
`ODDS_API_KEY` env var, bookmaker regions) and a connection test that also
reports your remaining monthly quota. There are no per-provider credentials in
the DB anymore.

---

## Cron jobs

All endpoints are `GET /api/cron/<job>?secret=<CRON_SECRET>`. Any scheduler
works: **Railway cron, cron-job.org, UptimeRobot, GitHub Actions, or the VPS
crontab** (installer sets it up automatically).

| Endpoint | Purpose | Recommended schedule (UTC) | Odds API credits |
|---|---|---|---|
| `/api/cron/sync` | Odds prices | Free tier: **every 3 days** (`0 6 */3 * *`); paid: 3–4×/day (`0 */8 * * *`) | ~44/run |
| `/api/cron/schedule` | 7-day calendar (`/events`, 0 quota) | Daily (`0 5 * * *`) | 0 |
| `/api/cron/settle` | Auto-settle finished games | Every 10–15 min (`*/12 * * * *`) | 0 |
| `/api/cron/purge` | Delete expired calendar rows (never rows with bet history) | Daily (`0 0 * * *`) | 0 |

**Admin → Cronjobs** (`/admin/cronjobs`) generates every config for you —
endpoint URL, curl, wget (Railway cron), cron-job.org fields, UptimeRobot
fields — with copy buttons, editable schedules (persisted to the DB), and a
**Run now** button per job (admin auth, no secret needed). Recommended pick:
**cron-job.org** (real cron syntax, fixed times, free).

Free-tier quota math: 500 credits/mo ÷ ~44 per sync ≈ **11 runs/mo** → every 3
days. The homepage is DB-first (0 API requests per visit) and the calendar +
settle + purge cost nothing.

**Rate limit (why syncs 429'd):** the free tier allows **1 request/second** —
the sync fires 44 back-to-back requests, which trips `429 EXCEEDED_FREQ_LIMIT`
on fast networks (Railway). The sync is throttled internally
(`ODDS_API_RATE_LIMIT_MS`, default 1100) and retries 429s with backoff. A full
sync now takes **~50s** — schedulers need a ≥60s request timeout (Railway cron
`wget -m 300`, VPS crontab: fine).

---

## Deploy to Railway

1. Push the repo to GitHub (`main` and `master` are kept in sync).
2. Railway → New → Deploy from GitHub → set env vars from the table above
   (`ODDS_API_REGIONS=us`; leave `SHOW_SEEDED_GAMES` unset).
3. **Start command:** `npx prisma migrate deploy && npx prisma db seed && next start`
4. Post-deploy: hit `/api/cron/sync?secret=…` **once manually**, verify Admin →
   Games is populated, then enable the cron jobs (see above).

---

## Deploy to a VPS (installer)

`deploy/install.sh` takes a **fresh Ubuntu 22.04/24.04 VPS** to a live site in
one run — Node 22 + pnpm + PostgreSQL + Nginx + SSL + PM2 + firewall + the 4
cron jobs, then prints the admin login and next steps. It is **Railway-safe**
(purely additive `deploy/` files — your Railway instance is untouched).

```bash
# interactive
bash deploy/install.sh

# or non-interactive (for setup calls / automation)
DOMAIN=bet.example.com ODDS_API_KEY=xxx \
  SITE_NAME="MyBet" BRAND_COLOR="#00c853" \
  ADMIN_PASSWORD="StrongPass1!" bash deploy/install.sh
```

What it does, step by step:

1. System packages (nginx, postgres, certbot, fail2ban, ufw)
2. Node 22 + pnpm
3. App user `voltsbet` + clone/pull the repo to `/var/www/voltsbet`
4. Postgres role + database with a random password
5. `.env` generated with a random `CRON_SECRET` (existing `.env` is never
   overwritten; `SHOW_SEEDED_GAMES` left unset)
6. `prisma migrate deploy` + `db seed` + production build
7. Branding + admin password via `deploy/post-install.mjs` (per-client
   identity: site name, primary color, fresh admin password)
8. PM2 (auto-restart on boot) — `ecosystem.config.cjs` generated
9. Nginx reverse proxy + optional certbot SSL for the domain
10. Firewall (22/80/443)
11. **crontab** for the 4 cron jobs hitting `127.0.0.1` (no cron-job.org
    needed on a VPS) + logrotate
12. Summary with URL, admin login, next steps

Also in `deploy/`: `post-install.mjs` (rebrand + reset admin password anytime).

**VPS checklist before installing:** a domain pointed at the server (optional,
works on IP too), and an Odds API key (`ODDS_API_KEY` env var — the only
sports-data credential in the stack).

---

## Selling to clients — theming & handover

**Each client gets an independent brand — theming is DB-driven, not code.**
`site.name` and `branding.primaryColor` live in the DB (editable in Admin →
Website Settings); the whole UI follows. The installer prompts for
`SITE_NAME` + `BRAND_COLOR` at install time, so every sale is a 10-minute
re-run, not a project. Banner, promos, languages, currencies and payment keys
are all per-install too. A genuinely different *layout* (custom pages) is a
customization line-item.

**Handover package** (what a buyer receives):
- Private repo (git history is secret-free — verified) or a clean zip
- `deploy/install.sh` + `deploy/post-install.mjs`
- This README
- Accounts checklist (they create their own): VPS, domain, Odds API,
  NOWPayments, M-Pesa Daraja sandbox→live
- 1-hour setup call (run the installer together), optional support retainer

**Bring-your-own-keys rule:** never ship your own API keys. The Odds API key
is env-only — nothing key-related lives in the code or git history.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Home feed shows "0 matches" | `live` flag stuck true (old syncs). Fixed in code (`live:false` on pre-match upserts); run the sync once to refresh rows |
| Cron returns 401 | `CRON_SECRET` mismatch — DB `cron.secret` (Admin → Website Settings) wins over the env var; keep ONE source (env recommended) |
| Cron returns 503 CRON_NOT_CONFIGURED | No secret anywhere — set `CRON_SECRET` (service env, not just project) |
| Sync returns few/no games | Odds API quota exhausted (422/429) — check `x-requests-remaining`; free tier ≈ 11 syncs/mo |
| `?date=` views empty for far dates | By design: `/api/matches` only falls back to the API within the rolling 7-day window |
| Login API rejects curl | The login body uses `identifier`, not `username`: `{"identifier":"admin@voltbet.test","password":"…"}` |
| Day windows look shifted | Calendar days are local-midnight based; the server TZ defines "today" for `/api/matches` (Railway = UTC) |

---

## Security notes (read before real money)

- All balance-changing operations run in DB transactions with audit records.
- Payments are credited only after provider webhook verification — never on
  user claims. The `/api/webhooks/crypto/demo` endpoint is a dev stand-in.
- Sessions are HttpOnly cookies with server-side expiry; CSRF double-submit
  on all mutations; rate limiting on auth endpoints; RBAC on every admin route.
- Real-money operation requires licensing (e.g. BCLB in Kenya), KYC and
  responsible-gambling compliance beyond this codebase.

---

## Pre-launch checklist

- [ ] Rotate all API keys (they've been shared in dev chat)
- [ ] Change the seeded admin password (installer does this on VPS; do it
      manually on Railway)
- [ ] Delete test-only files: `src/app/api/test-hybrid-feed/`,
      `src/app/test-preview/`, `src/components/HybridMatchCard.tsx`
- [ ] Buy the paid Odds API plan → set `ODDS_API_REGIONS=us,eu`, sync 3–4×/day
- [ ] Wire the 4 cron jobs (Admin → Cronjobs generates the configs)
- [ ] Verify Admin → Games is populated before opening bets
- [ ] Backups running (VPS: `pg_dump` daily — see installer logrotate)

---

## Developer contact

For installation support, customization quotes, or new features:

- **Telegram:** [t.me/Poriot_ke](https://t.me/Poriot_ke)
- **WhatsApp:** [wa.me/254717702563](https://wa.me/254717702563)

## Responsible gambling

Deposit/stake/session limits and self-exclusion are supported (see
`/responsible-gambling`). VoltBet is 18+ only.
