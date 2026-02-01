#!/bin/bash

# Backup production database
# Usage: ./scripts/backup-prod.sh

set -e

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$HOME/school-scheduler-backups"
BACKUP_FILE="$BACKUP_DIR/prod_backup_$TIMESTAMP.sql"

mkdir -p "$BACKUP_DIR"

echo "========================================"
echo "Production Database Backup"
echo "========================================"
echo ""

# Pull credentials from Vercel
echo "Fetching credentials from Vercel..."
vercel env pull --environment=production .env.prod.tmp --yes > /dev/null 2>&1

# Extract connection info
PROD_HOST=$(grep POSTGRES_URL_NON_POOLING .env.prod.tmp | sed 's/.*@\([^:]*\):.*/\1/')
PROD_USER=$(grep POSTGRES_URL_NON_POOLING .env.prod.tmp | sed 's/.*\/\/\([^:]*\):.*/\1/')
PROD_PASS=$(grep POSTGRES_PASSWORD .env.prod.tmp | cut -d'"' -f2)

echo "Production: $PROD_HOST"
echo "Backup to: $BACKUP_FILE"
echo ""

echo "Dumping production data..."
PGPASSWORD="$PROD_PASS" pg_dump \
  -h "$PROD_HOST" \
  -p 5432 \
  -U "$PROD_USER" \
  -d postgres \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-privileges \
  -t teachers \
  -t grades \
  -t subjects \
  -t quarters \
  -t rules \
  -t study_hall_groups \
  -t classes \
  -t restrictions \
  -t schedule_generations \
  > "$BACKUP_FILE"

echo ""
echo "Backup complete: $(wc -l < "$BACKUP_FILE") lines"
echo "Location: $BACKUP_FILE"

# Cleanup
rm -f .env.prod.tmp

echo ""
echo "========================================"
echo "Done!"
echo "========================================"
