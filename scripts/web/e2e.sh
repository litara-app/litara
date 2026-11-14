#!/usr/bin/env bash
# Browser end-to-end tests against the real Go application (API, web UI and the
# separate reader origin). Needs LITARA_TEST_DATABASE_URL (PostgreSQL superuser
# URL; a throwaway database is created and dropped), ffmpeg/ffprobe on PATH, Go,
# Node and installed Playwright browsers. Ports 8091 and 8092 must be free.
set -euo pipefail
: "${LITARA_TEST_DATABASE_URL:?set LITARA_TEST_DATABASE_URL to a PostgreSQL superuser URL}"
cd "$(dirname "$0")/../../apps/web"
npm ci
npm run build
npx playwright test -c playwright.e2e.config.ts "$@"
