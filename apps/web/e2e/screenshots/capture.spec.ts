import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * All screenshots land directly in the Docusaurus static screenshots directory
 * so `npm run build` in apps/docs picks them up immediately.
 */
const DOCS_SCREENSHOTS = path.resolve(
  __dirname,
  '../../../docs/static/screenshots',
);

function ss(name: string) {
  return path.join(DOCS_SCREENSHOTS, `${name}.png`);
}

/** Wait for the page to be visually settled (no pending network, no CSS transitions). */
async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  // Let any enter-transitions finish
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Login (unauthenticated — clear the project-level storageState)
// ---------------------------------------------------------------------------

test.describe('Login page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({
      timeout: 10_000,
    });
    await settle(page);
    await page.screenshot({ path: ss('login'), fullPage: false });
  });
});

// ---------------------------------------------------------------------------
// Main authenticated pages
// ---------------------------------------------------------------------------

test.describe('Dashboard', () => {
  test('dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
      timeout: 10_000,
    });
    // Wait for at least one book card to appear
    await page
      .locator('.book-card')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    await settle(page);
    await page.screenshot({ path: ss('dashboard'), fullPage: false });
  });
});

test.describe('All Books', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/books');
    await expect(page.getByRole('heading', { name: 'All Books' })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .locator('.book-card')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
  });

  test('all-books', async ({ page }) => {
    await settle(page);
    await page.screenshot({ path: ss('all-books'), fullPage: false });
  });

  test('book-filter', async ({ page }) => {
    // Open the filter panel
    await page.getByRole('button', { name: 'Toggle filters' }).click();
    await page
      .locator('[data-filter-panel], aside, [role="complementary"]')
      .first()
      .or(page.getByText(/filter/i).first())
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await settle(page);
    await page.screenshot({ path: ss('book-filter'), fullPage: false });
  });
});

test.describe('Book detail modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/books');
    await page.locator('.book-card').first().waitFor({ timeout: 15_000 });
    await page.locator('.book-card').first().click();
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 8_000 });
    await settle(page);
  });

  test('book-detail', async ({ page }) => {
    await page.screenshot({ path: ss('book-detail'), fullPage: false });
  });

  test('book-detail-metadata', async ({ page }) => {
    await page.getByRole('tab', { name: 'Edit Metadata' }).click();
    await expect(
      page.getByRole('textbox', { name: 'Title', exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await settle(page);
    await page.screenshot({
      path: ss('book-detail-metadata'),
      fullPage: false,
    });
  });
});

test.describe('Authors page', () => {
  test('authors', async ({ page }) => {
    await page.goto('/authors');
    await expect(page.getByRole('heading', { name: 'Authors' })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .locator('.mantine-Card-root')
      .first()
      .or(page.getByText('No authors found'))
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await page.screenshot({ path: ss('authors'), fullPage: false });
  });
});

test.describe('Series page', () => {
  test('series', async ({ page }) => {
    await page.goto('/series');
    await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible({
      timeout: 10_000,
    });
    await page
      .locator('.mantine-Card-root')
      .first()
      .or(page.getByText('No series found'))
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await page.screenshot({ path: ss('series'), fullPage: false });
  });
});

test.describe('Settings page', () => {
  test('settings', async ({ page }) => {
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: /settings/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await settle(page);
    await page.screenshot({ path: ss('settings'), fullPage: false });
  });
});

test.describe('Admin Settings page', () => {
  test('admin-settings', async ({ page }) => {
    await page.goto('/admin-settings');
    await expect(
      page.getByRole('heading', { name: 'Admin Settings' }),
    ).toBeVisible({ timeout: 10_000 });
    await settle(page);
    await page.screenshot({ path: ss('admin-settings'), fullPage: false });
  });

  test('admin-settings-tasks', async ({ page }) => {
    await page.goto('/admin-settings');
    await expect(
      page.getByRole('heading', { name: 'Admin Settings' }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: 'Tasks' }).click();
    await settle(page);
    await page.screenshot({
      path: ss('admin-settings-tasks'),
      fullPage: false,
    });
  });
});

test.describe('Profile page', () => {
  test('profile-library-stats', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({
      timeout: 10_000,
    });
    // The Library Statistics tab is the default — wait for the stat cards to render
    await expect(page.getByText('Books', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
    // Wait for charts: the pie chart SVG appears once data loads
    await page
      .locator('svg')
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await page.screenshot({
      path: ss('profile-library-stats'),
      fullPage: false,
    });
  });

  test('profile-reading-stats', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('tab', { name: 'Reading Stats' }).click();
    // Wait for the heatmap and charts to render
    await page
      .locator('svg')
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await page.screenshot({
      path: ss('profile-reading-stats'),
      fullPage: false,
    });
  });
});
