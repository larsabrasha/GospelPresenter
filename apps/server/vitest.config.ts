import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests may point sign-in at the fake Google in test/fake-google.ts (src/google.ts).
  define: { GP_TEST_ISSUER: 'true' },
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one server per adapter; run files one at a time.
    fileParallelism: false,
  },
});
