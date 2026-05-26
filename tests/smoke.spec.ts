import { test, expect } from './web-fixture';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const envEntries = readFileSync('.env', 'utf-8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const separatorIndex = line.indexOf('=');
    return [
      line.slice(0, separatorIndex).trim(),
      line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, ''),
    ] as const;
  });

const envMap = new Map(envEntries);
const supabaseUrl = envMap.get('VITE_SUPABASE_URL') ?? '';
const supabasePublishableKey = envMap.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';

async function seedEditableField() {
  const client = createClient(supabaseUrl, supabasePublishableKey);
  const suffix = randomUUID().slice(0, 8);
  const farmerName = `Edit Farmer ${suffix}`;

  const { data: farmerRows, error: farmerError } = await client.rpc('upsert_farmer', {
    input_name: farmerName,
  });
  if (farmerError) {
    throw farmerError;
  }

  const farmer = (farmerRows as Array<{ id: string; name: string }>)[0];
  const { data: fieldId, error: fieldError } = await client.rpc('create_field', {
    input_farmer_id: farmer.id,
    input_field_name: 'North Pivot',
    input_boundary: {
      type: 'Polygon',
      coordinates: [
        [
          [24.67, -28.47],
          [24.671, -28.47],
          [24.671, -28.471],
          [24.67, -28.471],
          [24.67, -28.47],
        ],
      ],
    },
    input_field_type: 'pivot',
    input_pivot_angle_degrees: 90,
  });
  if (fieldError) {
    throw fieldError;
  }

  return {
    farmerName,
    fieldId: fieldId as string,
  };
}

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
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Switch farmer' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Switch farmer' }).click();
  await expect(
    page.getByRole('heading', { name: 'Open your farmer workspace' }),
  ).toBeVisible();
});

test('navbar tabs navigate to their route roots', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Name', { exact: true }).fill(`Farmer ${Date.now()}`);
  await page.locator('form').getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Field boundaries' })).toBeVisible();
  await expect(page).toHaveURL(/\/fields$/);

  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);

  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await expect(page).toHaveURL(/\/insights$/);

  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page).toHaveURL(/\/alerts$/);

  await page.getByRole('button', { name: 'Fields', exact: true }).click();
  await expect(page).toHaveURL(/\/fields$/);
});

test('farmer can open and save the field edit screen', async ({ page }) => {
  const seeded = await seedEditableField();

  await page.goto('/');
  await page.getByLabel('Name', { exact: true }).fill(seeded.farmerName);
  await page.locator('form').getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Field boundaries' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit field', exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/fields/${seeded.fieldId}$`));
  await expect(page.getByRole('heading', { name: 'Edit field' })).toBeVisible();
  await expect(page.getByLabel('Field name', { exact: true })).toHaveValue('North Pivot');
  await expect(page.getByRole('button', { name: 'Delete field', exact: true })).toBeVisible();

  await page.getByLabel('Field name', { exact: true }).fill('North Pivot Updated');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();

  await expect(page).toHaveURL(/\/fields$/);
  await expect(page.getByText('Updated North Pivot Updated.', { exact: true })).toBeVisible();
});
