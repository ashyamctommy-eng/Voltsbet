# Sports Data API Integration

The platform syncs sports, competitions, teams, matches, markets, odds, live
scores and results from an external provider — without being hard-coded to one.

## Recommended provider: The Odds API

- **Free tier: 500 requests/month, no credit card.** Covers 70+ sports, 40+ bookmakers,
  markets h2h (match result), totals (over/under), spreads, outrights + a scores endpoint.
- Sign up → key is emailed: https://the-odds-api.com
- Docs: https://the-odds-api.com/liveapi/guides/v4/
- Paid tiers from $30/mo (20K requests) — upgrade when you outgrow the free quota.

## Alternate provider: API-Football (api-sports.io)

- **Free tier: 100 requests/day, no card — every endpoint including odds.**
- Football only, but **global + African leagues, no region locks** — one key covers
  Serie A, Bundesliga, EPL, CAF competitions, etc. Real-time in-play minute/period
  metadata and pre-match odds 1–14 days before kickoff.
- Sign up → key on dashboard: https://dashboard.api-football.com
- Endpoints used (verified against official OpenAPI v3.9.3):
  - `GET /fixtures?date=YYYY-MM-DD&timezone=UTC` — fixtures per day
  - `GET /fixtures?live=all` — in-play fixtures with score + minute
  - `GET /odds?date=YYYY-MM-DD&page=N` — pre-match odds (paginated 10/page)
- Auth: `x-apisports-key: <key>` header (env `ODDS_API_IO_KEY`).
- Switch: Admin → Settings → Odds & Risk → `odds.provider` = `api-football`.
- Free-tier budget: 1 full sync = days-ahead (7) fixture calls + ≤3 odds pages/day
  (default) + 1 live call ≈ 29 requests. Run 1–2×/day; live polling every ~20 min
  keeps you under the 100/day cap. Tune with `ODDS_API_IO_DAYS_AHEAD` and
  `ODDS_API_IO_MAX_ODDS_PAGES`.

## Alternate provider: Odds-API.io (api.odds-api.io/v3)

- **The company at odds-api.io — NOT the same as API-Football above.** Free plan:
  2 **recreational** bookmakers (sharp/exchange books are paid), 100 req/hour.
- Global + African football confirmed (South Africa Premiership, Egypt Premier
  League, Tunisia Ligue 1, Angola, Tanzania, Uganda, Zimbabwe, …) plus 34 sports.
- Sign up → key + bookmaker selection: https://odds-api.io/dashboard
- Endpoints used (verified live 2026-08):
  - `GET /events?sport=football` — events, next 14 days by default, status
    `pending | live | settled | cancelled`, scores included, hard cap 5000
  - `GET /odds/multi?eventIds=…&bookmakers=…` — odds for ≤10 events per call
  - `GET /events/live` — in-play events with clock (minute, period)
  - `GET /bookmakers/selected` — the account's selected bookmakers
- Auth: `?apiKey=` query param (env `ODDS_IO_KEY`).
- Markets mapped: `ML` → MATCH_RESULT, `Double Chance` → DOUBLE_CHANCE,
  `Totals` → OVER_UNDER, `Both Teams To Score` → BTTS (outcome names are
  lowercase so auto-settle matches). Margin applied via the same grid.
- Switch: Admin → Settings → Odds & Risk → `odds.provider` = `odds-api-io`.
- Budget: 1 full sync ≈ 1 events call + ceil(events/10) odds calls + 1 live call;
  capped at 150 events by default (`ODDS_IO_MAX_EVENTS`), so ≈ 17 requests.

## Why not the others (as of 2026): Sportmonks is excellent but €100+/mo after a
14-day trial; football-data.org has no odds. Start free with The Odds API; the
provider layer makes swapping later a non-event.

## How it fits the codebase

```
src/lib/providers/odds-api.ts       TheOddsApi class (The Odds API, the-odds-api.com)
src/lib/providers/api-football.ts   ApiFootballProvider (API-Football, api-sports.io)
src/lib/providers/odds-api-io.ts    OddsIoProvider (Odds-API.io, api.odds-api.io/v3)
src/lib/sync.ts                     syncGames(): fetch → upsert → dedup (externalId unique)
src/app/api/admin/sync/route.ts     manual trigger (admin button on Games page)
```

`OddsProvider` interface (implement a new file to add a provider):

```ts
fetchSports()                    → [{ key, name }]
fetchUpcomingGames(sportKeys)    → ApiGame[]  (games + markets + outcomes + odds)
fetchLiveScores(sportKeys)       → ApiScore[] (status, score, period, clock)
```

### Setup

1. Set `ODDS_API_KEY` in `.env` / Railway vars / VPS env.
2. Map provider sport keys to local slugs in `SPORT_KEY_MAP` in `src/lib/sync.ts`
   (e.g. `soccer_epl → football`). Extend for the sports you offer.
3. Run sync: **Admin → Games → ⟳ Sync API**, or wire automation:

### Automating the sync

**Option A — cron (recommended, multi-instance safe):**
```cron
*/10 * * * *  cd /app && node -e "require('tsx/cjs').register(); require('./src/lib/sync')"  # adjust per setup
```
(tsx note: with `tsx` installed, `npx tsx -e "import { syncGames } from './src/lib/sync'; syncGames().then(console.log)"` works.)

**Option B — in-process interval** (single instance only): call `syncGames()` every
N minutes from a `setInterval` guarded by `process.env.NODE_ENV`.

**Option C — admin button** already exists (manual refresh anytime).

### Sync behavior (all idempotent)

- Games dedup on `externalId` — repeated runs never create duplicates.
- Existing markets get odds updated in place; new outcomes added; suspended
  outcomes can be reactivated when they reappear in the feed.
- Live scores set `status=LIVE`, update score/clock/period; finished → `FINISHED`.
- API games carry `source: "API"` and are visually distinguished from manual games.
- Manual games (admin-created) are never touched by sync.

### Odds-change safety

When sync updates odds, bets already placed keep their locked odds
(`oddsAtPlacement` on each selection). New bets use the fresh odds, and the
customer-facing bet slip shows a confirmation dialog if odds moved between
tapping and placing (spec §17).

### Rate budget (free tier: 500 req/month)

One request = one sport + one market set. Example budget for a light start:
- 10 soccer leagues × 2 market requests (h2h + totals) × 2×/day = 40/day ≈ 1,200/mo — too much.
- **Realistic free-tier plan:** sync 6 key competitions (EPL, La Liga, Serie A,
  Bundesliga, NBA, ATP) with h2h only, 2×/day = 24/day ≈ 720/mo — still over.
- **Best free-tier plan:** 6 competitions, h2h only, **every 6 hours** (4×/day) = 24/day
  ≈ 750/mo — still over. Use **3×/day (every 8h)** ≈ 540/mo, or drop to 4 competitions.
- Scores endpoint: 1 request per sport per run (cheap).
- The $30/mo plan (20K/month) removes all pressure: 20K ÷ (6 comps × 2 markets × 24×/day) ≈ 69 days.

> TL;DR: free tier supports 3–6 competitions synced every 8 hours with h2h odds;
> pay $30/mo when you want more sports or faster updates. The architecture doesn't
> care — only the quota does.

## Live in-play data

The Odds API's scores endpoint gives basic live scores/status. For deep in-play
(shot-by-shot, full live markets), providers like Sportmonks or LSports are the
industry standard — implement the same `OddsProvider` interface and you're done.
