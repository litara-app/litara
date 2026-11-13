#!/usr/bin/env bash
# Local/CI verification for apps/server (T001).
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
echo "CHECK OK"
