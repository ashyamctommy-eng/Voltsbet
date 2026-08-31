# Deploying VoltBet to Railway (testing) — step by step

Goal: get the full site — customer frontend, admin, betting, and **live payment
webhooks** — running on a public HTTPS URL so you can test deposits/withdrawals
against the NOWPayments and M-Pesa **sandboxes**.

> Time: ~30–45 min. Costs: Railway free/cheap trial + sandbox accounts are free.

---

## Step 1 — Push the code to GitHub

> ✅ Repo: **`ashyamctommy-eng/Voltsbet`** — branches `master` and `main` are
> kept in sync. Clone: `git clone https://github.com/ashyamctommy-eng/Voltsbet.git`
> `.gitignore` excludes `node_modules`, `.next`, `prisma/dev.db` — never commit
> the dev database or any keys.

## Step 2 — Create the Railway project

1. Go to **railway.app** → **New Project** → **Deploy from GitHub repo** → pick `voltbet`.
2. Railway detects Next.js automatically and starts building. The first build may
   fail because there's no database yet — fix that next, then redeploy.

## Step 3 — Add PostgreSQL + env vars

> ✅ The schema (`prisma/schema.prisma`) is already on **PostgreSQL** with a fresh
> init migration (`20260816180000_init_postgres`) — no code change needed.

1. **Variables** tab → add:
   | Name | Value |
   |---|---|
   | `DATABASE_URL` | from the **PostgreSQL** plugin you add in Step 4 |
   | `NODE_ENV` | `production` |
   | `APP_URL` | `https://<your-service>.up.railway.app` (the Railway URL from the Settings tab) |
   | `ODDS_API_KEY` | *(optional)* your The Odds API key |
   | `SEED_ADMIN_EMAIL` | *(recommended)* super-admin email — defaults to `admin@voltbet.test` |
   | `SEED_ADMIN_PASSWORD` | *(recommended)* super-admin password — **required in production**; the seed never falls back to the dev password |
2. **Add a PostgreSQL plugin**: New → Database → PostgreSQL. Copy its
   `DATABASE_URL` internal connection string into the variable above
   (use the *internal* one so the app and DB talk over Railway's network).

> The seed creates demo users/bets/notifications **only** outside production
> (or when `SEED_DEMO_USERS=true`) — a fresh Railway deploy gets your admin
> account and no demo accounts by default.

## Step 4 — Set the start command

1. **Settings → Deploy → Custom start command:**
   ```
   npx prisma migrate deploy && npx prisma db seed && next start
   ```
   > `prisma migrate deploy` runs the Postgres init migration (idempotent —
   > safe to keep on every deploy, the seed is idempotent too).
2. Deploy. When it finishes, open the service URL → you should see VoltBet.
   - First deploy only: tables are created + initial data seeded (no demo accounts in production).
   - You can remove `&& npx prisma db seed` later (the seed is idempotent anyway).

## Step 5 — Log in and verify

- Site: `/login` — register a fresh customer account (no seeded demo users in production).
- Admin: `/admin` → `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (the vars you set in Step 3).
- Place a bet, deposit in demo payment mode, settle a game. The whole loop should work.
- Local dev only: seeded demo accounts are `demo@voltbet.test` / `Demo123!` (see README).

---

## Step 6 — NOWPayments (crypto) sandbox wiring

1. **nowpayments.io** → Register → Dashboard → **API Keys**.
   - Copy the **API key** (create payments).
   - Create an **IPN secret key** (for webhook signatures).
   - Generate a **payout API key** (withdrawals) — this may require a quick
     verification, fine for testing.
2. **VoltBet → Admin → Website Settings → Crypto Payments:**
   - `crypto.provider` = `NOWPAYMENTS`
   - `crypto.apiKey` = your API key
   - `crypto.ipnSecret` = your IPN secret
   - `crypto.payoutApiKey` = your payout key
   - `app.url` = `https://<your-service>.up.railway.app`
3. **Test deposit:** Account → Deposit → Crypto → USDT → amount → *Create Payment*.
   You'll get a **real NOWPayments address**; the IPN webhook
   (`/api/webhooks/crypto/nowpayments`) will credit your balance automatically.
   NOWPayments has a test mode (fake coins) — check their dashboard for the test
   harness, or send a tiny real amount (USDT TRC20 fees are cents).
4. **Test payout (admin):** Withdrawals → a pending request → mark **Completed** →
   the app calls the NOWPayments payout API and sends crypto from your balance.

## Step 7 — M-Pesa (Daraja) sandbox wiring

1. **developer.safaricom.co.ke** → register → create an **app** → get Consumer Key
   + Secret. In the sandbox portal you also get the **passkey** and test Paybill
   (`174379`), test phone numbers (e.g. `254708374149`), and the **sandbox
   certificate** for B2C.
2. **VoltBet → Admin → Website Settings → M-Pesa:**
   - `mpesa.enabled` = `true`
   - `mpesa.env` = `sandbox`
   - `mpesa.consumerKey` / `mpesa.consumerSecret` / `mpesa.passkey` / `mpesa.shortcode` = `174379`
   - `mpesa.initiatorName` = the initiator from the portal (sandbox default is `testapi`)
   - `mpesa.securityCredential` = generate it (Step 3 below)
   - `mpesa.callbackSecret` = leave the generated random value
3. **Generate the B2C security credential** (one-time):
   ```bash
   cd app
   # download the sandbox certificate from the Daraja portal → save as safaricom.cer
   pnpm tsx scripts/gen-mpesa-credential.ts --password "Safaricom123!" --cert ./safaricom.cer
   ```
   Paste the printed string into `mpesa.securityCredential`.
4. **Test deposit:** Account → Deposit → **M-Pesa** → your number → amount →
   *Pay with M-Pesa* → a PIN prompt appears on the test phone (in sandbox the
   callback simulates the payment; your balance credits when the callback lands).
5. **Test payout:** Withdrawals → set a request to **Processing** → the app calls
   B2C → the result callback (`/api/webhooks/mpesa/b2c`) debits the wallet and
   marks it **Completed**.

> M-Pesa callbacks need a **public HTTPS URL** — exactly what Railway gives you.
> In sandbox the STK push works with test numbers; real numbers require moving
> to production credentials (Step 9).

---

## Step 8 — When you're happy: production switch (still on Railway)

1. NOWPayments: enable live payments in their dashboard (KYC done) — same keys.
2. M-Pesa: you need a **registered business + Paybill** from Safaricom, then
   production app credentials (go-live via the Daraja portal), real initiator
   password + cert → regenerate the security credential.
3. Set `mpesa.env` = `production`, swap the shortcode, and update callbacks.
4. Change/delete demo accounts, enable KYC expectations, set real limits.

---

## Step 9 — Later: move to your own hosting provider

The app is a standard Next.js deployment — anything that runs Node 20+ works:

```bash
# on your VPS / hosting
git clone https://github.com/YOU/voltbet.git /opt/voltbet
cd /opt/voltbet
pnpm install
# .env: DATABASE_URL=postgresql://... (your own Postgres), NODE_ENV=production, APP_URL=https://bet.yourdomain.com
npx prisma migrate deploy
npx prisma db seed
npx prisma build && pnpm start   # or pm2 start
```

- Put **NGINX/Caddy + HTTPS** in front (certbot). HTTPS is mandatory — cookies are
  secure-only in production and Safaricom rejects non-HTTPS callbacks.
- Same env vars and admin settings carry over (they live in the database, so the
  payment config moves with your data).
- Full VPS runbook: see `DEPLOYMENT.md`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails on first deploy | Add the Postgres plugin + `DATABASE_URL` first, then redeploy |
| `P1001` database errors | `DATABASE_URL` empty/wrong — use the Postgres plugin's *internal* URL |
| Crypto deposit stuck "Awaiting" | IPN secret mismatch → re-paste `crypto.ipnSecret`; check NOWPayments webhook logs |
| M-Pesa PIN prompt doesn't arrive | `mpesa.env` must be `sandbox`, use a sandbox test number; check `app.url` is the Railway HTTPS URL |
| B2C callback never fires | `mpesa.securityCredential` wrong → regenerate with the correct initiator password/cert |
| Webhooks return 401 | `mpesa.callbackSecret` changed after a payment was created — don't rotate it mid-test |
