import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname_ = dirname(fileURLToPath(import.meta.url));

function readProjectName(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname_, '..', 'package.json'), 'utf8'));
    return String(pkg.name ?? 'unnamed-project').replace(/[^a-zA-Z0-9_-]+/g, '_');
  } catch {
    return 'unnamed-project';
  }
}

function newRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}_${rnd}`;
}

const PROJECT_NAME = readProjectName();
const RUN_ID = process.env.GERALD_TEST_RUN_ID ?? newRunId();
const LOG_PATH = resolve(tmpdir(), 'gerald-test-logs', PROJECT_NAME, `${RUN_ID}.jsonl`);

mkdirSync(dirname(LOG_PATH), { recursive: true });

export function getLogPath(): string {
  return LOG_PATH;
}

export function getRunId(): string {
  return RUN_ID;
}

export function appendEvent(event: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), ...event }) + '\n';
  try { appendFileSync(LOG_PATH, line); } catch { /* never throw from logger */ }
}
