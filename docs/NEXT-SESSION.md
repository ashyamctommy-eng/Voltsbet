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

### 2.2 FINDINGS FROM A LIVE KEY — read before planning anything

A live key was tested on **2026-09-12** against `api.bigballsdata.com`. These are
measured results, not documentation claims. **They change the plan.**

| Need | Status | Evidence |
|---|---|---|
| **Goals, full time** | ✅ | `score: {home, away}` |
| **Goals, HALF TIME** | ✅ | `linescore: {home:[1,1], away:[2,2]}` — **per-period [1H, 2H]**, proven on Venezia 2-4 Fiorentina (goals at 22/29/30 and 66/84/86). Cumulative [HT,FT] would have been [1,2]/[2,4]. |
| **Goals per minute** | ✅ | `/v1/matches/:id/events` → `elapsed` (52), `elapsed_extra`, `team`, `event_type: "Goal"`, `event_detail` |
| Match status | ✅ | `scheduled · in_progress · finished · postponed · cancelled · suspended` |
| Team identity | ✅ | `home.id` / `away.id` (UUIDs) + `name` / `short_name` |
| Kickoff | ✅ | `kickoff_utc` |
| **Cards, full time** | ✅ **via player rows** — *but only when filtered by `team_id`* | `players[].stats.yellow_cards` / `.red_cards` are **per-match** and correct: on 1. FC Union Berlin 1-3 Schalke 04, minutes cap at 90 and the player `goals` sum to exactly 4 = the 1-3 score. Filtering to the two fixture `team_id`s gives Union 2 yellows / Schalke 1. |
| Cards, half time | ❌ | Player rows carry no minute, so there is no HT split. |
| **Corners** | ❌ **NOT SERVED** | The substring `corner` appears **0 times in the entire 60 KB response** for a Bundesliga match, and `data.team_stats` — the only team-level bucket — is an **empty array on all 14 matches tested**, across 2026-08-24 → 09-11 and four leagues. Not ingestion lag. |

**Two data-quality traps worth more than the endpoint list:**

1. **The per-match `players[]` array is not scoped to the match — filter by
   `team_id`, never by `team_name`.** Union Berlin vs Schalke carried rows for
   **Pisa** and **Wolverhampton Wanderers**, plus two rows with
   `team_id: null` — and one of those nulls had a yellow card, so an unfiltered
   sum silently adds a booking from a player who was not in the match. Venezia
   vs Fiorentina was worse: Barcelona, Leeds, Napoli, Portugal, Everton and
   Torino all appeared. **The rows are correct per-match; the array around them
   is not.** Filter on the fixture's two `team_id`s and the numbers are sound —
   this is what makes card settlement possible at all.
2. **Team names differ between endpoints.** The match object says
   `"Stade Rennais"`; the events feed says `"Rennes"`. A name-based matcher
   (ours uses token coverage, so it would refuse rather than guess) cannot be
   relied on here — **match on team ids**, which every other endpoint returns.

**What this means:** three of the four data families are available —
**goals (FT + HT)**, and **cards (FT)** via `team_id`-filtered player rows.
Only **corners** (and half-time cards, which need a minute) are genuinely
missing. So the gap is narrower than it first looked:

- **Option A (hybrid)** — BigBallsData for goals/HT/cards, keep the SofaScore
  scrape (and the proxy pool) for **corners only**. Nearly everything automated;
  one fragile component retained for one market family.
- **Option B (one source)** — BigBallsData only; **corner** markets (and HT
  cards) go to the manual review queue. Retires the proxy pool entirely.
- **Option C (ask first)** — the docs advertise "Team stats (per game) …
  Won Corners / Yellow Cards / Red Cards" on the **Free** tier, yet
  `team_stats` is empty for every match. That is worth one email to
  `support@bigballsdata.com` (or their Discord) before designing around it:
  *is team_stats a tier gate, an ingestion gap, or a league-limited dataset?*
  If it is merely gated, Option A collapses into a single clean source.

**Recommendation: Option A is now the better call** — because only corners need
the scrape, the proxy pool's blast radius shrinks to a single market family, and
it can fail without touching goals/HT/cards. Choose B only if corner volume is
low enough that manual review is acceptable (that retires the proxies outright).

### 2.3 Implementation plan (updated for the findings)

1. **Decide A vs B vs C above.** Do not start coding the source until that is
   settled — it changes which endpoints you need.
2. Capture the real responses into `worker/samples/` (a finished match's
   `/v1/matches/:id` and `/v1/matches/:id/events`), then extend `--selftest`
   with them **before** going live. A source change breaks settlement silently —
   the payload still parses, the numbers are just wrong.
3. Add `BigBallsSource` alongside the SofaScore code, selected by
   `SETTLE_SOURCE=sofa|bigballs`, so a bad swap is a one-line rollback.
   - `extract_goals(score)` → FT from `score`, **HT from `linescore[0]`**.
   - `extract_cards(players)` → sum `yellow_cards`/`red_cards` over player rows
     **filtered to the fixture's two `team_id`s** (this is the whole trick).
   - `extract_corners(...)` → the SofaScore path under Option A, or `null`s
     under Option B (those markets then fall to review — the correct outcome).
   - Match to our fixture on `home.id`/`away.id` + `kickoff_utc`, not names.
   - Send our `eventId` upstream as `Idempotency-Key`.
4. **Respect the rate limits.** Measured on this key:
   `x-ratelimit-limit: 100` (minute), `x-ratelimit-limit-day: 2000`,
   `x-ratelimit-remaining: 99` — the GitHub bonus is active. The headers come
   back on **every** authenticated response, so self-throttle from them. There is
   also a **4xx circuit breaker** (sustained 4xx → key cooldown): our current
   retry loop is too aggressive for this API and would *cause* the outage it is
   meant to survive. Honour `Retry-After`, treat 4xx as do-not-retry.
5. Because `team_stats` is empty, send `null` — **never 0** — for any statistic
   you could not read (corners under Option B, HT cards always). The resolvers
   already refuse to settle on a null.
6. Update `worker/README.md` §8 and `docs/AUTO-SETTLEMENT.md` §1.5b when the
   source lands, and retire the proxy pool if Option B is chosen.

### 2.4 Key handling

The API key lives **outside the repo** (`/home/user/.secrets/bigballsdata-key`,
`chmod 600` on the previous host) and **only on the cPanel worker** — the app
never needs it, so it does not belong in Railway env or `.env.example`. If a key
is ever pasted into a chat or ticket, rotate it at
`https://bigballsdata.com/dashboard/keys`.

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

### 2.6 TotalCorner is the corner source — verified API shape, needs a token

Corners are the one family BigBallsData cannot serve (§2.2), and **TotalCorner
covers exactly that gap**. Its API is real and documented at
`https://www.totalcorner.com/page/api`; every claim below was confirmed against
the live service on 2026-09-12 (its routing answers `TOKEN_ERROR` on
`/v1/match/schedule` and `/v1/match/view/{id}`, and 404 on nonsense paths, so
the routes exist).

- Base `https://api.totalcorner.com/v1/`, auth is the **`?token=` query param**.
- Endpoints: `/match/schedule?date=YYYYMMDD&columns=events&page=1`,
  `/match/view/{match_id}`, `/match/today?type=upcoming|inplay|ended`,
  `/league/schedule/{id}`, `/league/table/{id}`.
- Envelope: `{"success": 1, "data": [...]}` or `{"success": 0, "error": {code, message}}`.
  Codes seen in the docs: `TOKEN_ERROR`, `NO_PERMISSION` (not a VIP member),
  `TOO_MANY_REQUEST`.
- **Rate limit: 30 requests/minute**, advertised in
  `X-Rate-Limit-Limit / -Remaining / -Reset`. The script self-throttles to one
  call every ~2.05s and reads the remaining count.
- Field names (all values are **strings**, cast them):
  `hc`/`ac` corners FT, **`hf_hc`/`hf_ac` corners at HALF TIME**,
  `hg`/`ag` goals, `hf_hg`/`hf_ag` half-time goals,
  `hrc`/`arc` red cards, **`hyc`/`ayc` yellow cards**,
  `h`/`a` team names, `h_id`/`a_id` team ids, `l` league,
  `start` kickoff, `status` a **numeric code**, `ish` second-half flag.
  The optional `columns=events` adds a timeline of goals, corners and red cards
  (`{tp: "c"|"g"|"rc", h: "h"|"a", t: minute}`) — note **no yellow cards** there.
- **`status` is an undocumented numeric code.** The documented finished sample
  shows `"79"`, which is the only value the script treats as finished; verify the
  rest against a live token before trusting it.
- `start` carries **no timezone**, so kickoff is used only as a soft signal in
  matching, never as the deciding one.
- **Access requires a VIP membership.** A token was supplied and tested on
  2026-09-12: it is *recognised* (the API answers `NO_PERMISSION`, not
  `TOKEN_ERROR`) but the account is **not a VIP member**, so
  `/match/schedule`, `/match/today`, `/match/view/{id}`, `/league/table/{id}`
  and `/league/schedule/{id}` all return `NO_PERMISSION` with no data. Buy VIP at
  `https://www.totalcorner.com/membership`, then re-check. Until then every
  corner figure is null by design.
- **The rate limit is per-account and lower than the docs claim.** The
  documented 30/min is what an entitled account is promised; this token
  advertises `X-Rate-Limit-Limit: 5`, and 5 rapid calls produced
  `TOO_MANY_REQUEST`. The client therefore reads that header on the first
  response and throttles to the real value instead of trusting the docs.

**`worker/test_hybrid_settlement.py`** (new) merges the two sources into the
settlement payload and writes `test_result.json`. Its BigBallsData half is
verified live; its TotalCorner half is written to the schema above but has
**not been run against a real token yet** — that is the outstanding gap. Run it
with `--selftest` (no keys, no network) to exercise the parsers and the matcher.

Note that TotalCorner also reports **half-time corners**, so 1H corner markets
could be settled from it (`--include-ht-corners` emits them; off by default to
keep the payload shape unchanged).

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
2. **Corners come from TotalCorner, not BigBallsData** (measured — §2.2/§2.6).
   BigBallsData serves goals FT/HT and cards FT; its `team_stats` is empty on 14
   matches and the string `corner` is absent from a 60 KB payload. TotalCorner
   supplies `hc`/`ac` (and `hf_hc`/`hf_ac` at half time). Two things block it:
   a **VIP membership** and a **token** — get both, then run
   `worker/test_hybrid_settlement.py` and check the `CROSS-CHECK` warnings.
   With TotalCorner live, the SofaScore scrape and its proxy pool can be retired
   entirely: that is the whole point of the hybrid.
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
