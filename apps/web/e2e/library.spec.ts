import { test, expect } from './fixtures.js';

test.describe('Library browsing', () => {
  test('dashboard shows imported book cards', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();
    // Wait for the book grid to populate (scanner may need a moment on first run)
    await expect(page.locator('.book-card').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('All Books page lists imported books', async ({ page }) => {
    await page.goto('/books');
    await expect(
      page.getByRole('heading', { name: 'All Books' }),
    ).toBeVisible();
    await expect(page.locator('.book-card').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('global search filters books by title', async ({ page }) => {
    await page.goto('/');
    // The global search in the header requires at least 2 characters
    await page.getByPlaceholder('Search...').fill('Pride');
    // The search popover should appear with results
    await expect(
      page.getByText('Pride and Prejudice', { exact: false }),
    ).toBeVisible({
      timeout: 5_000,
    });
  });
});
