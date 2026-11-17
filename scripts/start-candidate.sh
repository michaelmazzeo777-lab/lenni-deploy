#!/bin/sh
# Starts the final-candidate Studio on http://127.0.0.1:3400 with the real local
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
# After a Mac restart the default Node may be older than this app needs (22+).
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then
  for d in "$HOME"/.nvm/versions/node/v22*/bin; do [ -x "$d/node" ] && PATH="$d:$PATH"; done
  export PATH
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||
    { echo "Node 22 or newer is required (found $(node --version 2>/dev/null))."; exit 1; }
fi
[ -f .env ] || { echo "No .env in $(pwd)."; exit 1; }
# A DATABASE_URL inherited from the shell would override .env; refuse rather than guess.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "Refusing to start: DATABASE_URL is set in this shell and would override .env. Open a new Terminal window."; exit 1
fi
grep -Eq "^DATABASE_URL=.*@localhost:$PGPORT/fgcand_dev" .env || {
  echo "Refusing to start: DATABASE_URL in .env is not the candidate database (localhost:$PGPORT/fgcand_dev)."; exit 1; }
[ -f "$PGDATA/PG_VERSION" ] || { echo "The candidate's PostgreSQL data folder is missing: $PGDATA"; exit 1; }
"$PGBIN/pg_isready" -q -h localhost -p $PGPORT ||
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/server.log" -o "-c listen_addresses=localhost -p $PGPORT" -w start
# Tools the clipper and renderers need. Missing ones are named, not discovered mid-job.
FFMPEG_BIN=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg
[ -x "$FFMPEG_BIN" ] || FFMPEG_BIN="$(command -v ffmpeg || true)"
[ -n "$FFMPEG_BIN" ] || { echo "ffmpeg is not installed."; exit 1; }
WHISPER_BIN="${WHISPER_CLI_PATH:-/opt/homebrew/bin/whisper-cli}"
[ -x "$WHISPER_BIN" ] || echo "Warning: whisper-cli not found at $WHISPER_BIN; clipping and caption QA will report NOT_VERIFIED."
MODEL="$(sed -n 's/^WHISPER_MODEL_PATH="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | tail -1)"
[ -n "$MODEL" ] && [ -f "$MODEL" ] || echo "Warning: speech model not found (WHISPER_MODEL_PATH in .env); the clipper will refuse to start a job."
# Rebuild when the code changed since the last build, not only when there is none.
HEAD_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
if [ ! -f .next/BUILD_ID ] || [ "$(cat .next/.source-commit 2>/dev/null)" != "$HEAD_COMMIT" ] || [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  pnpm build && echo "$HEAD_COMMIT" > .next/.source-commit
fi
echo "Field Guide Studio (candidate): http://127.0.0.1:3400   sign-in details are on the sign-in page"
exec pnpm exec next start -H 127.0.0.1 -p 3400
