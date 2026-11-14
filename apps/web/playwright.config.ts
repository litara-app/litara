import { defineConfig, devices } from "@playwright/test";

// Serves dist-proof through the real Go web handler (production CSP/CORS
// headers) without a database. Build first: VITE_READER_PROOF=1 vite build
// --outDir dist-proof.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8099" },
  webServer: {
    command: "go run ./cmd/webserve -dir ../web/dist-proof -addr 127.0.0.1:8099",
    cwd: "../server",
    url: "http://127.0.0.1:8099/",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
