# VoltBet — Accounts Checklist (for the buyer)

Create these accounts **before** the setup call so the installer can run
end-to-end without waiting on anything. You keep all credentials — the
developer never holds your keys.

| # | Account | Where | What for | Time | Cost |
|---|---|---|---|---|---|
| 1 | **VPS (server)** | DigitalOcean / Hetzner / Vultr / Linode | Hosts the site. Pick **Ubuntu 24.04**, **2 GB RAM minimum (4 GB recommended)**, any region near your users | 10 min | ~$6–12/mo |
| 2 | **Domain + DNS** | Namecheap / Cloudflare / your registrar | Your site's address (e.g. `bet.yourbrand.com`) | 10 min | ~$10/yr |
| 3 | **The Odds API** | https://the-odds-api.com | Pre-match odds — the data engine. Free key = 500 requests/mo (≈1 sync every 3 days); paid plan removes limits | 5 min | Free → ~$49/mo |
| 4 | **The Odds API** | https://the-odds-api.com (key emailed) | The ONLY sports data provider: pre-match odds, live scores, settlement | 5 min | Free 500 req/mo → paid |
| 5 | **NOWPayments** (optional) | https://nowpayments.io | Crypto deposits (BTC/ETH/USDT…) | 15 min | 0.5% per deposit |
| 6 | **M-Pesa Daraja** (optional) | Safaricom Daraja (Kenya) | Mobile-money deposits/withdrawals (STK Push) | 1–2 days (KYC) | Sandbox free |

## Notes

- **#3 and #4 are required** for real matches. #5/#6 are for payments — the
  site runs in demo payment mode until they're configured.
- Keep your API keys in a password manager. They're entered into the server's
  `.env` (never shared, never in chat).
- Payment accounts (NOWPayments, Daraja) require KYC/verification — start them
  early, they take time.
- If a VPS is new to you: pick the provider, create a droplet/server, and note
  the **root password or SSH key** — you'll paste it during setup.

## What you'll have after the call

- A live site at your domain with SSL
- Admin panel at `/admin` (your login)
- Real pre-match odds + live scores (once your Odds API key is in)
- Automatic daily backups + the 4 cron jobs running (odds sync, calendar,
  settlements, cleanup)
- Developer support on Telegram / WhatsApp
