#!/usr/bin/env bash
# Local/CI verification for apps/server (T001 foundation + T003 accounts/catalog/media/progress).
# Integration tests need LITARA_TEST_DATABASE_URL (a PostgreSQL superuser URL to
# an admin database; tests create and drop their own databases) plus ffmpeg and
# ffprobe on PATH or via LITARA_FFMPEG_PATH / LITARA_FFPROBE_PATH.
# Set LITARA_REQUIRE_INTEGRATION=1 to fail instead of skip when they are missing.
set -euo pipefail
cd "$(dirname "$0")/../../apps/server"

echo "== gofmt"
unformatted="$(gofmt -l .)"
[ -z "$unformatted" ] || { echo "needs gofmt:" >&2; echo "$unformatted" >&2; exit 1; }

echo "== go mod tidy is clean"
tmp="$(mktemp -d)"; cp go.mod go.sum "$tmp/"
go mod tidy
cmp -s go.mod "$tmp/go.mod" && cmp -s go.sum "$tmp/go.sum" || { echo "go.mod/go.sum were not tidy (now fixed); review and commit" >&2; exit 1; }

echo "== go vet / build"
go vet ./...
go build ./...

echo "== sqlc generated code is current"
sqlc diff

echo "== tests"
go test ./... -count=1 "$@"
echo "== generated OpenAPI matches the shared T003 contract"
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -n "$PY" ]; then
  "$PY" ../../scripts/contracts/compare.py
elif [ "${LITARA_REQUIRE_INTEGRATION:-}" = "1" ]; then
  echo "python is required for the OpenAPI parity check" >&2; exit 1
else
  echo "SKIPPED: python not found (set LITARA_REQUIRE_INTEGRATION=1 to make this fatal)"
fi
echo "CHECK OK"
