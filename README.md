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

**Customer site** — homepage (hero banners, featured matches, promos, testimonials),
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
currencies, languages + translations, promotions/testimonials/banners, announcements,
website settings (branding colors, limits, support links, crypto config), audit logs,
on-demand API sync button.

**Data-driven everything** — statuses (feature-gating engine), currencies, languages,
settings and content are all DB tables the admin can edit without touching code.

---

## Project layout

```
prisma/            schema.prisma (24 models), migrations, seed.ts
src/lib/
  auth.ts          sessions (HttpOnly cookie), bcrypt, CSRF token
  api.ts           ApiError, RBAC matrix, audit logging, route wrapper
  bet-engine.ts    server-side bet placement (§54 checks)
  settle.ts        settlement + balance adjustments
  statuses.ts      status-engine feature gating
  currency.ts      conversion + display formatting
  settings.ts      typed site settings (admin-configurable)
  sync.ts          sports-API sync service (provider-agnostic)
  providers/odds-api.ts   The Odds API implementation
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

## Deploy

- **Railway (recommended for testing)**: full walkthrough in `docs/DEPLOYMENT-RAILWAY.md`
  — includes NOWPayments + M-Pesa sandbox wiring and a production-switch checklist.
- **VPS**: `pnpm build && pnpm start` behind NGINX/Caddy with HTTPS, Postgres on
  the host. Guide: `docs/DEPLOYMENT.md`.
- SQLite (dev) → Postgres (prod): change `provider` to `postgresql` in
  `prisma/schema.prisma`, set `DATABASE_URL`, run migrations. No code changes.

---

## Sports data API (The Odds API — recommended)

Free tier: 500 requests/month, no credit card. Sign up at https://the-odds-api.com,
put the key in `ODDS_API_KEY`. The sync layer is provider-agnostic
(`src/lib/providers/odds-api.ts` + `src/lib/sync.ts`) — swap implementations
without touching app code. Admin → Games → **⟳ Sync API** runs it manually; wire it
to a cron for automation. Full guide: `docs/API-INTEGRATION.md`.

---

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
