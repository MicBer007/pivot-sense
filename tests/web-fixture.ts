import { test as base } from '@playwright/test';
import { appendEvent } from './test-log';

/**
 * Wraps Playwright's default `test` with a few niceties shared across the
 * Gerald web template:
 *   - Logs every test start/end + browser dialog to the per-run JSONL log.
 *   - Installs a default `page.on('dialog')` handler that dismisses any
 *     unhandled alert/confirm/prompt so a stray dialog cannot freeze a test.
 *     Tests that want a specific response register their own handler — every
 *     registered handler runs.
 *
 * Use it the same way as `@playwright/test`:
 *   import { test, expect } from './web-fixture';
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    appendEvent({ kind: 'test.start', title: testInfo.title, file: testInfo.file });

    page.on('dialog', (d) => {
      appendEvent({ kind: 'page.dialog', type: d.type(), message: d.message() });
      d.dismiss().catch(() => {});
    });

    try {
      await use(page);
    } finally {
      appendEvent({
        kind: 'test.end',
        title: testInfo.title,
        status: testInfo.status,
        duration: testInfo.duration,
      });
    }
  },
});

export { expect } from '@playwright/test';
export { getLogPath, getRunId } from './test-log';
