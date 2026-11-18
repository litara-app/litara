#!/usr/bin/env bash
# Runs the locally built unsigned test image under compose and checks that the PACKAGE (not the host) provides the web app, the
# reader origin and both native media tools, with the server container's network limited to the database. T007 M3/M5.
#   bash scripts/t007/package_check.sh      (needs docker with compose, curl; builds deploy/Dockerfile from the repo root)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$root"
export LITARA_IMAGE="${LITARA_IMAGE:-litara-backend:dev}" LITARA_HTTP_PORT=18180 LITARA_READER_PORT=18181
export LITARA_DB_PASSWORD="pkg-$(date +%s)" LITARA_DEV_INSECURE_HTTP=1
fx="$(mktemp -d)"; if command -v cygpath >/dev/null 2>&1; then fx="$(cygpath -m "$fx")"; export MSYS_NO_PATHCONV=1; fi
export LITARA_MEDIA_DIR="$fx"
compose=(docker compose -f deploy/compose.yaml -p litara-pkg)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$fx"; }
trap cleanup EXIT
fail=0; ok() { echo "PASS $1"; }; bad() { echo "FAIL $1"; fail=1; }
"${compose[@]}" build >/dev/null
LITARA_SECRET_KEY="$("${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate gen-key | tr -d '\r\n')"; export LITARA_SECRET_KEY
"${compose[@]}" up -d server >/dev/null
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$LITARA_HTTP_PORT/readyz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$LITARA_HTTP_PORT/readyz" >/dev/null && ok "server ready from the image (web enabled)" || bad "server ready"
app() { curl -sS -H "Host: app.localhost:$LITARA_HTTP_PORT" "$@"; }
rdr() { curl -sS -H "Host: reader.localhost:$LITARA_READER_PORT" "$@"; }
body="$(app "http://127.0.0.1:$LITARA_HTTP_PORT/")"; case "$body" in *"<script"*) ok "app origin serves the bundled SPA";; *) bad "app SPA";; esac
app -D "$fx/hdr.txt" -o "$fx/body.txt" "http://127.0.0.1:$LITARA_HTTP_PORT/"; hdr="$(cat "$fx/hdr.txt")"; case "${hdr,,}" in *content-security-policy*) ok "app CSP present";; *) bad "app CSP";; esac
cfg="$(app "http://127.0.0.1:$LITARA_HTTP_PORT/app-config.json")"; case "$cfg" in *"reader.localhost:$LITARA_READER_PORT"*) ok "app-config names the reader origin";; *) bad "app-config";; esac
code="$(rdr -o "$fx/o.txt" -w '%{http_code}' "http://127.0.0.1:$LITARA_READER_PORT/frame.html")"; [ "$code" = 200 ] && ok "reader origin serves bundled reader assets (frame.html)" || bad "reader frame ($code)"
code="$(rdr -o "$fx/o.txt" -w '%{http_code}' "http://127.0.0.1:$LITARA_READER_PORT/api/v1/me")"; { [ "$code" = 404 ] || [ "$code" = 403 ]; } && ok "reader origin has no API ($code)" || bad "reader api ($code)"
if "${compose[@]}" exec -T server /opt/litara/bin/ffprobe -version >/dev/null 2>&1 && "${compose[@]}" exec -T server /opt/litara/bin/ffmpeg -version >/dev/null 2>&1; then ok "pinned ffprobe and ffmpeg run inside the package"; else bad "bundled tools"; fi
"${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate tools
exit $fail
