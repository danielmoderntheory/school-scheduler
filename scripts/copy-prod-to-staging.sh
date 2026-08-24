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

# Extract connection info.
# Take the whole connection URL and hand it straight to pg_dump/psql rather
# than picking it apart into host/user/password. The old version scraped those
# out with a sed that assumed an "@host:port" shape; Neon's URLs carry no port,
# so the pattern silently failed to substitute and PROD_HOST became the entire
# env line. Passing the URL through also keeps the password out of argv and out
# of anything this script prints.
url_for() {
  # Prefer the unpooled URL: pg_dump and a bulk restore want a direct session,
  # not the pooler. Fall back to whichever URL the env actually carries.
  local file="$1" key
  for key in NEON_POSTGRES_URL_NON_POOLING NEON_DATABASE_URL_UNPOOLED \
             POSTGRES_URL_NON_POOLING NEON_DATABASE_URL POSTGRES_URL; do
    local v
    v="$(grep -m1 "^${key}=" "$file" | cut -d= -f2- | tr -d '"' || true)"
    if [ -n "$v" ]; then echo "$v"; return 0; fi
  done
  return 1
}

# Host only — never echo a URL, it carries the password.
host_of() { echo "$1" | sed -E 's#^[^@]*@([^/:?]+).*#\1#'; }

PROD_URL="$(url_for .env.prod.tmp)"      || { echo "No production database URL found."; exit 1; }
STAGING_URL="$(url_for .env.preview.tmp)" || { echo "No staging database URL found."; exit 1; }

PROD_HOST="$(host_of "$PROD_URL")"
STAGING_HOST="$(host_of "$STAGING_URL")"

if [ "$PROD_HOST" = "$STAGING_HOST" ]; then
  echo "REFUSING: staging and production resolve to the same host ($PROD_HOST)."
  exit 1
fi

echo "Production: $PROD_HOST"
echo "Staging:    $STAGING_HOST"
echo ""

DUMP_FILE="/tmp/school_scheduler_prod_dump.sql"
TEMPLATE_DUMP="/tmp/school_scheduler_prod_templates.sql"

# timetable_templates is dumped and restored on its own, ahead of everything
# else, for two reasons. It was missing from this script entirely, and each
# environment had independently created its own "26/27 9-Block" row with a
# different id -- so prod's current quarter pointed at a template id staging
# had never heard of, its insert failed the foreign key, and every class,
# restriction and schedule hanging off that quarter vanished with it. That is
# how staging came to be running a stale bell schedule. Restoring it in a
# separate pass also guarantees it lands before quarters, rather than relying
# on pg_dump's ordering of a multi-table data dump.
echo "Step 1: Dumping production data..."
pg_dump "$PROD_URL" \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-privileges \
  -t timetable_templates \
  > "$TEMPLATE_DUMP"

pg_dump "$PROD_URL" \
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

echo "Dump created: $(wc -l < "$DUMP_FILE") lines (+ $(wc -l < "$TEMPLATE_DUMP") for templates)"

echo ""
echo "Step 2: Clearing staging tables..."
psql "$STAGING_URL" -v ON_ERROR_STOP=1 \
  -c "TRUNCATE schedule_generations, restrictions, classes, study_hall_groups, rules, quarters, timetable_templates, subjects, grades, teachers CASCADE;"

echo ""
echo "Step 3: Importing data to staging..."
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -q -f "$TEMPLATE_DUMP"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP_FILE"

echo ""
echo "Step 4: Re-identifying staging schedules..."

# A dump/restore carries prod's schedule_generations UUIDs across verbatim, so
# /history/<id> would resolve to the SAME id on staging and on prod -- a shared
# link would be ambiguous, and a staging schedule indistinguishable from the
# real one. Give every copied schedule a fresh id, and record the prod id it
# came from in its notes so it can still be traced back.
#
# Safe to re-id: nothing has a foreign key to schedule_generations, and no
# generation stores its own or another generation's id inside options/stats.
# Postgres evaluates every SET expression against the OLD row, so id::text on
# the right-hand side is still the prod id while the left-hand side replaces it.
psql "$STAGING_URL" -v ON_ERROR_STOP=1 \
  -c "UPDATE schedule_generations
      SET notes = trim(both ' ' from
                    coalesce(notes || ' ', '') ||
                    '[staging copy of prod ' || left(id::text, 8) || ']'),
          id = gen_random_uuid();"

echo ""
echo "Step 5: Verifying counts..."
echo ""

TABLES="teachers grades subjects quarters timetable_templates classes restrictions rules study_hall_groups schedule_generations"

MISMATCH=0
printf "%-22s %10s %10s\n" "table" "prod" "staging"
for table in $TABLES; do
  prod_count=$(psql "$PROD_URL" -tAc "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ')
  stg_count=$(psql "$STAGING_URL" -tAc "SELECT COUNT(*) FROM $table;" 2>/dev/null | tr -d ' ')
  flag=""
  if [ "$prod_count" != "$stg_count" ]; then flag="  <-- MISMATCH"; MISMATCH=1; fi
  printf "%-22s %10s %10s%s\n" "$table:" "$prod_count" "$stg_count" "$flag"
done

if [ "$MISMATCH" -ne 0 ]; then
  echo ""
  echo "COPY INCOMPLETE: staging does not match production."
  echo "Rows were rejected during import -- scroll up for the errors."
  exit 1
fi

echo ""
echo "========================================"
echo "Database copy complete!"
echo "========================================"

# Cleanup
rm -f "$DUMP_FILE" "$TEMPLATE_DUMP" .env.prod.tmp .env.preview.tmp
