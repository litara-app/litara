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
  use: { baseURL: "http://127.0.0.1:8091", screenshot: "only-on-failure" },
  webServer: [
    {
      command: "go test ./internal/httpapi -run TestE2EServe -count=1 -v -timeout 25m",
      cwd: "../server",
      url: "http://127.0.0.1:8091/healthz",
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "pipe",
      env: { ...(process.env as Record<string, string>), LITARA_E2E_SERVE: "1", LITARA_E2E_WEBDIR: path.resolve(import.meta.dirname, "dist"), LITARA_E2E_INFO: path.resolve(import.meta.dirname, "test-results/e2e-info.json"), LITARA_E2E_DEV_ORIGIN: "http://127.0.0.1:5174" },
    },
    {
      // The Vite development server, proxying the API of the end-to-end server (the dev-proxy scenario).
      command: "npx vite --host 127.0.0.1 --port 5174 --strictPort",
      cwd: ".",
      url: "http://127.0.0.1:5174/",
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      env: { ...(process.env as Record<string, string>), LITARA_DEV_API: "http://127.0.0.1:8091" },
    },
  ],
  // Administration scenarios change shared state permanently (a repair applies once),
  // so they run once, in Chromium, after the reader scenarios.
  projects: [
    { name: "chromium", testIgnore: /admin\.spec|devproxy\.spec/, use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testIgnore: /admin\.spec|devproxy\.spec/, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testIgnore: /admin\.spec|devproxy\.spec/, use: { ...devices["Desktop Safari"] } },
    { name: "devproxy", testMatch: /devproxy\.spec/, use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5174" } },
    { name: "admin", testMatch: /admin\.spec/, dependencies: ["chromium", "firefox", "webkit"], use: { ...devices["Desktop Chrome"] } },
  ],
});
