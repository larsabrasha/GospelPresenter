// The same embedded server and operator client as main.ts, under plain Node.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDesktop } from './desktop.ts';

await runDesktop({
  dataDir: process.env.DATA_DIR ?? mkdtempSync(join(tmpdir(), 'gp-desktop-')),
  runtime: `node ${process.version}`,
  emit: (e) => process.stdout.write(JSON.stringify(e) + '\n'),
});
