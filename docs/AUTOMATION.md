# Automation, Risk & Security — operations guide

## 1. Auto-settlement (cron)

Settles finished games automatically (result resolution for `MATCH_RESULT`,
`OVER_UNDER`, `DOUBLE_CHANCE`, `BTTS`, `CORRECT_SCORE`; anything ambiguous is
left for admin review — auto-settle never guesses).

**Configure:** Admin → Website Settings → **Automation**:
- `settlement.delayMinutes` — how long after a game finishes before settling (default 10).
- `cron.secret` — a random token protecting the endpoint.

**Call it from any scheduler every ~10 minutes:**

```
GET https://YOUR-APP/api/cron/settle?secret=<cron.secret>
```

Free schedulers: Railway (Project → Add → Cron Job), cron-job.org, GitHub
Actions schedule, or any VPS crontab. Returns:

```json
{ "ok": true, "settled": ["Game · Market · Outcome"], "skipped": [] }
```

## 2. Odds margin & liability limits

- `odds.marginPercent` (default 6) — the overround VoltBet keeps on top of the
  feed odds. Applied automatically in the sync pipeline; 0 = pass-through.
- `betting.maxLiabilityPerMarket` (default 500000) — a bet is rejected if it
  would push this market's total exposure (open bets + new potential win)
  past the cap. Set 0 to disable.

Both in Admin → Website Settings → **Odds & Risk**.

## 3. Referral program

- `referral.enabled` / `bonusPercent` (10) / `bonusCap` (500) / `minDeposit` (0).
- Every account gets its own `VOLT-XXXXXX` share code at registration; users
  who sign up via `/register?ref=CODE` are tracked (`referredByCode`).
- When the referee's **first** deposit completes, the referrer is credited
  `min(deposit × bonusPercent%, bonusCap)` as a `REFERRAL_BONUS` transaction +
  notification. Repeat deposits never re-trigger.

## 4. Security

- **Login lockout:** 5 failed attempts → account locked 15 minutes (per-IP
  rate limit already exists on top).
- **Telegram OTP (replaces TOTP 2FA):** users link Telegram in **Account →
  Settings → Telegram Verification** (single-use deep-link token, consumed by
  the bot webhook at `/api/webhooks/telegram`). When `telegram.otpEnabled` is
  on, linked accounts must enter a 6-digit code DMed by the bot at login.
  Codes are sha256-hashed at rest, expire after 5 minutes, and brute force is
  capped at 5 attempts per code + 3 codes per 10 minutes per user.

## 3. Ready-made GitHub Actions schedule

Free, real cron syntax, no request timeouts, runs on GitHub's infra. Four
workflow files ship in the repo (GitHub allows ONE cron per `schedule`, so
there's one file per job):

| Workflow file | Endpoint | Cron (UTC) |
|---|---|---|
| `.github/workflows/cron-settle.yml` | `/api/cron/settle` | `*/12 * * * *` |
| `.github/workflows/cron-sync.yml` | `/api/cron/sync` | `0 6 */3 * *` |
| `.github/workflows/cron-schedule.yml` | `/api/cron/schedule` | `0 5 * * *` |
| `.github/workflows/cron-purge.yml` | `/api/cron/purge` | `0 0 * * *` |

**Setup (2 minutes):** add two repository secrets —
Settings → Secrets and variables → Actions → New repository secret:

- `VOLTBET_APP_URL` — e.g. `voltsbet-production.up.railway.app` (no https://)
- `VOLTBET_CRON_SECRET` — your cron secret

That's it. Test immediately via the **Actions** tab → any workflow →
**Run workflow** (manual trigger) and check the run log for the JSON response.

> Caveat: GitHub Actions free tier can delay scheduled runs by up to ~15 min
> on busy periods — fine for our cadence; the odds-sync route self-throttles
> anyway. Do NOT put multiple crons in one workflow's `schedule` — every cron
> would trigger ALL jobs (the sync would burn quota 4×/day).