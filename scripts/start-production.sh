#!/bin/sh
# Isolated local proof Studio. Does not stop or modify the original applications.
set -eu
cd "$(dirname "$0")/.."
for d in "$HOME"/.nvm/versions/node/v22*/bin; do [ ! -x "$d/node" ] || PATH="$d:$PATH"; done
export PATH
[ -z "${DATABASE_URL:-}" ] || { echo 'Refusing an inherited database setting. Open a fresh shell.'; exit 1; }
[ -f .env ] || { echo 'Missing isolated configuration.'; exit 1; }
node --env-file=.env -e 'const u=new URL(process.env.DATABASE_URL);if(u.hostname!=="localhost"||u.port!=="5433"||u.pathname!=="/fgprod_dev")throw Error("Expected isolated localhost:5433/fgprod_dev");if(process.env.YOUTUBE_PUBLISHER!=="mock")throw Error("Publishing must remain disabled")'
/opt/homebrew/opt/postgresql@16/bin/pg_isready -q -h localhost -p 5433 || {
 echo 'The candidate database service on 5433 is stopped. Start the existing candidate database before this isolated app.'; exit 1;
}
[ -f .next/BUILD_ID ] || pnpm build
printf 'Internal review Studio: http://127.0.0.1:3500/studio\nAll production outputs require human review. Publication blocked.\n'
exec pnpm exec next start -H 127.0.0.1 -p 3500
