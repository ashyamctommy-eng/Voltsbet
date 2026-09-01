#!/usr/bin/env bash
# UNIBET360 — local crontab installer for VPS/cPanel deployments.
#
# Registers cron entries that ping the app's cron endpoints on localhost,
# mirroring the GitHub Actions cron workflows for hosts without GH Actions.
#
# Usage:
#   CRON_SECRET=<cron.secret> ./setup.sh            # install (default)
#   CRON_SECRET=... BASE_URL=http://localhost:3000 ./setup.sh
#   CRON_SECRET=... ./setup.sh --uninstall          # remove the entries
#   CRON_SECRET=... ./setup.sh --dry-run            # print, don't install
#
# CRON_SECRET must match the app's configured cron secret
# (Admin → Website Settings → cron.secret, or the CRON_SECRET env var).
# BASE_URL defaults to http://localhost:3000 — the app started via start.js.
#
# NOTE: the app self-throttles each endpoint (see src/lib/cron-guard.ts), so
# overlapping triggers are safe — the schedules below follow the docs
# (docs/AUTOMATION.md) and the GitHub workflow cadence.

set -euo pipefail

CRON_SECRET="${CRON_SECRET:-}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
TAG="# UNIBET360-CRON"

if [[ -z "$CRON_SECRET" ]]; then
  echo "error: CRON_SECRET is required (export it or set it in .env)" >&2
  exit 1
fi

# ── endpoints + schedules (UTC) ───────────────────────────────────────────
# settle: every 12 minutes (same cadence as the GH Actions workflow)
# rates:  hourly at :17
# schedule: 05:00 daily (7-day calendar refresh, 0 quota)
# purge:  00:00 daily (expired fixtures + stale deposits)
# sync:   06:00 every 3rd day (free tier ~11 syncs/mo)
LINES=(
  "*/12 * * * * curl -fsS -m 120 '${BASE_URL}/api/cron/settle?secret=${CRON_SECRET}' >/dev/null 2>&1 || true"
  "17 * * * * curl -fsS -m 120 '${BASE_URL}/api/cron/rates?secret=${CRON_SECRET}' >/dev/null 2>&1 || true"
  "0 5 * * * curl -fsS -m 120 '${BASE_URL}/api/cron/schedule?secret=${CRON_SECRET}' >/dev/null 2>&1 || true"
  "0 0 * * * curl -fsS -m 120 '${BASE_URL}/api/cron/purge?secret=${CRON_SECRET}' >/dev/null 2>&1 || true"
  "0 6 */3 * * curl -fsS -m 300 '${BASE_URL}/api/cron/sync?secret=${CRON_SECRET}' >/dev/null 2>&1 || true"
)

existing="$(crontab -l 2>/dev/null || true)"

if [[ "${1:-}" == "--uninstall" ]]; then
  cleaned="$(printf '%s\n' "$existing" | grep -v "^${TAG}$" | grep -v "^${TAG}-END$" | grep -v "cron/settle?secret=" | grep -v "cron/rates?secret=" | grep -v "cron/schedule?secret=" | grep -v "cron/purge?secret=" | grep -v "cron/sync?secret=" || true)"
  printf '%s\n' "$cleaned" | crontab -
  echo "✅ UNIBET360 cron entries removed."
  exit 0
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "--- would install ${#LINES[@]} cron entries under ${BASE_URL} ---"
  for l in "${LINES[@]}"; do printf '  %s\n' "$l"; done
  exit 0
fi

# Drop any previous install of our block, keep everything else.
cleaned="$(printf '%s\n' "$existing" | grep -v "^${TAG}$" | grep -v "^${TAG}-END$" | grep -v "cron/settle?secret=" | grep -v "cron/rates?secret=" | grep -v "cron/schedule?secret=" | grep -v "cron/purge?secret=" | grep -v "cron/sync?secret=" || true)"

{
  printf '%s\n' "$cleaned"
  printf '%s\n' "$TAG"
  for l in "${LINES[@]}"; do printf '%s\n' "$l"; done
  printf '%s\n' "${TAG}-END"
} | crontab -

echo "✅ Installed ${#LINES[@]} UNIBET360 cron entries (BASE_URL=${BASE_URL})."
echo "   Verify with: crontab -l"
