# NEXT SESSION — VoltBet / Voltsbet handover

**Read this first.** Written to be self-sufficient: assume you are a fresh agent,
on a fresh account, with **no memory of any previous session**. Everything you
need is in this file and in the repo.

| | |
|---|---|
| Repo | `ashyamctommy-eng/Voltsbet` |
| Local clone (previous session) | `/home/user/.workspace/repos/Voltsbet` |
| State at handover | `bf2c26e` — **`master` and `main` are identical**, working tree clean |
| Package manager | `pnpm` (v10) |
| Deploy | Railway (app) · cPanel cron (scraper worker) |

> ⚠️ **Verify the real state yourself before trusting the line above:**
> `git log -1 --oneline && git status --short`, then
> `git rev-list --left-right --count master...main` (must be `0 0`).

---

## 0. Bootstrap a fresh session

```bash
git clone git@github.com:ashyamctommy-eng/Voltsbet.git
cd Voltsbet
pnpm install                 # postinstall runs prisma generate

# The verification loop. Run it before EVERY push.
npx tsc --noEmit
npx eslint src
pnpm run test                # 163 tests
pnpm run check:schemas       # CI guard — see below
pnpm build                   # runs prisma generate && next build
```

**`pnpm run check:schemas` is a CI guard you must not skip.** It fails if
`prisma/schema.prisma` and `prisma/schema.mysql.prisma` drift apart. It
normalises only comments and the datasource provider line, so **a native type on
one side counts as drift** — put `@db.Text` (or any `@db.*`) on **both** or on
neither. Run it the moment you touch a schema file, not at push time.

### Branch + push convention (there is a trap here)

`master` and `main` must stay byte-identical; the deploy may watch either.

```bash
git branch -f main master      # ← REQUIRED: a local branch does NOT follow master
git push origin master
git push origin main
git rev-list --left-right --count master...main    # expect: 0  0
```

**The trap:** a local `main` created earlier does not advance when you commit on
`master`. `git push origin main` then reports *"Everything up-to-date"* while
`main` sits behind. That happened. Always push BOTH explicitly and check the
behind/ahead count — don't trust the push output.

---

## 1. What is live and working

### Betting UI (all rebuilt this cycle)
- **One canonical odds cell**: `src/components/OddsButton.tsx` + the `.odds-btn`
  class in `src/app/globals.css`. Two presentations from one widget:
  - **Inner markets** (match detail, `FixtureMarkets.tsx`): stacked cell — market
    label in **grey** on top, odds **bold white** below, inside a subtly outlined
    14px card. Grey `#94a3b8` / white (dark); `#64748b` / near-black (light).
  - **Feed quick-pick** (`MatchCard.tsx`): the label is a **column header** above
    the box (`1 X 2`), and the box shows only the price — `OddsButton oddsOnly`
    keeps the label in `aria-label` so it isn't a nameless number.
- **Layout rules** live in `src/lib/odds-layout.ts` — `pairOverUnderGroups()`
  (Over/Under pairs 2-up per line, by outcome *name shape*, not market key),
  `gridColumns()` (1/2/3 columns; 4 outcomes → 2 so no row is orphaned).
  **Never re-derive this in a component** — both surfaces must call it.
- **Team-name sanitising**: `src/lib/market-labels.ts` — `TEAM_MARKET_SCOPE`
  strips the team on Home/Away Team Totals (`"West Ham United Over 0.5"` →
  `"Over 0.5"`); mixed boards (Team Totals / Team Corners) keep the team and get
  a **sub-header rendered once per team**.
- **Header**: sports menu is **boxed** tabs; only the top bar (logo/nav/account)
  is sticky — the sports menu, Highlights/Upcoming row and mobile search
  **scroll away**.
- **Back-to-top FAB**: `src/components/ScrollToTopButton.tsx`, `bg-brand`,
  appears after 500px, sits clear of the bet-slip bar and the desktop rail.
- Reference renders + measured tables: `docs/ui/odds-widget/README.md`.

### Settlement
- The **API-Football / API-Sports.io stats feed was REMOVED** (free tier was
  unreliable). Do not configure `API_FOOTBALL_KEY` or `STATS_*` — they no longer
  exist. Corners/cards/HT markets fall back to the manual path
  (Admin → Ops → Settlement Review; HT scores at Admin → Games).
- An **external scraper-worker settlement engine** replaced it — see
  `docs/AUTO-SETTLEMENT.md` (architecture, threat model, wire contract, runbook)
  and `worker/README.md` (operator guide).
  - Receiver: `POST /api/v1/settlement/process` + work list
    `GET /api/v1/settlement/pending` (`src/app/api/v1/settlement/*`).
  - Core: `src/lib/settlement/` — `ingest.ts` (the transaction + settle loop),
    `resolve-stats.ts` (corner/card resolvers), `match-game.ts` (fixture
    matching), `signature.ts` (HMAC), `payload.ts` (zod wire format).
  - Worker: `worker/settle_worker.py` (**stdlib only**, on purpose — cPanel
    rarely has pip/compilers). `python3 worker/settle_worker.py --selftest`
    runs its offline parser/matcher checks. **Run it after every worker edit.**

---

## 2. ⭐ THE NEXT TASK — move the stats source to BigBallsData

Current worker source: **SofaScore scraping through a residential proxy pool**
(that's why it needs proxies at all). The plan is to switch to
**BigBallsData** (`bigballsdata.com`), a paid-optional unified sports API with a
free tier — which removes the scraper's worst property (CDN blocking).

**The backend contract does not change.** `docs/AUTO-SETTLEMENT.md` §8 says a
source swap touches exactly two things: the request targets, and the three
extractors (`extract_corners` / `extract_goals` / `extract_cards`). Everything
downstream — the payload, the HMAC, the ingest transaction, the resolvers — is
source-agnostic.

### 2.1 Confirmed API facts (from the live OpenAPI spec + llms.txt)

| Thing | Value |
|---|---|
| Base URL | `https://api.bigballsdata.com` |
| Auth | `Authorization: Bearer bbs_...` **or** `x-api-key: bbs_...` |
| Key format | `bbs_<env>_<32hex>` |
| Response envelope | `{ data, meta, error }` |
| `meta` | `{ source, confidence, cached, cache_age_ms, request_id, fields_missing[] }` |
| Pagination | `?limit=` / `?offset=` (`?page=N` is an alias; on single-page endpoints `?page=` is a **400**, not ignored) |
| Idempotency | optional `Idempotency-Key` header — 24h replay returns the original response |
| Match statuses | `scheduled · in_progress · finished · postponed · cancelled · suspended` |
| Canonical ids | `bb_match_…`, `bb_team_…`, `^bb_(match\|player\|team\|league\|event\|…)_[a-z0-9]{10,32}$` |
| Rate headers | `X-RateLimit-Limit/-Remaining/-Reset` returned on **every** authenticated response — use them to self-throttle |

Endpoints that matter (free tier):

```
GET /v1/matches?sport=football&league=<key>[&date=YYYY-MM-DD]   fixtures + live
GET /v1/stored/matches/:id/stats      ← team stats (corners, cards, xG, possession)
GET /v1/matches/:id/events?sport=football   ← goals, cards, substitutions (with minute)
```

Relevant schemas (verbatim from the spec):

```jsonc
// Score
{ "match_id": "bb_match_…", "home": 2, "away": 1, "status": "finished",
  "period_scores": [ { "period": 1, "label": "1st Half", "home": 1, "away": 0 } ],
  "clock": { "elapsed_seconds": 5400, "period": 2, "added_seconds": 0 },
  "updated_at": "…" }

// Stat  (one row per metric, per team)
{ "match_id": "bb_match_…", "team_id": "bb_team_…", "metric": "<canonical name>",
  "value": 7, "unit": "count", "updated_at": "…" }

// Team
{ "id": "bb_team_…", "sport": "football", "name": "Racing Santander",
  "short_name": "…", "country": "ESP" }
```

### 2.2 The finding that matters most

**`Score.period_scores` gives you the half-time GOALS** (period 1) — so the
`auto-ht` market family (`OVER_UNDER_1H`, `OVER_UNDER_2H`, `FIRST_HALF_BTTS`,
`HT_FT`) becomes machine-settleable from this source.

**But `Stat` has no period field.** There is no obvious half-time split for
**corners or cards** on the stats endpoint — it is per-team, match-level. Treat
this as the key open question (§2.4). Practical consequence today: half-time
**corner** markets (and HT card markets) probably stay manual, while half-time
**goals** become automatic. Our resolvers already handle this shape — a missing
number is sent as `null` and the outcome falls to review.

### 2.3 Implementation plan

1. **Read the real response once** (see §2.4) — capture
   `/v1/stored/matches/:id/stats` and `/v1/matches/:id/events` for a finished
   match into `worker/samples/`.
2. Extend `--selftest` with those captured payloads **first**. A source change
   breaks settlement *silently* — the payload still parses, the numbers are just
   wrong. This is the one habit that prevents an expensive class of bug.
3. Add a `BigBallsSource` alongside the SofaScore code in
   `worker/settle_worker.py` (keep both, select with `SETTLE_SOURCE=sofa|bigballs`
   so a bad swap is a one-line rollback):
   - `fetch_json` → plain HTTPS with the bearer header. **No proxy pool needed** —
     keep `ProxyPool` for the SofaScore path only.
   - `extract_corners(stats)` → map the `metric` rows per `team_id` onto
     home/away using the team ids from the match, not names.
   - `extract_goals(score)` → FT from `Score.home/away`; HT from
     `period_scores[period=1]`.
   - `extract_cards(events)` → count by `incidentType`/minute, exactly as now.
   - Send our `eventId` as upstream `Idempotency-Key`.
4. **Respect the rate limits — this is not optional.** Free tier is
   **1,000 request/day (2,000 with GitHub linked), 100/minute**. More
   importantly there is a **4xx circuit breaker**: sustained 4xx responses put
   the key in a cooldown (`X-RateLimit-4xx-Cooldown`, and `error.code:
   rate_limited`). Our current retry loop is aggressive — on this API it would
   *cause* an outage. Rework it to: honour `Retry-After`, read
   `X-RateLimit-Remaining` and back off, and treat 4xx as **do not retry**
   (it already returns `4xx = don't retry, 5xx = retry` semantics downstream).
5. Trust `meta.confidence` and `meta.fields_missing`: if a field is missing or
   confidence is low, send `null` and let the market go to review. Same rule as
   today — **a missing stat is never a zero.**
6. Map our fixtures to their match ids. Two options, both viable:
   - keep the existing name + kickoff matcher (`match_event`) against
     `/v1/matches?sport=football&date=…`, or
   - **better**: store their `bb_match_…` id on our `Game` so matching stops
     being fuzzy. `Game.externalId` is already taken by the *odds* feed, so this
     needs a new nullable column (e.g. `statsExternalId`) — remember the MySQL
     mirror **and** `pnpm run check:schemas`.
7. Update `worker/README.md` §8 and `docs/AUTO-SETTLEMENT.md` §8 to say the
   source is BigBallsData, and note the free-tier ceiling in the runbook.
8. Consider retiring the proxy pool once BigBallsData is proven — it is the main
   operational cost and fragility of the current worker.

### 2.4 Open questions — confirm with ONE authenticated call each

Do not guess these; a wrong mapping settles the wrong side of a market.

- [ ] The exact `metric` strings `Stat` uses for **corners**, **yellow cards**,
      **red cards** (the docs list "Won Corners", "Yellow Cards", "Red Cards" as
      *field* names, but the API serves `metric` rows — the canonical metric
      vocabulary is the thing to capture).
- [ ] Whether the events endpoint carries a **card class** distinguishing
      straight red / second yellow, and whether it has a period or only a minute.
- [ ] Whether **half-time corners** exist anywhere (see §2.2). If not, HT corner
      markets stay manual — write that down rather than approximating.
- [ ] Whether the free tier covers the leagues you actually price (free covers
      EPL, La Liga, Bundesliga, Serie A, Ligue 1, UCL, MLS, WC2026 — **not**
      lower divisions or smaller federations).
- [ ] Whether `/v1/matches` returns **team ids** for both sides (needed to attach
      stats to the right side without name matching).
- [ ] Free-tier daily cap vs your fixture volume: 1,000/day sounds like plenty
      for a handful of fixtures, but a full day's card plus retries adds up.

### 2.5 Still true from the old plan

- **Cards remain opt-in** (`SETTLEMENT_SETTLE_CARDS`) — counting conventions
  differ between sources (ours: booking points, yellow = 1, red = 2). Verify
  against real matches before enabling.
- **Migrations**: `20260911120000_add_settlement_engine` must be applied on
  deploy (Postgres) / the `_mysql` variant on MySQL. Confirm with
  `prisma migrate status` — this could not be run against a live DB from the
  previous session.
- **Secrets**: `SETTLEMENT_WEBHOOK_SECRET` must match on Railway and cPanel.
  `BBS_API_KEY` (or whatever you name it) lives **on the cPanel worker only** —
  the app never needs it.

---

## 3. Deploy reality — check this FIRST if "my changes aren't showing"

Once already, the live site at `voltbets.me` was serving a build from **before
the odds-widget work**, and the user (rightly) reported that nothing had
changed. It was not a code bug: Railway had not redeployed.

Fast diagnosis — fetch the live stylesheet and look for a marker class:

```bash
curl -s https://voltbets.me/ | grep -o '/_next/static/[^"]*\.css' | head -1
# then curl that chunk and grep it:
#   .odds-btn .odds-label     ← present = new odds widget is deployed
#   .odds-btn{height:calc(var(--spacing) * 11) …  ← OLD build (pre-9f45fb9)
```

Do this **before** debugging code when the user says "no changes".

---

## 4. Where everything lives

| Path | What |
|---|---|
| `docs/AUTO-SETTLEMENT.md` | Settlement architecture, HMAC rationale, transaction boundaries, wire contract, runbook, exit path |
| `docs/ui/odds-widget/README.md` | Odds cell rules + reference screenshots + measured tables |
| `worker/settle_worker.py` | The cPanel scraper (stdlib only, `--selftest`) |
| `worker/README.md` | Operator guide: install, env, dry run, cron, red flags |
| `src/lib/settlement/` | `ingest.ts`, `resolve-stats.ts`, `match-game.ts`, `signature.ts`, `payload.ts` |
| `src/app/api/v1/settlement/` | `process/route.ts`, `pending/route.ts` |
| `src/lib/odds-layout.ts` | THE layout rule (pairing + columns) |
| `src/lib/market-labels.ts` | Team-prefix stripping, handicap formatting |
| `src/app/globals.css` | `.odds-btn`, `.odds-label`, `.odds-price`, light/dark overrides |
| `scripts/check-schema-sync.sh` | Schema drift guard (also `pnpm run check:schemas`) |

---

## 5. Open items / known gaps

1. **Swap the stats source to BigBallsData** (§2) — the main task.
2. **HT corners may be unavailable** from BigBallsData → decide whether those
   markets stay manual or are removed from the catalogue.
3. **`prisma migrate status` never verified against a live DB** for the
   settlement-engine migration.
4. **Proxy retirement** — once BigBallsData is proven, drop the residential pool.
5. **NEEDS_REVIEW alerting** — if the volume of outcomes needing review spikes,
   the extractor has drifted. Nothing watches this today.
6. **`Transaction.reference` has no unique index** — a second idempotency layer
   behind the bet/outcome claims would be belt-and-braces for settlement payouts.
7. `MatchSlideshow` hero odds chips are decorative and were deliberately left out
   of the odds-widget standardisation.
8. README §"64/64 vitest suites" is a stale count (tests are now **163**).
