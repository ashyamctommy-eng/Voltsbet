# VoltBet — Owner's Setup Guide (for the buyer)

Welcome! This guide takes you from "just bought a server" to "live sportsbook"
in about **20 minutes**. The installer does the heavy lifting — you mostly
answer a few questions. No coding knowledge needed.

> Don't have your accounts ready? Start with
> [ACCOUNTS-CHECKLIST.md](./ACCOUNTS-CHECKLIST.md) first.

---

## Step 1 — What you need (before starting)

- [ ] A **VPS** running Ubuntu 24.04 (2 GB RAM+) with root access
- [ ] A **domain** (optional but recommended) — you can start on an IP address
- [ ] Your **The Odds API key** (from https://the-odds-api.com)
- [ ] Your **Odds API key** (`ODDS_API_KEY`) — the only sports-data credential

---

## Step 2 — Connect to your server

From your computer's terminal (Mac/Linux) or PowerShell (Windows):

```bash
ssh root@YOUR_SERVER_IP
```

If you're new to SSH, your VPS provider has a "console" button in their
dashboard that opens the same thing in the browser — use that.

---

## Step 3 — Run the installer (the big one)

Once you're at the server's command line:

```bash
# Option A — interactive (it asks you questions one by one):
bash <(curl -fsSL https://raw.githubusercontent.com/ashyamctommy-eng/Voltsbet/main/deploy/install.sh)

# Option B — everything in one line (recommended for setup calls):
DOMAIN=bet.yourbrand.com \
ODDS_API_KEY=your_odds_api_key \
SITE_NAME="Your Brand" \
BRAND_COLOR="#00e676" \
bash <(curl -fsSL https://raw.githubusercontent.com/ashyamctommy-eng/Voltsbet/main/deploy/install.sh)
```

It will take **5–10 minutes** (installing software + building the site). When
it finishes you'll see a summary like this:

```
✅ VoltBet is LIVE on this VPS
  Site:        https://bet.yourbrand.com
  Admin:       https://bet.yourbrand.com/admin   (email: admin@voltbet.test)
  Admin pass:  <randomly generated — save this!>
  ...
  ── Developer contact (installation support) ──
    ✈️  Telegram:  https://t.me/Poriot_ke
    💬  WhatsApp:  https://wa.me/254717702563
```

**Save the admin password it prints** — that's your login.

> ⚠️ One prompt to notice: the **domain** question. Type your domain
> (e.g. `bet.yourbrand.com`) — the installer then sets up SSL automatically.
> Press Enter to skip if you're starting on an IP.

---

## Step 4 — Point your domain (if you used one)

At your domain registrar / Cloudflare, add a DNS record:

| Type | Name | Value |
|---|---|---|
| A | `@` (or your subdomain) | your server's IP address |

SSL is handled by the installer once the domain resolves — wait a few minutes,
then visit your domain. Done when the padlock icon appears.

---

## Step 5 — After install (5 minutes)

1. **Log in** at `/admin` with the printed email + password. Change the
   password in Account → Settings.
2. **Set your Odds API key** → `ODDS_API_KEY` env var (Admin → **API Settings**
   shows provider status + a connection test).
3. **Load matches once** — Admin → **Cronjobs** → find "Sync odds prices" →
   click **Run now** (takes ~50 seconds the first time). Then check
   Admin → **Games** — fixtures with prices should appear.
4. **Payments (optional)** — Admin → Website Settings → add your NOWPayments /
   M-Pesa keys when you have them. Until then the site uses demo payment mode.

---

## Step 6 — Everyday operations

**It mostly runs itself.** The server automatically:
- Refreshes odds every 3 days (or 3×/day on the paid Odds API plan)
- Fills the 7-day fixture calendar daily
- Settles finished bets every 12 minutes
- Cleans up old matches daily
- Backs up the database daily (7 days kept)

**What you might do occasionally:**

```bash
# Check the site is healthy
curl -s https://bet.yourbrand.com -o /dev/null -w "%{http_code}\n"      # → 200

# See scheduled jobs
crontab -u voltsbet -l

# Take a manual backup
bash /var/www/voltsbet/deploy/backup.sh

# Update to a new version (when the developer ships one)
bash /var/www/voltsbet/deploy/update.sh

# Watch the app logs
pm2 logs voltsbet
```

---

## Troubleshooting (quick)

| Problem | Fix |
|---|---|
| Site shows "0 matches" | Admin → Cronjobs → **Run now** on "Sync odds prices" — then refresh |
| Odds sync says 429 | Normal on free keys — it retries automatically; the sync takes ~50s |
| Admin login fails | Use the email + password printed at install (not the demo one) |
| SSL not working | Domain must point to the server IP first; then run `certbot --nginx -d yourdomain.com` |
| Something else | Contact the developer (Telegram/WhatsApp below) with the output of `pm2 logs voltsbet` |

---

## Support

- **Telegram:** https://t.me/Poriot_ke
- **WhatsApp:** https://wa.me/254717702563

Include: your domain, what you were doing, and any error text you see.
