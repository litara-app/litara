import { test, expect } from '@playwright/test';

test.describe('Setup page', () => {
  // After globalSetup runs, the admin user already exists, so the API reports
  // setupRequired: false. The SetupPage useEffect detects this and redirects to
  // /login. This is the expected behaviour once setup is complete.
  test('redirects to /login when setup is already complete', async ({
    page,
  }) => {
    await page.goto('/setup');
    await expect(page).toHaveURL('/login');
  });

  test('setup page has email, password, and submit button', async ({
    page,
  }) => {
    // Intercept the status endpoint to simulate a fresh instance needing setup.
    await page.route('**/api/v1/setup/status', (route) =>
      route.fulfill({ json: { setupRequired: true } }),
    );
    await page.goto('/setup');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create Admin Account' }),
    ).toBeVisible();
  });
});
