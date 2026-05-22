import { test, expect } from './web-fixture';

test('app renders heading', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /gerald web template/i }),
  ).toBeVisible();
});

test('shows web template badge', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Web App Template')).toBeVisible();
});
