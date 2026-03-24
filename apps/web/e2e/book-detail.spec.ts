import { test, expect } from './fixtures.js';

test.describe('Book detail modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/books');
    await expect(page.locator('.book-card').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('clicking a book card opens the modal', async ({ page }) => {
    await page.locator('.book-card').first().click();
    // Modal is fullscreen — the close button is the clearest indicator it opened
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 5_000 });
  });

  test('Escape key closes the modal', async ({ page }) => {
    await page.locator('.book-card').first().click();
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Close')).not.toBeVisible({ timeout: 3_000 });
  });

  test('close button dismisses the modal', async ({ page }) => {
    await page.locator('.book-card').first().click();
    const closeBtn = page.getByLabel('Close');
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });
    await closeBtn.click();
    await expect(closeBtn).not.toBeVisible({ timeout: 3_000 });
  });

  test('Edit Metadata tab shows metadata form fields', async ({ page }) => {
    await page.locator('.book-card').first().click();
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: 'Edit Metadata' }).click();
    await expect(
      page.getByRole('textbox', { name: 'Title', exact: true }),
    ).toBeVisible();
  });
});

test.describe('Search Metadata tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/books');
    await expect(page.locator('.book-card').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('.book-card').first().click();
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: 'Search Metadata' }).click();
  });

  test('renders search form with title, author, ISBN inputs and search button', async ({
    page,
  }) => {
    await expect(
      page.getByPlaceholder('Title...', { exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder('Author...')).toBeVisible();
    await expect(page.getByPlaceholder('ISBN...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  });

  test('search returns results or shows no-results message', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    // Wait for either a result card (identified by its "N fields" badge) or the empty state
    await expect(
      page
        .getByText(/\d+ fields/)
        .first()
        .or(page.getByText('No results found.')),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Sidecar tab', () => {
  test('shows sidecar metadata for Pride and Prejudice', async ({ page }) => {
    await page.goto('/books');
    await expect(page.locator('.book-card').first()).toBeVisible({
      timeout: 15_000,
    });

    // Open the Pride and Prejudice card specifically
    await page
      .locator('.book-card')
      .filter({ hasText: 'Pride and Prejudice' })
      .first()
      .click();
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: 'Sidecar' }).click();

    // The sidecar file exists — expect the filename and Apply All button
    await expect(
      page.getByText('Pride and Prejudice.metadata.json'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Apply All' })).toBeVisible();
  });

  test('shows no-sidecar message for a book without a sidecar file', async ({
    page,
  }) => {
    await page.goto('/books');
    await expect(page.locator('.book-card').first()).toBeVisible({
      timeout: 15_000,
    });

    // The Great Gatsby has no sidecar
    await page
      .locator('.book-card')
      .filter({ hasText: 'The Great Gatsby' })
      .first()
      .click();
    await expect(page.getByLabel('Close')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: 'Sidecar' }).click();

    await expect(page.getByText('No sidecar file found.')).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole('button', { name: 'Scan for Sidecar' }),
    ).toBeVisible();
  });
});
