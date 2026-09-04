# UNIBET360 — Sportsbook Platform

Full-stack, database-driven sportsbook: customer frontend, admin panel, betting
engine, settlement, **crypto + M-Pesa (Palpluss) + voucher** deposits,
multi-currency with **automated market rates**, manual custom markets, live
betting, multi-language, RBAC and audit logging. Deploy on **Railway** or any **VPS**.

**Stack:** Next.js 16 (App Router) · TypeScript (strict) · Prisma 6 · PostgreSQL 14+ · Tailwind 4 · react-i18next

**Repo:** [github.com/ashyamctommy-eng/Voltsbet](https://github.com/ashyamctommy-eng/Voltsbet)
**Branches:** `master` and `main` are kept identical (fast-forward sync).

---

## Table of contents

1. [Status](#status)
2. [Features](#features)
3. [Quick start (local dev)](#quick-start-local-dev)
4. [Verify the build](#verify-the-build)
5. [Environment variables (complete reference)](#environment-variables-complete-reference)
6. [Sports data — The Odds API](#sports-data--the-odds-api)
7. [M-Pesa via Palpluss (setup guide)](#m-pesa-via-palpluss-setup-guide)
8. [Manual custom markets](#manual-custom-markets)
9. [Automated market rates & multi-currency](#automated-market-rates--multi-currency)
10. [Cron jobs](#cron-jobs)
11. [GitHub Actions workflows](#github-actions-workflows)
12. [Withdrawal pipeline (manual payouts)](#withdrawal-pipeline-manual-payouts)
13. [Deploy to Railway](#deploy-to-railway)
14. [Deploy to a VPS](#deploy-to-a-vps)
15. [Selling to clients — theming & handover](#selling-to-clients--theming--handover)
16. [Troubleshooting](#troubleshooting)
17. [Security notes](#security-notes)
18. [Pre-launch checklist](#pre-launch-checklist)
19. [Docs & support](#docs--support)

---

## Status

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | ✅ Pass — zero TypeScript errors |
| `pnpm run lint` | ✅ Pass — 0 errors (27 non-blocking warnings) |
| `pnpm run test` | ✅ Pass — 64/64 vitest suites (wallet, settlement, odds, bonus-pool rules) |
| `pnpm run build` | ✅ Pass — production Next.js compile succeeds |
| `bash scripts/check-schema-sync.sh` | ✅ Postgres + MySQL schemas in sync |

Latest release line: **bonus & wallet UX batch** — registration-bonus system
(admin toggle + amount, deposit-locked bonus balance, header **Balance +
Bonus** block, bonus-first staking with source-aware refunds), crypto deposit
QR codes + SVG trust badges, withdrawal limit validation, touch-scroll footer
partner/payment logos, developer contact moved to the admin panel only
(`d17eb63` → `a0af5e1` → `d82ebfc`).

---

## Features

**Customer site** — homepage (banners, featured matches, promos), sports
catalogue (DB-driven; football, basketball, tennis, esports + more), match pages
with full markets, **live betting** with scores/clocks, bet slip (singles +
accumulators, odds-change confirmation, cash-out, parlay reduction), search,
results, promotions, responsible gambling, **voucher deposits**, WhatsApp +
Telegram widgets, mobile bottom-nav + desktop three-column layout.

**Wallet & bonuses** — the header shows **Balance + Bonus** side by side in the
wallet currency (mobile keeps a compact deposit button). A configurable
**registration bonus** (Admin → Website Settings → Registration Bonus) is
credited to a separate bonus balance at signup and is **deposit-locked**: it
cannot be staked or withdrawn until the player's first successful deposit
(crypto, M-Pesa or voucher) unlocks it — after that, stakes spend bonus funds
first and voided/cancelled bets refund to the same pools. Bonus funds are never
withdrawable.

**Deposit UX** — QR-code crypto deposits (scan or copy the address), SVG trust
badges (instant / secure / no fees), and server-verified voucher redemption.

**Betting engine** (server-side) — validates user status, game/market/outcome
state, odds drift, stake limits, payout caps, wallet balance; debits atomically
with transaction records. CSRF-protected.

**Settlement engine** — outcomes marked WON/LOST/VOID → open bets processed
(win credit / void refund / loss), markets close when settled, users notified,
actions audited. Optional auto-settlement via cron.

**Admin panel** `/admin` — dashboard, sports CRUD, manual games + live scores,
markets/outcomes + inline odds, **custom market builder** (manual markets that
sync never overwrites), settlement UI, users, deposits + withdrawals (with the
manual payout queue), **Vouchers** (bulk generate, batches, export/print),
currencies (+ market-rate sync), languages, promotions/banners, website
settings (branding, limits, crypto, **Palpluss M-Pesa**, **registration
bonus**), **API Settings**
(Odds API status + test), **Cronjobs** (scheduler config generator), audit logs,
on-demand sync.

Withdrawal requests are validated against the real balance only — bonus funds
are excluded — with inline "Insufficient withdrawable balance" errors and a
disabled submit button when the amount exceeds available funds.

**Payments** — NOWPayments (crypto) · **M-Pesa via Palpluss** (STK deposits +
B2C payouts, optional `?secret=`-authenticated webhooks) · prepaid vouchers.
Legacy Daraja code remains as a fallback provider when Palpluss is not
configured.

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
| Super Admin | `admin@unibet360.test` | `Admin123!` | `/admin` — dev only |
| Customer | `demo@unibet360.test` | `Demo123!` | Wallet KSh 24,800 |
| Customer | `pending@unibet360.test` | `Demo123!` | Pending verification |
| Customer | `suspended@unibet360.test` | `Demo123!` | Fully locked |

---

## Verify the build

Run before tagging a release or handing off to a client:

```bash
pnpm exec tsc --noEmit          # TypeScript — must be clean
pnpm run lint                   # ESLint — 0 errors required
pnpm run build                  # Prisma generate + Next.js production build
bash scripts/check-schema-sync.sh  # Postgres schema == MySQL schema
bash -n installer.sh            # root VPS installer syntax
bash -n deploy/install.sh       # deploy-folder installer syntax
```

Production build needs a valid `DATABASE_URL` (PostgreSQL). Static page
generation may log Prisma connection warnings if the DB is unreachable during
build — the compile itself still succeeds.

---

## Environment variables (complete reference)

**Required in production:** `DATABASE_URL`, `NODE_ENV`, `APP_URL`, `ODDS_API_KEY`,
`CRON_SECRET`, and (for the seed) `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `NODE_ENV` | ✅ | — | `production` |
| `APP_URL` | ✅ | — | Public HTTPS base URL — builds webhook callback URLs + cron configs |
| `ODDS_API_KEY` | ✅ | — | the-odds-api.com v4 — pre-match odds, live scores, live odds, settlement |
| `CRON_SECRET` | ✅ | — | Guards `/api/cron/*` (`?secret=` or `x-cron-secret`) — `openssl rand -hex 32` |
| `SEED_ADMIN_EMAIL` | seed | `admin@unibet360.test` | Super-admin email created by the seed |
| `SEED_ADMIN_PASSWORD` | seed | — | **No production fallback** — seed skips admin if unset |
| `ODDS_API_REGIONS` | — | `eu,us` | Bookmaker regions — `eu` is the only region with Pinnacle (deepest soccer book), `us` adds Bovada + US majors. Union = 34 books on EPL (11 full h2h/spreads/totals). 6 credits/league/list. |
| `ODDS_API_MARKETS` | — | `h2h,spreads,totals,btts,double_chance,draw_no_bet,correct_score` | List-endpoint markets + per-event extended markets; unsupported ones are auto-dropped |
| `ODDS_API_FALLBACK_LEAGUES` | — | *(all active)* | Comma list of preferred feed leagues (e.g. `soccer_epl,soccer_spain_la_liga`); empty = all active soccer leagues |
| `ODDS_API_FEED_MAX_LEAGUES` | — | `60` | Max leagues per feed refresh when no override above (1 request each) |
| `ODDS_API_EVENT_BOOKMAKERS` | — | `pinnacle` | Bookmaker for per-event markets (`/events/{id}/odds`) — Pinnacle confirmed |
| `ODDS_API_EVENT_MARKET_LEAGUES` | — | top-6 soccer (EPL, UCL, Serie A, La Liga, Bundesliga, Ligue 1) | Leagues that get per-event extended markets |
| `ODDS_API_EVENT_MARKET_LIMIT` | — | `4` | Max fixtures per league for the deep event pass (1 credit per served market per event; `0` disables) |
| `ODDS_API_LIVE_MARKETS` | — | `h2h` | In-play odds markets refreshed on `/live` |
| `LIVE_ODDS_THROTTLE_SECONDS` | — | `900` | Min seconds between in-play odds refreshes |
| `LIVE_SCORES_THROTTLE_SECONDS` | — | `300` | Min seconds between live-score sweeps (per active league) |
| `LIVE_SCORES_LOOKBACK_HOURS` | — | `4` | How far back live scores look for recently started games |
| `FEED_EVENTS` | — | `12` | Max events per league in the 7-day calendar feed |
| `FEED_TTL_SECONDS` | — | `21600` (6 h) | Calendar feed cache TTL |
| `ODDS_API_CACHE_TTL_SECONDS` | — | `1800` (30 min) | Provider response cache TTL |
| `ODDS_API_RATE_LIMIT_MS` | — | `1100` | Min spacing between Odds API calls — free tier ≈1 req/s; paid ≈250–300 |
| `SYNC_THROTTLE_MINUTES` | — | `60` | Min minutes between odds-sync runs |
| `SCHEDULE_THROTTLE_MINUTES` | — | `60` | Min minutes between calendar-feed runs |
| `SETTLE_THROTTLE_MINUTES` | — | `5` | Min minutes between auto-settle runs |
| `PURGE_THROTTLE_MINUTES` | — | `60` | Min minutes between calendar-purge runs |
| `PURGE_MAX_AGE_HOURS` | — | `2` | Delete non-in-play games this long after kickoff |
| `RATES_SYNC_THROTTLE_MINUTES` | — | `60` | Min minutes between market-rate syncs (`/api/cron/rates`) |
| `ENABLE_MPESA_PAYMENTS` | — | unset (admin toggle) | `false` **hides the M-Pesa tab** on Deposit & Withdraw — users fall back to crypto; env wins over the admin toggle |
| `ENABLE_MPESA_WITHDRAWALS` | — | follows `ENABLE_MPESA_PAYMENTS` | `false` hides M-Pesa as a withdrawal method |
| `PALPLUS_BASE_URL` | — | `https://api.palpluss.com/v1` | Override for gateway mirrors (rarely needed) |
| `SHOW_SEEDED_GAMES` | — | unset | **Leave unset in production** — reveals demo games |
| `SEED_DEMO_USERS` | — | dev: true / prod: false | `true` seeds demo users in production |

**Palpluss M-Pesa credentials are NOT env vars** — they live in
**Admin → Settings → M-Pesa (Palplus)** (stored encrypted/masked on read):
`PALPLUS_API_KEY`, `PALPLUS_CHANNEL_ID`, `PALPLUS_WEBHOOK_SECRET`, `PALPLUS_ENV`.
See the [Palpluss setup guide](#m-pesa-via-palpluss-setup-guide).

Full templates: [`.env.production.example`](.env.production.example) · [`.env.example`](.env.example)

---

## Sports data — The Odds API

One provider for all sports data — **The Odds API (v4)**:

| Job | Endpoint | Config |
|---|---|---|
| Pre-match fixtures + odds | `/api/cron/sync` | `ODDS_API_KEY` |
| 7-day calendar (0-quota) | `/api/cron/schedule` | `ODDS_API_KEY` |
| Live scores / status | `/api/cron/sync` + `/live` | `ODDS_API_KEY` |
| Settlement inputs | `/api/cron/settle` | derived from `/scores` |

### Market layers

1. **List endpoint** (`/odds`): `h2h` (1X2), `spreads`, `totals` — the only
   markets that endpoint serves.
2. **Per-event endpoint** (`/events/{id}/odds`): **BTTS, Correct Score, Double
   Chance, Draw No Bet, alternate totals/spreads, half-time lines** for the
   nearest fixtures of the configured leagues. **Bovada is the primary event
   book** (audited 2026-08-31: 10 market keys / 51–52 outcome lines per EPL
   fixture incl. 20-line alternate spreads), **Pinnacle is the fallback** for
   markets Bovada doesn't serve (`ODDS_API_EVENT_BOOKMAKERS`, default
   `bovada,pinnacle`). 1 credit per served market per event — see
   `ODDS_API_EVENT_MARKET_LIMIT`; the full market set is configurable via
   `ODDS_API_MARKETS`, default includes
   `alternate_spreads,alternate_totals,h2h_h1,totals_h1,spreads_h1,
   h2h_h2,totals_h2,spreads_h2` — verified against the live API; the
   `h2h_1st_half`-style names 422 and are dropped gracefully).
3. **Derived-markets engine** (zero provider cost, zero manual input): every
   priced 3-way 1X2 automatically generates a **63-outcome board** — Double
   Chance, Draw No Bet, BTTS, Alternate Totals (O/U 0.5–5.5), Alternate
   Spreads (AH −2.5…+2.5), Home/Away Team Totals (O/U 0.5–3.5), 1st/2nd-half
   match results + totals, and Goal Parity (Odd/Even) — via a Poisson/Skellam
   model fitted to the 1X2 odds (λ estimated by coordinate descent). Derived
   odds inherit the source market's margin. **Ownership:** derived markets are
   flagged `isDerived` and refreshed every sync; when the feed later prices the
   same key the API takes over and the engine backs off. Admin-created and
   settled markets are never touched. Kill-switch: `ENABLE_DERIVED_MARKETS=false`.

Unsupported markets are dropped
gracefully, never breaking a league. **Live odds** for in-play games are
refreshed on `/live` (`ODDS_API_LIVE_MARKETS`, default `h2h`). Live minutes are
**estimated** from kickoff — The Odds API has no match clock; the `completed`
flag and scores are authoritative.

### Sports coverage

`SPORT_KEY_MAP` in `src/lib/sync.ts` maps the catalog to The Odds API sport
keys — football (EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL, UEL, UECL,
EFL, SA, MLS, …), **basketball** (NBA, Euroleague, NCAAB, WNBA), **tennis** (ATP
US Open, WTA US Open, Winston-Salem), **esports** (CS2 ESL Pro League, Dota 2
International, LCK), plus cricket and more. Seasonal keys (e.g. NCAAB,
Winston-Salem, esports majors) activate automatically when the API lists them;
out-of-season sports simply show no fixtures. `ensureMappedSports()` auto-creates
missing `Sport` rows during sync, so existing installs don't need reseeding.

**Full auto-mapping — nothing is dropped:** the sync ingests *every*
bettable league the API lists, not just the curated map. Curated categories
(football, basketball, tennis, esports, …) come first; unknown keys resolve
via sport-prefix fallback (NFL → American Football, NHL → Ice Hockey, boxing,
MMA, cricket, K-League, …) or a sanitized key. Sport rows are auto-created at
sync time, and league names come from the API. Futures/outrights keys
(`*_winner`, `*_preseason`, …) are excluded from the catalog. The odds pass
is capped by `ODDS_API_FEED_MAX_LEAGUES` (default `120`; free tier: lower it).

Sport pages query **live/today matches first and fall back to upcoming
fixtures** when a tab has none — no empty-tab UX dead-ends. The home hero
slideshow and `/live` fall back to the next kickoffs the same way.

---

## M-Pesa via Palpluss (setup guide)

M-Pesa deposits (STK Push) and payouts (B2C) run through the **PalPluss**
gateway (`palpluss.com`) — no Daraja configuration, no OAuth tokens.

### 1. Create your gateway account

1. Register at [console.palpluss.com](https://console.palpluss.com) and complete
   email verification + KYC (KYC is required for live STK and B2C).
2. **Settings → API Keys → Create API Key** — copy the full key (**shown only
   once**). Keys start with `pp_live_` (production) or `pp_test_` (test).
3. **Payment Channels → Create channel** — register your M-Pesa Paybill/Till
   shortcode and **mark it as default**. Copy the channel UUID.

### 2. Configure the app

Open **Admin → Settings → M-Pesa (Palplus)**:

| Field | Value |
|---|---|
| `PALPLUS_API_KEY` | `pp_live_…` (or `pp_test_…`) |
| `PALPLUS_CHANNEL_ID` | Channel UUID from the console — **optional** if your channel is default |
| `PALPLUS_WEBHOOK_SECRET` | Any random string (`openssl rand -hex 16`) — appended to callback URLs as `?secret=…`; callbacks without it are rejected |
| `PALPLUS_ENV` | `sandbox` while testing → `production` when live |

Then hit **"⟳ Test Palpluss connection"** — it performs a read-only
service-wallet balance call and confirms the key, channel and environment
without initiating any payment.

The webhook URL is `https://<APP_URL>/api/webhooks/palplus` (copyable from the
same settings page). Callbacks are authenticated by the `?secret=` suffix the
app appends automatically — **no console webhook registration needed**.

### 3. Auth & endpoints (verified against the live API, 2026-08-31)

- **Auth:** `Authorization: Basic <base64(apiKey:)>` — the key is the username,
  the password is empty. **There is no token endpoint.**
- **STK deposit:** `POST https://api.palpluss.com/v1/payments/stk`
  `{ amount, phone, accountReference (≤12), transactionDesc (≤13), callbackUrl, channelId? }`
- **B2C payout:** `POST https://api.palpluss.com/v1/b2c/payouts`
  `{ amount (≥10), phone, reference, description?, callbackUrl }`
- **Health:** `GET https://api.palpluss.com/v1/wallets/service/balance`
- **Rate limit:** 60 req/min per key (`x-ratelimit-*` headers).

### 4. Go-live notes

- The **service wallet** pays the per-transaction fee (~KES 2.5) — top it up at
  console → Finance → Wallets; requests fail with `INSUFFICIENT_SERVICE_BALANCE`
  (402) when it runs dry.
- **B2C payouts** draw from a separate **B2C wallet** (top up in the console);
  requests before KYC approval fail with `KYC_NOT_VERIFIED` (403).
- M-Pesa is a **KES-only rail**: non-KES wallets are converted at market rates
  (STK charges the KES amount, the wallet is credited in its own currency).
  The Safaricom **KSh 150,000/transaction cap** is enforced.
- `ENABLE_MPESA_PAYMENTS=false` (env) hides the M-Pesa tab on Deposit and
  Withdraw entirely — the UI snaps back to crypto.
- Legacy Daraja credentials still work as a fallback when `PALPLUS_API_KEY` is
  empty (Admin → Settings → M-Pesa (Daraja) fields remain for that path).

---

## Manual custom markets

Admins can inject **manual markets/outcomes** on any game — player props,
promos, one-off lines — that the sync pipeline will **never touch**:

1. Admin → Games → open a match → **+ Add Market** (name, type, status,
   outcomes with labels + odds).
2. Manual markets are flagged `isManual` in the DB and render with a **Manual**
   chip in the customer accordion.
3. Sync guards: manual markets/outcomes are **never overwritten, suspended, or
   resurrected** by the feed or the derived-market engine (verified by the
   test suite). Admins can still edit odds inline and toggle
   ACTIVE/SUSPENDED anytime.

---

## Automated market rates & multi-currency

- **Registration** picks the wallet currency (DB-driven dropdown, platform
  default preselected). The wallet is created in that currency; balances always
  display in it.
- **Deposits convert automatically** into the wallet currency:
  - **Crypto** — NOWPayments prices the payment in the wallet currency
    (1:1 for USD/USDT/USDC-pegged, KES-pegged and crypto-table rates; a missing
    rate refuses the payment rather than guessing).
  - **M-Pesa** — KES-only rail: the STK push charges the converted KES amount
    (shown upfront), the wallet is credited in its own currency.
  - **Vouchers** — redeemable across currencies at system rates.
- **Rates are automated, not manual:** `/api/cron/rates` (or **⟳ Sync market
  rates** on Admin → Currencies) pulls live rates from free, keyless sources
  (open.er-api.com base KES + CoinGecko) into the `Currency` table and
  `settings.cryptoRates`. Admin edits are still possible but the next sync
  overwrites them. `RATES_SYNC_THROTTLE_MINUTES` controls the cadence.

---

## Cron jobs

All endpoints: `GET /api/cron/<job>?secret=<CRON_SECRET>`

| Endpoint | Purpose | Schedule (UTC) | Credits |
|---|---|---|---|
| `/api/cron/sync` | Odds prices | Free: `0 6 */3 * *`; paid: `0 */8 * * *` | ~44/run |
| `/api/cron/schedule` | 7-day calendar | `0 5 * * *` | 0 |
| `/api/cron/settle` | Auto-settle | `*/12 * * * *` | 0 |
| `/api/cron/purge` | Expired calendar rows | `0 0 * * *` | 0 |
| `/api/cron/rates` | **Market FX + crypto rates** | `17 * * * *` (hourly) | 0 |

**Admin → Cronjobs** generates copy-paste configs (URL, curl, wget,
cron-job.org, UptimeRobot) with editable schedules and **Run now** per job.

Free-tier math: 500 credits/mo ÷ ~44 ≈ **11 syncs/mo** → every 3 days. Sync is
rate-limited internally; allow ≥60s request timeout on schedulers.

---

## GitHub Actions workflows

`.github/workflows/` contains ready-made schedules for the cron endpoints —
deploy and the crons run without external schedulers:

| Workflow | Runs | Needs repo secrets |
|---|---|---|
| `cron-sync.yml` | Odds prices (3×/day) | `CRON_SECRET`, `APP_URL` |
| `cron-schedule.yml` | 7-day calendar (daily) | `CRON_SECRET`, `APP_URL` |
| `cron-settle.yml` | Auto-settle (every 12 min) | `CRON_SECRET`, `APP_URL` |
| `cron-purge.yml` | Calendar purge (daily) | `CRON_SECRET`, `APP_URL` |
| `cron-rates.yml` | Market rates (hourly) | `CRON_SECRET`, `APP_URL` |
| `schema-sync.yml` | CI — Postgres/MySQL schema guard | — |

**Setup:** GitHub → Settings → Secrets and variables → Actions → add
`CRON_SECRET` (the same value as your env var) and `APP_URL`
(e.g. `https://bet.example.com`). ⚠️ The GitHub App used for pushes has
**no `workflows` permission** — workflow files must be added via the web UI or
a PAT; normal code pushes are unaffected.

---

## Withdrawal pipeline (manual payouts)

Withdrawals are **never auto-dispatched** — a human approves every payout:

1. **User requests** → funds are reserved atomically, a tracking ID
   (`WD-2026-XXXX`) is assigned, status = `PENDING`.
2. **Admin reviews** the queue (Admin → Withdrawals) and picks one of three
   actions:
   - **Approve via Palpluss B2C** — fires the B2C API call; the callback
     completes the withdrawal (`COMPLETED`) or refunds the reservation
     exactly-once on failure.
   - **Approve & mark paid (manual)** — for cash/offline payouts; attach a
     reference + note.
   - **Reject & refund** — releases the reservation back to the wallet.
3. Every action is audited; duplicate webhook deliveries and race conditions
   are guarded (status-claimed updates) so funds can never be credited twice.

---

## Deploy to Railway

1. Push to GitHub (`main` / `master` stay identical).
2. Railway → Deploy from GitHub → set env vars from the
   [reference table](#environment-variables-complete-reference).
3. **Start command:**
   ```bash
   npx prisma migrate deploy && npx prisma db seed && next start
   ```
   The seed needs `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` set (Step 2) to
   create your admin — demo accounts are skipped in production.
4. Post-deploy: hit `/api/cron/sync?secret=…` once, verify Admin → Games,
   configure Palpluss in Admin → Settings, enable cron jobs.

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
| Palpluss test → 401 `INVALID_API_KEY` | Key truncated/mis-copied — keys are `pp_live_…` + ~40 chars; re-copy from console |
| STK push → 400 `NO_DEFAULT_CHANNEL` | Set a default channel in the console, or paste the channel UUID into `PALPLUS_CHANNEL_ID` |
| B2C → 403 `KYC_NOT_VERIFIED` | KYC approval required before payouts (console) |
| Deposit fails → 402 `INSUFFICIENT_SERVICE_BALANCE` | Top up the service wallet (console → Finance → Wallets) |
| B2C fails → 409 `INSUFFICIENT_FUNDS` | Top up the B2C wallet |
| M-Pesa tab missing | `ENABLE_MPESA_PAYMENTS=false` or `palplus.apiKey` unset — falls back to crypto |
| Voucher code won't redeem | Codes are normalized (case/format) — check for stray dashes/spaces |

---

## Security notes

- Balance changes run in DB transactions with audit records.
- Payments credited only after webhook verification (`?secret=` on Palpluss
  callbacks, HMAC on Daraja) — idempotent, exactly-once.
- HttpOnly sessions, CSRF on mutations, rate-limited auth, RBAC on admin routes.
- Provider secrets are masked on read in the admin panel.
- Real-money operation requires licensing, KYC and responsible-gambling compliance.

---

## Pre-launch checklist

- [ ] Rotate all API keys shared during development (Odds API, Palpluss, any PATs)
- [ ] Set `SEED_ADMIN_PASSWORD` / run `deploy/post-install.mjs` — no seeded admin default reaches production
- [ ] Remove test routes if still present (`/api/test/*`, test preview pages)
- [ ] Paid Odds API plan → `ODDS_API_REGIONS=eu,us`, sync 3–4×/day
- [ ] Wire the 4 cron jobs (Admin → Cronjobs) or add the repo secrets for GitHub Actions
- [ ] Palpluss: KYC done · default channel set · service + B2C wallets topped up · Test connection ✅
- [ ] Verify Admin → Games populated before opening bets
- [ ] Database backups configured (`pg_dump` daily on VPS)

---

## Docs & support

| Doc | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, money flow, settlement |
| [`docs/API-INTEGRATION.md`](docs/API-INTEGRATION.md) | Odds API + payment provider integration notes |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | VPS install walkthrough |
| [`docs/DEPLOYMENT-RAILWAY.md`](docs/DEPLOYMENT-RAILWAY.md) | Railway-specific steps |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | Client handover checklist |
| [`docs/ACCOUNTS-CHECKLIST.md`](docs/ACCOUNTS-CHECKLIST.md) | Admin accounts & security checklist |

**Developer contact** — shown only inside the **Admin panel sidebar** (never on
public pages, keeping the site white-label for end users). Links live in
`src/app/admin/layout.tsx`.

- Telegram: [t.me/Poriot_ke](https://t.me/Poriot_ke)
- WhatsApp: [wa.me/254717702563](https://wa.me/254717702563)

## Responsible gambling

Deposit/stake/session limits and self-exclusion at `/responsible-gambling`.
UNIBET360 is 18+ only.
