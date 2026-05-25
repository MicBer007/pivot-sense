import { test, expect } from './web-fixture';

test('navbar shows brand and main links', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('banner').getByRole('link', { name: 'PivotSense home' }),
  ).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Pricing' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Stories' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('app renders farmer workspace shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Farmer workspace' })).toBeVisible();
  await expect(page.getByText('PivotSense').first()).toBeVisible();
});

test('shows four main tabs', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Insights' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fields' })).toBeVisible();
});

test('fields tab shows maps setup instructions without an api key', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Fields' }).click();

  await expect(page.getByTestId('maps-setup-needed')).toBeVisible();
  await expect(page.getByText('VITE_GOOGLE_MAPS_API_KEY')).toBeVisible();
});
