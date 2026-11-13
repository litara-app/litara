import * as path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../..');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'e2e',
      testMatch: /e2e\/[^/]+\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'screenshots',
      testMatch: /e2e\/screenshots\/[^/]+\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Reuse pre-seeded auth state so tests don't spend time on login
        storageState: 'e2e/.auth.json',
      },
    },
  ],

  // Two web servers: the NestJS API and the Vite dev server.
  //
  // IMPORTANT — EBOOK_LIBRARY_PATH:
  //   These env vars only apply when Playwright starts the servers itself
  //   (i.e. they are not already running on the expected ports).
  //   If you run `npm run dev` from the monorepo root first, Playwright
  //   will reuse those processes and the env vars below won't take effect.
  //   Use `npm run dev:e2e` from the monorepo root instead, which sets
  //   EBOOK_LIBRARY_PATH before starting the dev stack.
  webServer: [
    {
      command: 'npm run dev --workspace=@litara/api',
      cwd: MONOREPO_ROOT,
      url: 'http://localhost:3000/api/v1/setup/status',
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        EBOOK_LIBRARY_PATH: path.join(
          MONOREPO_ROOT,
          'test',
          'fixtures',
          'ebook-library',
        ),
        JWT_SECRET:
          process.env.JWT_SECRET ?? 'e2e-test-secret-do-not-use-in-prod',
        DATABASE_URL:
          process.env.DATABASE_URL ??
          'postgresql://postgres:postgres@localhost:5432/litara',
      },
    },
    {
      command: 'npm run dev',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
