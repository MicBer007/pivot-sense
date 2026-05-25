import { test, expect } from './web-fixture';

test('signed-out landing shows brand and auth prompt', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'PivotSense home' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sign in to view your fields' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible();
});

test('signed-out shell explains RLS-backed login flow', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByText('Your signed-in user session is what the field RLS policies rely on.'),
  ).toBeVisible();
  await expect(page.getByText('PivotSense').first()).toBeVisible();
});

test('supabase auth is configured in the browser app', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('supabase-setup-needed')).toHaveCount(0);
});
