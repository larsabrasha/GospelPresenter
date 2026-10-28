import { availableParallelism } from 'node:os';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Builds the app unless turbo just did (a direct `playwright test <spec>`).
  globalSetup: './e2e/global-setup.ts',
  timeout: 90_000,
  // Each test starts its own apps, each with its own data directory and port, so files run side by side
  // (tests within a file still run in order). GP_E2E_WORKERS=1 runs one at a time.
  workers: Number(process.env.GP_E2E_WORKERS) || Math.max(1, Math.floor(availableParallelism() / 2)),
  reporter: [['list']],
});
