// Bundles the Electron main process, its preload, and a plain-Node server for
// development. better-sqlite3 stays external; the desktop uses node:sqlite.
import { build } from 'esbuild';

// Only a development or test build may point sign-in at a fake Google
// (apps/server/src/google.ts); GP_RELEASE=1 is the build a package is made from.
const define = { GP_TEST_ISSUER: process.env.GP_RELEASE === '1' ? 'false' : 'true' };

const common = {
  define,
  bundle: true,
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  logLevel: 'warning',
  external: ['electron', 'better-sqlite3', 'bufferutil', 'utf-8-validate'],
};

await build({
  ...common,
  entryPoints: ['src/main.ts', 'src/serve.ts'],
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
// A sandboxed preload must be CommonJS.
await build({ ...common, entryPoints: ['src/preload.ts'], format: 'cjs', outExtension: { '.js': '.cjs' } });
