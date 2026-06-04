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

async function seedRainFarmer() {
  const client = createClient(supabaseUrl, supabasePublishableKey);
  const suffix = randomUUID().slice(0, 8);
  const farmerName = `Rain Shot ${suffix}`;
  const normalizedName = farmerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.');

  const { data: farmer, error: farmerError } = await client
    .from('farmers')
    .insert({ name: farmerName, normalized_name: normalizedName })
    .select('id, name')
    .single();
  if (farmerError) throw farmerError;

  const fieldsPayload = [
    {
      farmer_id: farmer.id,
      field_name: 'East Pivot',
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [24.670, -28.470],
            [24.685, -28.470],
            [24.685, -28.485],
            [24.670, -28.485],
            [24.670, -28.470],
          ],
        ],
      },
      field_type: 'pivot',
      pivot_angle_degrees: 45,
    },
    {
      farmer_id: farmer.id,
      field_name: 'West Pivot',
      boundary: {
        type: 'Polygon',
        coordinates: [
          [
            [24.650, -28.470],
            [24.665, -28.470],
            [24.665, -28.485],
            [24.650, -28.485],
            [24.650, -28.470],
          ],
        ],
      },
      field_type: 'pivot',
      pivot_angle_degrees: 270,
    },
  ];

  const { error: fieldsError } = await client.from('fields').insert(fieldsPayload);
  if (fieldsError) throw fieldsError;

  return { farmerName };
}

test('rain logging and insights screenshots', async ({ page }) => {
  const seeded = await seedRainFarmer();

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

  await page.getByRole('button', { name: 'Rain', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Log a rain action' })).toBeVisible();
  await expect(page.getByLabel('Millimetres of rain')).toBeVisible();
  await page.getByLabel('Millimetres of rain').fill('12');

  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'rain-flow.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: /^Log rain across/ }).click();

  await expect(page.getByRole('heading', { name: 'Actions', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  // The list now has the rain rows.
  await expect(page.getByText('East Pivot', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Insights', exact: true }).click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole('heading', { name: 'Water logged' })).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: resolve(dir, 'insights-after-rain.png'),
    fullPage: true,
  });

  // Also a "latest.png" pointer for the most recent capture.
  await page.screenshot({
    path: resolve(dir, 'latest.png'),
    fullPage: true,
  });
});
