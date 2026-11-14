#!/usr/bin/env bash
# Local web checks: lockfile-exact install, typecheck+build, unit tests.
# Real-API browser tests are separate: scripts/web/e2e.sh (needs PostgreSQL).
set -euo pipefail
cd "$(dirname "$0")/../../apps/web"
npm ci
npm run build
npm test
VITE_READER_PROOF=1 npx vite build --outDir dist-proof
npx playwright test
