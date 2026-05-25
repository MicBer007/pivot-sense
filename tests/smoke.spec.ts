import { test, expect } from './web-fixture';

test('signed-out landing shows brand and auth prompt', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'PivotSense home' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sign in to view your fields' }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Sign in method').getByRole('button', {
      name: 'Create account',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel('Sign in method').getByRole('button', {
      name: 'Sign in',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Surname', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Confirm password', { exact: true })).toBeVisible();
  await expect(
    page.locator('form').getByRole('button', { name: 'Create account', exact: true }),
  ).toBeVisible();
});

test('signed-out shell explains RLS-backed login flow', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByText('The browser keeps the signed-in session cached until you sign out.'),
  ).toBeVisible();
  await expect(
    page.getByText('the combination of name and surname needs to be unique', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('PivotSense').first()).toBeVisible();
});

test('supabase auth is configured in the browser app', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('supabase-setup-needed')).toHaveCount(0);
});

test('plain sign-in mode is available for returning users', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Surname', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(
    page.locator('form').getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
});
