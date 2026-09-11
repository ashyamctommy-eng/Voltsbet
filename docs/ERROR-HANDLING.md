# Error handling & maintenance

What a visitor sees depends on **where** the failure happens. There are three
layers, and only two of them can be styled by app code.

| Layer | What breaks | Who renders the page | In this repo |
|---|---|---|---|
| **1. Platform** | the container is restarting / not accepting traffic during a deploy | Railway's own error page | fixed by the **healthcheck** (`railway.json`) — see §1 |
| **2. Application** | the process is up, but a page throws (DB down, bad query, provider error) | `app/error.tsx` / `app/global-error.tsx` | branded, see §2 |
| **3. Planned maintenance** | you deliberately take the site down | `app/maintenance/page.tsx` via `proxy.ts` | branded 503, see §3 |

---

## 1. The "errored Railway page" during deploys

**Why it happens.** With no healthcheck configured, Railway cuts traffic to the
new container as soon as it *starts*. A Next.js container spends the first
seconds building routes/connecting to the DB and is not listening yet — so
requests in that window get Railway's generic "Application failed to respond"
page. No app code can render anything there; the process literally isn't up.

**The fix (repository side, done):**

- `GET /api/health` — returns `200` when the process is up **and** the DB
  answers (`SELECT 1`, 2 s timeout), `503` otherwise.
- `railway.json` — declares `healthcheckPath: /api/health` with a 120 s
  timeout and an `ON_FAILURE` restart policy.

With the healthcheck set, Railway keeps the **old** deployment serving until the
new one passes the probe, then switches. The error window effectively
disappears.

**What to verify in the Railway dashboard** (not doable from the repo):

1. Service → **Settings → Healthcheck Path** shows `/api/health`
   (or that `railway.json` was picked up).
2. **Deploy** settings → *Zero-downtime / overlapping deploys* enabled if the
   plan offers it.
3. The start command is the default `pnpm start` (`next start`); the app listens
   on `$PORT`.

**Run `prisma migrate deploy` carefully.** If migrations run in the start
command they delay "listening" and can fail the probe. Prefer a release step
(or `preDeployCommand`) so `next start` comes up immediately.

### If you still want branding on platform-level errors

Railway does not support custom error pages. Two options:

- **Cloudflare in front of Railway** (proxied DNS): Cloudflare **Custom Pages**
  can serve a branded 502/503/504 to visitors when the origin is unreachable.
  This is the only way to brand the "origin down" case. It also gives you
  "Always Online" for cached HTML.
- A tiny separate **status/maintenance** service on its own domain that you link
  to, and point customers at.

---

## 2. Application errors (branded, in-app)

| File | Catches |
|---|---|
| `src/app/error.tsx` | errors thrown while rendering a page — shows a branded screen with **Try again** (`reset()`) and a home link. Renders inside the root layout, so header/footer/theme apply. |
| `src/app/global-error.tsx` | errors thrown by the **root layout** itself. Must render its own `<html>/<body>` and cannot rely on `globals.css`, so it uses self-contained inline styles. |
| `src/app/not-found.tsx` | unmatched routes and explicit `notFound()` → branded 404. |

`error.tsx` logs the error and surfaces `error.digest` as a reference so a
report can be tied to a server log. It never shows a stack trace to the user.

---

## 3. Planned maintenance

Toggle by setting the env var and redeploying:

```
MAINTENANCE_MODE=1
```

`src/proxy.ts` (Next 16's rename of `middleware`) then:

- rewrites page requests to `/maintenance`, with `Retry-After: 300` and
  `Cache-Control: no-store`;
- returns `503` JSON for `/api/*`;
- **always allows** `/api/health`, `/api/cron/*`, `/api/webhooks/*` and the
  static assets (so the maintenance page renders styled and scheduled jobs and
  payment callbacks keep working).

It is deliberately dependency-free so it also works **while the database is
down**. Remove the env var (and redeploy) to restore normal service.

> Trade-off: an env toggle means a redeploy. If you'd rather flip maintenance on
> from Admin → Website Settings without a deploy, that's a small follow-up: a
> `maintenance.enabled` Setting + `maintenance.message` read in the root layout
> (with the env var kept as the emergency switch for DB-down cases).

---

## Quick reference

| Symptom | Layer | Action |
|---|---|---|
| "Application failed to respond" during a deploy | platform | confirm railway.json healthcheck is active |
| Branded "Something went wrong" on a page | application | `error.tsx` — check server logs via the digest |
| Everything shows the maintenance screen | maintenance | unset `MAINTENANCE_MODE` and redeploy |
| 503 JSON from `/api/*` | maintenance | expected while `MAINTENANCE_MODE=1` |
| `/api/health` returns 503 | application | DB unreachable from the app — check `DATABASE_URL` |
