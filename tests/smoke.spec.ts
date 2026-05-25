import { test, expect } from './web-fixture';

test('signed-out landing shows brand and auth prompt', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'PivotSense home' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sign in to view your fields' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Magic link', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Password', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
});

test('signed-out shell explains RLS-backed login flow', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByText('The browser keeps that session cached until you sign out.'),
  ).toBeVisible();
  await expect(page.getByText('PivotSense').first()).toBeVisible();
});

test('supabase auth is configured in the browser app', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('supabase-setup-needed')).toHaveCount(0);
});

test('password sign-in mode is available for returning users', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Password', exact: true }).click();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with password' })).toBeVisible();
});
