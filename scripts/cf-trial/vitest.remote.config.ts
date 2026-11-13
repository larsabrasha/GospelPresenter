// The server suites and the trial's own tests against the deployed trial Worker (README.md here).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('../../apps/server'),
  define: { GP_TEST_ISSUER: 'true' },
  test: {
    include: ['test/**/*.test.ts', here('./tests') + '/**/*.test.ts'],
    setupFiles: [here('./remote-setup.ts')],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
