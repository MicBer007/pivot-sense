import { test } from './web-fixture';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Dumps screenshots/latest.png for Gerald to attach to a Telegram reply.
// Run with `npm run screenshot`.
test('capture homepage', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  // Mapbox tiles stream continuously so 'networkidle' never settles.
  // Wait for the in-app status pill or the setup card, whichever appears.
  await page
    .locator('.status-ready, [data-testid="maps-setup-needed"]')
    .first()
    .waitFor({ timeout: 20_000 });
  // Give tiles a moment to paint after the load event.
  await page.waitForTimeout(1500);
  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'latest.png'),
    fullPage: true,
  });
});
