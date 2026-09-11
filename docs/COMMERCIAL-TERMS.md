# Commercial Terms — draft for legal review

> **Status: DRAFT.** This is a working checklist and term sheet for selling or licensing Voltbets,
> not a contract and not legal advice. Have counsel turn it into an agreement before it is signed.
> Read alongside `docs/NEXT-SESSION.md` §6 (pre-sale checklist) and `docs/SAAS-PLAYBOOK.md`
> (operations, packaging, costs).

---

## 1. The three sale shapes

Pick one before drafting; the shape drives almost every other clause. (Owner decision was still
pending as of 2026-09-11.)

| | **A. Buyout / assignment** | **B. Per-client licence** | **C. Hosted SaaS** |
|---|---|---|---|
| What transfers | Copyright in the code, outright | A right to run **one** branded deployment | Nothing — you host and charge monthly |
| Price shape | Highest one-off | One-off setup + annual licence | Setup + recurring monthly |
| Resale | Buyer may resell | You keep IP, may sell again | You keep everything |
| Handover | Repo transfer / zip + escrow, docs, keys, credentials | Repo, runbook, their own accounts | None; access only |
| Best when | Buyer wants to own the product | Buyer wants their own brand/host but not the code | Recurring revenue, least leakage |

The code is **single-tenant today** (one brand in `Setting`, one `DATABASE_URL`, keys in env), so
shapes A and B are "one instance per client" and work with what exists; shape C needs the Phase-2
tenant isolation sketched in `docs/SAAS-PLAYBOOK.md` §5. Never fork the repo per client — per-client
differences are configuration, not code.

## 2. Parties and definitions

- **Supplier** — the copyright holder (`[LEGAL NAME]`, the "we" below).
- **Client / Buyer** — `[LEGAL NAME]`, jurisdiction, registration no.
- **Software** — the Voltbets codebase and documentation as delivered (tag/commit `[REF]`).
- **Deliverables** — Software, deployment runbook, admin credentials, `THIRD-PARTY-NOTICES.md`,
  `LICENSE`, and the acceptance-criteria list (§5).

## 3. Scope of delivery

State exactly what is and is not included, e.g.:

- Included: the Software at the agreed commit; provisioning/branding; domain + DNS + TLS setup;
  cron configuration; initial data seed; one smoke-test pass; a handover call; the docs pack.
- **Not included** (the Client's own obligations — put these in the agreement):
  gambling licence, KYC/AML program, responsible-gambling compliance, payment merchant accounts
  (Palpluss/Daraja/crypto), and the odds/stats API accounts and their quotas.
- Third-party services the Client must obtain and pay for: The Odds API key (`ODDS_API_KEY`);
  hosting (Railway/VPS); database.

## 4. Price and staged payment

Use milestones, not a lump sum. Suggested tranches for shapes A/B:

| Milestone | Share | Trigger |
|---|---|---|
| Deposit | 30–50% | On signing |
| Staging sign-off | 30% | Client accepts on a staging URL (§5) |
| Production go-live | 20–30% | Live on the Client's domain, smoke test passed |
| Balance / warranty end | 10–20% | After the support window (§6) closes clean |

For shape C, replace with the packaging in `docs/SAAS-PLAYBOOK.md` §2 (one-off setup + monthly plan).

## 5. Acceptance criteria

The Client accepts the delivery when all of these pass on the agreed environment. Reuse
`docs/SAAS-PLAYBOOK.md` §3.5 as the executable list, at minimum:

1. **Build & boot** — `npx tsc --noEmit` clean, `pnpm run test` green, `pnpm build` succeeds, site loads.
2. **Auth & roles** — a fresh customer can register, log in, and see their wallet; the super-admin
   reaches `/admin`; a suspended user is locked out.
3. **Odds pipeline** — a cron sync imports games/odds; the homepage feed renders; the market catalog
   reflects the enabled markets.
4. **Betting loop** — place a single and a multi; the bet appears in the account and in Admin → Bets;
   stake is debited once (no double-spend in the wallet ledger).
5. **Settlement** — a finished game settles `auto` markets; a manual market can be settled by hand at
   Admin → Ops → Settlement Review, crediting the wallet.
6. **Payments (sandbox)** — a crypto and an M-Pesa deposit land via webhook and credit the wallet; a
   withdrawal enters the admin queue and can be marked paid.
7. **Branding & i18n** — site name/logo/colours come from settings (no supplier branding visible);
   switcher and currencies behave.
8. **Cron** — `sync`/`settle`/`schedule`/`purge`/`rates` run with the cron secret and are protected
   without it.

A client-visible defect that blocks any item is fixed before the milestone invoice.

## 6. Support, warranty, updates

- Warranty window: 30–90 days from go-live — fix defects in delivered scope at no charge.
- Support window and response target: state them (e.g. email, 48h business days). Ongoing support
  and updates are a paid plan or a maintenance percentage (e.g. 20%/yr), not open-ended.
- Updates: how fixes/features reach the Client (shape B: you apply them; shape C: automatic).
- Explicit exclusions: third-party API changes/quota exhaustion, hosting outages, the Client's own
  modifications, and forced changes to payment-provider rules.

## 7. Intellectual property

- Shape A: copyright in the Software assigns to the Buyer on full payment; the Supplier keeps no
  rights except the right to use generic know-how. Deliver signed assignment.
- Shape B/C: the Supplier retains all IP; the Client receives a non-exclusive, non-transferable
  licence to use one branded deployment (B) or merely service access (C). No source access in C.
- Third-party components remain under their own licences (`THIRD-PARTY-NOTICES.md`). The Supplier
  warrants it has the right to distribute the Software and that — as audited — no dependency forces
  the Client to publish their own source. **Flag for counsel:** the production tree includes
  `@img/sharp-libvips-linux-x64` under **LGPL-3.0-or-later** (via Next.js image optimisation) and
  `caniuse-lite` under **CC-BY-4.0**; used unmodified as separate modules, but ship the notices and
  upstream licence texts and let counsel confirm compliance.
- No supplier trademarks are delivered as part of the product; the Client supplies their own brand.

## 8. Data protection

- Roles: the Client is the **data controller** (punter PII); the Supplier is a **processor** in shapes
  B/C. Sign a DPA covering purpose, retention, sub-processors, breach notification (72h), and data
  residency (GDPR / Kenya DPA posture).
- Shape A: data protection transfers to the Buyer with the deployment; the Supplier deletes any
  copies it held.

## 9. Liability and risk

- Warranty/liability caps: typically fees paid; exclude indirect/consequential loss.
- The Client owns gambling-licence, KYC/AML and responsible-gambling compliance; state that the
  Software is a tool and does not itself make the Client compliant.
- Confirm the responsibility split for settlement errors: the Software never guesses (a null
  resolution goes to admin review), and manual settlement decisions are the operator's.

## 10. Term, termination, offboarding

- Term and renewal (shape B/C); termination for breach with a cure period.
- Offboarding: data export, credentials rotation, and deletion timeline. See
  `docs/SAAS-PLAYBOOK.md` §3.9.

---

## Pre-signature checklist

- [ ] Sale shape chosen (A/B/C) and price/milestones filled in.
- [ ] `[LEGAL NAME]` and governing law completed in `LICENSE` and here.
- [ ] Shared secrets rotated (the odds key was pasted in a chat — rotate before handover).
- [ ] `THIRD-PARTY-NOTICES.md` regenerated at the delivered commit and attached.
- [ ] `LICENSE` reviewed and attached.
- [ ] Client's own accounts confirmed (odds/stats API, hosting, DB, payment merchant).
- [ ] Acceptance criteria (§5) run and signed on staging.
- [ ] DPA and client-obligation clauses in place.
- [ ] Support window, update policy and exclusions written down.
