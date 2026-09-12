# Free data sources — filling the corners gap without paying

**Answer: you do not need a paid API.** Verified live on 2026-09-12.

The settlement engine needs four data families. Three are already free:

| Family | Source | Cost |
|---|---|---|
| Goals (FT + HT) | BigBallsData `score` + `linescore` | free |
| Cards | ⚠️ see [Cards](#cards-bigballsdata-undercounts-heres-why) — BigBallsData undercounts | free |
| Match completion | BigBallsData `status` | free |
| **Corners (FT + HT)** | **FotMob** — verified below | **free, no key** |

TotalCorner would have covered corners cleanly, but the API is a VIP privilege and
the account is not entitled (`NO_PERMISSION` on every endpoint). Rather than pay,
use FotMob.

---

## FotMob — corners, free, no key, no proxy

Verified from a datacentre IP with **no API key, no proxy and no bot challenge**:

```
GET https://www.fotmob.com/api/data/matches?date=20260911
    -> JSON, 204 finished fixtures that day, each with a numeric match id
GET https://www.fotmob.com/match/{matchId}
    -> HTML. Parse <script id="__NEXT_DATA__" type="application/json">
       props.pageProps.content.stats.Periods.{All,FirstHalf,SecondHalf}.stats[].stats[]
```

Each stat is `{title, key, stats: [home, away], format, type}` — a positional
`[home, away]` pair. Real output for **Union Berlin vs Schalke 04, 2026-09-11**:

```
All        Corners [4, 5]      Yellow cards [3, 1]     Red cards [0, 0]
FirstHalf  Corners [1, 5]      Yellow cards [1, 0]
SecondHalf Corners [3, 0]      Yellow cards [2, 1]
```

Note what that gives you: **half-time corners** (1H 1:5 + 2H 3:0 = FT 4:5 ✓),
which is what the 1H corner markets need. The same call also returns shots, xG,
possession and cards, so FotMob can serve as the cross-check source for
BigBallsData's goals too.

### Other things worth knowing about FotMob

- `https://apigw.fotmob.com/searchapi/suggest?term=<teams>&lang=en` resolves a
  fixture to a match id free and unauthenticated. **Use a two-word query**
  (`union berlin schalke`): a bare team name returns only a few fixtures and missed
  the 09-11 match entirely, while the two-word form found it first try.
- `apigw.fotmob.com/matches?date=` returns **XML**, not JSON. The JSON day list
  is `www.fotmob.com/api/data/matches?date=`. Match ids are the same on both.
- The legacy `www.fotmob.com/api/matches` path is **gone** (404).
- `apigw.fotmob.com/matchDetails` needs a client-generated `x-mas` header and
  returns 404 without it. Do not try to forge it — read the page's
  `__NEXT_DATA__` instead, which needs no token at all.
- **Pre-render caveat (the one real risk).** `props.pageProps.content` is present
  only for pre-rendered matches; others ship an empty shell
  (`{fetchingLeagueData: true}`) that hydrates client-side. Our same-day match
  *was* pre-rendered, but this must be handled: detect a missing `content` and
  fall back to (a) your existing SofaScore scrape or (b) a headless browser.
- It is an **unofficial, undocumented endpoint**. Poll modestly and cache —
  fetch stats once per fixture after full time, not in a loop. No key means no
  rate-limit contract to rely on.

---

## Cards: BigBallsData undercounts, here's why

This one is money-critical, so it is worth stating plainly.

For Union Berlin vs Schalke, BigBallsData's team_id-filtered player rows gave
**2** yellows to Union Berlin. FotMob's card events gave **3**:

```
45' Aljoscha Kemlein (home)   74' Marin Ljubičić (home)
79' Felix Uduokhai (home)     90' Loris Karius (away)
```

FotMob is right. The missing card is **Felix Uduokhai**, and BigBallsData *does*
carry it — on a row with **`team_id: null`**. The `team_id` filter that removes
the foreign-club contamination (`Pisa`, `Wolverhampton Wanderers` in that same
match) also silently discards rows whose team attribution is missing, and one of
those rows was a real booking.

Consequences:

- Team_id filtering is still the right call — it is the only thing standing
  between you and summing cards for teams that were not playing. But it is a
  **lower bound**, not an exact count.
- **Do not settle card markets on BigBallsData alone.** Prefer a source with
  event-level detail (FotMob gives player + minute per card) or require two
  sources to agree and send disagreements to review.
- This is exactly what `worker/test_hybrid_settlement.py`'s `CROSS-CHECK`
  warnings are for. Trust that signal.

## Kickoff times: BigBallsData is off by the local UTC offset

BigBallsData reported `kickoff_utc: 2026-09-11T20:30:00.000Z` for the Union
Berlin match; FotMob reports `18:30 UTC`. The real kickoff was 20:30 CEST, so
**BigBallsData appears to label local time as UTC** (+2h here). Never match
fixtures on exact kickoff equality — treat kickoff as a soft signal with a
tolerance of hours, which is what the worker's matcher already does.

---

## The alternatives, ranked

| Source | Corners | Cost | Access | Verdict |
|---|---|---|---|---|
| **FotMob** | FT + HT + per-event cards | free | no key, no proxy, no anti-bot | **Best free option — verified** |
| Your existing SofaScore scrape | FT + HT | free | proxy pool required | Keep as fallback / second opinion; already built |
| 365Scores | FT (`webws.365scores.com/web/game?...`) | free | unofficial, needs game id | Third cross-check if you want one |
| API-Football free tier | FT | free, **100 req/day** | key required | Too small for bulk; ideal **tiebreaker** on disputed matches only |
| TotalCorner VIP | FT + HT | paid | token | Declined — no longer needed |
| Sportmonks / Sportradar | FT + HT | paid | key | Only if you later need a contractual SLA |

football-data.org, TheSportsDB and OpenLigaDB were also probed: they are free and
reachable, but none of them publish corner counts, so they cannot fill this gap.

## Recommended architecture

1. **Goals + HT + completion** — BigBallsData (already live, free).
2. **Corners** — FotMob primary, existing SofaScore scrape as fallback when a
   FotMob page has no `content`.
3. **Cards** — FotMob (event-level), because BigBallsData undercounts as shown
   above. Never single-source cards.
4. **Agreement rule** — settle automatically only where the two independent
   sources agree; send every disagreement to the existing NEEDS_REVIEW queue
   with both numbers attached. Free sources are unofficial, so the cross-check is
   not optional overhead — it is the substitute for the SLA you are not buying.
5. Retire the TotalCorner code path, or keep it dormant behind the
   `SETTLE_SOURCE` switch in case the account is upgraded later.

The open question this converts from "which API do we pay for" into
"how many fixtures land in manual review" — which is a capacity question you can
measure on a week of real data before deciding whether any of this needs
revisiting.
