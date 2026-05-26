import { test, expect } from './web-fixture';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

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

async function seedPivotFarmer() {
  const client = createClient(supabaseUrl, supabasePublishableKey);
  const suffix = Date.now().toString().slice(-6);
  const farmerName = `Action Farmer ${suffix}`;

  const { data: farmerRows, error: farmerError } = await client.rpc('upsert_farmer', {
    input_name: farmerName,
  });
  if (farmerError) throw farmerError;

  const farmer = (farmerRows as Array<{ id: string; name: string }>)[0];
  const { error: fieldError } = await client.rpc('create_field', {
    input_farmer_id: farmer.id,
    input_field_name: 'East Pivot',
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
    input_pivot_angle_degrees: 45,
  });
  if (fieldError) throw fieldError;

  return { farmerName };
}

test('actions tab renders pivot dial and effective mm', async ({ page }) => {
  const seeded = await seedPivotFarmer();

  await page.goto('/');
  await page.getByLabel('Name', { exact: true }).fill(seeded.farmerName);
  await page.locator('form').getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Field boundaries' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page).toHaveURL(/\/actions$/);
  await expect(page.getByRole('heading', { name: 'Log a pivot action' })).toBeVisible();

  await page.getByLabel('Pivot field').selectOption({ index: 1 });
  await page.getByLabel('Millimetres at pivot').fill('20');
  await page.getByLabel('Movement (degrees) — override').fill('180');

  await expect(page.getByText('10.00 mm', { exact: true })).toBeVisible();

  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'actions-flow.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Log action', exact: true }).click();
  await expect(page.getByText(/Logged 10\.00 mm across East Pivot\./)).toBeVisible({
    timeout: 10_000,
  });
});
