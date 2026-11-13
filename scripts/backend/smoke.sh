#!/usr/bin/env bash
# Container/Compose smoke path for T001.
#   - builds the backend image (pinned ffprobe/ffmpeg, no host FFmpeg needed)
#   - generates fixtures with the IMAGE's ffmpeg into a read-only-mounted dir
#   - starts db + migrate + server, checks /readyz
#   - stops the server, submits an inspection (durable while no worker runs),
#     restarts the server, and verifies the persisted result
# Requires: docker with compose, curl. Linux/macOS/Git Bash. Tested: linux/amd64 image.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
export LITARA_IMAGE="${LITARA_IMAGE:-litara-backend:dev}"
export LITARA_HTTP_PORT="${LITARA_HTTP_PORT:-18080}"
export LITARA_DB_PASSWORD="smoke-$(date +%s)"
export LITARA_DEV_INSECURE_HTTP=1
fx="$(mktemp -d)"
# Docker expects host mount paths, while container arguments must stay POSIX.
if command -v cygpath >/dev/null 2>&1; then
  fx="$(cygpath -m "$fx")"
  export MSYS_NO_PATHCONV=1
fi
export LITARA_MEDIA_DIR="$fx"
compose=(docker compose -f deploy/compose.yaml -p litara-smoke)
cleanup() { "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$fx"; }
trap cleanup EXIT

"${compose[@]}" build
LITARA_SECRET_KEY="$("${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate gen-key | tr -d '\r\n')"
export LITARA_SECRET_KEY
live_pw="Smoke-$(date +%s)-synthetic"
# Fail early if the build did not produce the image the rest of the script uses.
docker image inspect "$LITARA_IMAGE" >/dev/null
echo "== license notice present in image"
docker run --rm --entrypoint sh "$LITARA_IMAGE" -c 'test -s /usr/share/doc/litara/ffmpeg/LICENSE.txt'

echo "== tools inside image"
"${compose[@]}" run --rm --no-deps --entrypoint ctl migrate tools

echo "== generating fixtures with the image's ffmpeg"
for spec in "book one.m4b:-c:a aac -f ipod" "track.flac:-c:a flac" "track.opus:-c:a libopus -b:a 32k" "vbr.mp3:-c:a libmp3lame -q:a 4"; do
  name="${spec%%:*}"; codec="${spec#*:}"
  # shellcheck disable=SC2086
  docker run --rm --user 0 --entrypoint /opt/litara/bin/ffmpeg -v "$fx:/out" "$LITARA_IMAGE" \
    -v error -y -f lavfi -i "sine=frequency=440:duration=3" $codec "/out/$name"
done
# Create the malformed fixture and fix permissions from inside a container so
# the script also works where the Docker daemon sees a different filesystem
# view than the host shell (e.g. Docker Desktop with Git Bash).
docker run --rm --user 0 --entrypoint sh -v "$fx:/out" "$LITARA_IMAGE"   -c "printf 'not media' > /out/broken.mp3 && chmod -R a+rX /out"

wait_ready() {
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${LITARA_HTTP_PORT}/readyz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "server never became ready" >&2; "${compose[@]}" logs server >&2; return 1
}

echo "== start stack"
"${compose[@]}" up -d db
"${compose[@]}" up -d server
wait_ready
curl -fsS "http://127.0.0.1:${LITARA_HTTP_PORT}/readyz"; echo

echo "== read-only media check (writes must fail)"
if "${compose[@]}" exec -T server sh -c 'touch /media/should-fail' 2>/dev/null; then
  echo "media mount is writable" >&2; exit 1
fi

echo "== durable submission while the server is stopped"
"${compose[@]}" stop server
"${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate inspect --wait=false "/media/book one.m4b"
"${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate inspect --wait=false /media/broken.mp3
"${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate inspect --wait=false /media/missing.mp3

echo "== restart server; it must pick the queued work up"
"${compose[@]}" up -d server
wait_ready
sleep 5
show() { "${compose[@]}" run --rm --no-deps -T --entrypoint ctl migrate show "$1"; }
good="$(show "/media/book one.m4b")"
echo "$good" | sed -n 1,2p
[[ "$good" == *"state=completed outcome=ok"* ]] || { echo "expected completed/ok" >&2; exit 1; }
broken="$(show /media/broken.mp3)"; echo "$broken" | sed -n 1,2p
[[ "$broken" == *"outcome=malformed_media"* ]] || { echo "expected malformed_media" >&2; exit 1; }
missing="$(show /media/missing.mp3)"; echo "$missing" | sed -n 1,2p
[[ "$missing" == *"outcome=missing_input"* ]] || { echo "expected missing_input" >&2; exit 1; }

echo "== T003: seed the fixture (writable one-shot mount) and run the authenticated third-party flow"
"${compose[@]}" run --rm --no-deps -T --user 0 -v "$fx:/media" -e LITARA_FFMPEG_PATH=/opt/litara/bin/ffmpeg \
  --entrypoint ctl migrate seed --dir /media --password-stdin <<<"$live_pw"
docker run --rm --user 0 --entrypoint sh -v "$fx:/out" "$LITARA_IMAGE" -c "chmod -R a+rX /out"
"${compose[@]}" up -d server
wait_ready
py=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys' >/dev/null 2>&1; then py="$c"; break; fi
done
[ -n "$py" ] || { echo "python is required for the live contract check" >&2; exit 1; }
LITARA_LIVE_PASSWORD="$live_pw" "$py" scripts/contracts/live_check.py "http://127.0.0.1:${LITARA_HTTP_PORT}"

echo "== T003: accounts and progress survive a server restart"
"${compose[@]}" restart server
wait_ready
LITARA_LIVE_PASSWORD="$live_pw" "$py" scripts/contracts/live_check.py --after-restart "http://127.0.0.1:${LITARA_HTTP_PORT}"

echo "SMOKE OK"
