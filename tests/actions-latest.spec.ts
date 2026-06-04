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
  const farmerName = `Action Shot ${suffix}`;
  const normalizedName = farmerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.');

  const { data: farmer, error: farmerError } = await client
    .from('farmers')
    .insert({ name: farmerName, normalized_name: normalizedName })
    .select('id, name')
    .single();
  if (farmerError) throw farmerError;

  const { error: fieldError } = await client.from('fields').insert({
    farmer_id: farmer.id,
    field_name: 'East Pivot',
    boundary: {
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
    field_type: 'pivot',
    pivot_angle_degrees: 45,
  });
  if (fieldError) throw fieldError;

  return { farmerName };
}

test('actions page latest screenshot', async ({ page }) => {
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
  await page.waitForTimeout(1_500);
  const mapBox = await mapCanvas.boundingBox();
  if (!mapBox) throw new Error('Actions map canvas is not visible.');
  const nextButton = page.getByRole('button', { name: 'Next', exact: true });
  for (const [xFactor, yFactor] of [
    [0.5, 0.5],
    [0.45, 0.5],
    [0.55, 0.5],
    [0.5, 0.45],
    [0.5, 0.55],
  ] as const) {
    await page.mouse.click(mapBox.x + mapBox.width * xFactor, mapBox.y + mapBox.height * yFactor);
    if (await nextButton.isEnabled()) break;
    await page.waitForTimeout(400);
  }

  await expect(nextButton).toBeEnabled();
  await nextButton.click();
  await expect(page.getByLabel('Millimetres at pivot')).toBeVisible();
  await page.getByLabel('Millimetres at pivot').fill('20');

  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'latest.png'),
    fullPage: true,
  });
});
