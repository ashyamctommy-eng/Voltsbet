# NEXT SESSION — VoltBet handover

**Read this first** if you are picking up a fresh session/account.
Repo: `ashyamctommy-eng/Voltsbet` · working branch convention: **push `master`, then fast-forward `main`** (both kept identical).
State at handover: **HEAD `d8fb21f`** on `master`/`main` · `pnpm` (v10) · verification loop = `npx tsc --noEmit` → `npx eslint <files>` → `pnpm run test` (**112 passing**) → `pnpm build`.

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

## 2. The open item: a stats feed (corners / cards / HT / exact minute)

**Why:** our only result source is The Odds API `/scores` → final + `completed` only. So these cannot be auto-settled today and are flagged `manual` (= admin marks Won/Lost/Void at **Admin → Ops → Settlement Review**, `POST /api/admin/settle/{outcomeId}`):

- corners & cards (`alternate_totals_corners`, `alternate_spreads_corners`, `alternate_team_totals_corners`, `corners_1x2`, `alternate_totals_cards`, `alternate_spreads_cards`)
- half-time markets (need the HT score) — flagged `needs HT`
- exact minute + true `HT`/`ET`/`PEN` status (we currently **estimate** these from kickoff)
- `to_qualify` (knockout)

**Chosen provider: API-Football / API-Sports** (sign up at **api-sports.io**, free plan = **100 requests/day**, resets **00:00 UTC**).

### Doc-verified facts (verified 2026-09-10 from their docs + published examples)

- Base `https://v3.football.api-sports.io`, header **`x-apisports-key: <KEY>`**
- `/fixtures?id=` → `score.halftime`, `score.fulltime`, `score.extratime`, `score.penalty`; `fixture.status.short` ∈ `1H, HT, 2H, ET, BT, P, FT, AET, PEN, …`
- `/fixtures/statistics?fixture=<id>&half=true` → all stats **incl. Fulltime + 1st/2nd half**; types include **`Corner Kicks`**, `Yellow Cards`, `Red Cards`, `Ball Possession`, `Shots on Goal`…
- `/fixtures?live=all` → **every live match globally in ONE call**; live data refreshes every **15 s**
- Rate-limit headers on every response: `x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`
- Free plan: all endpoints but **"limited in terms of available seasons"**; paid from **$19/mo** = "all competitions and endpoints" (higher tiers advertise 75k/150k requests)

### NOT yet verified (needs the key — do this before integrating)

1. Whether the **free plan actually serves stats for our leagues** (UCL/EPL/Serie A + others) — "limited seasons" is vague.
2. `half=true` behaviour on a free key.
3. Real `x-ratelimit-requests-remaining` value.
4. Whether free-tier use is licensed for production.

Their docs site is Cloudflare-protected: plain curl → 403, our proxy → connection failed, r.jina.ai → challenge, headless Chrome → challenge, Camoufox (663 MB install) → challenge. **Live `curl` with a key is the only way to verify.**

### Planned architecture (settlement-first)

- One `StatsProvider` with two capabilities:
  - `settleMatchStats` — for **finished** matches that have corner/card/HT markets: 1 call `/fixtures?id=` + 1 call `/fixtures/statistics?fixture=&half=true`, **cached forever** (final stats never change). Flips corner/card markets to `auto` and makes `needs HT` markets truly automatic.
  - `liveSnapshot` — **off by default**, labelled "needs paid plan": `/fixtures?live=all` (1 call/poll) for exact minute + true HT/ET/PEN; optional per-match live stats are the paid-only, expensive part.
- **Budget guard**: read `x-ratelimit-requests-remaining`, keep a daily counter in `Setting`, and when exhausted **skip and leave the game in the manual review queue** (never throw) — same behaviour as today, so the failure mode is safe.
- Cost model: settlement ≈ 2 calls per finished match (100/day ⇒ ~50 matches/day on free). Live status = 1 call per poll (at 5-min polls a 6h window ≈ 72 calls ⇒ fits a free day but no headroom). Live *per-match* stats = paid.
- Recommendation: **free for settlement first**, measure, upgrade to `$19` only if live precision/live corners are wanted. The plan is just a key/setting change — no rewrite, no migration.

## 3. Environment variables to set

**Railway (the app)** — add when the key exists:

```
API_FOOTBALL_KEY=xxxxxxxxxxxxxxxxxxxxxxxx   # server-only, never exposed to the browser
# optional, when the integration ships:
STATS_AUTOSETTLE=settlement                 # off | settlement | live
STATS_DAILY_BUDGET=90                       # hard ceiling (leave headroom under 100/day)
```

Existing ones that matter (already set): `ODDS_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, `APP_URL`, `TRIGGER_SECRET_KEY` is **obsolete** (Trigger.dev was removed — do not re-add).

**Sandbox (for testing here):** the key only needs to be in the shell env of the session, e.g. `export API_FOOTBALL_KEY=...`, or paste it in chat. **Never commit it.** If writing it to a file, put it outside the repo (e.g. `/home/user/.workspace/secrets/`) and confirm it is untracked.

Also worth doing in the api-sports dashboard: **whitelist the Railway egress IPs** for the key. Note that a Railway plan without static egress means the IP can change; if so, skip whitelisting and rely on the daily budget.

## 4. Test protocol (run these 4 calls, then report)

Costs 4 of the 100 daily requests. `KEY=<your key>`

```bash
# 0) account + quota sanity (also shows today's remaining)
curl -s -D - -H "x-apisports-key: $KEY" \
  "https://v3.football.api-sports.io/status" | tail -20

# 1) a FINISHED match — scores by period + status code
#    (find an id first: fixtures?date=YYYY-MM-DD&league=39&season=2026 → EPL id=39)
curl -s -H "x-apisports-key: $KEY" \
  "https://v3.football.api-sports.io/fixtures?id=<FIXTURE_ID>" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['response'][0]; print(d['fixture']['status'], d['score'])"

# 2) stats per half — the corners/cards settlement source
curl -s -H "x-apisports-key: $KEY" \
  "https://v3.football.api-sports.io/fixtures/statistics?fixture=<FIXTURE_ID>&half=true" \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['response']; [print(t['team']['name'], [(s['type'], s['value']) for s in t['statistics'] if 'Corner' in s['type'] or 'Cards' in s['type']]) for t in d]"

# 3) league/season coverage on the FREE plan (does it serve our leagues?)
curl -s -H "x-apisports-key: $KEY" \
  "https://v3.football.api-sports.io/leagues?id=2&season=2026" | head -c 600

# 4) live probe — every live match in one call + rate-limit headers
curl -s -D - -H "x-apisports-key: $KEY" \
  "https://v3.football.api-sports.io/fixtures?live=all" -o /tmp/live.json | grep -i ratelimit
python3 -c "import json; d=json.load(open('/tmp/live.json')); print('live matches:', len(d['response']))"
```

League ids for reference: EPL `39`, UCL `2`, Serie A `135`, La Liga `140`, Bundesliga `78`, Ligue 1 `61`, Championship `40`, Kenya Premier League `276`.

**What to report back** (paste raw output):
1. `/status` line → plan name + `requests.current` / `limit_day`.
2. `score` object from call 1 → do `halftime` / `extratime` / `penalty` come back populated?
3. Any `Corner Kicks` / `Yellow Cards` rows from call 2, and whether the per-half variant returned data.
4. Call 3 → is our league/season served (200 with a `league` object, or an error/empty)?
5. Call 4 → live match count + the `x-ratelimit-requests-remaining` value.

Then say: *"read docs/NEXT-SESSION.md and wire the stats feed"* — integration only starts once the above is confirmed.

## 5. Useful context for the next session

- Catalogue of markets + settlement flags: `src/lib/market-catalog.ts` (keep in sync with `MARKET_MAP` in `src/lib/providers/odds-api.ts`; a test enforces it).
- Settlement engine: `src/lib/auto-settle.ts` (`resolveOutcome` — return `null` = leave for admin; never guess).
- Live pipeline: `src/lib/live-scores.ts` + `src/lib/providers/odds-api.ts` (`estimateClock`, `parseScoreEvent`).
- Cron endpoints: `/api/cron/sync|settle|schedule|purge|rates|refresh` (secret via `?secret=` or `x-cron-secret`).
- Admin surfaces touched recently: API Settings (odds + Soccer Market Engine), Cron Settings (freshness + Run now), Broadcast, Website Settings (broadcast TTL, bet slip, betting).
