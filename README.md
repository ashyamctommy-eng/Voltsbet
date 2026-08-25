# VoltBet — Sportsbook Platform

A full-stack, database-driven sportsbook: customer frontend, admin backend,
betting engine, settlement engine, crypto deposits, multi-currency,
multi-language, RBAC and audit logging.

Built with **Next.js 16 (App Router) + TypeScript + Prisma + SQLite/PostgreSQL + Tailwind 4**.

---

## Quick start

```bash
pnpm install
cp .env.example .env          # DATABASE_URL="file:./dev.db"
pnpm prisma migrate dev       # create schema
pnpm prisma db seed           # demo data
pnpm dev                      # http://localhost:3000
```

### Demo accounts (seeded)

| Role | Login | Password | Notes |
|---|---|---|---|
| Super Admin | `admin@voltbet.test` | `Admin123!` | Full admin panel at `/admin` |
| Customer | `demo@voltbet.test` | `Demo123!` | Wallet KSh 24,800, betting history |
| Customer | `pending@voltbet.test` | `Demo123!` | Pending verification → betting/withdrawal locked |
| Customer | `suspended@voltbet.test` | `Demo123!` | Fully locked account |

> Change these before going live. Passwords are bcrypt-hashed; never store plaintext.

---

## What's inside

**Customer site** — homepage (hero banners, featured matches, promos),
sports catalogue (14 sports, DB-driven), match pages with full markets, live betting
with scores/clocks, bet slip (singles + accumulators, instant calc, odds-change
confirmation), search, results, promotions, responsible gambling, floating WhatsApp +
Telegram widgets, mobile bottom-nav + desktop three-column layout.

**Betting engine** (server-side only, spec §54) — validates user status, game/market/
outcome state, current odds vs displayed odds, stake limits, payout caps, wallet
balance; debits atomically with a transaction record. CSRF-protected.

**Settlement engine** — admin marks outcomes WON/LOST/VOID → open bets processed
automatically (win credit / void refund / loss), market closes when fully settled,
users notified, every action audited. Settlements can be reopened (guarded).

**Admin panel** `/admin` — dashboard stats, sports CRUD, manual games + live score
control, markets/outcomes with inline odds editing and suspension, settlement UI,
user management (verify/suspend/status), crypto deposits + withdrawals review,
currencies, languages + translations, promotions/banners, announcements,
website settings (branding colors, limits, support links, crypto config), audit logs,
on-demand API sync button.

**Data-driven everything** — statuses (feature-gating engine), currencies, languages,
settings and content are all DB tables the admin can edit without touching code.

---

## Data providers (production architecture)

Two providers, one job each — verified live 2026-08-25:

| Provider | Job | How it's configured |
|---|---|---|
| **The Odds API** | **Pre-match fixtures + odds** (`/api/cron/sync`) and the **free 7-day calendar** (`/api/cron/schedule`, via the 0-quota `/events` endpoint) | `ODDS_API_KEY` env var |
| **BetsAPI (RapidAPI)** | **Live in-play engine** (scores, live odds, settlement inputs) | Admin → **API Settings** — **NOT an env var** |

The sync layer is provider-agnostic (`src/lib/providers/odds-api.ts` +
`src/lib/sync.ts` + `src/lib/schedule-sync.ts`) — swap implementations without
touching app code. Admin → Games → **⟳ Sync API** runs the odds sync manually.
Full guide: `docs/API-INTEGRATION.md`.

**Currency resolution hierarchy:** admin force-default currency → user display
preference → IP detection (ipapi.co → ipinfo.io fallback, ~160-country map) → USD.

---

## Production configuration

### 1. Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `NODE_ENV` | ✅ | — | `production` |
| `APP_URL` | ✅ | — | Public base URL (used in notifications/webhooks) |
| `ODDS_API_KEY` | ✅ | — | the-odds-api.com key. Free tier = 500 req/month |
| `ODDS_API_REGIONS` | — | `us` | `us,eu` once on a paid plan (more leagues + books) |
| `CRON_SECRET` | ✅ | — | Guards every `/api/cron/*` endpoint (`?secret=` or `x-cron-secret` header) |
| `SYNC_THROTTLE_MINUTES` | — | `60` | Min minutes between odds-sync runs (route self-throttles; over-firing crons no-op) |
| `ODDS_API_CACHE_TTL_SECONDS` | — | `300` | Provider response cache TTL |
| `PURGE_MAX_AGE_HOURS` | — | `2` | Calendar purge deletes games kicked off this long ago (non-in-play) |
| `ODDS_API_FALLBACK_LEAGUES` | — | all | Comma-separated sport keys to sync (defaults to the built-in league set) |
| `ODDS_API_IO_DAYS_AHEAD` | — | — | Optional: schedule-sync horizon in days (default 7) |
| `ODDS_API_IO_KEY` / `ODDS_API_IO_MAX_ODDS_PAGES` | — | — | Optional the-odds-api.io bridge — not used on the standard path |
| `SHOW_SEEDED_GAMES` | — | unset | **Leave UNSET in production** — demo games leak into feeds if set |
| `SPORTMONKS_API_TOKEN` | — | — | **No longer needed** (calendar moved to The Odds API `/events`) |
| `BETSAPI_FEED_EVENTS` / `BETSAPI_MAX_EVENTS` / `BETSAPI_ODDS_EVENTS` / `BETSAPI_RESULT_SWEEP` | — | tuned | Optional BetsAPI feed tuning knobs |

### 2. BetsAPI credentials — Admin, not env

BetsAPI keys go in **Admin → API Settings** (stored in the DB, never in
`.env`): host `betsapi2.p.rapidapi.com`, your RapidAPI key, base URL
`https://betsapi2.p.rapidapi.com`.

### 3. Cron / scheduled jobs

All cron endpoints are `GET /api/cron/<job>?secret=<CRON_SECRET>` and require the
secret. They're plain HTTP — any scheduler works (Railway Cron, UptimeRobot,
GitHub Actions, cron-job.org).

| Endpoint | Purpose | Recommended schedule |
|---|---|---|
| `/api/cron/sync` | Odds API pre-match odds sync (prices for the league set) | **Free tier: every 2 days** (~44 credits/run, 500/mo budget). **Paid: 3–4×/day** |
| `/api/cron/schedule` | 7-day fixture calendar refresh (`/events`, 0 quota) | Daily (e.g. `0 3 * * *`) |
| `/api/cron/settle` | Settle finished games (win/void/loss) | Every 10–15 min (`*/12 * * * *`) |
| `/api/cron/purge` | Delete expired calendar rows (started >2h ago, not in-play; never rows with bet history) | Daily (`0 0 * * *`) |

**Railway Cron (native):** create a Cron Job service per endpoint with the full
`https://<app>.up.railway.app/api/cron/<job>?secret=<CRON_SECRET>` URL.

**UptimeRobot (free, no Railway cron needed):** free plan offers 5 / 10 / 15 / 30 min /
1 h / **24 h** intervals — no fixed time-of-day, and the clock starts at monitor
creation. Suggested mapping: `sync` → 24 h (throttle makes over-firing harmless),
`schedule` → 24 h, `purge` → 24 h, `settle` → 5 min. `SYNC_THROTTLE_MINUTES` means
frequent monitors just no-op.

**GitHub Actions (free, fixed times):** cron syntax like `0 3 * * *` — see
`docs/AUTOMATION.md` for a ready workflow.

### 4. Railway deployment

- **Start command:** `npx prisma migrate deploy && npx prisma db seed && next start`
- Set the env vars above; `ODDS_API_REGIONS=us` (→ `us,eu` after the paid plan).
- Post-deploy: hit `/api/cron/sync?secret=…` once manually, verify Admin → Games is
  populated, then enable the crons.
- Full walkthrough (incl. NOWPayments + M-Pesa sandbox wiring and a
  production-switch checklist): `docs/DEPLOYMENT-RAILWAY.md`.

---

## Project layout

```
prisma/            schema.prisma (24 models), migrations, seed.ts
src/lib/
  auth.ts          sessions (HttpOnly cookie), bcrypt, CSRF token
  api.ts           ApiError, RBAC matrix, audit logging, route wrapper
  bet-engine.ts    server-side bet placement (§54 checks)
  settle.ts        settlement + balance adjustments
  sync.ts          odds sync service (The Odds API)
  schedule-sync.ts 7-day calendar sync (/events) + expired-fixture purge
  providers/odds-api.ts   The Odds API implementation (pre-match)
  providers/betsapi*.ts   BetsAPI live engine
  currency-format.ts      Intl currency formatting (KSh/KES etc.)
  league-rank.ts          UEFA → EFL → La Liga → big-five priority
  feed.ts                 league titles + prematch feed
src/app/
  (customer pages) /, /sports, /live, /match/[id], /promotions, /results,
                   /search, /login, /register, /account/*, /responsible-gambling, /terms
  /admin/*         admin panel
  /api/*           REST endpoints (auth, bets, account, webhooks, admin)
src/components/    BetSlip, OddsButton, MatchCard, Header, MobileNav, admin CRUD, …
```

---

## Demo flows to try

1. **Place a bet** — open any match → tap odds → stake → *Place Bet* → see it in
   My Bets and the wallet debit in Transactions.
2. **Deposit** — Account → Deposit → pick USDT → amount → *Create Payment* →
   copy the demo address → *Simulate provider confirmation* → balance credited
   (this is exactly what a real NOWPayments webhook will do).
3. **Settle a game** — Admin → Games → a live match → set score/clock/status →
   in a market click **Won/Lost/Void** per outcome → open bets are paid/refunded
   automatically, market closes, users get notifications.
4. **Lock a user** — Admin → Users → suspend someone → they can no longer bet or
   deposit, and see a clear reason.
5. **Rebrand** — Admin → Website Settings → change primary color → whole site updates.
6. **Odds change guard** — open two tabs; change an outcome's odds in admin, then
   place the bet in the customer tab → confirmation dialog with new odds.

---

## Payments (automated deposits & withdrawals)

Two rails are built in, both fully automated and provider-swappable:

- **Crypto — NOWPayments** (`src/lib/providers/nowpayments.ts`): real per-payment
  addresses, HMAC-verified IPN webhook (`/api/webhooks/crypto/nowpayments`), and
  payout API for withdrawals. Custodial — no hot wallet needed to start.
- **M-Pesa — Safaricom Daraja** (`src/lib/providers/mpesa.ts`): STK Push deposits
  (PIN prompt on the user's phone, callback credits the wallet) and B2C payouts
  (result callback debits + completes). Webhook URLs are secret-guarded.

Configure keys in **Admin → Website Settings** (Crypto Payments / M-Pesa groups).
No provider configured → the app falls back to demo mode (mock address +
simulate button). Step-by-step setup incl. sandbox testing: `docs/DEPLOYMENT-RAILWAY.md`.

---

## Pre-launch checklist

- [ ] **Rotate all API keys** (Odds API, BetsAPI/RapidAPI) — they've been shared in
      dev chat/history. Revoke and re-issue before real money.
- [ ] Delete test-only files: `src/app/api/test-hybrid-feed/`, `src/app/test-preview/`,
      `src/components/HybridMatchCard.tsx`.
- [ ] Change seeded admin/customer passwords.
- [ ] Buy the paid Odds API plan (free tier = 500 req/month ≈ one sync every 2 days;
      ~44 credits per full sync across 22 leagues × 2 markets).
- [ ] Set `ODDS_API_REGIONS=us,eu` after the paid plan (more leagues + bookmakers).
- [ ] Wire the four cron jobs above.
- [ ] Verify Admin → Games is populated from the API before opening bets.

## Security notes (read before real money)

- All balance-changing operations run in DB transactions with audit records;
  nothing trusts the frontend.
- Payments are credited only after provider webhook verification — never on user
  claims. The `/api/webhooks/crypto/demo` endpoint is a dev stand-in; a real
  provider must verify HMAC signatures server-side.
- Sessions are HttpOnly cookies with server-side expiry; CSRF double-submit on
  all mutations; rate limiting on auth endpoints; RBAC on every admin route/API.
- Real-money operation requires licensing (e.g. BCLB in Kenya), KYC and
  responsible-gambling compliance beyond this codebase.

## Responsible gambling

Deposit/stake/session limits and self-exclusion are supported (see
`/responsible-gambling`). VoltBet is 18+ only.
