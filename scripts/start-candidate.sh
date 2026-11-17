#!/bin/sh
# Starts the final-candidate Studio on http://127.0.0.1:3300 with the real local
# pipeline. It uses only this folder: its own .env, its own PostgreSQL (port
# 5433, data in .data/pg) and its own media (.data/storage). It never touches
# the baseline Studio (port 3000, PostgreSQL 5432) or its data.
#   sh scripts/start-candidate.sh        start (builds first if needed)
#   sh scripts/start-candidate.sh stop   stop the candidate's PostgreSQL
set -e
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGDATA="$PWD/.data/pg"
PGPORT=5433
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
if [ "${1:-start}" = "stop" ]; then exec "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop; fi
[ -f .env ] || { echo "No .env in $(pwd)."; exit 1; }
grep -Eq "^DATABASE_URL=.*@localhost:$PGPORT/fgcand_dev" .env || {
  echo "Refusing to start: DATABASE_URL in .env is not the candidate database (localhost:$PGPORT/fgcand_dev)."; exit 1; }
[ -f "$PGDATA/PG_VERSION" ] || { echo "The candidate's PostgreSQL data folder is missing: $PGDATA"; exit 1; }
"$PGBIN/pg_isready" -q -h localhost -p $PGPORT ||
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-c listen_addresses=localhost -p $PGPORT" -w start
[ -f .next/BUILD_ID ] || pnpm build
echo "Field Guide Studio (candidate): http://127.0.0.1:3300   sign-in details are on the sign-in page"
exec pnpm exec next start -H 127.0.0.1 -p 3300
