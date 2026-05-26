import { test, expect } from './web-fixture';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('capture add field flow', async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const farmerName = `Field Demo ${suffix}`;

  await page.goto('/');
  await page.getByLabel('Name', { exact: true }).fill(farmerName);
  await page
    .locator('form')
    .getByRole('button', { name: 'Continue', exact: true })
    .click();

  await expect(page.getByRole('heading', { name: 'Field boundaries' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: 'Add field', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  await expect(page).toHaveURL(/\/fields\/add$/);
  await expect(page.getByRole('heading', { name: 'Add field' })).toBeVisible();
  await page.getByLabel('Field name', { exact: true }).fill('North Pivot');
  await expect(page.getByText('Pivots field', { exact: true })).toBeVisible();
  await expect(page.getByText('Current pivot angle:', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Circle mode', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free mode', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Free mode', exact: true }).click();
  await expect(page.getByText('Normal field', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm boundary', exact: true })).toBeVisible();

  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'field-flow.png'),
    fullPage: true,
  });
});
