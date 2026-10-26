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
copyFileSync(join(here, 'src', 'index.html'), join(out, 'index.html'));
