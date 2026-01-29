#!/bin/bash

# Complete database copy from production to staging
# Usage: ./scripts/copy-prod-to-staging.sh
#
# Prerequisites:
#   - vercel CLI logged in
#   - pg_dump and psql installed

set -e

echo "========================================"
echo "Production to Staging Database Copy"
echo "========================================"
echo ""

# Pull credentials from Vercel
echo "Fetching credentials from Vercel..."
vercel env pull --environment=production .env.prod.tmp --yes > /dev/null 2>&1
vercel env pull --environment=preview .env.preview.tmp --yes > /dev/null 2>&1

# Extract connection info
PROD_HOST=$(grep POSTGRES_URL_NON_POOLING .env.prod.tmp | sed 's/.*@\([^:]*\):.*/\1/')
PROD_USER=$(grep POSTGRES_URL_NON_POOLING .env.prod.tmp | sed 's/.*\/\/\([^:]*\):.*/\1/')
PROD_PASS=$(grep POSTGRES_PASSWORD .env.prod.tmp | cut -d'"' -f2)

STAGING_HOST=$(grep POSTGRES_URL_NON_POOLING .env.preview.tmp | sed 's/.*@\([^:]*\):.*/\1/')
STAGING_USER=$(grep POSTGRES_URL_NON_POOLING .env.preview.tmp | sed 's/.*\/\/\([^:]*\):.*/\1/')
STAGING_PASS=$(grep POSTGRES_PASSWORD .env.preview.tmp | cut -d'"' -f2)

echo "Production: $PROD_HOST"
echo "Staging: $STAGING_HOST"
echo ""

DUMP_FILE="/tmp/school_scheduler_prod_dump.sql"

echo "Step 1: Dumping production data..."
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
  > "$DUMP_FILE"

echo "Dump created: $(wc -l < "$DUMP_FILE") lines"

echo ""
echo "Step 2: Clearing staging tables..."
PGPASSWORD="$STAGING_PASS" psql \
  -h "$STAGING_HOST" \
  -p 5432 \
  -U "$STAGING_USER" \
  -d postgres \
  -c "TRUNCATE schedule_generations, restrictions, classes, study_hall_groups, rules, quarters, subjects, grades, teachers CASCADE;"

echo ""
echo "Step 3: Importing data to staging..."
PGPASSWORD="$STAGING_PASS" psql \
  -h "$STAGING_HOST" \
  -p 5432 \
  -U "$STAGING_USER" \
  -d postgres \
  -f "$DUMP_FILE"

echo ""
echo "Step 4: Verifying counts..."
echo ""

TABLES="teachers grades subjects quarters classes restrictions rules study_hall_groups schedule_generations"

echo "=== Production counts ==="
for table in $TABLES; do
  count=$(PGPASSWORD="$PROD_PASS" psql -h "$PROD_HOST" -p 5432 -U "$PROD_USER" -d postgres -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ')
  printf "%-22s %s\n" "$table:" "$count"
done

echo ""
echo "=== Staging counts ==="
for table in $TABLES; do
  count=$(PGPASSWORD="$STAGING_PASS" psql -h "$STAGING_HOST" -p 5432 -U "$STAGING_USER" -d postgres -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ')
  printf "%-22s %s\n" "$table:" "$count"
done

echo ""
echo "========================================"
echo "Database copy complete!"
echo "========================================"

# Cleanup
rm -f "$DUMP_FILE" .env.prod.tmp .env.preview.tmp
