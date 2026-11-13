// Bundles the page and its database worker into dist/, next to the wa-sqlite wasm.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(here, 'src', 'main.ts'), join(here, 'src', 'db-worker.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outdir: out,
  logLevel: 'warning',
});
const wasDist = join(dirname(createRequire(import.meta.url).resolve('@journeyapps/wa-sqlite')), '..', 'dist');
copyFileSync(join(wasDist, 'wa-sqlite.wasm'), join(out, 'wa-sqlite.wasm'));
for (const page of ['index.html', 'app.html']) copyFileSync(join(here, 'src', page), join(out, page));

// The LAN test server (serve.ts) for plain Node. better-sqlite3 stays external: it is native.
await build({
  entryPoints: [join(here, 'serve.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(here, 'dist-node', 'serve.mjs'),
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
