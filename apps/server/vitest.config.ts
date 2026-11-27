import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests may point sign-in at the fake Google in test/fake-google.ts (src/google.ts).
  define: { GP_TEST_ISSUER: 'true' },
  plugins: [
    {
      // The picture codecs' WebAssembly (src/picture-codecs.ts) as its bytes, as esbuild's `binary` loader hands it to Node.
      name: 'wasm-bytes',
      enforce: 'pre',
      load: (id) => (id.endsWith('.wasm') ? `export default new Uint8Array(Buffer.from('${readFileSync(id).toString('base64')}', 'base64'));` : null),
    },
  ],
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one server per adapter; run files one at a time.
    fileParallelism: false,
    // Through the plugin above, not Node's own loading of a .wasm, which reads it as a module of imports.
    server: { deps: { inline: [/@jsquash/, /@resvg/] } },
  },
});
