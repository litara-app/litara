import { test } from '../fixtures.js';

test.describe('Screenshot captures', () => {
  test('series page', async ({ page }) => {
    await page.goto('/series');
    // Wait for the Series heading to confirm the page loaded
    await page
      .getByRole('heading', { name: 'Series' })
      .waitFor({ timeout: 10_000 });
    // Wait for any series cards to appear (or the empty state)
    await page
      .locator('.mantine-Card-root')
      .first()
      .or(page.getByText('No series found'))
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await page.screenshot({ path: 'screenshots/series.png', fullPage: false });
  });
});
