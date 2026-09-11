# NEXT SESSION — VoltBet handover

**Read this first** if you are picking up a fresh session/account.
Repo: `ashyamctommy-eng/Voltsbet` · working branch convention: **push `master`, then fast-forward `main`** (both kept identical).
State at handover: **`d8fb21f`** on `master`/`main` · `pnpm` (v10) · verification loop = `npx tsc --noEmit` → `npx eslint <files>` → `pnpm run test` → `pnpm build`.

> **Update 2026-09-11 — the API-Football settlement stats feed was REMOVED.**
> The free account proved unreliable, so the whole feature was deleted: provider
> client, daily budget guard, corner resolver, match bridge, stats pass, the
> admin API Settings card, `POST /api/admin/stats-run`, `/api/cron/settle`'s stats
> pass, the `stats.*` settings and its tests. Corners, cards and half-time markets
> are back on the manual path (Admin → Ops → Settlement Review, with HT scores
> entered at Admin → Games). **Do not configure an API-Football key** — the
> `API_FOOTBALL_KEY` / `STATS_*` env vars no longer exist. An **external
> settlement worker** is the intended replacement (see §2).

---

## 1. What is live and working

| Area | Status |
|---|---|
| Live scores/status sweep (`/api/cron/sync`, native Railway Cron) | ✅ scores by `externalId`, `LIVE`/`HALF_TIME`/`FINISHED`, 4h stale sweep, orphan cleanup |
| Half time | ✅ persisted `HALF_TIME`, card shows "Halftime HT" (soccer-only estimate) |
| Extra time / penalties | ✅ phases `ET1`/`ET2`/`PENS` (estimated, stoppage allowance), `ET`/`PENS` badge; finish stamped `AET`/`PENS` |
| Settlement on knockout finishes | ✅ auto-settle **skips** `AET`/`PENS` (90-minute markets) → admin review. Opt in: `LIVE_ET_SETTLE=auto` |
| Live-tab count/filters | ✅ one predicate `liveFeedWhere()` (badge = header = cards); hides non-bettable rows |
| Two-tier markets | ✅ bulk sweep (list + per-event pass) + Tier-2 cached match-detail deep markets (`soccer.detailMarkets`, TTL `soccer.detailCacheTtlSeconds` 45s) |
| Market catalog (tap-select) | ✅ `src/lib/market-catalog.ts`, incl. corners/cards; `settle: auto | auto-ht | manual` |
| Broadcast (site-wide) | ✅ `/admin/broadcast` — history, deactivate/reactivate, delete, TTL (`broadcast.ttlHours` 72h), audiences |
| Bet slip | ✅ silent pick-up by default (`betSlip.autoOpen=false`) |

Quota-conscious defaults: odds provider = The Odds API (`ODDS_API_KEY`, 20k/mo plan). Homepage feed cache is shared across instances via `Setting: feed.snapshot*` (stopped a big credit drain).

## 2. Settlement coverage (and the removed stats feed)

Our only result source is The Odds API `/scores` → final + `completed` only. So
these cannot be auto-settled and are flagged `manual` (= admin marks Won/Lost/Void
at **Admin → Ops → Settlement Review**, `POST /api/admin/settle/{outcomeId}`):

- corners & cards (`alternate_totals_corners`, `alternate_spreads_corners`,
  `alternate_team_totals_corners`, `corners_1x2`, `alternate_totals_cards`,
  `alternate_spreads_cards`)
- half-time markets (need the HT score) — flagged `auto-ht`; an admin enters the
  HT score at Admin → Games, which unlocks the existing resolvers
- exact minute + true `HT`/`ET`/`PEN` status (currently **estimated** from kickoff)
- `to_qualify` (knockout)

**The API-Football / API-Sports stats feed was REMOVED (2026-09-11).** It was
built and canary-verified, but the free account proved unreliable, so it is gone
and is intentionally not documented as an option. The `src/lib/stats/` module, the
`stats.*` settings, the `POST /api/admin/stats-run` endpoint, the API Settings
"Settlement stats feed" card and the `API_FOOTBALL_KEY` / `STATS_*` env vars no
longer exist. Do not re-add them.

**Intended replacement: an external settlement worker.** It should post finished
half-time scores and per-team corner counts (and optionally card counts) so the
existing resolvers in `src/lib/auto-settle.ts` can settle the remaining markets.
The worker spec is in **`docs/AUTO-SETTLEMENT.md`** (with the worker at
`worker/settle_worker.py` and the receiver at
`src/app/api/v1/settlement/process/route.ts`). Keep the same safety
posture — resolve or leave for review, never guess. Until then, fleet-mode
operators handle these markets manually.

## 3. Useful context for the next session

- Catalogue of markets + settlement flags: `src/lib/market-catalog.ts` (keep in sync with `MARKET_MAP` in `src/lib/providers/odds-api.ts`; a test enforces it).
- Settlement engine: `src/lib/auto-settle.ts` (`resolveOutcome` — return `null` = leave for admin; never guess).
- Credit safety: `src/lib/odds-cost.ts` models a sync's cost
  (`leagues × listMarkets × regions + eventLeagues × eventLimit × extendedMarkets × regions`);
  `syncGames` aborts before the paid pass when the estimate exceeds `MAX_CREDITS_PER_RUN`.
  The live estimate, runs-left and monthly projection are in **Admin → API Settings → Credits**.
- Payments: an optional Palplus stats/status poll plus `/api/cron/reconcile` (missed-webhook safety net for
  PalPluss + NOWPayments) — see `docs/ERROR-HANDLING.md` for the platform/error/maintenance layers.
- Fixtures vs odds: the rolling 7-day calendar comes from the FREE `/api/cron/schedule` (`/events`, 0 credits) and
  now renders **unpriced** `SCHEDULE` rows too ("Odds not available yet"), so the calendar no longer depends on the
  paid sync. Hide-seeded keeps `API` + `SCHEDULE`, hiding only `MANUAL`.
- Live pipeline: `src/lib/live-scores.ts` + `src/lib/providers/odds-api.ts` (`estimateClock`, `parseScoreEvent`).
- Cron endpoints: `/api/cron/sync|settle|schedule|purge|rates|refresh|reconcile` (secret via `?secret=` or `x-cron-secret`).
- Admin surfaces touched recently: API Settings (odds + Soccer Market Engine), Cron Settings (freshness + Run now), Broadcast, Website Settings (broadcast TTL, bet slip, betting).

## 4. Selling / licensing this project (pre-sale checklist)

**Ownership audit (ran 2026-09-10):** the code is clean to sell commercially.
- 169 packages: 125 MIT, 11 Apache-2.0, 9 ISC, 4 BSD-3-Clause, 2 CC0-1.0, 1 BSD-2, 1 MPL-2.0
  (`@vercel/og` — file-level copyleft, fine while unmodified). **No GPL / AGPL / SSPL / non-commercial
  dependencies anywhere** → nothing forces us to publish source or blocks paid distribution.
- **No licence phone-home or purchase-code hooks** in `src/` → the app never needs a third party's
  permission to run (a strong selling point vs. CodeCanyon-style scripts).
- **No secrets tracked**: only `.env.example` / `.env.production.example`; the odds API key exists only as
  an env var (it *was* pasted in chat — **rotate it before any handover**).
- Cron endpoints + admin APIs are guard-protected (12 guard usages across `/api/cron/*`).

**Status before a sale (updated 2026-09-11):**
1. ✅ **`LICENSE`** (proprietary, all rights reserved — replace the holder + governing-law placeholders) and
   **`THIRD-PARTY-NOTICES.md`** (regenerate with `node scripts/generate-third-party-notices.mjs`).
   ⚠️ The production tree ships **LGPL-3.0-or-later** (`@img/sharp-libvips-linux-x64`, via sharp / Next image
   optimisation) and **CC-BY-4.0** (`caniuse-lite`) — used unmodified as separate modules, but ship the notices and
   upstream licence texts and let counsel confirm. This corrects the earlier "no GPL/LGPL anywhere" line.
2. ⬜ **Rotate shared keys**; each client brings **their own** `ODDS_API_KEY` and quota.
   The odds key was pasted in a chat — rotate it before any handover. (Owner action; not a code change.)
3. ✅ **De-branded** (`UNIBET360 → Voltbets`) on 2026-09-11 — only the historical reference in this file remains.
   Never use `UNIBET360` on the product or in marketing — "Unibet" is a Kindred trademark.
4. ✅ **Commercial term sheet** drafted in `docs/COMMERCIAL-TERMS.md` (three sale shapes, milestones, acceptance
   criteria, IP/DPA/liability, pre-signature checklist) — for counsel to turn into a contract.

**Three sale shapes:** (a) **buyout/assignment** — assign copyright, price highest, you lose resale rights;
(b) **per-client licence** — keep the IP, sell a right to run one branded deployment (natural white-label fit);
(c) **hosted SaaS** — you host, charge monthly, never hand over source (best recurring revenue, least leakage).

**Decision pending (owner is thinking it over):** *per-client licence* vs *hosted SaaS*. Architectural
implication — the app is **single-tenant today** (one brand in `Setting`, one `DATABASE_URL`, API keys in env), so:
per-client licence = **one instance per client** (works with what we have, cheapest to ship); hosted SaaS needs
**tenant isolation** (schema/DB per tenant), per-tenant API keys + quotas, admin scoping and billing — a real
build. Sketch both with effort estimates before client #2.

**SaaS operations:** see `docs/SAAS-PLAYBOOK.md` — fleet vs multi-tenant, packaging/economics, per-client
provisioning (`scripts/provision-client.sh`, dry-run first), env template (`docs/templates/client.env.example`),
cron cadence, acceptance tests, backups/restore drill, update rollout, billing, owner console spec, the Phase-2
multi-tenant design (row-level `tenantId` + scoped Prisma client) and the switch triggers.

**Handover package for a client:** repo transfer (or zip + escrow), deployment runbook (env vars, `prisma
migrate deploy`, cron cadence, first admin), their own API accounts, admin credentials, third-party notices,
support window + update policy, staged payments (deposit → staging sign-off → production → balance).
Client's own obligations (gambling licence, KYC/AML, payment merchant accounts) belong in the agreement.
