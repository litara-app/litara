#!/usr/bin/env bash
# Local web checks: lockfile-exact install, typecheck+build, unit tests.
# Real-API browser tests are separate: scripts/web/e2e.sh (needs PostgreSQL).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/ports.sh"
require_free_ports 8098 8099
cd "$here/../../apps/web"
npm ci
npm run build
npm test
VITE_READER_PROOF=1 npx vite build --outDir dist-proof
npx playwright test
