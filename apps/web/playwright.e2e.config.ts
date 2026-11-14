import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// Browser end-to-end tests against the real Go application: API, built web UI,
// separate reader origin (127.0.0.1 app, localhost reader) and a throwaway
// PostgreSQL database created by the Go test harness.
// Requires LITARA_TEST_DATABASE_URL (superuser URL), ffmpeg/ffprobe on PATH and
// `npm run build` first. See scripts/web/e2e.sh.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8091" },
  webServer: {
    command: "go test ./internal/httpapi -run TestE2EServe -count=1 -timeout 25m",
    cwd: "../server",
    url: "http://127.0.0.1:8091/healthz",
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    env: { ...(process.env as Record<string, string>), LITARA_E2E_SERVE: "1", LITARA_E2E_WEBDIR: path.resolve(import.meta.dirname, "dist") },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
