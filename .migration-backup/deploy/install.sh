#!/usr/bin/env bash
#
# ⚡ VoltBet — one-command VPS installer (Ubuntu 22.04 / 24.04)
# ===================================================================
#   Installs everything a buyer needs to run VoltBet on their own VPS:
#   Node 22 + pnpm + PostgreSQL + Nginx + PM2 + SSL + firewall + the 4
#   cron jobs — then prints the admin login and next steps.
#
#   RAILWAY-SAFE: this script lives in deploy/ and touches ONLY this
#   server. It never pushes, never modifies app code, never changes
#   Railway env vars or the Railway deployment. Your Railway instance
#   is completely unaffected.
#
# Usage:
#   bash install.sh                          # interactive (prompts)
#   DOMAIN=bet.example.com ODDS_API_KEY=xxx \
#     SITE_NAME="MyBet" BRAND_COLOR="#00c853" bash install.sh   # non-interactive
#
# Env overrides (all optional):
#   GIT_URL        repo to deploy (default: the public VoltBet repo)
#   INSTALL_DIR    app directory (default: /var/www/voltsbet)
#   APP_PORT       internal port (default: 3000)
#   SITE_NAME      brand name shown in the header
#   BRAND_COLOR    primary brand color, hex e.g. #00e676
#   ODDS_API_KEY   The Odds API key (required for odds; can add later)
#   ADMIN_PASSWORD new admin password (auto-generated if empty)
#   NO_SSL=1       skip certbot (dev / IP-only installs)
# ===================================================================
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────
GIT_URL="${GIT_URL:-https://github.com/ashyamctommy-eng/Voltsbet.git}"
INSTALL_DIR="${INSTALL_DIR:-/var/www/voltsbet}"
APP_PORT="${APP_PORT:-3000}"
APP_USER="voltsbet"
DB_NAME="voltsbet"
DB_USER="voltsbet"
LOG_DIR="/var/log/voltsbet"
ADMIN_EMAIL="admin@voltbet.test"

# ── Helpers ───────────────────────────────────────────────────────────
log()  { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

ask() { # ask <var_name> <prompt> <default>
  local __v="$1" __p="$2" __d="${3:-}"
  if [ -n "${!__v:-}" ]; then return 0; fi
  if [ -n "$__d" ]; then
    read -r -p "$__p [$__d]: " "$__v"
    eval "$__v=\"\${$__v:-$__d}\""
  else
    read -r -p "$__p: " "$__v"
    [ -n "${!__v:-}" ] || die "$__p cannot be empty."
  fi
}

# ── 0. Preflight ──────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash install.sh"
command -v apt-get >/dev/null || die "This installer supports Ubuntu/Debian (apt)."
command -v git >/dev/null || true

log "VoltBet VPS installer starting — this machine will run a fresh copy."
log "Your Railway deployment is untouched (additive files only)."

SITE_NAME="${SITE_NAME:-}"
BRAND_COLOR="${BRAND_COLOR:-}"
ODDS_API_KEY="${ODDS_API_KEY:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
DOMAIN="${DOMAIN:-}"
ask DOMAIN "Site domain (e.g. bet.example.com — empty = IP only)" ""
ask SITE_NAME "Site name (branding)" "VoltBet"
ask BRAND_COLOR "Primary brand color (hex)" "#00e676"
ask ODDS_API_KEY "The Odds API key (https://the-odds-api.com — empty = add later)" "SKIP"
[ "$ODDS_API_KEY" = "SKIP" ] && ODDS_API_KEY=""

# ── 1. System packages ────────────────────────────────────────────────
log "Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl wget git ca-certificates gnupg lsb-release ufw fail2ban \
  nginx postgresql postgresql-contrib certbot python3-certbot-nginx \
  build-essential

# ── 2. Node 22 + pnpm ─────────────────────────────────────────────────
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  log "Installing Node 22 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm@latest >/dev/null 2>&1 || npm install -g pnpm

# ── 3. App user ───────────────────────────────────────────────────────
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi

# ── 4. Code ───────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing install at $INSTALL_DIR…"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Cloning $GIT_URL → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$GIT_URL" "$INSTALL_DIR"
  chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"
fi

# ── 5. PostgreSQL ─────────────────────────────────────────────────────
DB_PASS="$(openssl rand -hex 16)"
if ! su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
  log "Creating database role + database…"
  su - postgres -c "psql -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';\""
  su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""
else
  warn "Database role '$DB_USER' already exists — reusing it."
  warn "If you forgot the password, check $INSTALL_DIR/.env (DATABASE_URL)."
fi
DB_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME"

# ── 6. .env (NEVER clobbers an existing file) ─────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  warn "$ENV_FILE already exists — keeping it. Remove it to regenerate."
else
  CRON_SECRET="$(openssl rand -hex 32)"
  APP_URL="http://127.0.0.1:$APP_PORT"
  [ -n "$DOMAIN" ] && APP_URL="https://$DOMAIN"
  log "Writing $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# VoltBet production environment — generated by deploy/install.sh
DATABASE_URL="$DB_URL"
NODE_ENV="production"
APP_URL="$APP_URL"
ODDS_API_KEY="$ODDS_API_KEY"
ODDS_API_REGIONS="us"
CRON_SECRET="$CRON_SECRET"
# SYNC_THROTTLE_MINUTES=60
# PURGE_MAX_AGE_HOURS=2
# Leave SHOW_SEEDED_GAMES unset in production (demo games hidden).
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# ── 7. Install, migrate, seed, build (as app user) ────────────────────
log "Installing dependencies + deploying schema (this takes a few minutes)…"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && '$(command -v pnpm)' install --frozen-lockfile 2>/dev/null || '$(command -v pnpm)' install"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && DATABASE_URL='$DB_URL' '$(command -v pnpm)' exec prisma migrate deploy"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && DATABASE_URL='$DB_URL' '$(command -v pnpm)' exec prisma db seed"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && NODE_ENV=production '$(command -v pnpm)' build"

# ── 8. Branding + admin password (per-client identity, DB-driven) ─────
log "Applying branding (site name + color) and resetting the admin password…"
[ -z "$ADMIN_PASSWORD" ] && ADMIN_PASSWORD="$(openssl rand -base64 12 | tr -d '/+=')"
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && DATABASE_URL='$DB_URL' node deploy/post-install.mjs '$SITE_NAME' '$BRAND_COLOR' '$ADMIN_EMAIL' '$ADMIN_PASSWORD'"
# ── 9. PM2 ────────────────────────────────────────────────────────────
if ! command -v pm2 >/dev/null; then
  log "Installing PM2…"
  npm install -g pm2
fi
log "Generating PM2 ecosystem + starting the app…"
cat > "$INSTALL_DIR/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [{
    name: "voltsbet",
    cwd: "$INSTALL_DIR",
    script: "npm",
    args: "start",
    env: { NODE_ENV: "production" },
    instances: 1,
    max_memory_restart: "600M",
    out_file: "$LOG_DIR/pm2.out.log",
    error_file: "$LOG_DIR/pm2.err.log",
  }],
};
EOF
chown "$APP_USER:$APP_USER" "$INSTALL_DIR/ecosystem.config.cjs"
mkdir -p "$LOG_DIR" /home/$APP_USER/.pm2 && chown -R "$APP_USER:$APP_USER" "$LOG_DIR" /home/$APP_USER/.pm2
su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && PM2_HOME=/home/$APP_USER/.pm2 '$(command -v pm2)' start ecosystem.config.cjs && PM2_HOME=/home/$APP_USER/.pm2 '$(command -v pm2)' save"
PM2_HOME="/home/$APP_USER/.pm2" "$(command -v pm2)" startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null 2>&1 || true

# Wait for the app to come up
for i in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT" && break
  sleep 2
done
curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT" || warn "App did not answer on port $APP_PORT yet — check: pm2 logs voltsbet"

# ── 10. Nginx + SSL ───────────────────────────────────────────────────
cat > /etc/nginx/sites-available/voltsbet <<EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/voltsbet /etc/nginx/sites-enabled/voltsbet
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

if [ -n "$DOMAIN" ] && [ "${NO_SSL:-0}" != "1" ]; then
  log "Issuing SSL certificate for $DOMAIN (certbot)…"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect || warn "certbot failed — run manually: certbot --nginx -d $DOMAIN"
fi

# ── 11. Firewall ──────────────────────────────────────────────────────
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ── 12. Cron jobs (VPS crontab — the built-in scheduler) ──────────────
log "Installing the 4 cron jobs for user $APP_USER…"
CRON_SECRET="$(grep -oP '^CRON_SECRET="?\K[^"]+' "$ENV_FILE")"
CRON_BASE="http://127.0.0.1:$APP_PORT/api/cron"
CRON_MARKER="# voltsbet-cron"
CRON_BLOCK=$(cat <<EOF
$CRON_MARKER
0 6 */3 * * curl -fsS -m 300 "$CRON_BASE/sync?secret=$CRON_SECRET" >> $LOG_DIR/cron-sync.log 2>&1
0 5 * * * curl -fsS -m 120 "$CRON_BASE/schedule?secret=$CRON_SECRET" >> $LOG_DIR/cron-schedule.log 2>&1
*/12 * * * * curl -fsS -m 120 "$CRON_BASE/settle?secret=$CRON_SECRET" >> $LOG_DIR/cron-settle.log 2>&1
0 0 * * * curl -fsS -m 120 "$CRON_BASE/purge?secret=$CRON_SECRET" >> $LOG_DIR/cron-purge.log 2>&1
$CRON_MARKER-end
EOF
)
CURRENT_CRON="$(crontab -u "$APP_USER" -l 2>/dev/null || true)"
if printf '%s' "$CURRENT_CRON" | grep -q "$CRON_MARKER"; then
  warn "Cron block already present — replacing it (idempotent re-run)."
  CURRENT_CRON="$(printf '%s\n' "$CURRENT_CRON" | sed "/$CRON_MARKER/,/$CRON_MARKER-end/d")"
fi
printf '%s\n%s\n' "$CURRENT_CRON" "$CRON_BLOCK" | crontab -u "$APP_USER" -
touch "$LOG_DIR"/cron-{sync,schedule,settle,purge}.log
chown -R "$APP_USER:$APP_USER" "$LOG_DIR"

cat > /etc/logrotate.d/voltsbet <<EOF
$LOG_DIR/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    copytruncate
}
EOF

# ── 13. Summary ───────────────────────────────────────────────────────
URL="$APP_URL"
[ -n "$DOMAIN" ] && URL="https://$DOMAIN"
echo
echo "══════════════════════════════════════════════════════════════"
echo "  ✅ VoltBet is LIVE on this VPS"
echo "══════════════════════════════════════════════════════════════"
echo "  Site:        $URL"
echo "  Admin:       $URL/admin   (email: $ADMIN_EMAIL)"
echo "  Admin pass:  $ADMIN_PASSWORD   ← change it after first login"
echo "  Brand:       $SITE_NAME · $BRAND_COLOR"
echo
echo "  App dir:     $INSTALL_DIR"
echo "  Env file:    $ENV_FILE (secrets — never share/commit)"
echo "  Logs:        $LOG_DIR/  ·  pm2 logs voltsbet"
echo "  Cron jobs:   crontab -u $APP_USER -l   (sync/schedule/settle/purge)"
echo
echo "  Next steps:"
echo "   1. Admin → API Settings: paste the BetsAPI host + key (DB-stored)."
echo "   2. Admin → Website Settings: payments (NOWPayments / M-Pesa)."
echo "   3. Run sync once:  curl -s \"http://127.0.0.1:$APP_PORT/api/cron/sync?secret=$CRON_SECRET\""
echo "   4. Set DNS: point $DOMAIN → this server's IP (done? SSL is live)."
echo "   5. Backups: run deploy/backup.sh daily (cron) or add your own pg_dump."
echo
echo "  ── Developer contact (installation support) ──"
echo "    ✈️  Telegram:  https://t.me/Poriot_ke"
echo "    💬  WhatsApp:  https://wa.me/254717702563"
echo "══════════════════════════════════════════════════════════════"
