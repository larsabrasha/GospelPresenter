// Bundles the server on its own (src/standalone.ts) into dist/node-server.mjs, for the Docker image (docs/self-hosting.md).
// Everything is inside but better-sqlite3, which the image does not use (it runs Node's own SQLite), and ws's optional
// native helpers. Never a build that signs in against a fake Google.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/standalone.ts'],
  outfile: 'dist/node-server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  define: { GP_TEST_ISSUER: 'false' },
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
