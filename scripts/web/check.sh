#!/usr/bin/env bash
# Local web checks: lockfile-exact install, typecheck+build, unit tests.
# Browser/API acceptance (Playwright) is added in a later T005 milestone.
set -euo pipefail
cd "$(dirname "$0")/../../apps/web"
npm ci
npm run build
npm test
VITE_READER_PROOF=1 npx vite build --outDir dist-proof
npx playwright test
