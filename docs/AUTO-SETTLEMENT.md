# Auto-Settlement Engine

Decoupled settlement: a **scraper worker on cPanel cron** posts signed match
statistics to the **Railway app**, which settles the affected bets. The app
stays the only writer to the money tables.

```
┌──────────────────────┐        HTTPS + HMAC        ┌──────────────────────────┐
│  cPanel cron         │  ───────────────────────▶  │  Railway (Next.js)       │
│  settle_worker.py    │                            │  POST /api/v1/settlement │
│                      │                            │         /process         │
│  • ProxyPool         │  ◀───────  200/202/4xx/5xx  │                          │
│  • SofaScore scrape  │                            │  • verify HMAC + window  │
│  • extract stats     │                            │  • resolve Game          │
│  • sign + POST       │                            │  • write data (1 tx)     │
└──────────────────────┘                            │  • settle (atomic claims)│
                                                    └───────────┬──────────────┘
                                                                │
                                            Postgres/MySQL ◀────┘  (single writer)
```

**Why decoupled at all:** scraping is noisy, bursty and gets CDN-blocked.
Running it on the app host would put that footprint on the same IP that serves
customers and would compete with request traffic. cPanel cron is cheap and
isolated; if it dies, the app is unaffected.

---

## 1. Architecture & stack recommendations

### 1.1 Receiver: a Next.js route handler, **not** Express/FastAPI

Recommended and implemented: `src/app/api/v1/settlement/process/route.ts`
(Node runtime).

The money path — `settleOutcome`, the wallet ledger, the bet status claims — is
**already in this process**, behind Prisma. A standalone Express or FastAPI
service would need its own DB credentials, its own deploy, its own migrations
and its own idea of the schema. That gives you **two writers to one ledger**,
which is the single most expensive failure mode available in a betting system:
double payouts, or a payout written with no matching ledger row where the
transaction log lives in a different service.

Choose a separate service only if you need a runtime this app cannot host
(e.g. CPU-heavy scraping — which is exactly what the cPanel worker is for). If
you ever do, it must talk to the app over an API, never to the DB directly.

Two consequences worth knowing:

- The route is deliberately **not** wrapped in `handle()`. That helper applies
  the customer-facing maintenance gate; settlement must keep running while the
  site is down for maintenance. `src/proxy.ts` also exempts `/api/v1`.
- It runs on `runtime = "nodejs"` because it needs `node:crypto` and Prisma.

### 1.2 Signing: HMAC-SHA256 over `timestamp.body`, not a static secret header

A static `X-Secret: <value>` header only proves *"whoever sent this has seen the
secret"*. It does not bind the secret to the payload, so a captured request can
be replayed for ever, a header leaked through a proxy log or a support
screenshot lets anyone forge any payload, and a bit-flip in transit is
undetectable.

Implemented scheme (Stripe/GitHub convention):

```
X-Voltbets-Signature: sha256=<hex HMAC_SHA256(secret, "<unix-ts>.<raw-body>")>
X-Voltbets-Timestamp: <unix seconds>
X-Voltbets-Event-Id:  <idempotency key, mirrors body.eventId>
```

- The signature covers the **raw bytes** (`await req.text()`), never a
  re-serialized object — JSON key order would change the digest.
- **±300 s replay window** on the timestamp, compared in constant time along
  with the digest (`crypto.timingSafeEqual`).
- The header event id must equal the body's, so a confused caller cannot settle
  the wrong event.
- **Fails closed**: an unset or <16-char secret returns 503 and accepts nothing.
- Secret lives in `SETTLEMENT_WEBHOOK_SECRET` (env wins) or the
  `settlement.webhookSecret` setting. Rotate by setting a new env value and
  redeploying both sides; the worker is the only client, so rotation is cheap.

### 1.3 Database transaction safety: separate DATA from MONEY

This is the most important design decision in the file.

**Inside one short transaction** (`ingestSettlement`): a `SELECT … FOR UPDATE`
row lock on the `Game` (the same pattern `placeBet` uses on `Market`), then the
score/status write and the `GameStats` upsert. Either all of the match data
lands or none of it does, and two concurrent ingests for the same fixture
serialise instead of interleaving.

**Outside it:** the settlement loop. `settleOutcome()` is *already* atomic and
idempotent per outcome:

1. claim `Outcome.settled false → true` (`updateMany`, count 0 ⇒ already done);
2. claim `Bet.status OPEN → final` before any money moves;
3. only then credit, via `creditWallet` (an `increment` + a ledger row).

Wrapping that loop in an outer transaction would hold row locks across every
bet in the slip, lengthen the critical section and risk deadlocks — for **no
safety gain**, because each claim is already race-safe on its own. The rule:
**the transaction owns DATA; the claims own MONEY.**

### 1.4 Race conditions when crediting balances

Already enforced in the existing money path — the webhook inherits them rather
than reinventing them:

| Risk | Guard |
|---|---|
| Two settlements pay the same bet | `Outcome.settled` claim + `Bet.status OPEN → final` claim |
| Overdraft / double-spend on stake | `debitWallet` = conditional `updateMany({ balance: { gte } })`; count 0 ⇒ `INSUFFICIENT_BALANCE` |
| Lost update on balance | `{ increment }` / `{ decrement }` — never read-modify-write |
| Payout with no audit trail | every wallet op writes a `Transaction` row with `prevBalance`/`newBalance`/`reference` |
| Duplicate webhook delivery | `WebhookEvent.eventId @unique` + upsert writes + idempotent claims |
| Concurrent ingest for one fixture | `SELECT … FOR UPDATE` on the `Game` row |

**Deliberate inversion — a duplicate is re-processed, not rejected.** The
obvious reflex is "eventId exists ⇒ return 200 and stop". That is wrong here: if
the first run crashed *between* writing stats and settling, the retry would be
swallowed and the bets would never settle. Because the writes are upserts and
the claims are idempotent, re-running is safe and self-healing — so a duplicate
is recorded and then processed anyway. Replays cannot double-pay *because of the
claims*, not because of the dedupe.

### 1.5 Deliberate non-automation

- **Card markets ship disabled** (`SETTLEMENT_SETTLE_CARDS`). Counting
  conventions differ between sources — yellow = 1 / red = 2 (implemented,
  `BOOKING_POINTS`), or each card = 1, or 10/25 booking points. A machine that
  guesses pays the wrong side. Turn it on per operator after verifying the
  convention against real matches.
- Any outcome the resolvers cannot decide returns `null` → the event lands in
  **NEEDS_REVIEW** and the outcome stays in the admin settlement queue. The
  engine never guesses: a wrong WON pays a customer who did not win, and a
  wrong LOST keeps money that is not ours.
- A missing statistic is sent as `null`, never `0`. Zero corners and "could not
  read the corner count" are very different things.

### 1.6 Recommended refinements (not yet built)

1. ~~A pending-settlement work list.~~ **Built** — see §2.1. `GET
   /api/v1/settlement/pending` returns only the games that actually have
   unsettled corner/card/half-time selections, so the worker scrapes a handful
   of fixtures instead of a whole day.
2. **Persist the raw payload** (already stored, capped at 8 kB) alongside a
   longer retention policy — the audit trail for "why did this bet settle?".
3. **Alerting on `NEEDS_REVIEW` volume.** If more than N events a day need
   review, the scraper has drifted (a renamed statistic, a changed period key)
   and should be noticed before customers complain.
4. **`Transaction.reference` uniqueness** for settlement payouts, as a
   belt-and-braces second idempotency layer behind the status claims.
5. **A canary fixture** the worker settles in dry-run and diffs against the
   admin-entered truth, to catch extractor drift cheaply.

---

## 2. Wire contract

Request body (`src/lib/settlement/payload.ts`, zod-validated):

```jsonc
{
  "eventId": "sofa-12345678-9f3c1a2b4d5e",   // idempotency key: match + revision
  "source": "settle-worker",
  "match": {
    "externalId": "12345678",                 // SofaScore event id
    "gameId": "clx…",                         // optional: our Game.id when known
    "kickoff": "2026-09-11T18:00:00+00:00",
    "homeName": "Racing Santander",
    "awayName": "Deportivo Alaves",
    "status": "FINISHED"                      // FINISHED | AET | PENS
  },
  "stats": {
    "corners": { "ht": { "home": 2, "away": 3 }, "ft": { "home": 6, "away": 4 } },
    "goals":   { "ht": { "home": 1, "away": 0 }, "ft": { "home": 2, "away": 1 } },
    "cards": {
      "ht": { "homeYellows": 1, "awayYellows": 2, "homeReds": 0, "awayReds": 0 },
      "ft": { "homeYellows": 3, "awayYellows": 2, "homeReds": 1, "awayReds": 0 }
    }
  },
  "meta": { "scrapedAt": "…", "url": "…" }
}
```

Responses: `200` processed · `202` needs review · `400` bad payload ·
`401` bad signature/timestamp · `405` method · `503` secret unset.
`4xx` means **do not retry** (the payload is wrong); `5xx` means **retry**.

### 2.1 Work list — `GET /api/v1/settlement/pending`

Tells the worker **what is worth scraping**. Same HMAC auth; a GET has no body,
so the signature covers the empty string: `HMAC_SHA256(secret, "<unix-ts>.")`.

Query: `?minAgeMinutes=110&maxAgeHours=30&limit=200` (all clamped server-side).

```jsonc
{
  "ok": true,
  "generatedAt": "2026-09-11T20:00:00Z",
  "window": { "minAgeMinutes": 110, "maxAgeHours": 30 },
  "count": 2,
  "games": [
    {
      "gameId": "clx…",
      "externalId": "abc123",            // the ODDS feed's id, not the scraper's
      "kickoff": "2026-09-11T18:00:00Z",
      "homeName": "Racing Santander",
      "awayName": "Deportivo Alaves",
      "status": "LIVE",
      "minutesSinceKickoff": 132,
      "picks": 3,                        // unsettled selections riding on it
      "markets": ["TOTAL_CORNERS", "OVER_UNDER_1H"],
      "needs": ["CORNERS", "HALF_TIME"]  // what kind of scrape this needs
    }
  ]
}
```

A game qualifies only when it has an **unsettled `BetSelection` on an OPEN bet**
for a stat-dependent market (corners, cards, or the half-time family) — so the
list is driven by money at stake, not by the fixture calendar. `needs` lets a
future worker skip work it cannot do (e.g. corners-only if its source has no
card data).

The response deliberately carries **no scraper-side id**: our `externalId`
belongs to the odds feed. The worker resolves the shared identity itself (team
names + kickoff) against its own source — the same matching rule the backend
applies in the other direction.

## 3. Which markets settle

| Market key | Source | Notes |
|---|---|---|
| `TOTAL_CORNERS`, `TEAM_CORNERS`, `CORNERS_1X2`, `CORNERS_HANDICAP` | corners | whole-line push → VOID; quarter lines → manual |
| `TOTAL_BOOKINGS`, `CARDS_HANDICAP` | cards | **opt-in**; booking points yellow=1 red=2 |
| goal markets (`OVER_UNDER`, `h2h`, `totals_h1`, `btts_h1`, `halftime_fulltime`, …) | goals | resolved by the existing `resolveOutcome` |

## 4. cPanel runbook

```bash
# 1. Files
mkdir -p ~/voltbets && cd ~/voltbets
#    copy worker/settle_worker.py and create proxies.txt (one proxy URL per line)

# 2. Environment (add to the cron line, or ~/.bashrc)
export SETTLE_WEBHOOK_URL="https://<your-app>.up.railway.app/api/v1/settlement/process"
export SETTLE_WEBHOOK_SECRET="<same 48+ char secret as Railway>"
export SETTLE_PROXIES_FILE="/home/<user>/voltbets/proxies.txt"

# 3. Dry run first — scrapes real matches, sends nothing
python3 settle_worker.py --dry-run --limit 3

# 4. Cron — every 10 minutes
*/10 * * * * /usr/bin/python3 /home/<user>/voltbets/settle_worker.py >> /home/<user>/voltbets/settle.log 2>&1
```

The worker is **stdlib-only on purpose**: shared cPanel hosts often have no pip
access, an old system Python or no compiler for native HTTP libraries.
`urllib` + `ssl` are always present. Proxy support is built on `ProxyHandler`.

`proxies.txt` format (credentials are masked in every log line):

```
http://user:pass@gate.provider.com:8000
http://user:pass@gate2.provider.com:8000
```

### Proxy health & auto-purging

`ProxyPool` drops an exit for the rest of the run when it is slower than
`SETTLE_PROXY_MAX_LATENCY` (default 5 s), raises a connection/TLS/timeout error,
or returns `403 / 429 / 407 / 451 / 503`. Dropping is aggressive by design: a
burnt residential exit does not recover inside a cron window, and retrying it
wastes the whole run's budget. A pre-flight healthcheck discards dead exits
before any real scrape, and every request rotates to the next live proxy. When
the pool empties the run stops cleanly rather than hammering from the host IP.

## 5. Rollout checklist

1. Set `SETTLEMENT_WEBHOOK_SECRET` (48+ random chars) in **both** Railway and the
   cPanel cron environment.
2. Set `SETTLEMENT_SETTLE_CARDS` only after verifying the card convention.
3. Deploy. `prisma migrate deploy` must apply
   `20260911120000_add_settlement_engine` (Postgres) / `…_mysql` (MySQL).
4. `python3 settle_worker.py --dry-run --limit 3` on the cPanel host — confirm
   the scraper reads corners/incidents through the proxies.
5. Run live with `--limit 3`, then check
   `SELECT * FROM "WebhookEvent" ORDER BY "receivedAt" DESC LIMIT 10;` and the
   Admin settlement review queue for anything that landed in `NEEDS_REVIEW`.
6. Enable the 10-minute cron.
