#!/bin/sh
# Project-local PostgreSQL 16 for Field Guide Studio (no login service).
# Data lives in .data/pg (gitignored). Usage: scripts/dev-db.sh start|stop|status
set -e
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
PGDATA="$PWD/.data/pg"
# macOS: postgres refuses to start without a valid locale ("became multithreaded").
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

case "${1:-status}" in
  start)
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      mkdir -p "$PGDATA"
      "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
    fi
    "$PGBIN/pg_isready" -q -h localhost -p 5432 ||
      "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-c listen_addresses=localhost -p 5432" -w start
    for db in fieldguide fieldguide_test fieldguide_e2e; do
      "$PGBIN/psql" -h localhost -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 ||
        "$PGBIN/createdb" -h localhost -U postgres "$db"
    done
    echo "postgres ready on localhost:5432 (fieldguide, fieldguide_test, fieldguide_e2e)"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop ;;
  status) "$PGBIN/pg_isready" -h localhost -p 5432 ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
