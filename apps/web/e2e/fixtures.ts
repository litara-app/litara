/**
 * Authenticated test fixture.
 *
 * Import `{ test, expect }` from this file in tests that require a logged-in
 * session. The fixture injects the saved auth state (JWT in localStorage)
 * produced by global-setup.ts, so every page navigation starts authenticated.
 *
 * For unauthenticated tests, import directly from `@playwright/test`.
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test as base, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_STATE_PATH = path.join(__dirname, '.auth.json');

export const test = base.extend({
  page: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
    const page = await context.newPage();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    await context.close();
  },
});

export { expect };
