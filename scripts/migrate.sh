#!/bin/bash

# Apply pending migrations to one environment.
#
# Usage:
#   ./scripts/migrate.sh production
#   ./scripts/migrate.sh preview            # staging
#   ./scripts/migrate.sh --url "postgres://..."
#   ./scripts/migrate.sh preview --dry-run  # list what would run, change nothing
#
# Every migrations/*.sql not recorded in schema_migrations is applied in
# filename order and then recorded. Each file is written to be re-runnable, so
# a partially-applied environment converges rather than erroring.
#
# Prerequisites: vercel CLI logged in (unless --url), psql installed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/migrations"

ENVIRONMENT=""
DB_URL=""
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --url) DB_URL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    production|preview|development) ENVIRONMENT="$1"; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$DB_URL" ]; then
  if [ -z "$ENVIRONMENT" ]; then
    echo "Usage: ./scripts/migrate.sh <production|preview> [--dry-run]"
    echo "   or: ./scripts/migrate.sh --url \"postgres://...\" [--dry-run]"
    exit 1
  fi
  ENV_FILE="$(mktemp)"
  trap 'rm -f "$ENV_FILE"' EXIT
  echo "Fetching $ENVIRONMENT credentials from Vercel..."
  vercel env pull --environment="$ENVIRONMENT" "$ENV_FILE" --yes > /dev/null 2>&1
  DB_URL="$(grep '^NEON_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
fi

if [ -z "$DB_URL" ]; then
  echo "Could not resolve a database URL."
  exit 1
fi

# Name the target so a mistaken run against production is visible before it
# starts, not after.
TARGET="$(psql "$DB_URL" -tAc "SELECT current_database() || ' @ ' || inet_server_addr()")"
echo "Target: $TARGET"
$DRY_RUN && echo "(dry run -- nothing will be applied)"
echo ""

# Applied-status is checked per file rather than read once up front, because
# 000-schema-migrations.sql is what CREATES schema_migrations: a list read
# before it runs would be empty, and every already-applied migration would be
# re-run despite the backfill. Sorting puts 000 first, and by the time 001 is
# considered the table exists and the backfill has been recorded.
is_applied() {
  [ "$(psql "$DB_URL" -tAc \
        "SELECT 1 FROM schema_migrations WHERE filename = '$1'" 2>/dev/null || true)" = "1" ]
}

PENDING=0
for path in "$MIGRATIONS_DIR"/*.sql; do
  file="$(basename "$path")"
  if is_applied "$file"; then
    printf "  skip   %s\n" "$file"
    continue
  fi
  PENDING=$((PENDING + 1))
  if $DRY_RUN; then
    printf "  PENDING %s\n" "$file"
    continue
  fi
  printf "  apply  %s\n" "$file"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$path"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO schema_migrations (filename) VALUES ('$file') ON CONFLICT DO NOTHING;"
done

echo ""
if [ "$PENDING" -eq 0 ]; then
  echo "Already up to date."
elif $DRY_RUN; then
  echo "$PENDING migration(s) pending."
else
  echo "Applied $PENDING migration(s)."
fi
