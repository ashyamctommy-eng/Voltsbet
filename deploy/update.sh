#!/usr/bin/env bash
#
# VoltBet — update script (run on the VPS to pull a new version + rebuild)
# ===================================================================
#   git pull → install deps → migrate → build → restart PM2
#   Safe to run at any time; the site is briefly unavailable during the
#   rebuild (~1-2 min). Run as root (or with sudo).
#
# Usage:  bash deploy/update.sh
# ===================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/var/www/voltsbet}"
APP_USER="${APP_USER:-voltsbet}"

log()  { printf '\033[1;32m[update]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[update]\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$INSTALL_DIR/.git" ] || die "No git repo at $INSTALL_DIR — is the app installed?"
id "$APP_USER" >/dev/null 2>&1 || die "App user '$APP_USER' missing."

log "1/5 Pulling latest code…"
git -C "$INSTALL_DIR" pull --ff-only

log "2/5 Installing dependencies…"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && '$(command -v pnpm)' install --frozen-lockfile 2>/dev/null || '$(command -v pnpm)' install"

log "3/5 Applying schema migrations (if any)…"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && set -a && . ./.env && set +a && '$(command -v pnpm)' exec prisma migrate deploy"

log "4/5 Building production bundle…"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && NODE_ENV=production '$(command -v pnpm)' build"

log "5/5 Restarting the app (PM2)…"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && PM2_HOME=/home/$APP_USER/.pm2 '$(command -v pm2)' restart voltsbet"

echo
log "✅ Update complete — $INSTALL_DIR is live."
log "   Check: pm2 logs voltsbet   ·   Site: https://your-domain"
