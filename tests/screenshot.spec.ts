import { test } from './web-fixture';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Dumps screenshots/latest.png for Gerald to attach to a Telegram reply.
// Run with `npm run screenshot`.
test('capture homepage', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('load');
  await page
    .locator('[data-testid="auth-card"], .status-ready, [data-testid="maps-setup-needed"]')
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const dir = resolve('screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({
    path: resolve(dir, 'latest.png'),
    fullPage: true,
  });
});
