/**
 * Generates a single run ID for this `playwright test` invocation and
 * publishes it via the GERALD_TEST_RUN_ID env var so every worker writes to
 * the same JSONL log file under
 *   <tmpdir>/gerald-test-logs/<projectName>/<runId>.jsonl
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.GERALD_TEST_RUN_ID) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const rnd = Math.random().toString(36).slice(2, 8);
    process.env.GERALD_TEST_RUN_ID = `${ts}_${rnd}`;
  }
}
