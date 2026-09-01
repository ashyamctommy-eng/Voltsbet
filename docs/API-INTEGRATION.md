# Sports Data API Integration

The platform syncs sports, competitions, teams, matches, markets, odds, live
scores and results from **one provider: The Odds API (v4)** — `the-odds-api.com`.
No other provider is used anywhere in the stack (BetsAPI/RapidAPI and
API-Football were fully removed).

## The provider: The Odds API (v4)

- **Free tier: 500 requests/month, no credit card.** Paid tiers from ~$30/mo
  (20K requests) — upgrade when you outgrow the free quota.
- Sign up → key is emailed: https://the-odds-api.com
- Docs: https://the-odds-api.com/liveapi/guides/v4/
- Key lives in the **`ODDS_API_KEY` env var only** (never in the DB).

### Endpoints used

| Endpoint | Job | Quota |
|---|---|---|
| `GET /v4/sports` | sport list (league discovery) | **0** (quota-free) |
| `GET /v4/sports/{sport}/odds?regions=…&markets=h2h,spreads,totals` | pre-match fixtures + odds + **in-play odds** (`/api/cron/sync`, `/live`) | 1/league/market |
| `GET /v4/sports/{sport}/events` | free 7-day calendar (`/api/cron/schedule`) | **0** |
| `GET /v4/sports/{sport}/scores?daysFrom=1` | live scores + finished results (live pipeline + settlement) | 2/league/sweep |
| `GET /v4/sports/{sport}/events/{eventId}/odds?bookmakers=…` | single-event extended markets (btts, correct_score, double_chance, draw_no_bet, halfs) — auto-fetched for the nearest fixtures of `ODDS_API_EVENT_MARKET_LEAGUES` | 1/market/event |

### Market set — what the list endpoint actually serves

The `/odds` **list** endpoint only serves the featured markets. Anything else
in the `markets` parameter is rejected with `422 INVALID_MARKET` — the sync
detects that, drops the unsupported keys and retries with the supported
subset, so a league never breaks because of a market The Odds API won't serve.

| API market | Local key | UI tab | Notes |
|---|---|---|---|
| `h2h` | `MATCH_RESULT` | Main | Always served where prices exist |
| `spreads` | `SPREAD` | Main | Mainly US sports/books; soccer often omits |
| `totals` | `OVER_UNDER` | Totals | Served for soccer + US sports |
| `h2h_lay` | — | — | Exchange lay prices; returned with `h2h` when Betfair/Matchbook are in the region (not bettable in this build) |

Derived locally from every 3-way `h2h` at **zero extra quota**:
`DOUBLE_CHANCE` (1X/12/X2) and `DRAW_NO_BET` (1/2), with the app's margin
applied — always priced, even when bookmakers don't list them. Where a
bookmaker does serve them (per-event), their prices overwrite the derived
ones.

**Extended markets** (`btts`, `correct_score`, `double_chance`,
`draw_no_bet`, half-time lines…) are served **only** by the per-event
endpoint `/events/{id}/odds`, and only by a limited set of bookmakers —
`regions=` alone returns nothing for them; explicit `bookmakers=` works
(**Pinnacle** confirmed for soccer, 2026-08-31). Cost: 1 credit per market
per event.

**Football-only by design.** The default `ODDS_API_MARKETS` carries the FULL
football menu (28 keys): the list trio + `btts, double_chance, draw_no_bet,
correct_score, team_totals, alternate_* (spreads/totals/team totals),
h2h_h1/totals_h1/spreads_h1, h2h_h2/totals_h2/spreads_h2,
alternate_totals_corners (Total Corners), alternate_totals_cards (Total
Cards), alternate_spreads_corners/cards, alternate_team_totals_corners,
corners_1x2, btts_h1, correct_score_h1, double_chance_h1, halftime_fulltime
(HT/FT), to_qualify`. Non-football sports are unaffected — the list endpoint
rejects keys it doesn't serve (sync drops them and retries with the
supported subset), and the extended per-event pass runs only for
`ODDS_API_EVENT_MARKET_LEAGUES` (top-6 soccer leagues by default; extend via
env to cover more football).

Soccer player props (`player_goal_scorer_anytime`, `player_first_goal_scorer`,
`player_last_goal_scorer`, `player_to_receive_card`,
`player_to_receive_red_card`, `player_shots_on_target`, `player_shots`,
`player_assists`) are **US bookmakers only** — Bovada serves them, Pinnacle
does not — and are the heaviest quota consumers (8 keys × events) with no
auto-settlement (no stats feed). Keep them opt-in via `ODDS_API_MARKETS`.

**Quota (paid 20K tier):** 28 extended keys × `ODDS_API_EVENT_MARKET_LIMIT`
(4) × leagues (6) ≈ 600–670 credits per sync worst case ≈ ~7K/month at the
default every-3-days cadence. Daily syncs would exceed the plan — keep the
cadence or trim `ODDS_API_MARKETS`/`EVENT_MARKET_LIMIT`. Corners/cards
markets also cannot auto-settle (no corner counts in `/scores`) — admin
settlement required.

Correct-score outcome names are normalized to the local `0-1` convention,
double-chance to `1X/X2/12`, and HT/FT to `1/1`, so the settlement engine
resolves them automatically; half-time-dependent markets auto-settle when
the `/scores` feed provides half-time scores, otherwise they stay for admin
review.

Config: `ODDS_API_MARKETS` (list + extended set), `ODDS_API_EVENT_*`
(per-event pass), `ODDS_API_LIVE_MARKETS` + `LIVE_ODDS_THROTTLE_SECONDS`
(in-play refresh on `/live`).

Half-time markets are **never auto-settled** (the `/scores` endpoint exposes
only full-time scores) — they go to admin review when enabled. Correct-score,
BTTS, double-chance, draw-no-bet, totals and handicap markets resolve
automatically from the final score.

## How it fits the codebase

```
src/lib/providers/odds-api.ts   TheOddsApi — the single provider (odds + scores)
src/lib/match-view.ts           provider-neutral MatchView contract (cards/feeds)
src/lib/feed.ts                 getPrematchFeed(): homepage pre-match feed (Odds API → DB)
src/lib/sync.ts                 syncGames(): pre-match fetch → upsert → dedup (externalId unique)
src/lib/live-scores.ts          live pipeline: /scores sweep → upsert started games (creates rows)
src/lib/schedule-sync.ts        free 7-day calendar (/events) + purge
src/app/api/admin/sync/route.ts manual trigger (admin button on Games page)
```

### Pre-match vs live split

- **Pre-match** (`sync.ts`): fixtures with `commence_time > now` only — a match
  that already kicked off is never treated as upcoming.
- **Live** (`live-scores.ts`): `GET /scores?daysFrom=1` for the active leagues
  (derived from DB candidates: LIVE rows + recently kicked-off SCHEDULED rows).
  Events are upserted by `externalId` — rows for started games the pre-match
  sync never ingested are **created here**. Finished events are marked
  `FINISHED` + `live:false` for the auto-settle cron.
- **Live odds**: the `/odds` endpoint returns in-play events with moving
  prices. `syncGames()` refreshes their market odds as a byproduct of the
  regular sync (zero extra requests), and `/live` additionally refreshes them
  on its own throttle (`LIVE_ODDS_THROTTLE_SECONDS`, markets
  `ODDS_API_LIVE_MARKETS`) — odds-only, never touching scores/status, settled
  markets stay frozen.
- **Match minutes are ESTIMATED** from kickoff time (The Odds API exposes no
  match clock). The `completed` flag and scores are authoritative.

## Setup

1. Set `ODDS_API_KEY` (and optionally `ODDS_API_REGIONS`; free tier = `us`,
   paid = `us,eu`) in `.env` / Railway vars / VPS env.
2. Map provider sport keys to local slugs in `SPORT_KEY_MAP` in `src/lib/sync.ts`
   (e.g. `soccer_epl → football`). Extend for the sports you offer.
3. Run sync: **Admin → Games → ⟳ Sync API**, or wire automation (cron
   endpoints documented in the README).

## Sync behavior (all idempotent)

- Games dedup on `externalId` — repeated runs never create duplicates.
- Existing markets get odds updated in place; new outcomes added; outcomes
  dropped from the feed are **suspended** (stale prices never stay bettable).
- **Settled markets/outcomes are never touched** by sync (no resurrection).
- In-play/finished games are skipped by the pre-match **create/update** pass —
  their **odds** are refreshed separately (odds-only), and rows are never
  created for in-play events (the live pipeline owns them).
- API games carry `source: "API"` and are visually distinguished from manual games.
- Manual games (admin-created) are never touched by sync or the calendar merge.

## Odds-change safety

When sync updates odds, bets already placed keep their locked odds
(`oddsAtPlacement` on each selection). New bets use the fresh odds, and the
customer-facing bet slip shows a confirmation dialog if odds moved between
tapping and placing (spec §17).

## Rate budget

One request = one sport + one market set per endpoint (list endpoint:
1 credit per market per league; scores: 2 per league with `daysFrom`).
Realistic budgets:
- **Free (500/mo):** 3 markets × ~20 leagues × 3×/day ≈ 180/day — far too
  much. Sync ~4–6 leagues every 8h (≈ 3 × 5 × 3 ≈ 45/day ≈ 1,350/mo — still
  over; lean on the **0-quota** `/events` calendar + DB-first rendering, and
  keep the league map small).
- **Paid (~$30/mo, 20K):** 3 markets × ~40 leagues × 3×/day = 360/day ≈
  10,800/mo — comfortable, with room for live sweeps. In-play odds at the
  default 1 market (h2h) every 15 min per active league ≈ 1 × 8 × 4/hr ≈
  32/hr during live windows — raise `LIVE_ODDS_THROTTLE_SECONDS` or narrow
  `ODDS_API_LIVE_MARKETS` to cut it.
- TL;DR: the free tier fits a light soccer-only book on an 8h cadence; the
  paid tier removes all pressure. The architecture doesn't care — only the
  quota does.

## Live in-play data (/live)

The `/live` page runs on the same The Odds API key. `refreshLiveScores()`
(src/lib/live-scores.ts) sweeps `/scores` for the active leagues (throttled:
one sweep per league per `LIVE_SCORES_THROTTLE_SECONDS`, default 300s) and
upserts in-play/finished games into the DB; the live page renders them with
scores and an estimated clock. No sockets or webhooks are required — the page
polls `/live` (server refresh) and the sweep is idempotent.
