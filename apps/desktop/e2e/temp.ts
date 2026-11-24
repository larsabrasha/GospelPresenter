// Every directory a test makes (data dirs, certificates, copies of the web app) lies in one directory for the
// run, which global-setup.ts makes and global-teardown.ts removes, also when tests fail: a run leaves the
// system's temp directory as it found it. An app's data dir has its Chromium profile (~50 MB), and a run
// starts some hundred apps. Workers get the directory through the environment; a run never touches another's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUN_DIR = 'GP_E2E_TMP';

export function makeRunDir(): void {
  process.env[RUN_DIR] = mkdtempSync(join(tmpdir(), 'gp-e2e-'));
}

export function removeRunDir(): void {
  const dir = process.env[RUN_DIR];
  // An app that is still closing may write a file while this removes the directory, hence the retries.
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}

/** A new empty directory for a test, inside the run's directory. */
export function testDir(prefix: string): string {
  return mkdtempSync(join(process.env[RUN_DIR] ?? tmpdir(), prefix));
}
