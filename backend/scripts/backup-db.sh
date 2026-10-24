#!/usr/bin/env bash
# Full backup before any schema-changing deploy (SaaS conversion phases etc.):
#   - MySQL dump of the shop database (single transaction → consistent without locking tables)
#   - uploads/ folder (photos) as a tar.gz
# Both land in ~/db-backups on the server (outside the git checkout) and are verified after writing.
# Old backups beyond the newest 14 of each kind are pruned.
#
# Usage on the server:   bash /var/www/stock-system/backend/scripts/backup-db.sh [label]
#   label (optional) shows up in the file name, e.g. "pre-saas-phase1"
set -euo pipefail

DB_NAME="${DB_NAME:-champpower-stock2}"
APP_DIR="${APP_DIR:-/var/www/stock-system}"
OUT_DIR="${OUT_DIR:-$HOME/db-backups}"
LABEL="${1:-manual}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

DUMP="$OUT_DIR/${DB_NAME}.${LABEL}.${STAMP}.sql.gz"
echo "dumping database $DB_NAME ..."
sudo mysqldump --single-transaction --routines --triggers --default-character-set=utf8mb4 "$DB_NAME" | gzip -9 > "$DUMP"

# a good dump ends with the mysqldump footer; a truncated one does not
if ! gunzip -c "$DUMP" | tail -n 3 | grep -q "Dump completed"; then
  echo "ERROR: dump looks incomplete: $DUMP" >&2
  exit 1
fi

if [ -d "$APP_DIR/backend/uploads" ]; then
  UPLOADS="$OUT_DIR/uploads.${LABEL}.${STAMP}.tar.gz"
  echo "archiving uploads ..."
  tar -czf "$UPLOADS" -C "$APP_DIR/backend" uploads
  tar -tzf "$UPLOADS" > /dev/null
fi

# keep the newest 14 of each kind
ls -1t "$OUT_DIR"/"${DB_NAME}".*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$OUT_DIR"/uploads.*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f

echo "OK"
ls -lh "$DUMP" ${UPLOADS:+"$UPLOADS"}
echo "row counts (sanity check):"
sudo mysql -N -e "SELECT 'customers', COUNT(*) FROM customers UNION ALL SELECT 'quotations', COUNT(*) FROM quotations UNION ALL SELECT 'receipts', COUNT(*) FROM receipts UNION ALL SELECT 'jobs', COUNT(*) FROM jobs UNION ALL SELECT 'stock_items', COUNT(*) FROM stock_items;" "$DB_NAME"
