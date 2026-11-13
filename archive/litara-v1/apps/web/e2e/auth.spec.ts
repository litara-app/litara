import { test, expect } from '@playwright/test';
import { E2E_USER } from './global-setup.js';

test.describe('Authentication', () => {
  test('successful login redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(E2E_USER.email);
    await page.getByLabel('Password').fill(E2E_USER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('invalid credentials show error alert', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(E2E_USER.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('unauthenticated navigation to protected route redirects to login', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });
});
