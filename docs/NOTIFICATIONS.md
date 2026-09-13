# Notifications: email & SMS integration (future work)

**Status: not implemented.** VoltBet sends no email and no SMS today. This
document exists so the decision doesn't have to be re-researched later. Prices
and free tiers change constantly — **verify before committing** (SendGrid retired
its free plan in 2025, which is exactly the kind of change that invalidates a
half-remembered plan).

## What works today

| Channel | State |
|---|---|
| **In-app notifications** | Working. `Notification` rows; the header bell and Profile page read them. Used for security events, e.g. "Your password was changed". |
| **Telegram** | Bot plumbing complete in `src/lib/telegram.ts` — `issueTelegramOtp` / `verifyTelegramOtp`, purpose-aware (`LOGIN`, `WITHDRAWAL`, …), codes hashed, per-purpose rate-limited, supersede-on-reissue. **Dormant until `TELEGRAM_BOT_TOKEN` is set and the webhook is registered.** |
| Email / SMS | Nothing. No transport, no provider SDK, no env vars. |

## Email options

| Provider | Free tier | Notes |
|---|---|---|
| **Brevo** (ex-Sendinblue) | 300/day ≈ 9,000/mo, permanent | Most generous permanent free tier. API + SMTP. ⚠️ The daily cap is **shared between marketing and transactional** — a promo blast can starve password resets. Over-limit mail queues (≤1,000) then drops. |
| **Mailjet** | 6,000/mo (200/day) | Sinch-owned, EU hosting. Fine, clunkier DX. |
| **Resend** | 3,000/mo (100/day) | Cleanest transactional API. Needs a verified domain. |
| **Amazon SES** | Pay-as-you-go, **$0.10 / 1,000** | Cheapest at scale. ⚠️ The old "62,000/mo from EC2" allowance has changed — current terms put SES under the new-account credit pool. Raw: you own bounce handling and warm-up. |
| ~~SendGrid~~ | ❌ Free plan retired 2025 | 60-day trial only. |
| Postmark | Trial only | Best-in-class deliverability, but paid. |

**Key insight:** for transactional auth mail (password resets) volume is tiny —
roughly 1–5% of monthly active users. A 5,000-user book sends maybe 50–250 resets
a month. **Every free tier above is 10–100× more than needed**, so choose on
deliverability and developer experience, not on the cap.

### Deliverability is the real work

The provider matters far less than these:

1. **Verify the domain** with the provider (DNS TXT records).
2. **SPF + DKIM + DMARC.** Without DKIM, Gmail and Outlook will treat you as bulk spam.
3. **Send from a subdomain** — e.g. `mail.voltbets.me` / `no-reply@mail.voltbets.me`.
   This isolates transactional reputation from marketing, so a campaign cannot
   poison password resets.
4. **Warm up.** Free tiers often share sending IPs; early volume spikes damage reputation.

A reset email in the spam folder is *worse* than no email, because the customer
concludes you ignored them and contacts support anyway.

## SMS options

**Free SMS for authentication effectively does not exist.** Plan around this.

- **Twilio trial** — credit-based, and trial accounts can only message pre-verified numbers.
- **Textbelt** — ~1 free SMS/day, shared pool. Not fit for auth.
- **Africa's Talking** — free sandbox for testing, but production needs approval **and payment**. Realistic Kenya option; ~KES 0.5–1 per SMS.
- Vonage / MessageBird trials — same shape as Twilio.

If SMS is ever required (e.g. a regulator insists on a phone factor), budget for
Africa's Talking rather than hunting for a free tier.

## Recommended shape when we build it

Provider-agnostic, so switching vendors is a config change and not a rewrite:

```
MAIL_PROVIDER=brevo        # brevo | resend | ses | none
MAIL_API_KEY=...
MAIL_FROM="VoltsBet <no-reply@mail.voltbets.me>"
SMS_PROVIDER=africastalking # or: none
SMS_API_KEY=...
```

`src/lib/mail.ts` exposes a single `sendEmail()` (and `src/lib/sms.ts` a
`sendSms()`) with one adapter per provider. With the provider set to `none` the
functions **log and no-op** — the app degrades gracefully instead of throwing on
a deployment where mail was never configured. That matters for self-hosted
client installs (`deploy/install.sh`), which must keep working with no provider.

### Priority order

1. Password reset via **Telegram** first — free, already built, and a *possession*
   factor is stronger than email. Email resets exist for the users who never
   linked Telegram.
2. Transactional receipts by **email** (deposit confirmed, withdrawal paid) —
   Brevo or Resend.
3. Marketing — separate sender/subdomain, opt-in, never on the transactional domain.
4. SMS only if a regulator requires it.

## Security rules for any reset channel

- 32-byte random token, stored **hashed**, single-use, 15–30 min TTL.
- **Never reveal whether an account exists** ("if that address is registered, we've sent a link").
- Rate-limit per account **and** per IP.
- **Revoke all sessions on success** — that is what actually helps someone who
  believes they are compromised.
- **Notify after the change** on a different channel where possible (in-app
  notification today), so a silent takeover has a chance of being noticed.
