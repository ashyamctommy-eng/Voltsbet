#!/usr/bin/env bash
# UNIBET360 schema drift guard.
#
# Fails when prisma/schema.prisma (PostgreSQL, production) and
# prisma/schema.mysql.prisma (MySQL/MariaDB variant, deploy-mysql.sh) fall out
# of sync. MySQL deploys swap the MySQL schema + migrations in place, so a
# forgotten model/column/relation on one side breaks that deployment silently.
#
# The comparison ignores:
#   - comments (// and ///)  — the two files document the same models
#   - the datasource provider line (postgresql vs mysql is intentional)
#   - blank lines and trailing whitespace
#
# Run locally:  bash scripts/check-schema-sync.sh   (or: pnpm run check:schemas)
set -euo pipefail
cd "$(dirname "$0")/.."

normalize() {
  sed -E 's#^[[:space:]]*///?[[:space:]]*.*$##' "$1" \
    | sed -E 's#^[[:space:]]*(provider[[:space:]]*=[[:space:]]*)"(postgresql|mysql)"#\1"DIALECT"#' \
    | sed -E 's/[[:space:]]+$//' \
    | grep -vE '^[[:space:]]*$'
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if diff -u <(normalize prisma/schema.prisma) <(normalize prisma/schema.mysql.prisma) > "$tmp"; then
  echo "✅ Schemas in sync: prisma/schema.prisma matches prisma/schema.mysql.prisma"
else
  echo "❌ Schema drift detected — prisma/schema.prisma and prisma/schema.mysql.prisma differ."
  echo "   The MySQL variant must mirror the main schema (only provider + comments may differ)."
  echo "   Fix: update prisma/schema.mysql.prisma to match, and add any missing"
  echo "   migrations under prisma/migrations.mysql/ (see deploy-mysql.sh)."
  echo
  cat "$tmp"
  exit 1
fi
