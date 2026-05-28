import { test, expect } from './web-fixture';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
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

async function seedPivotFarmer() {
  const client = createClient(supabaseUrl, supabasePublishableKey);
  const suffix = randomUUID().slice(0, 8);
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
          [24.69, -28.47],
          [24.69, -28.49],
          [24.67, -28.49],
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

test('actions tab renders pivot map and effective mm', async ({ page }) => {
  const seeded = await seedPivotFarmer();

  await page.goto('/');
  await page.getByLabel('Name', { exact: true }).fill(seeded.farmerName);
  await page.locator('form').getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Field boundaries' })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page).toHaveURL(/\/actions$/);
  await expect(page.getByRole('heading', { name: 'Actions', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Log new action', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log a pivot action' })).toBeVisible();

  const mapCanvas = page.getByTestId('actions-map-canvas');
  await expect(mapCanvas).toBeVisible();
  await page.waitForTimeout(1_200);
  const mapBox = await mapCanvas.boundingBox();
  if (!mapBox) throw new Error('Actions map canvas is not visible.');
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.waitForTimeout(1_200);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Millimetres at pivot')).toBeVisible();
  await page.getByLabel('Millimetres at pivot').fill('20');

  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'actions-flow.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Log action', exact: true }).click();

  // Logging returns to the list, where the new action now appears.
  await expect(page.getByRole('heading', { name: 'Actions', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('East Pivot', { exact: true })).toBeVisible();
});
