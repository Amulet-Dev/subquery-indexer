#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# === Configuration ===
SERVICE="${SERVICE:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-postgres}"
SCHEMA="${SCHEMA:-multi-transfers}"
RETENTION_DAYS="${RETENTION_DAYS:-5}"
LOG_FILE="${LOG_FILE:-$HOME/purge-pool-positions.log}"

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }
trap 'echo "$(timestamp) [ERROR] Script failed at line $LINENO" >> "$LOG_FILE"' ERR

echo "$(timestamp) [INFO] Starting purge-pool-positions (retention: ${RETENTION_DAYS} days)" >> "$LOG_FILE"
echo "$(timestamp) [INFO] Counting rows to delete..." >> "$LOG_FILE"

ROW_COUNT=$(docker compose exec -T "$SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -A -t <<EOF
SELECT COUNT(*)
  FROM "${SCHEMA}".pool_positions
 WHERE closed_at IS NOT NULL
   AND closed_at < NOW() - INTERVAL '${RETENTION_DAYS} days';
EOF
)

echo "$(timestamp) [INFO] Found ${ROW_COUNT} rows to delete" >> "$LOG_FILE"
echo "$(timestamp) [INFO] Deleting old rows..." >> "$LOG_FILE"

docker compose exec -T "$SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -e <<EOF
BEGIN;
DELETE FROM "${SCHEMA}".pool_positions
 WHERE closed_at IS NOT NULL
   AND closed_at < NOW() - INTERVAL '${RETENTION_DAYS} days';
COMMIT;
EOF

echo "$(timestamp) [INFO] Deleted old rows, now running VACUUM ANALYZE outside transaction..." >> "$LOG_FILE"
docker compose exec -T "$SERVICE" \
    psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -e <<EOF
VACUUM ANALYZE "${SCHEMA}".pool_positions;
EOF

echo "$(timestamp) [INFO] Deleted and vacuumed table pool_positions" >> "$LOG_FILE"

echo "$(timestamp) [INFO] Running pg_repack to shrink table file" >> "$LOG_FILE"
docker compose exec -i "$SERVICE" \
  pg_repack \
    --table="${SCHEMA}.pool_positions" \
    --dbname="$DB_NAME" \
    --tablespace=pg_default \
    --host=localhost \
    --username="$DB_USER" \
    --no-order \
    --no-analyze \
    --no-superuser-check

if [ $? -eq 0 ]; then
  echo "$(timestamp) [INFO] pg_repack completed successfully" >> "$LOG_FILE"
else
  echo "$(timestamp) [ERROR] pg_repack encountered an error" >> "$LOG_FILE"
fi

echo "$(timestamp) [INFO] purge-pool-positions completed successfully" >> "$LOG_FILE"
