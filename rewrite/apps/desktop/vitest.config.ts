import { defineConfig } from 'vitest/config';

// Unit tests of the desktop host's own code. The e2e (`e2e/*.spec.ts`) is Playwright's, not these.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
