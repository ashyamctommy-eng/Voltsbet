# SaaS Playbook — running Voltbets as a hosted platform

**Audience:** the platform owner / CTO.
**Scope:** how to operate this codebase as a multi-client hosted service (SaaS) instead of shipping copies.

> Verification status: the provisioning script (`scripts/provision-client.sh`) is **not yet executed against a live
> Railway account** — run it with `--dry-run` first. Everything else here (env names, cron endpoints, commands) is
> taken from this repo and has been exercised in development.

---

## 1. Two ways to run SaaS

| | **A. Fleet** (single-tenant per client) | **B. Multi-tenant** |
|---|---|---|
| Shape | one deployment + one database per client, each on its own domain | one deployment + one database serving every client, tenant resolved from the hostname |
| Code changes | **none** — what you have today | substantial (§5) |
| Isolation | physical (separate DB, separate keys) | logical (must be enforced; money paths need care) |
| Infra cost | ~$10–15 / client / month | ~$20–40 / month total for the first 5–10 clients |
| Update effort | N deployments (scriptable) | one deployment for everyone |
| Ceiling | ~6 clients before ops fatigue | hundreds |
| Best for | **starting now**, 1–6 clients | scale, self-serve signup |

**Plan: ship Fleet first, migrate to Multi-tenant when a trigger fires (§6).** Per-client differences in this app are
*configuration*, not code — branding/settings live in the `Setting` table, credentials live in env. **Never fork the repo
per client.**

---

## 2. Economics & packaging

### Cost per client (fleet, Railway 2026)

| Item | Typical | Notes |
|---|---|---|
| App service | $3–8 / mo | Next.js SSR, small footprint |
| Postgres | $3–7 / mo | grows with bets/audit/notifications |
| Domain | ~$10 / yr | client's own domain |
| Odds API (The Odds API) | **client's own key** | 20k credits ≈ $30/mo on their card |
| Railway plan | Hobby **$5/mo incl. $5 usage** · Pro **$20/mo per workspace** + usage | one workspace can host many clients |

### Suggested packaging

| Plan | Price | Includes |
|---|---|---|
| **Setup (one-off)** | $300–800 | provisioning, branding, domain+DNS, cron, data seed, smoke test, handover call |
| **Standard** | $149–249 / mo | hosting, updates, monitoring, backups, 1 brand, email support (48h) |
| **Pro** | $349–499 / mo | + manual settlement service for non-feed markets (corners/cards), 2h/mo changes, priority support |
| **Add-ons** | $49–99 / mo | extra brand/domain, SMS/Telegram bundle, custom market menu, extra admin training |
| **White-label licence (alt.)** | $1.5k–5k one-off + 20% maintenance | client hosts it themselves; you keep IP |

**Rule of thumb:** infra should stay **<10% of revenue**. If manual settlement labour exceeds ~2h/client/month, either
price it as a service, or run an external settlement worker so corners/half-time settle themselves (§7).

---

## 3. Phase 1 — Fleet operations

### 3.1 Reference architecture (per client)

```
client-domain.tld ──▶ Railway service (Next.js: web + /api/cron/*) ──▶ Postgres
                                   │
                                   ├─▶ the-odds-api.com   (ODDS_API_KEY — client's)
                                   └─▶ Palplus / Daraja   (client's merchant account)
Railway Cron (or external) ──▶ https://<client>/api/cron/{sync,settle,schedule,purge,rates}?secret=…
```

### 3.2 Provisioning a client

Preferred: the script.

```bash
# dry-run first — prints every command, changes nothing
./scripts/provision-client.sh --slug acme-bet --domain bet.acme.tld --brand "Acme Bet" \
  --admin-email ops@acme.tld --odds-key <CLIENT_KEY> --dry-run

# for real
./scripts/provision-client.sh --slug acme-bet --domain bet.acme.tld --brand "Acme Bet" \
  --admin-email ops@acme.tld --odds-key <CLIENT_KEY>
```

Manual fallback (identical outcome):

1. **Create the service** — Railway → *New Project* → *Deploy from GitHub repo* → `Voltsbet` (branch `main`).
2. **Add Postgres** — *New* → *Database* → *PostgreSQL*; Railway injects `DATABASE_URL`.
3. **Set variables** — copy `docs/templates/client.env.example`, fill it, paste into *Variables*
   (`ODDS_API_KEY` = the **client's** key; generate `CRON_SECRET` with `openssl rand -hex 32`).
4. **Deploy** (Railway builds with Nixpacks: `pnpm install` → `prisma generate && next build`).
5. **Migrate + seed the first admin**:
   ```bash
   railway run --service <slug> pnpm prisma migrate deploy
   railway run --service <slug> env SEED_ADMIN_EMAIL=ops@acme.tld SEED_ADMIN_PASSWORD='<strong-temp>' pnpm prisma db seed
   ```
6. **Domain + TLS** — Railway → *Settings* → *Domains* → add the client domain; point DNS (Cloudflare proxy is fine).
7. **Cron** — create 3 schedules (see §3.4) or install `setup.sh` on a VPS instead.
8. **Brand it** — Admin → Website Settings (site name, colours, support email) and Admin → API Settings.
9. **Smoke test** — run the acceptance list (§3.5). Then hand over credentials.

> The seed only creates the super admin from `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` in production; it also adopts an
> existing admin row rather than duplicating it. **Force a password reset after handover.**

### 3.3 Environment reference

Only these are **required**: `DATABASE_URL`, `APP_URL`, `CRON_SECRET`, `ODDS_API_KEY`.
Everything else has a sensible default and is admin-configurable at runtime (Admin → API Settings / Website Settings) —
env only *overrides* DB settings.

| Var | Per client | Purpose |
|---|---|---|
| `DATABASE_URL` | auto | Postgres connection (Railway plugin) |
| `APP_URL` | yes | public base URL — used by cron config + links |
| `CRON_SECRET` | yes (unique) | guards `/api/cron/*` |
| `ODDS_API_KEY` | **yes — theirs** | odds + scores + settlement |
| `ODDS_API_REGIONS` | optional | `eu` default (Pinnacle) |
| `SHOW_SEEDED_GAMES` | optional | `false` in production (hide demo rows) |
| `BETSLIP_AUTO_OPEN` | optional | `false` = silent pick-up |
| `BROADCAST_TTL_HOURS` | optional | banner lifetime (default 72) |
| `LIVE_ET_SETTLE` | optional | `auto` = settle knockouts on the full result |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | yes at setup | first super admin |
| `PALPLUS_*`, `RECAPTCHA_*`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | optional | payments/anti-abuse |
| `THE_ODDS_API_KEY` | legacy alias | prefer `ODDS_API_KEY` |

Full inventory lives in `docs/templates/client.env.example`; every knob is documented in `.env.example`.

### 3.4 Cron cadence (per client)

| Endpoint | Cadence | Purpose |
|---|---|---|
| `/api/cron/sync?secret=…` | every **5 min** | live scores/status + stale sweep; paid odds pass self-throttles to 60 min |
| `/api/cron/settle?secret=…` | every **10 min** | settle finished games (skips `AET`/`PENS`) |
| `/api/cron/schedule?secret=…` | daily 05:30 | rolling 7-day fixture calendar (0 credits) |
| `/api/cron/purge?secret=…` | daily 00:30 | expired games/deposits |
| `/api/cron/rates?secret=…` | daily | FX + crypto rates |
| `/api/cron/refresh?secret=…` | on demand | bust feed/settings caches (multi-instance) |

On Railway use *Cron Schedule* per service; on a VPS `setup.sh` installs the same entries into crontab.

### 3.5 Acceptance test (per client, before handover)

1. `GET /api/public/settings` returns **their** brand.
2. Admin login works; password changed from the seed value.
3. *Cron Settings → Run now (Sync)* returns counts (not `throttled`/errors) and the odds-freshness banner updates.
4. `/live` shows in-play games with ticking clocks (during a live window), plus HT/ET/PENS labels.
5. Place a test bet → appears in Admin → Bets; cash-out button shows if enabled.
6. Deposit/withdraw path in sandbox (M-Pesa/Palplus) → wallet + ledger rows correct.
7. Settlement: finish a game → bets settle; a corners market lands in *Settlement Review*.
8. Broadcast: send → banner appears in a private window; then Deactivate.
9. Cron routes return 401 **without** the secret.
10. Backups: confirm the offsite dump ran at least once.

### 3.6 Backups & restore drill

- Nightly `pg_dump` on the client's DB → object storage (S3/R2/B2), 30-day retention:
  `railway run --service <slug> pg_dump "$DATABASE_URL" | gzip > <slug>-$(date +%F).sql.gz`
- **Test a restore monthly** into a scratch DB. Snapshot ≠ backup.
- Target: RPO ≤ 24h (≈1h if you add WAL/PITR on a managed DB), RTO ≤ 2h.

### 3.7 Update rollout

1. Merge to `master` → fast-forward `main` (the deploy branch).
2. Canary **one** client (deploy, smoke test §3.5 items 1–4, 7).
3. Roll the rest: `for s in $(cat clients.txt); do railway up --service "$s" --detach; done`.
4. Watch logs for `[live-scores]`, `[auto-settle]`, `[odds-api] quota` lines.
5. Keep the previous deploy (Railway *Deployments* → *Redeploy*) as rollback.

### 3.8 Monitoring

- Uptime monitor on `https://<client>/` (expect 200).
- Per client, weekly: Admin → API Settings **quota card**, Cron Settings **freshness banner**, `live hygiene` log lines.
- Alert if: quota remaining < 500, no odds sync in >26h, cron 401s, DB size > 80% of plan.

### 3.9 Billing & offboarding

- Stripe: one Product per plan, subscription per client, invoice email = their ops address. Failed payment → warn →
  **suspend the cron jobs first** (site stays readable), then the service.
- Offboarding: export their data (`pg_dump` + CSV of bets/ledger), revoke API keys, remove the domain, delete the
  service and database, hand DNS back.

---

## 4. Owner console (build this in Phase 1)

A small internal page (protected by the platform super-admin role) listing every client — one row each:

| Column | Source |
|---|---|
| Client / domain | your `clients.txt` or a `Tenant` table |
| Deploy version | Railway/GitHub API (commit SHA) |
| Last odds sync / live sweep | `Setting: odds.lastSyncAt`, `live.lastSweepAt` |
| Quota remaining | `Setting: odds.lastQuota` |
| Open settlement review | count of finished games with unsettled outcomes |
| Health | uptime monitor + last cron status |

Actions: run sync, open admin, open logs. **No cross-client data access from the console** — keep isolation honest.

---

## 5. Phase 2 — Multi-tenant design

### 5.1 Isolation options

| Model | Pros | Cons | Verdict |
|---|---|---|---|
| **Row-level `tenantId`** on every table + a Prisma `$extends` that injects the tenant filter | cheapest, one DB, one connection pool | one missed `where` = cross-tenant leak; needs tests per model | ⭐ **recommended** |
| **Schema per tenant** (`?schema=tenant_x`) | stronger isolation, one cluster | a Prisma client per schema (pool pressure), migration fan-out | good middle ground |
| **Database per tenant** | strongest isolation, easy per-client backup/delete | most expensive, most connection pools | only if a client demands physical separation |

### 5.2 Changes required (row-level path)

1. **Tenant table**: `Tenant { id, slug, name, primaryDomain, customDomains[], status, plan, createdAt }`,
   plus `TenantSecret { tenantId, key, valueEncrypted }` for per-tenant API keys.
2. **`tenantId` column** on every business table (`Setting`, `User`, `Game`, `Market`, `Outcome`, `Bet`, `Wallet`,
   ledger, `Notification`, `Broadcast`, `AuditLog`, `Voucher`, …). Composite uniques become `@@unique([tenantId, …])`
   (e.g. `User.username`, `Game.externalId`, `Setting.key` — note `Setting.key` is currently globally unique and is the
   single biggest change).
3. **Tenant resolution**: middleware reads the hostname → tenant (cache 60s). Dev/fallback: `TENANT_SLUG` env.
4. **Scoped client**: a `tenantPrisma(tenantId)` extension that injects `where.tenantId` on reads/writes and blocks
   cross-tenant writes in dev (`throw` if a query omits the filter).
5. **Secrets**: replace direct `process.env.ODDS_API_KEY` reads with `tenantSecret(tenantId, "ODDS_API_KEY")` falling
   back to env (single-tenant dev still works).
6. **Cron fan-out**: one scheduler hits `/api/cron/sync` **once**; the route loops active tenants, respecting the
   existing DB throttle markers (`live.lastSweepAt`, `odds.lastSyncAt`) per tenant. Guard against thundering herd with a
   concurrency limit (2–4 tenants at a time).
7. **Admin/RBAC**: admin sessions carry `tenantId`; the platform super-admin role sees the owner console only.
8. **Branding**: already DB-driven (`SiteSettingsContext` is provider-based) — resolve per tenant instead of global.
9. **Billing**: `Tenant.plan` gates features (market menu size, live refresh rate, broadcast TTL).

### 5.3 Migration path (fleet → multi-tenant)

1. Ship the schema with nullable `tenantId` + a default tenant row (no behaviour change).
2. Backfill: assign every existing row to its client's tenant; add the composite uniques.
3. Dual-run: point one client's domain at the multi-tenant deployment, keep the rest on fleet.
4. Move clients one at a time (DNS switch), watching money paths first: place a bet, settle it, verify the ledger.
5. Decommission the fleet services.

**Effort estimate:** 2–4 focused weeks for the schema + scoping + cron fan-out + owner console, plus a dedicated
cross-tenant leak test suite. Treat it as a **money-path change**: migration + tests + a canary client week.

### 5.4 Risks to design for

- **Cross-tenant leakage** (bets/wallets/PII) → scoped client + leak tests + per-model test coverage.
- **Noisy neighbour** (one client's traffic/backfill starving others) → per-tenant rate limits and job concurrency caps.
- **Blast radius** of a bad deploy → feature flags, canary tenant, fast rollback.
- **Per-tenant cron cost** → the existing DB markers already make sweeps cheap and idempotent; keep them.

---

## 6. When to switch to Phase 2

Trigger *any two*:
- clients **> 6**, or
- maintenance **> 2 h/client/month**, or
- infra cost **> 10%** of revenue, or
- a client demands self-serve signup / instant provisioning.

Until then, fleet is faster and safer money.

---

## 7. Product-level settlement coverage (price it accordingly)

What auto-settles from The Odds API `/scores` alone:

| Market group | Settlement |
|---|---|
| Result, goals, totals, handicaps, BTTS, DNB, double chance, correct score | ✅ auto |
| Half-time lines (1H/2H totals, 1H BTTS, HT/FT) | manual — an admin enters the HT score at Admin → Games, which unlocks the auto resolvers |
| Corner markets (totals, team totals, 1X2, handicap) | manual — or automated by an external settlement worker that posts per-team corner counts |
| Cards / bookings | manual on purpose — booking conventions differ (one yellow-as-one-card vs 10/25 booking points), so a machine would risk paying the wrong side |
| `to_qualify` (knockout) | manual |

Every non-score market lands in **Admin → Ops → Settlement Review** for a
human — in fleet mode, **that human is you**. The built-in API-Football stats
feed was removed (unreliable on the free account); the intended replacement is
an external settlement worker that posts half-time scores and corner counts, so
only cards, `to_qualify` and the occasional ambiguous line (the resolver returns
`null` rather than guess → review) need a person. Price accordingly:
manual-settlement labour belongs in the Pro plan, not Standard.

---

## 8. Compliance & risk register

| Area | Owner | Notes |
|---|---|---|
| Gambling licence, KYC/AML, responsible gambling | **client** | state it in the agreement; you provide tooling only |
| PII (punter data) | you are the **data processor** | DPA with each client; GDPR / Kenya DPA posture; data residency |
| Payments | client's merchant accounts (Palplus/Daraja) | you never touch card data (out of PCI scope) |
| Uptime / SLA | you | only promise what the fleet can hold; document maintenance windows |
| Incidents | you | breach playbook: contain → notify client (72h GDPR) → post-mortem |
| Backups / DR | you | tested restores, documented RTO/RPO |
| IP | you | you own the platform; clients license usage, they don't own the code |

---

## 9. Runbook quick reference

```bash
# provision (see §3.2)
./scripts/provision-client.sh --slug <slug> --domain <domain> --brand "<name>" --admin-email <email> --odds-key <key>

# deploy an update to every client
for s in $(cat clients.txt); do railway up --service "$s" --detach; done

# nightly backup (per client, cron)
railway run --service <slug> pg_dump "$DATABASE_URL" | gzip > /backups/<slug>-$(date +%F).sql.gz

# restore drill
gunzip -c /backups/<slug>-YYYY-MM-DD.sql.gz | psql "$SCRATCH_DATABASE_URL"

# smoke test after a deploy
curl -s "https://<domain>/api/public/settings" | head -c 200
curl -s "https://<domain>/api/cron/sync?secret=$CRON_SECRET" | head -c 300
```

---

## 10. Glossary

- **Fleet** — one deployment per client (single-tenant), managed by you.
- **Multi-tenant** — one deployment serving many clients, isolated by `tenantId`.
- **Tenant** — a client's slice of the platform: brand, domain, data, keys, plan.
- **RPO / RTO** — max acceptable data loss / max acceptable downtime.
- **DPA** — data-processing agreement (you process punter data on the client's behalf).
