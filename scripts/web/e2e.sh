#!/usr/bin/env bash
# Browser end-to-end acceptance against the real Go application (API, web UI and the
# separate reader origin), including the generated format corpus.
#
# Needs: LITARA_TEST_DATABASE_URL (PostgreSQL superuser URL; a throwaway database is
# created per run), Go, Node, Python 3, ffmpeg on PATH (audio corpus), and installed
# Playwright browsers (set LITARA_INSTALL_BROWSERS=1 to install chromium/firefox/webkit
# first). Calibre's ebook-convert is optional: without it the MOBI/AZW3 rows are reported
# as "not generated" in the format matrix rather than failing.
# Ports 8091, 8092 and 5174 must be free. Extra arguments go to `playwright test`.
set -euo pipefail
: "${LITARA_TEST_DATABASE_URL:?set LITARA_TEST_DATABASE_URL to a PostgreSQL superuser URL}"
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/ports.sh"
require_free_ports 8091 8092 5174
command -v ffmpeg >/dev/null 2>&1 || { echo "error: ffmpeg is required (audio corpus and server media inspection)" >&2; exit 2; }
py=""
for c in python3 python py; do # run each candidate: on Windows `python3` can be a Store stub that exists but fails
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then py="$c"; break; fi
done
[ -n "$py" ] || { echo "error: a working Python 3 is required to generate the format corpus" >&2; exit 2; }

corpus="$(mktemp -d)"
trap 'rm -rf "$corpus"' EXIT
"$py" "$here/generate_format_corpus.py" "$corpus" >/dev/null
for f in corpus-pdf-crop.pdf corpus-epub.epub corpus-fb2.fb2 corpus-pdf.pdf; do
  [ -f "$corpus/$f" ] || { echo "error: corpus fixture $f was not generated" >&2; exit 2; }
done
export LITARA_E2E_CORPUS="$corpus"

cd "$here/../../apps/web"
npm ci
if [ "${LITARA_INSTALL_BROWSERS:-}" = "1" ]; then npx playwright install chromium firefox webkit; fi
npm run build
rc=0
npx playwright test -c playwright.e2e.config.ts "$@" || rc=$?
"$py" "$here/format_matrix.py" || true
exit $rc
