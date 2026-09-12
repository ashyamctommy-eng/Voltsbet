# Voltbets — Sportsbook Platform

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

**Corner & half-time settlement** — the score feed cannot resolve corners, cards
or half-time markets, so those settle manually: an admin enters the half-time
score at Admin → Games (which unlocks the half-time markets) and marks corner
outcomes at Admin → Ops → Settlement Review. Cards stay manual on purpose —
booking conventions differ between books, and settlement must never guess. An
external stats source that posts results can automate these markets.

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
| Super Admin | `admin@voltbets.test` | `Admin123!` | `/admin` — dev only |
| Customer | `demo@voltbets.test` | `Demo123!` | Wallet KSh 24,800 |
| Customer | `pending@voltbets.test` | `Demo123!` | Pending verification |
| Customer | `suspended@voltbets.test` | `Demo123!` | Fully locked |

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
| `SEED_ADMIN_EMAIL` | seed | `admin@voltbets.test` | Super-admin email created by the seed |
| `SEED_ADMIN_PASSWORD` | seed | — | **No production fallback** — seed skips admin if unset |
| `ODDS_API_REGIONS` | — | `eu` (DB setting `odds.regions`, Admin → API Settings) | Bookmaker regions — `eu` (default) = 3 credits/league, Pinnacle soccer only; `eu,us` = 6 credits/league and adds US books so MLB/NFL/NBA/NHL can be priced. |
| `ODDS_API_MARKETS` | — | built-in 26-key football menu (3 list: `h2h,spreads,totals` + 23 per-event incl. `btts,correct_score,corners…`) | List-endpoint markets + per-event extended markets. Each **extended** key costs 1 credit **per event** — the biggest cost multiplier. Unsupported keys are auto-dropped |
| `ODDS_API_FALLBACK_LEAGUES` | — | *(all active)* | Comma list of preferred feed leagues (e.g. `soccer_epl,soccer_spain_la_liga`); empty = all active soccer leagues |
| `ODDS_API_FEED_MAX_LEAGUES` | — | `120` (DB `odds.feedMaxLeagues`) | Max leagues per odds/schedule pass when no override above (1 request each). Without a league whitelist the sync walks **every bettable in-season sport/league** up to this cap — lower it (e.g. 20) to control cost |
| `ODDS_API_EVENT_BOOKMAKERS` | — | `pinnacle` | Bookmaker for per-event markets (`/events/{id}/odds`) — Pinnacle confirmed |
| `ODDS_API_EVENT_MARKET_LEAGUES` | — | DB setting (`odds.eventMarketLeagues`) | Env override for the per-event deep-market leagues — DB value comes from **Admin → Website Settings → Odds Sync** |
| `ODDS_API_EVENT_MARKET_LIMIT` | — | DB setting (`odds.eventMarketLimit`, default `4`) | Env override for max fixtures per league on the deep event pass (1 credit per served market per event; `0` disables) — DB value from **Admin → Website Settings → Odds Sync** |
| `MAX_CREDITS_PER_RUN` | — | *(unset = no cap)* | **Abort an odds sync whose estimated cost exceeds this** — checked *before* the paid pass, so nothing is fetched or spent. Recommended, e.g. `400`. The live estimate for the current config is shown in **Admin → API Settings → Credits**. Cost model: `leagues × listMarkets × regions + eventLeagues × eventLimit × extendedMarkets × regions` |
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
| `RECONCILE_THROTTLE_MINUTES` | — | `5` | Min minutes between payment-reconciliation runs (`/api/cron/reconcile`) |
| `PURGE_THROTTLE_MINUTES` | — | `60` | Min minutes between calendar-purge runs |
| `PURGE_MAX_AGE_HOURS` | — | `2` | Delete non-in-play games this long after kickoff |
| `RATES_SYNC_THROTTLE_MINUTES` | — | `60` | Min minutes between market-rate syncs (`/api/cron/rates`) |
| `ENABLE_MPESA_PAYMENTS` | — | unset (admin toggle / Palplus key) | `true` force-shows the M-Pesa tab; `false` **hides it** on Deposit & Withdraw regardless of Admin config — users fall back to crypto; env always wins |
| `ENABLE_MPESA_WITHDRAWALS` | — | follows `ENABLE_MPESA_PAYMENTS` | `false` hides M-Pesa as a withdrawal method |
| `PALPLUS_BASE_URL` | — | `https://api.palpluss.com/v1` | Override for gateway mirrors (rarely needed) |
| `SHOW_SEEDED_GAMES` | — | unset | **Leave unset in production** — reveals demo games |
| `MAINTENANCE_MODE` | — | unset | `1`/`true` serves the branded maintenance screen to customers (pages rewrite to `/maintenance`, `/api/*` → 503 JSON) while health, cron and payment webhooks keep running. Dependency-free, so it works even when the DB is down. For planned maintenance without a redeploy use **Admin → Website Settings → Maintenance** instead. See `docs/ERROR-HANDLING.md` |
| `SEED_DEMO_USERS` | — | dev: true / prod: false | `true` seeds demo users in production |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | — | — | reCAPTCHA v2 **site key** (public) — enables the "I'm not a robot" widget on `/register` + `/login` |
| `RECAPTCHA_SECRET_KEY` | — | — | reCAPTCHA **secret key** — when set, the auth APIs verify every token via `google.com/recaptcha/api/siteverify` before processing credentials |

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
| Payment reconciliation | `/api/cron/reconcile` | re-checks open M-Pesa (PalPluss) + crypto (NOWPayments) deposits with the provider |

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

**League sync whitelist (credit saver):** paid plans pay **1 request per
league per run**, so every client can restrict sync to the leagues they
actually offer — Admin → **API Settings → League sync**. The page lists the
*live* catalog of in-season leagues (searchable, one-click add/remove per
sport, e.g. the `＋ soccer` chip adds every football league) and stores the
whitelist as the `odds.syncLeagues` DB setting. When the whitelist is
non-empty, `sync` queries **only those keys, in the listed order** — no
credit is spent on any other league; out-of-season entries are kept and
skipped until the API lists them again. Empty whitelist = legacy full-catalog
behaviour above.

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

> **Showing the M-Pesa tab:** saving a `PALPLUS_API_KEY` automatically enables
> the M-Pesa Deposit/Withdraw tabs — you do **not** need a separate toggle when
> you've never touched "M-Pesa payments enabled". If you *have* flipped that
> toggle OFF at some point, switch it back ON (or clear it) to show the tabs.
> The only thing that overrides all of this is the `ENABLE_MPESA_PAYMENTS`
> env var (`false` = hard-hide, `true` = force-show).

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

## Broadcast (site-wide announcements)

One system, one history. **Admin → Broadcast** (`/admin/broadcast`) composes a
message and lists every send with its audience, status and expiry.

- **Delivery**: a dismissible banner site-wide (public `/api/broadcasts`, polled
  every 60s) plus a mirror in the notification centre (bell/unread).
- **Audiences**: everyone · signed-in users only · specific users (accepts ids,
  emails or @usernames).
- **Lifecycle** (no schema migration — kept in `Setting: broadcast.meta`):
  - **Deactivate / Reactivate** — hides it immediately, keeps the record.
  - **Delete** — removes the broadcast *and* its mirrored notification rows.
  - **Expiry** — `broadcast.ttlHours` (default **72h**, 0 = never; env
    `BROADCAST_TTL_HOURS`) plus an optional per-send override.
  - **Reuse** — prefill the composer from any past send.
- **Legacy sends**: the old "Announcements" page wrote `Notification` rows
  directly (bell only, never a banner, no history). Those are listed on the same
  page under "Announcement messages" with remove-one / remove-all-copies
  actions; `/admin/notifications` now redirects to `/admin/broadcast`.

---

## Background jobs (native Railway Cron)

All background work runs through secret-protected HTTP cron endpoints hit by
**Railway Cron** (no external job runner). Base URL `https://voltbets.me`,
auth via `?secret=<cron.secret>` or the `x-cron-secret` header.

| Endpoint | Recommended schedule | Purpose | API cost |
|---|---|---|---|
| `/api/cron/sync` | every 5–12h (or 2–5 min for scores-first) | pre-match odds/fixtures **+ live score & status sweep** + stale sweep | paid (throttled) |
| `/api/cron/settle` | every 10 min | settle finished games/bets | 0 |
| `/api/cron/schedule` | daily | rolling 7-day fixtures `/events` | 0 |
| `/api/cron/purge` | daily | expired games + abandoned deposits | 0 |
| `/api/cron/rates` | daily | FX rate refresh | 0 |
| `/api/cron/refresh` | on demand | clear homepage feed + settings caches | 0 |

- **`/api/cron/sync` is the source of truth for live sync.** Each run:
  1. upserts pre-match fixtures + odds (paid pass, throttled by
     `SYNC_THROTTLE_MINUTES`, default 60; `?force=1` bypasses);
  2. sweeps scores **by `externalId`** and applies the state machine —
     `completed === false` + kickoff reached → `LIVE`, `completed === true`
     → `FINISHED` (plus in-play odds on their own throttle);
  3. force-finishes stale `LIVE` rows: API rows (`externalId` set) older
     than `LIVE_STALE_FINISH_HOURS` (default 4) → `FINISHED`;
  4. deletes seed/manual placeholder rows stuck `LIVE` (no externalId,
     >6h, zero bets) and clears the homepage feed cache.
- **Credit safety:** the live sweep throttle is mirrored in the DB
  (`Setting: live.lastSweepAt`), so cron hits and `/live` visitor sweeps
  never double-spend. Set the cron interval shorter than the throttle and
  extra hits return `skipped`/`throttled` cheaply.
### Market catalog (tap-to-select) + corners

`src/lib/market-catalog.ts` is the single source of truth for every valid
soccer market key (from the official betting-markets page, retrieved
2026-09-10). Admin → API Settings renders it as a **tap-to-select catalog**
(search + groups + Recommended/Clear) for both tiers — same interaction as the
league whitelist.

- Groups: **Core** (list pass: h2h/spreads/totals), **Goals & results**,
  **Halves**, **Corners & cards**, **Extras**.
- Each entry carries a settlement flag (matches `src/lib/auto-settle.ts`):
  - **`auto`** — resolved from the final score in `/scores`: 1X2 (incl. 3-way),
    totals/goal lines, BTTS, Draw No Bet, Double Chance, Correct Score,
    handicaps, team totals.
  - **`auto-ht`** — the resolver exists but requires the half-time score, which
    `/scores` does not provide: 1st/2nd-half totals, 1st-half BTTS, HT/FT.
    An admin enters the HT score (Admin → Games), which unlocks these markets.
  - **`manual`** — no resolver from the score feed: corners, cards, half
    result/handicap/correct score, qualification, player props. Corners and cards
    settle in **Admin → Ops → Settlement Review** (`POST /api/admin/settle/{outcomeId}`),
    unless an external stats source posts the per-team corner counts. **Cards stay
    manual on purpose** (book conventions differ).
- A unit test asserts every selectable key exists in the provider `MARKET_MAP`
  (a selectable-but-unmappable market would burn credits and store nothing).

Corners coverage verified live 2026-09-10 (Aston Villa v Nottingham Forest):

| Market | Pinnacle | Bovada |
|---|---|---|
| `alternate_totals_corners` | 10 lines (9.0–11.0) | 10 lines |
| `alternate_spreads_corners` | 10 lines | 6 lines |
| `alternate_team_totals_corners` | 4 (per team) | 4 (per team) |
| `corners_1x2` | — | 1.51 / 8.25 / 3.00 |

Team-scoped outcomes carry a provider `description` (the team/player); it is now
prefixed onto the outcome name so both teams' lines stay distinct.

### Two-tier soccer market engine (quota-aware)

Verified against the live API 2026-09-10 (6 probe credits):

| Tier | Where | Markets | Cost |
|---|---|---|---|
| **1 — bulk sweep** | `syncGames` (`/api/cron/sync`) | list pass `h2h,spreads,totals` for every whitelisted league; `btts` + `draw_no_bet` via the **per-event pass** for `odds.eventMarketLeagues` (nearest `odds.eventMarketLimit` fixtures) | 3/league list + ~1/market/event |
| **2 — on demand** | `GET /api/games/{eventId}` and every match-detail page load | `soccer.detailMarkets` (default `alternate_totals, alternate_spreads, h2h_h1, h2h_h2, team_totals`) fetched per event | ~1/served market/event, cached |

- **Admin → API Settings → "Soccer Market Engine"** edits the bulk market chips
  (`Setting: odds.markets`, recommended `h2h,btts,draw_no_bet,totals`), the deep
  detail chips (`Setting: soccer.detailMarkets`) and the detail cache TTL
  (`Setting: soccer.detailCacheTtlSeconds`, default **45s**). Env overrides:
  `ODDS_API_MARKETS`, `SOCCER_DETAIL_MARKETS`, `SOCCER_DETAIL_CACHE_TTL_SECONDS`.
- **Caching**: `detail.oddsAt.<gameId>` in `Setting`. A detail-page hit inside
  the TTL is served from the DB with **zero API cost**; concurrent hits share
  one in-flight request; a provider failure serves the stored markets (never
  throws to the page).
- **Cards (`+N Markets`)**: the badge counts bettable markets only (OPEN market
  + ACTIVE outcome priced > 1) and is hidden at 0; "Market Suspended" now shows
  only when the card has **no outcomes at all**.
- Note from the probe: the list endpoint 422s on `btts`/`draw_no_bet` — the
  sync's market-validation retry drops them and the per-event pass prices them
  (error responses cost 0). `team_totals` returned no data from
  Pinnacle/Bovada for EPL — the detail tier skips markets a book doesn't serve.

### Public live feed — one predicate

The bottom-nav badge, the `/live` header count and the rendered cards all use
**`liveFeedWhere()`** (`src/lib/live-feed.ts`), so they can never disagree:

- `status ∈ (LIVE, HALF_TIME, IN_PLAY)` — `status` is the only live signal; the
  legacy `live` boolean is ignored for visibility (the sweep normalizes it).
- `externalId IS NOT NULL` and `source = API` — orphan/seed rows never appear.
- at least one **bettable** market (OPEN market + ACTIVE outcome with price > 1)
  — no "Market Suspended / +0 Markets" cards on the live tab or its fallback.
- `updatedAt` within `LIVE_FEED_FRESH_MINUTES` (default 30) — a live row the
  API stopped reporting drops off the public feed instead of lingering; the 4h
  stale sweep still flips its status permanently.

**Homepage feed cache is now shared across instances** (`Setting: feed.snapshot`
/ `feed.snapshotAt`): one process fetches per TTL window and the others read the
snapshot, so expiry no longer re-spends a full league sweep per Railway instance.

### Live sweep API contract (The Odds API v4)

Verified against the live API (2026-09-10) and the official guide
(https://the-odds-api.com/liveapi/guides/v4/):

- **Scores are per-sport**: `GET /v4/sports/{sport}/scores`. There is **no
  `/sports/upcoming/scores`** endpoint — `upcoming` is a valid pseudo-sport on
  the **/odds** endpoint only.
- **`daysFrom` omitted = live + upcoming only, cost 1/league** ("If this
  parameter is missing, only live and upcoming games are returned"). With
  `daysFrom=1` the price is 2 and completed games come back. The live sweep
  therefore omits it, except for leagues that still hold `LIVE` rows — those
  add `daysFrom=1` narrowed by `eventIds` so the `completed` flag can settle a
  finished game immediately instead of waiting for the 4h stale sweep.
- **In-play odds in ONE call**:
  `GET /v4/sports/upcoming/odds?regions=eu&markets=h2h&oddsFormat=decimal&eventIds=<live ids>`
  → cost = markets × regions = **1** total (per-league calls would be 1 each);
  skipped entirely when nothing is live.
- **Matching**: events are matched strictly by `externalId`; manual/seed rows
  (no `externalId`) are never touched by the score pass. Scores are read by
  TEAM NAME from the payload's `scores` array.
- **State machine**: `completed=false && commence_time <= now → LIVE`;
  `completed=true → FINISHED`; `LIVE` rows with `startAt` older than
  `LIVE_STALE_FINISH_HOURS` (default 4) → `FINISHED`. Upcoming events are never
  created by the live pass (the pre-match sync owns them).
- **Half time**: /scores carries no match minute, so the clock is estimated
  from kickoff (45' → 15-minute interval → 45'). When the estimate lands in the
  interval the sweep persists `HALF_TIME` (soccer only — the model is soccer's,
  so other sports stay `LIVE`) and the card renders "Halftime HT" instead of a
  ticking counter. Rows stay on /live and keep having their odds refreshed.
- **Extra time & penalties**: also estimated (no ET/shootout marker in /scores),
  with a stoppage allowance so added time can never trip it — a normal 90-minute
  match is over by ~113 real minutes. Phases are `period` = `ET1` / `ET2` /
  `PENS` (status stays `LIVE`), shown as an `ET` / `PENS` badge plus the ticking
  clock. ET/penalty games stay on /live and keep their odds refreshed.
  - **Settlement**: when such a game finishes it is stamped `AET` / `PENS` and
    auto-settlement SKIPS it — the feed's final score may include extra-time (or
    shootout) goals while 1X2/totals/BTTS settle on 90 minutes, so those games go
    to Admin → Ops → Settlement Review. Opt into full-result settlement with
    `LIVE_ET_SETTLE=auto`.
- **Quota telemetry**: `x-requests-remaining` / `-used` / `-last` are logged on
  every call and persisted to `Setting: odds.lastQuota`, surfaced in
  Admin → API Settings ("last sweep" snapshot).

- **Ops visibility:** Admin → Cron Settings shows odds freshness (last sync
  age, league/mode counts) and per-job ready-to-paste configs.

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
| `/api/cron/sync` | Odds prices | Free: `0 6 */3 * *`; paid: `0 */8 * * *` | **config-dependent** — see estimate below |
| `/api/cron/schedule` | 7-day calendar | `0 5 * * *` | 0 |
| `/api/cron/settle` | Auto-settle | `*/12 * * * *` | 0 |
| `/api/cron/purge` | Expired calendar rows | `0 0 * * *` | 0 |
| `/api/cron/rates` | **Market FX + crypto rates** | `17 * * * *` (hourly) | 0 |
| `/api/cron/reconcile` | **Payment reconciliation** (missed webhooks) | `*/10 * * * *` | 0 |

**Admin → Cronjobs** generates copy-paste configs (URL, curl, wget,
cron-job.org, UptimeRobot) with editable schedules and **Run now** per job.

Free-tier math: 500 credits/mo ÷ ~44 ≈ **11 syncs/mo** → every 3 days. Sync is
rate-limited internally; allow ≥60s request timeout on schedulers.

**Cost per sync is config-dependent** — `≈ leagues × listMarkets × regions +
eventLeagues × eventLimit × extendedMarkets × regions`. The deep per-event pass
usually dominates and is the same regardless of how many leagues you sync.
**Admin → API Settings → Credits** shows the live estimate for the current
config, the runs left on your balance, and a monthly projection. Set
`MAX_CREDITS_PER_RUN` to make a too-expensive run abort before spending.

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
| `cron-reconcile.yml` | Payment reconciliation (every 10 min) | `CRON_SECRET`, `APP_URL` |
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
- [ ] Paid Odds API plan → set regions + cadence in Admin → API Settings (Credits card) and Cron Settings
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
| [`docs/ui/odds-widget/README.md`](docs/ui/odds-widget/README.md) | Odds cell layout rules + reference screenshots of every market, 320/360px, dark & light |
| [`docs/AUTO-SETTLEMENT.md`](docs/AUTO-SETTLEMENT.md) | Auto-settlement engine: webhook contract, resolver rules, review queue |
| [`docs/FREE-DATA-SOURCES.md`](docs/FREE-DATA-SOURCES.md) | Settling goals/cards/corners with free sources — FotMob verified, why BigBallsData undercounts cards |

**Developer contact** — shown only inside the **Admin panel sidebar** (never on
public pages, keeping the site white-label for end users). Links live in
`src/app/admin/layout.tsx`.

- Telegram: [t.me/Poriot_ke](https://t.me/Poriot_ke)
- WhatsApp: [wa.me/254717702563](https://wa.me/254717702563)

## Responsible gambling

Deposit/stake/session limits and self-exclusion at `/responsible-gambling`.
Voltbets is 18+ only.
