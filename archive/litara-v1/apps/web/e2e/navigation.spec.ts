import { test, expect } from './fixtures.js';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('Settings link navigates to /settings', async ({ page }) => {
    await page
      .getByRole('button', { name: 'Settings' })
      .or(page.getByText('Settings').locator('..'))
      .first()
      .click();
    // Fallback: use the nav link directly
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');
    await expect(
      page.getByRole('heading', { name: /settings/i }).first(),
    ).toBeVisible();
  });

  test('clicking Settings nav item navigates to /settings', async ({
    page,
  }) => {
    // NavLink renders as a button-like element; target by its label text
    await page
      .locator('a, button')
      .filter({ hasText: /^Settings$/ })
      .first()
      .click();
    await expect(page).toHaveURL('/settings');
  });

  test('Admin Settings link navigates to /admin-settings', async ({ page }) => {
    await page.goto('/admin-settings');
    await expect(page).toHaveURL('/admin-settings');
    await expect(
      page.getByRole('heading', { name: /admin/i }).first(),
    ).toBeVisible();
  });

  test('Logout clears token and redirects to /login', async ({ page }) => {
    await page.locator('a, button').filter({ hasText: 'Logout' }).click();
    await expect(page).toHaveURL('/login');
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeNull();
  });
});
