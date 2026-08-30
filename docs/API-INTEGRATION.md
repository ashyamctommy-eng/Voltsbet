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
| `GET /v4/sports/{sport}/odds?regions=…&markets=h2h,spreads,totals,h2h_h1,totals_h1,h2h_h2,totals_h2,correct_score` | pre-match fixtures + expanded odds (`/api/cron/sync`) | 1/league |
| `GET /v4/sports/{sport}/events` | free 7-day calendar (`/api/cron/schedule`) | **0** |
| `GET /v4/sports/{sport}/scores?daysFrom=1` | live scores + finished results (live pipeline + settlement) | 1/league/sweep |

### Expanded market set

Every pre-match fetch requests the full set — The Odds API omits markets it has
no prices for, so the UI tabs render only what exists:

| API market | Local key | UI tab |
|---|---|---|
| `h2h` | `MATCH_RESULT` | Main |
| `spreads` | `SPREAD` | Main |
| `totals` | `OVER_UNDER` | Totals |
| `h2h_h1` | `HT_RESULT` | 1st Half |
| `totals_h1` | `OVER_UNDER_1H` | 1st Half |
| `h2h_h2` | `2H_RESULT` | 2nd Half |
| `totals_h2` | `OVER_UNDER_2H` | 2nd Half |
| `correct_score` | `CORRECT_SCORE` | Correct Score |

Half-time markets are **never auto-settled** (the `/scores` endpoint exposes
only full-time scores) — they go to admin, same as correct score.

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
- In-play/finished games are skipped by the pre-match pass (the live pipeline
  owns them).
- API games carry `source: "API"` and are visually distinguished from manual games.
- Manual games (admin-created) are never touched by sync or the calendar merge.

## Odds-change safety

When sync updates odds, bets already placed keep their locked odds
(`oddsAtPlacement` on each selection). New bets use the fresh odds, and the
customer-facing bet slip shows a confirmation dialog if odds moved between
tapping and placing (spec §17).

## Rate budget

One request = one sport + one market set per endpoint. Realistic budgets:
- **Free (500/mo):** ~20 soccer leagues × 1 odds request × 3×/day ≈ 60/day is
  too much. Sync ~6–8 leagues every 6h (≈ 30/day ≈ 900/mo — still over).
  Use the free tier for ~4–6 leagues every 8h, and lean on the **0-quota**
  `/events` calendar + DB-first rendering (0 requests per page load).
- **Paid (~$30/mo, 20K):** 20 leagues × 1 × 4×/day = 80/day ≈ 2,400/mo —
  comfortable, with room for live sweeps (≈ 288 × active-leagues/day worst
  case at the 5-min default sweep window; raise `LIVE_SCORES_THROTTLE_SECONDS`
  to cut that).

> TL;DR: the free tier fits a light soccer-only book on an 8h cadence; the paid
> tier removes all pressure. The architecture doesn't care — only the quota does.

## Live in-play data (/live)

The `/live` page runs on the same The Odds API key. `refreshLiveScores()`
(src/lib/live-scores.ts) sweeps `/scores` for the active leagues (throttled:
one sweep per league per `LIVE_SCORES_THROTTLE_SECONDS`, default 300s) and
upserts in-play/finished games into the DB; the live page renders them with
scores and an estimated clock. No sockets or webhooks are required — the page
polls `/live` (server refresh) and the sweep is idempotent.
