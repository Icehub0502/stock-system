#!/usr/bin/env bash
# Restore ONE deleted job (and its status history) from a database dump.
# The dump is loaded into a throw-away database; only the rows of that job are copied
# into the live database. Nothing else in the live database is touched.
#
# Usage on the server:   bash restore-job.sh <dump.sql.gz> <job_id>
set -euo pipefail

DUMP="${1:?dump file required}"
JOB_ID="${2:?job id required}"
DB_NAME="${DB_NAME:-champpower-stock2}"
TMP_DB="restore_tmp_job"

[[ "$JOB_ID" =~ ^[0-9]+$ ]] || { echo "job id must be a number" >&2; exit 1; }

EXISTS=$(sudo mysql -N -e "SELECT COUNT(*) FROM jobs WHERE id = $JOB_ID" "$DB_NAME")
if [ "$EXISTS" != "0" ]; then
  echo "job $JOB_ID already exists in $DB_NAME - nothing to restore" >&2
  exit 1
fi

echo "loading dump into temporary database $TMP_DB ..."
sudo mysql -e "DROP DATABASE IF EXISTS \`$TMP_DB\`; CREATE DATABASE \`$TMP_DB\` CHARACTER SET utf8mb4;"
gunzip -c "$DUMP" | sudo mysql --default-character-set=utf8mb4 "$TMP_DB"

FOUND=$(sudo mysql -N -e "SELECT COUNT(*) FROM jobs WHERE id = $JOB_ID" "$TMP_DB")
if [ "$FOUND" != "1" ]; then
  echo "job $JOB_ID not found in dump" >&2
  sudo mysql -e "DROP DATABASE \`$TMP_DB\`"
  exit 1
fi

# job_no must still be free in the live database (unique per shop)
CLASH=$(sudo mysql -N -e "SELECT COUNT(*) FROM \`$DB_NAME\`.jobs l JOIN \`$TMP_DB\`.jobs t ON t.shop_id = l.shop_id AND t.job_no = l.job_no WHERE t.id = $JOB_ID" )
if [ "$CLASH" != "0" ]; then
  echo "job_no of job $JOB_ID is already used in the live database" >&2
  sudo mysql -e "DROP DATABASE \`$TMP_DB\`"
  exit 1
fi

echo "restoring job $JOB_ID ..."
sudo mysql "$DB_NAME" <<SQL
START TRANSACTION;
INSERT INTO jobs SELECT * FROM \`$TMP_DB\`.jobs WHERE id = $JOB_ID;
INSERT INTO job_status_history SELECT * FROM \`$TMP_DB\`.job_status_history WHERE job_id = $JOB_ID;
COMMIT;
SQL

sudo mysql -e "DROP DATABASE \`$TMP_DB\`"
echo "OK"
sudo mysql -e "SELECT id, job_no, queue_no, job_date, status, bay FROM jobs WHERE id = $JOB_ID" "$DB_NAME"
sudo mysql -N -e "SELECT COUNT(*) AS history_rows FROM job_status_history WHERE job_id = $JOB_ID" "$DB_NAME"
