# NEXT SESSION — VoltBet handover

**Read this first** if you are picking up a fresh session/account.
Repo: `ashyamctommy-eng/Voltsbet` · working branch convention: **push `master`, then fast-forward `main`** (both kept identical).
State at handover: **`d8fb21f`** on `master`/`main` · `pnpm` (v10) · verification loop = `npx tsc --noEmit` → `npx eslint <files>` → `pnpm run test` → `pnpm build`.

> **Update 2026-09-11 — the stats feed is shipped.** HEAD is now **`3d3a174`**, `pnpm run test` is **146 passing** (tsc/eslint/build green). §2's plan is built and canary-verified, so enabling the provider + the per-market toggles turns **corner and half-time markets automatic**; **cards stay manual on purpose** and `to_qualify` is still manual. The remaining work is no longer integration — it is enablement (add `API_FOOTBALL_KEY`, flip the toggles) and the pre-sale checklist in §6.

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

### LIVE-VERIFIED (2026-09-10, real key, 6 requests spent)

```
account : Free plan, active, valid to 2027-09-11 · 100 requests/day · 10 requests/MINUTE
errors  : {plan: "Free plans do not have access to this date, try from 2026-09-10 to 2026-09-12"}
```

| Capability | Free tier | Evidence |
|---|---|---|
| `/status` (plan + quota) | ✅ | headers `x-ratelimit-requests-limit: 100` / `-remaining` |
| `/fixtures?live=all` | ✅ | **19 live matches**, each with real `status.short` (1H/…) and `elapsed` minute |
| `/fixtures?date=<today>` | ✅ | 174 fixtures today, 160 finished (no season param needed) |
| `/fixtures?id=<id>` | ✅ | live **and** today's finished matches |
| `/fixtures/statistics?fixture=<id>` | ✅ | **Corner Kicks, Yellow/Red Cards, Possession**, shots, fouls, offsides |
| Half-time score | ✅ | `score.halftime {0,1}` alongside `fulltime {1,1}` on Fenerbahçe–Roma |
| Past dates | ❌ | `date=2026-09-09` → only **today → +2 days** allowed |
| Season-filtered queries | ❌ | `season=2026` blocked ("try from 2022 to 2024") — use date queries |
| `half=true` per-half rows | ❌ | returned **totals only** (16 types, no 1H/2H duplicates) — **corrects the earlier README claim** |
| Live match statistics | ❌ (yet) | `results: 0` mid-match; stats appear at/after FT |

Real corners for the matches the owner was watching: **Fenerbahçe 1 – 3 AS Roma**, **PSV 3 – 3 Shakhtar**.

### Consequences for the design

1. **Free is enough for settlement** — the need is *same-day*: settle right after FT (the settle cron already runs
   every 10 min) = ~2 calls per finished match. Corners/cards + the real HT score arrive in those two calls, so
   corner/card markets and the `needs HT` markets become auto-settleable.
2. **Settle immediately, never defer to tomorrow** — yesterday's dates are blocked. Add a by-ID fallback for matches
   that finish after midnight (ID lookups worked for today's data; the date window is the constraint).
3. **Budget**: keep our own counter (Setting `stats.budgetUsed` / `stats.budgetDate`) with a default ceiling of **90/day**;
   the provider also logs `x-ratelimit-requests-remaining`. On exhaustion the game stays in the admin review queue.
4. **Live minute/status is a free bonus, not the core**: `live=all` = 1 call per poll, but 100/day means ~1 poll per
   14 min if used all day — fine for a burst during a match window, not for constant 5-min polling.
5. **Paid ($19/mo) only if** history/backfill/re-settlement or frequent live polling is wanted.

### Planned architecture (settlement-first) — STEP 1+2 BUILT (off by default)

`src/lib/stats/api-football.ts` (provider + parsers), `src/lib/stats/budget.ts` (daily guard), settings
(`stats.provider` default **off**, `stats.apiKey`, `stats.dailyBudget` 90, `stats.settleCorners`,
`stats.settleHalfTime`), an admin card in **API Settings → Settlement stats feed**, and `stats-feed.test.ts`
(10 tests, parsers exercised against the real payloads captured above).

**STEP 3 BUILT + CANARY-VERIFIED (2026-09-11):**

- `src/lib/stats/match.ts` — two-id-space bridge (kickoff ± 5 h + accent/club-noise-proof names).
- `src/lib/stats/corner-settle.ts` — corner resolver (TOTAL_CORNERS, TEAM_CORNERS, CORNERS_1X2,
  CORNERS_HANDICAP; quarter lines only when both halves agree, else → review). Cards deliberately manual.
- `src/lib/stats/settle-stats.ts` — the pass: finds finished games with a resolvable market, fetches the
  matchday list (1 call, cached 15 min), matches the fixture, writes the HT score (which unlocks the EXISTING
  half-time resolvers), fetches statistics (1 call, cached forever) and settles corner outcomes.
  Guards: provider + per-market toggles, daily budget, FT/AET/PEN only, AET/PEN skips 90-minute corner markets
  unless `LIVE_ET_SETTLE=auto`, ambiguous team orientation → skip, null resolution → review queue.
- Wired into `/api/cron/settle` (stats pass runs first, then the score sweep) with `?forceStats=1`, plus
  `POST /api/admin/stats-run` and a **Run settlement now** button in the API Settings card.

**Canary (real match, real key, throwaway sqlite DB — 2026-09-11):**
`Fenerbahçe 1-1 AS Roma` (fixture 1635659, HT 0-1, corners 1-3): matched via name+time, HT recorded,
4 corner outcomes settled (Over 1.5 WON / Under 1.5 LOST / Over 9.5 LOST / Under 9.5 WON), then the score
sweep settled the 2 half-time markets from the recorded HT — **2 API calls total**. A repeat pass over the same
match cost **0 calls / 0 budget** (fixture-list + stats caches). 20 unit tests cover the resolver and matching.

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

## 6. Selling / licensing this project (pre-sale checklist)

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
2. ⬜ **Rotate shared keys**; each client brings **their own** `ODDS_API_KEY` (+ `API_FOOTBALL_KEY`) and quota.
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
