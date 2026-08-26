#!/usr/bin/env bash
#
# VoltBet — database + env backup script (VPS)
# ===================================================================
#   pg_dump of the app database + a copy of .env (secrets), kept 7 days.
#   Run daily. Add to the voltsbet user's crontab:
#
#     0 3 * * * bash /var/www/voltsbet/deploy/backup.sh >> /var/log/voltsbet/backup.log 2>&1
#
#   Restore (if disaster strikes):
#     gunzip -c /var/backups/voltsbet/db-YYYYMMDD-HHMMSS.sql.gz | psql "$DATABASE_URL"
#   (DATABASE_URL is in /var/www/voltsbet/.env)
# ===================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/var/www/voltsbet}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/voltsbet}"
KEEP_DAYS="${KEEP_DAYS:-7}"

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] %s\n' "$*" >&2; exit 1; }

ENV_FILE="$INSTALL_DIR/.env"
[ -f "$ENV_FILE" ] || die "No .env at $ENV_FILE — nothing to back up."

# Read DATABASE_URL out of .env (quoted or not).
DB_URL="$(grep -oP '^DATABASE_URL="?\K[^"]+' "$ENV_FILE" || true)"
[ -n "$DB_URL" ] || die "DATABASE_URL not found in $ENV_FILE."

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz"
ENV_FILE_BACKUP="$BACKUP_DIR/env-$STAMP.txt"

log "Dumping database → $DB_FILE"
pg_dump "$DB_URL" | gzip > "$DB_FILE"

log "Copying env → $ENV_FILE_BACKUP"
cp "$ENV_FILE" "$ENV_FILE_BACKUP"
chmod 600 "$ENV_FILE_BACKUP"

log "Pruning backups older than ${KEEP_DAYS} days…"
find "$BACKUP_DIR" -name "db-*.sql.gz" -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name "env-*.txt" -mtime "+$KEEP_DAYS" -delete

SIZE="$(du -h "$DB_FILE" | cut -f1)"
log "✅ Backup complete: $DB_FILE ($SIZE)"

echo "   Restore:  gunzip -c $DB_FILE | psql \"\$DATABASE_URL\""
