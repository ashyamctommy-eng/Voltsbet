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
- **2FA (TOTP):** admin/staff can enable in **Account → Settings → Two-Factor
  Authentication** (Google Authenticator / Authy). Enforced at login for all
  non-customer roles. Secrets are stored per-user; disabling requires the
  current session.
