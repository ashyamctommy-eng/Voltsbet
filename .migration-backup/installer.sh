#!/usr/bin/env bash
# ===================================================================
# ⚡ VoltBet — root automated VPS installer (Ubuntu / Debian)
# -------------------------------------------------------------------
# One command takes a bare Linux VPS to a running sportsbook:
#
#   1. Installs dependencies (Node.js LTS, PM2, PostgreSQL, Nginx, Certbot)
#   2. Interactive setup: domain, DB credentials, THE_ODDS_API_KEY,
#      Telegram bot token, initial Super Admin credentials
#   3. Writes a sanitized .env
#   4. npm install → prisma migrate deploy → prisma db seed → npm run build
#   5. PM2 (ecosystem.config.js) bootstrap + boot persistence
#   6. Nginx reverse proxy (80/443 → local app port)
#   7. Certbot Let's Encrypt SSL when a valid domain is present
#
# Usage:
#   sudo bash installer.sh                     # interactive
#   DOMAIN=bet.example.com THE_ODDS_API_KEY=xxx \
#     ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='S3cret!' \
#     sudo -E bash installer.sh                # non-interactive
#
# Env overrides (all optional):
#   GIT_URL         repo to deploy (default: the public VoltBet repo)
#   INSTALL_DIR     app directory        (default: /var/www/voltsbet)
#   APP_PORT        internal app port    (default: 3000)
#   DB_NAME/DB_USER/DB_PASSWORD / DB_HOST / DB_PORT
#   TELEGRAM_BOT_TOKEN   bot token from @BotFather (empty = configure later)
#   NO_SSL=1        skip certbot (dev / IP-only installs)
#   SKIP_DB_CREATE=1 use the given DB credentials as-is (managed Postgres)
# ===================================================================
set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────
log()  { printf '\033[1;32m[installer]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

ask() { # ask <var> <prompt> [default] [secret]
  local __v="$1" __p="$2" __d="${3:-}" __s="${4:-}"
  [ -n "${!__v:-}" ] && return 0
  local __read=(read -r)
  [ "$__s" = "secret" ] && __read=(read -r -s)
  if [ -n "$__d" ]; then
    "${__read[@]}" -p "$__p [$__d]: " "$__v"
  else
    "${__read[@]}" -p "$__p: " "$__v"
  fi
  [ "$__s" = "secret" ] && printf '\n'
  eval "$__v=\"\${$__v:-$__d}\""
}

sanitize() { # sanitize <value> — strip chars that would break a .env line
  printf '%s' "$1" | tr -d '\r\n' | sed 's/["`$\\]//g'
}

rand() { openssl rand -hex "${1:-16}"; }

# ── 0. Preflight ──────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash installer.sh"
command -v apt-get >/dev/null || die "This installer supports Ubuntu/Debian (apt-get) only."
export DEBIAN_FRONTEND=noninteractive

# ── Config ────────────────────────────────────────────────────────────
GIT_URL="${GIT_URL:-https://github.com/ashyamctommy-eng/Voltsbet.git}"
INSTALL_DIR="${INSTALL_DIR:-/var/www/voltsbet}"
APP_PORT="${APP_PORT:-3000}"
APP_USER="voltsbet"
LOG_DIR="/var/log/voltsbet"

log "VoltBet VPS installer — target: $INSTALL_DIR (port $APP_PORT)"

# ── 1. Interactive setup ─────────────────────────────────────────────
DOMAIN="${DOMAIN:-}"
THE_ODDS_API_KEY="${THE_ODDS_API_KEY:-${ODDS_API_KEY:-}}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
DB_NAME="${DB_NAME:-voltsbet}"
DB_USER="${DB_USER:-voltsbet}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

ask DOMAIN "Site domain (e.g. bet.example.com — empty = IP only, no SSL)" ""
ask DB_NAME "PostgreSQL database name" "voltsbet"
ask DB_USER "PostgreSQL user" "voltsbet"
if [ -z "$DB_PASSWORD" ]; then
  if [ -t 0 ]; then
    ask DB_PASSWORD "PostgreSQL password (empty = auto-generate)" "$(rand 16)" secret
  else
    DB_PASSWORD="$(rand 16)"
  fi
fi
ask THE_ODDS_API_KEY "The Odds API key (https://the-odds-api.com — empty = add later)" ""
ask TELEGRAM_BOT_TOKEN "Telegram bot token from @BotFather (empty = configure later)" ""
ask ADMIN_USERNAME "Super Admin username" "admin"
ask ADMIN_EMAIL "Super Admin email" "admin@${DOMAIN:-voltbet.local}"
if [ -z "$ADMIN_PASSWORD" ]; then
  if [ -t 0 ]; then
    ask ADMIN_PASSWORD "Super Admin password (empty = auto-generate)" "$(rand 9)" secret
  else
    ADMIN_PASSWORD="$(rand 9)"
  fi
fi

# Sanitized values destined for .env (quotes/backticks/$ stripped)
DB_NAME="$(sanitize "$DB_NAME")"; DB_USER="$(sanitize "$DB_USER")"
DB_PASSWORD="$(sanitize "$DB_PASSWORD")"; DB_HOST="$(sanitize "$DB_HOST")"; DB_PORT="$(sanitize "$DB_PORT")"
THE_ODDS_API_KEY="$(sanitize "$THE_ODDS_API_KEY")"; TELEGRAM_BOT_TOKEN="$(sanitize "$TELEGRAM_BOT_TOKEN")"
DOMAIN="$(sanitize "$DOMAIN")"; ADMIN_EMAIL="$(sanitize "$ADMIN_EMAIL")"; ADMIN_USERNAME="$(sanitize "$ADMIN_USERNAME")"

APP_URL="http://127.0.0.1:${APP_PORT}"
[ -n "$DOMAIN" ] && APP_URL="https://${DOMAIN}"
CRON_SECRET="$(rand 32)"

# ── 2. System dependencies ───────────────────────────────────────────
log "Installing system packages (PostgreSQL, Nginx, Certbot, toolchain)…"
apt-get update -y
apt-get install -y --no-install-recommends \
  curl wget git ca-certificates gnupg openssl ufw \
  nginx postgresql postgresql-contrib certbot python3-certbot-nginx \
  build-essential

# Node.js LTS (22.x via NodeSource) — skip if a v22+ runtime already exists
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
  log "Installing Node.js LTS (22.x)…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "Node $(node --version) / npm $(npm --version)"

if ! command -v pm2 >/dev/null; then
  log "Installing PM2…"
  npm install -g pm2
fi

# ── 3. App user + code checkout ───────────────────────────────────────
id "$APP_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$APP_USER"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing install…"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Cloning $GIT_URL → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$GIT_URL" "$INSTALL_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$INSTALL_DIR"

# ── 4. PostgreSQL role + database ────────────────────────────────────
if [ "${SKIP_DB_CREATE:-0}" != "1" ]; then
  systemctl enable --now postgresql
  if su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
    warn "DB role '$DB_USER' exists — aligning password with this install."
    su - postgres -c "psql -c \"ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';\""
  else
    log "Creating DB role '$DB_USER'…"
    su - postgres -c "psql -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';\""
  fi
  su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 \
    || su - postgres -c "psql -c \"CREATE DATABASE $DB_NAME OWNER $DB_USER;\""
fi
DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# ── 5. Sanitized .env ────────────────────────────────────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ] && [ "${FORCE_ENV:-0}" != "1" ]; then
  warn "$ENV_FILE already exists — keeping it (FORCE_ENV=1 to regenerate)."
  DB_URL="$(grep -oP '^DATABASE_URL="?\K[^"]+' "$ENV_FILE" || echo "$DB_URL")"
  CRON_SECRET="$(grep -oP '^CRON_SECRET="?\K[^"]+' "$ENV_FILE" || echo "$CRON_SECRET")"
else
  log "Writing $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
# VoltBet production environment — generated by installer.sh ($(date -u +%FT%TZ))
DATABASE_URL="${DB_URL}"
NODE_ENV="production"
APP_URL="${APP_URL}"
ODDS_API_KEY="${THE_ODDS_API_KEY}"
ODDS_API_REGIONS="us"
CRON_SECRET="${CRON_SECRET}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
# ENABLE_MPESA_WITHDRAWALS="false"
# SYNC_THROTTLE_MINUTES=60
EOF
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# Run app steps as the unprivileged app user
as_app() { su -s /bin/bash "$APP_USER" -c "export HOME=/home/$APP_USER && cd '$INSTALL_DIR' && $*"; }

# ── 6. Dependencies → migrations → seed → build ──────────────────────
log "Installing production dependencies (npm install)…"
as_app "npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund"

log "Running Prisma migrations…"
as_app "DATABASE_URL='${DB_URL}' npx prisma migrate deploy"

log "Seeding initial data (sports, statuses, admin)…"
as_app "DATABASE_URL='${DB_URL}' npx prisma db seed"

log "Building the Next.js production bundle…"
as_app "DATABASE_URL='${DB_URL}' NODE_ENV=production npm run build"

# ── 6b. Branding + Super Admin credentials + Telegram ────────────────
log "Applying Super Admin credentials (${ADMIN_EMAIL})…"
as_app "DATABASE_URL='${DB_URL}' TELEGRAM_BOT_TOKEN='${TELEGRAM_BOT_TOKEN}' node deploy/post-install.mjs '' '' '$ADMIN_EMAIL' '$ADMIN_PASSWORD' '$ADMIN_USERNAME'"

# ── 7. PM2 bootstrap ─────────────────────────────────────────────────
log "Generating ecosystem.config.js and starting under PM2…"
cat > "$INSTALL_DIR/ecosystem.config.js" <<EOF
module.exports = {
  apps: [{
    name: "voltsbet",
    cwd: "$INSTALL_DIR",
    script: "npm",
    args: "start",
    env: { NODE_ENV: "production", PORT: "$APP_PORT" },
    instances: 1,
    max_memory_restart: "600M",
    out_file: "$LOG_DIR/pm2.out.log",
    error_file: "$LOG_DIR/pm2.err.log",
  }],
};
EOF
chown "$APP_USER:$APP_USER" "$INSTALL_DIR/ecosystem.config.js"
mkdir -p "$LOG_DIR" "/home/$APP_USER/.pm2" && chown -R "$APP_USER:$APP_USER" "$LOG_DIR" "/home/$APP_USER/.pm2"
as_app "PM2_HOME=/home/$APP_USER/.pm2 pm2 start ecosystem.config.js && PM2_HOME=/home/$APP_USER/.pm2 pm2 save"
PM2_HOME="/home/$APP_USER/.pm2" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null 2>&1 || true

# Wait for the app to answer
for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT" && break || sleep 2; done
curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT" || warn "App not answering on :$APP_PORT yet — check: pm2 logs voltsbet"

# ── 8. Nginx reverse proxy ───────────────────────────────────────────
log "Configuring Nginx (80/443 → 127.0.0.1:$APP_PORT)…"
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
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
ln -sf /etc/nginx/sites-available/voltsbet /etc/nginx/sites-enabled/voltsbet
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 9. Certbot SSL (valid domain only) ───────────────────────────────
if [ -n "$DOMAIN" ] && [ "${NO_SSL:-0}" != "1" ]; then
  log "Provisioning Let's Encrypt SSL for $DOMAIN…"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN" --redirect \
    || warn "certbot failed — point DNS at this server, then: certbot --nginx -d $DOMAIN"
fi

# ── 10. Firewall ─────────────────────────────────────────────────────
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# ── 11. Cron jobs ────────────────────────────────────────────────────
log "Installing cron jobs (sync / schedule / settle / purge)…"
CRON_BASE="http://127.0.0.1:$APP_PORT/api/cron"
MARK="# voltsbet-cron"
BLOCK=$(cat <<EOF
$MARK
0 6 */3 * * curl -fsS -m 300 "$CRON_BASE/sync?secret=$CRON_SECRET" >> $LOG_DIR/cron-sync.log 2>&1
0 5 * * * curl -fsS -m 120 "$CRON_BASE/schedule?secret=$CRON_SECRET" >> $LOG_DIR/cron-schedule.log 2>&1
*/12 * * * * curl -fsS -m 120 "$CRON_BASE/settle?secret=$CRON_SECRET" >> $LOG_DIR/cron-settle.log 2>&1
0 0 * * * curl -fsS -m 120 "$CRON_BASE/purge?secret=$CRON_SECRET" >> $LOG_DIR/cron-purge.log 2>&1
$MARK-end
EOF
)
CUR="$(crontab -u "$APP_USER" -l 2>/dev/null || true)"
printf '%s\n' "$CUR" | grep -q "$MARK" && CUR="$(printf '%s\n' "$CUR" | sed "/$MARK/,/$MARK-end/d")"
printf '%s\n%s\n' "$CUR" "$BLOCK" | crontab -u "$APP_USER" -

cat > /etc/logrotate.d/voltsbet <<EOF
$LOG_DIR/*.log { daily rotate 7 compress missingok notifempty copytruncate }
EOF

# ── 12. Summary ──────────────────────────────────────────────────────
echo
echo "══════════════════════════════════════════════════════════════"
echo "  ✅ VoltBet is LIVE"
echo "══════════════════════════════════════════════════════════════"
echo "  Site:         $APP_URL"
echo "  Admin panel:  $APP_URL/admin"
echo "  Super Admin:  $ADMIN_EMAIL  (user: $ADMIN_USERNAME)"
echo "  Password:     $ADMIN_PASSWORD   ← change it after first login"
echo
echo "  App dir:      $INSTALL_DIR"
echo "  Env file:     $ENV_FILE (secrets — never share or commit)"
echo "  Logs:         $LOG_DIR/ · pm2 logs voltsbet"
echo
echo "  Next steps:"
echo "   1. Admin → Website Settings → Telegram Bot: verify bot token,"
echo "      set bot username + webhook secret, then register the webhook:"
echo "      curl 'https://api.telegram.org/bot<TOKEN>/setWebhook' \\"
echo "        -d url='$APP_URL/api/webhooks/telegram' -d secret_token='<secret>'"
echo "   2. Admin → Website Settings → Payments: NOWPayments / M-Pesa."
echo "   3. Trigger a first odds sync:"
echo "      curl -s '$CRON_BASE/sync?secret=$CRON_SECRET'"
echo "══════════════════════════════════════════════════════════════"
