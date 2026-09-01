#!/usr/bin/env bash
# VoltBet MySQL deployment helper (CloudPanel / VPS with MySQL/MariaDB).
# Swaps the repo to the MySQL variant, then migrates + seeds + builds.
# Run from the app root on the server:  bash deploy-mysql.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Using MySQL schema"
cp prisma/schema.mysql.prisma prisma/schema.prisma

echo "→ Switching migration set"
rm -rf prisma/migrations
cp -r prisma/migrations.mysql prisma/migrations
cp prisma/migration_lock.mysql.toml prisma/migrations/migration_lock.toml

echo "→ Installing deps"
pnpm install --frozen-lockfile || pnpm install

echo "→ Migrating (creates all tables)"
npx prisma migrate deploy

echo "→ Seeding demo data"
npx prisma db seed || true

echo "→ Building production bundle"
pnpm build

echo "✅ Done. Start with: pm2 start start.js --name voltbet (or systemd)"
