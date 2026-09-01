#!/usr/bin/env bash
set -euo pipefail

# Deploy stock-system to production — codifies the manual SSH command
# sequence used throughout development into one repeatable script, so a
# typo in a long one-liner doesn't skip a step (e.g. restarting pm2 before
# `npm run build` finishes, or before a migration in server.js has run).
#
# Does NOT touch git for you. Commit and push locally first, the same way
# as always (stage specific files by name — never `git add -A`/`.`, since
# this repo intentionally carries an uncommitted local .gitignore change
# that must never be swept in). Then run this script from the repo root:
#
#   scripts/deploy.sh
#
# Refuses to run if: there are uncommitted changes (other than .gitignore),
# local main hasn't been pushed to origin/main yet, or the local backend
# test suite fails — each of those has caused a real production incident
# in this project's history, so they're hard stops, not warnings.

SSH_KEY="$HOME/.ssh/champpower_deploy"
SSH_HOST="ubuntu@103.230.123.62"
REMOTE_DIR="/var/www/stock-system"
HEALTH_URL="https://champ-powerspk.com/api/health"

cd "$(dirname "$0")/.."

echo "==> Checking for uncommitted changes to tracked files..."
if [ -n "$(git status --porcelain --untracked-files=no -- ':!.gitignore')" ]; then
  echo "!! Uncommitted changes to tracked files present (other than .gitignore). Commit and push first:" >&2
  git status --short --untracked-files=no
  exit 1
fi

echo "==> Checking local main is pushed to origin/main..."
git fetch origin main --quiet
LOCAL_HEAD=$(git rev-parse main)
REMOTE_HEAD=$(git rev-parse origin/main)
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
  echo "!! Local main ($LOCAL_HEAD) is not pushed to origin/main ($REMOTE_HEAD)." >&2
  echo "   Run: git push origin main" >&2
  exit 1
fi

echo "==> Running backend test suite locally before deploying..."
if ! (cd backend && npx jest --runInBand --forceExit); then
  echo "!! Tests failed — aborting deploy. Fix tests before deploying." >&2
  exit 1
fi

echo "==> Deploying $LOCAL_HEAD to $SSH_HOST..."
ssh -i "$SSH_KEY" "$SSH_HOST" bash -s <<EOF
set -e
cd "$REMOTE_DIR"
git pull origin main
cd backend && npm install --production
cd ../frontend && npm install && npm run build
pm2 restart stock-system
EOF

echo "==> Waiting for the server to come back up..."
sleep 3

for i in 1 2 3 4 5; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --ssl-no-revoke "$HEALTH_URL" || echo "000")
  if [ "$STATUS" = "200" ]; then
    echo "==> Deploy successful — health check OK ($HEALTH_URL)"
    exit 0
  fi
  echo "   health check attempt $i: HTTP $STATUS, retrying..."
  sleep 2
done

echo "!! Health check failed after deploy — check the server manually:" >&2
echo "   ssh -i $SSH_KEY $SSH_HOST 'pm2 logs stock-system --lines 50 --nostream'" >&2
exit 1
