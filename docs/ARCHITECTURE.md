# Architecture

## System overview

```
┌────────────────────┐   ┌────────────────────┐
│  Customer frontend │   │  Admin panel       │
│  (Next.js, SSR)    │   │  /admin (RBAC)     │
└─────────┬──────────┘   └─────────┬──────────┘
          │                        │
          ▼                        ▼
┌────────────────────────────────────────────────┐
│            Next.js API layer (/api/*)          │
│  auth · betting engine · settlement · wallet   │
│  payments · content · settings · sync trigger  │
└───────────────────────┬────────────────────────┘
                        ▼
┌────────────────────────────────────────────────┐
│   Prisma ORM — PostgreSQL (dev: SQLite)        │
│   24 models · all business data in DB          │
└───────────────────────┬────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Sports/odds  │ │ Crypto pay   │ │ Currency/    │
│ provider     │ │ provider     │ │ translation  │
│ (OddsProvider│ │ (webhook →   │ │ services     │
│  interface)  │ │  atomic      │ │ (pluggable)  │
│              │ │  credit)     │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

## Key design decisions

### 1. Money is transactional, always
Every balance change goes through `Wallet` + `Transaction` rows inside one DB
transaction (`prevBalance`/`newBalance` recorded). No direct balance writes exist
outside these paths. Duplicate webhook processing is prevented by status checks
(completed deposits are rejected).

### 2. The status engine (spec §51) powers feature gating (spec §30)
`StatusType` rows define allowed/blocked actions per status. `USER/ACTIVE` allows
bet+deposit+withdraw; `PENDING_VERIFICATION` blocks bet+withdraw; `SUSPENDED`
blocks everything. The betting engine, deposit and withdrawal routes all check it.
Admins can add statuses without code changes.

### 3. Settlement is outcome-driven
Admins (or the sync layer) mark outcomes WON/LOST/VOID. The settlement engine then:
- processes every open bet containing that outcome (single → immediate result;
  multiple → resolves when all legs settle; any void voids the acca with refund),
- credits/refunds wallets atomically with transaction records,
- closes the market when all outcomes are settled,
- notifies users and writes audit entries.
Reopening is guarded — blocked if bets were already settled by that outcome.

### 4. Providers are interfaces, not imports
`OddsProvider` (sports), webhook contracts (payments), `convert()` (currency) and
the translation store are all swappable. The spec's §47 requirement.

### 5. RBAC matrix
`ROLE_RESOURCES` in `src/lib/api.ts` maps every admin resource to roles
(SUPER_ADMIN / SPORTS_MANAGER / FINANCE_MANAGER / SUPPORT_MANAGER /
CONTENT_MANAGER). Both page routes and API handlers enforce it; every admin
mutation writes an immutable audit row (admin, action, entity, prev/new values).

### 6. Frontend state
Bet slip lives in a React context, persisted to localStorage, feeding a
client-side-only API. Odds are never trusted from the client: the server re-reads
current odds, and mismatches trigger the §17 confirmation dialog.

## Data model (24 tables)

users · sessions · sports · competitions · teams · games · markets · outcomes ·
bets · bet_selections · wallets · transactions · deposits · withdrawals ·
currencies · languages · translations · banners · promotions · testimonials ·
notifications · status_types · settings · audit_logs

## Security checklist

- bcrypt password hashing, HttpOnly session cookies, server-side session expiry
- CSRF double-submit token on every mutation
- Rate limiting (in-memory; Redis for scale) on auth endpoints
- Server-side validation everywhere; API never exposes internals (generic 500)
- Webhook endpoints must verify provider signatures before crediting (demo webhook
  is dev-only)
- Audit log for odds changes, results, settlements, balance adjustments, status
  changes, payment changes

## Known MVP simplifications (documented)

- Multiples support parlay reduction: a VOID leg is removed and the acca
  continues at reduced odds (totalOdds ÷ void leg odds, same stake); a LOST
  leg kills the acca immediately. Full-stake refund only when every leg voids.
- Cash-out: full cash-out on OPEN bets at a live quote (stake × original ÷
  current total odds, minus the configurable cash-out margin). No partial
  cash-out or cash-out-after-live-settlement yet.
- Wallet currency = user's registration currency; display currency converts on the
  fly without touching wallet value (spec §23 honored).
- No parlay boost engine (promotions exist but are informational).
- Correct Score + half-time markets are manual/admin-managed (no HT scores in
  the data feed).
- In-memory rate limiter and settings cache are per-process (fine single-instance).
