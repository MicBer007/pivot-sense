import { test, expect } from './web-fixture';

test('signed-out landing shows farmer workspace prompt', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'PivotSense home' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Open your farmer workspace' }),
  ).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(
    page.locator('form').getByRole('button', { name: 'Continue', exact: true }),
  ).toBeVisible();
});

test('signed-out shell stays minimal', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('PivotSense').first()).toBeVisible();
  await expect(page.getByText('Current pilot limitation')).toHaveCount(0);
  await expect(page.getByText('Sign in to view your fields')).toHaveCount(0);
});

test('supabase auth is configured in the browser app', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('supabase-setup-needed')).toHaveCount(0);
});

test('farmer can open a workspace with a single name field', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Name', { exact: true }).fill(`Farmer ${Date.now()}`);
  await page.locator('form').getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Field boundaries' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch farmer', exact: true })).toBeVisible();
});
