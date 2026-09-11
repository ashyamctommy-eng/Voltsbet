# Settlement worker — operator guide

The cPanel side of the auto-settlement engine. It scrapes match statistics and
posts them to the Railway app, which settles the bets. Architecture, threat
model and the wire contract live in **`docs/AUTO-SETTLEMENT.md`** — this file is
the practical "make it run" guide.

> **Status: interim.** This worker exists because the previous in-app stats feed
> (API-Sports.io free tier) was unreliable. It is a stop-gap while a better
> provider is evaluated — see *Exit path* at the bottom. Nothing about the
> backend contract changes if the source changes: only `fetch_json` targets and
> the extractors need replacing.

---

## 1. What it needs

| Requirement | Why |
|---|---|
| Python 3.8+ | stdlib only — **no pip installs**, no compiler |
| Residential proxy pool | the statistics CDN blocks datacentre IPs almost immediately |
| The webhook secret | HMAC-signs every request |
| Outbound HTTPS | to the scrape source **and** your Railway app |

## 2. Install

```bash
# On the cPanel host (Terminal, or SSH)
mkdir -p ~/voltbets && cd ~/voltbets

# 1. copy settle_worker.py here (scp/git/File Manager)

# 2. the proxy list
cp proxies.example.txt proxies.txt
vi proxies.txt                      # one http://user:pass@host:port per line

# 3. sanity: parsers first, no network needed
python3 settle_worker.py --selftest
#   → selftest: all parser + matching checks passed
```

## 3. Environment

Put these in the **cron line** (recommended — cPanel cron does not read
`~/.bashrc` for non-interactive jobs):

```bash
SETTLE_WEBHOOK_URL=https://<your-app>.up.railway.app/api/v1/settlement/process
SETTLE_WEBHOOK_SECRET=<same 48+ char secret as Railway>
SETTLE_PROXIES_FILE=/home/<user>/voltbets/proxies.txt
```

| Variable | Default | Notes |
|---|---|---|
| `SETTLE_WEBHOOK_URL` | — | required |
| `SETTLE_WEBHOOK_SECRET` | — | required; must match `SETTLEMENT_WEBHOOK_SECRET` on Railway |
| `SETTLE_PROXIES_FILE` | — | one proxy per line; `#` comments allowed |
| `SETTLE_PROXIES` | — | same list inline, comma/newline separated |
| `SETTLE_PENDING_URL` | derived from the webhook URL | `/process` → `/pending` |
| `SETTLE_TIMEOUT` | `12` | per-request timeout, seconds |
| `SETTLE_PROXY_MAX_LATENCY` | `5` | slower than this → the proxy is dropped |
| `SETTLE_RETRIES` | `4` | attempts per request, rotating proxies |
| `SETTLE_MATCH_AGE_MINUTES` | `110` | skip anything younger than this |
| `SETTLE_MAX_MATCHES` | `60` | cap per run |
| `SETTLE_DRY_RUN` | off | scrape but never POST |

## 4. First run — always dry

```bash
cd ~/voltbets
python3 settle_worker.py --dry-run --limit 3
```

Read the log. You want to see:

```
proxy pool loaded: 12 exit(s)
pre-flight healthcheck on 12 exit(s)
work list: 4 game(s) with unsettled stat markets
work list: resolved 4/4 to source events
  OK   Racing Santander vs Deportivo Alaves corners FT {'home': 6, 'away': 4} — dry-run (not sent)
```

Red flags:

| Log line | Meaning | Fix |
|---|---|---|
| `no proxies configured` | running direct | fill `proxies.txt` — you will be blocked |
| `proxy DROPPED (HTTP 403)` ×many | IPs already burnt | rotate the pool / buy fresh exits |
| `statistics unavailable — skipping` | endpoint blocked or renamed | check the event id in a browser through the same proxy |
| `work list unavailable` | HMAC or URL wrong | confirm the secret matches and the URL ends `/pending` |
| `work list resolved nothing` | our fixtures are not in today's feed | check `--date`, and the team-name shapes |

Then go live with a small cap and confirm on the backend:

```bash
python3 settle_worker.py --limit 3
# backend:  SELECT * FROM "WebhookEvent" ORDER BY "receivedAt" DESC LIMIT 10;
```

## 5. Cron

```cron
*/10 * * * * cd /home/<user>/voltbets && SETTLE_WEBHOOK_URL=... SETTLE_WEBHOOK_SECRET=... SETTLE_PROXIES_FILE=/home/<user>/voltbets/proxies.txt /usr/bin/python3 settle_worker.py >> settle.log 2>&1
```

Every 10 minutes is enough: matches are only scraped once they are 110 minutes
old, and a match that is already settled is never returned by the work list.

**Log rotation** — `settle.log` grows. Add to the same cron:

```cron
0 4 * * * find /home/<user>/voltbets/settle.log -size +5M -exec truncate -s 0 {} \;
```

## 6. How it decides what to scrape

```
GET /api/v1/settlement/pending          ← signed, returns games with UNSETTLED
        │                                  selections on corner/card/half-time markets
        ▼
scheduled-events/{date}                 ← 1-2 cheap requests; the id index
        │
        ▼
match by team names + kickoff (±180 min)
        │
        ▼
event/{id}/statistics + event/{id}/incidents   ← 2 requests per match
        │
        ▼
POST /api/v1/settlement/process         ← signed payload, one per match
```

The work list is what keeps this cheap: the app tells the worker *"these 4
fixtures have money waiting on corners"* instead of the worker scraping a whole
day of matches and discarding 95% of them. `--no-pending` reverts to the old
scan-everything behaviour if the endpoint is ever unavailable.

Our `externalId` is the **odds feed's** id, not the scrape source's — the two
sides share no id, which is why matching happens on names + kickoff on *both*
sides of the wire. If a match will not resolve, the names have drifted
(abbreviations, sponsor prefixes); widen `normalize_team` rather than loosening
`MIN_TEAM_SCORE`, which is deliberately strict so it can never match
`Manchester United` against `Manchester City`.

## 7. Safety properties (do not weaken these)

- A statistic that could not be read is sent as **`null`, never `0`** — zero
  corners and "could not read the corners" are completely different claims, and
  the backend refuses to settle a market fed by a null.
- If statistics **or** incidents fail, the match is skipped entirely. No partial
  payload is ever sent.
- Card markets settle only when `SETTLEMENT_SETTLE_CARDS` is enabled on the
  backend (counting conventions differ between sources).
- The event id is `sofa-<match>-<revision>`: a retry of the same scrape is
  recognised, while a genuinely corrected score is new data.
- Proxy credentials are masked in every log line.

## 8. Exit path (when a better source is found)

The backend contract is source-agnostic — it only cares about the payload in
`docs/AUTO-SETTLEMENT.md` §2. To swap the source you replace exactly two things:

1. `fetch_json` targets (the `SOFASCORE` URLs),
2. `extract_corners` / `extract_goals` / `extract_cards` (parse the new shape).

Then extend `--selftest` with a real payload from the new provider — that is
where a provider change silently breaks settlement, so a captured sample
belongs in the self-test before it goes live.
