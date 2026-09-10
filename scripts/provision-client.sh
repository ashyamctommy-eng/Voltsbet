#!/usr/bin/env bash
#
# provision-client.sh — stand up one client (Fleet model) on Railway.
#
# Creates a Railway project, attaches Postgres, sets the client's environment,
# deploys the app, runs migrations + the admin seed, and attaches a domain.
#
# NOT YET RUN AGAINST A LIVE RAILWAY ACCOUNT — always start with --dry-run.
# Requires: railway CLI (https://docs.railway.com/guides/cli) and `railway login`.
#
# Usage:
#   ./scripts/provision-client.sh \
#     --slug acme-bet --domain bet.acme.tld --brand "Acme Bet" \
#     --admin-email ops@acme.tld --odds-key "$CLIENT_ODDS_KEY" [--admin-password '…'] [--dry-run]
#
set -euo pipefail

# ── args ──────────────────────────────────────────────────────────────────
SLUG=""; DOMAIN=""; BRAND=""; ADMIN_EMAIL=""; ODDS_KEY=""; ADMIN_PASSWORD=""; DRY=0; TEAM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --brand) BRAND="$2"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --odds-key) ODDS_KEY="$2"; shift 2 ;;
    --team) TEAM="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "✖ $*" >&2; exit 1; }
run() {
  if [[ $DRY -eq 1 ]]; then printf '  [dry-run] %s\n' "$*"; else printf '  → %s\n' "$*"; "$@"; fi
}

[[ -n "$SLUG" ]]        || die "--slug is required (Railway service name, e.g. acme-bet)"
[[ -n "$DOMAIN" ]]      || die "--domain is required (e.g. bet.acme.tld)"
[[ -n "$BRAND" ]]       || die "--brand is required (e.g. \"Acme Bet\")"
[[ -n "$ADMIN_EMAIL" ]] || die "--admin-email is required (first super admin)"
[[ -n "$ODDS_KEY" ]]    || die "--odds-key is required — use the CLIENT'S key, not yours"

if [[ $DRY -eq 0 ]]; then
  command -v railway >/dev/null || die "railway CLI not found — install it, then 'railway login'"
  railway whoami >/dev/null 2>&1 || die "not logged in — run 'railway login'"
fi

# unique cron secret per client + a temp admin password if none supplied
CRON_SECRET="${CRON_SECRET:-$(openssl rand -hex 32)}"
if [[ -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  GENERATED_PW=1
fi

APP_URL="https://${DOMAIN}"
TEAM_FLAG=(); [[ -n "$TEAM" ]] && TEAM_FLAG=(--team "$TEAM")

echo "── Provisioning ${BRAND} (${SLUG}) ───────────────────────────────"
echo "   domain      : ${DOMAIN}"
echo "   admin       : ${ADMIN_EMAIL}"
echo "   odds key    : ${ODDS_KEY:0:6}… (client's)"
echo "   dry run     : $([[ $DRY -eq 1 ]] && echo yes || echo no)"
echo

# ── 1. project + database ─────────────────────────────────────────────────
echo "1/6 project + Postgres"
run railway init --name "$SLUG" "${TEAM_FLAG[@]:-}"
run railway add --plugin postgresql

# ── 2. environment ────────────────────────────────────────────────────────
echo "2/6 environment"
run railway variables \
  --set "APP_URL=${APP_URL}" \
  --set "NODE_ENV=production" \
  --set "CRON_SECRET=${CRON_SECRET}" \
  --set "ODDS_API_KEY=${ODDS_KEY}" \
  --set "ODDS_API_REGIONS=eu" \
  --set "SHOW_SEEDED_GAMES=false" \
  --set "BROADCAST_TTL_HOURS=72"

# ── 3. deploy ─────────────────────────────────────────────────────────────
echo "3/6 deploy (Next.js build ~2-4 min)"
run railway up --detach

# ── 4. migrate + seed the first admin ─────────────────────────────────────
echo "4/6 migrate + seed admin"
run railway run --service "$SLUG" pnpm prisma migrate deploy
run env SEED_ADMIN_EMAIL="$ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    railway run --service "$SLUG" pnpm prisma db seed

# ── 5. domain ─────────────────────────────────────────────────────────────
echo "5/6 domain"
run railway domain "$DOMAIN"
echo "   ↳ point DNS: CNAME ${DOMAIN} → the Railway target shown above (Cloudflare proxy is fine)"

# ── 6. verify ─────────────────────────────────────────────────────────────
echo "6/6 verify (run these once DNS resolves)"
echo "   curl -s ${APP_URL}/api/public/settings | head -c 200"
echo "   curl -s '${APP_URL}/api/cron/sync?secret=${CRON_SECRET}' | head -c 300"
echo

cat <<EOF
✅ ${BRAND} provisioned (pending DNS + cron).

Next steps
  1. Create 2 Railway cron schedules on this service:
       */5  * * * *   ${APP_URL}/api/cron/sync?secret=${CRON_SECRET}
       */10 * * * *   ${APP_URL}/api/cron/settle?secret=${CRON_SECRET}
     plus daily: /api/cron/schedule, /api/cron/purge, /api/cron/rates
  2. Brand it: Admin → Website Settings (site name = ${BRAND}, colours, support email)
  3. Change the admin password after first login.
  4. Run the acceptance list in docs/SAAS-PLAYBOOK.md §3.5.
  5. Add "${SLUG}" to clients.txt (used by the rollout/backup loops).

Admin credentials (change after first login)
  email:    ${ADMIN_EMAIL}
  password: ${ADMIN_PASSWORD}$([[ "${GENERATED_PW:-0}" == "1" ]] && echo "   (generated)")
EOF

if [[ "${GENERATED_PW:-0}" == "1" && $DRY -eq 1 ]]; then
  echo "  (dry run — password above is a sample, nothing was created)"
fi
