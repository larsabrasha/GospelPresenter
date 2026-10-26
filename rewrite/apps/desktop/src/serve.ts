// The embedded server under plain Node, for `pnpm dev` in apps/web and for
// browsers on this machine: http://127.0.0.1:8787/?user=operator
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATOR, pageUrl, startHost } from './host.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const server = await startHost({
  dataDir: process.env.GP_DATA_DIR ?? join(here, '..', '.data'),
  webRoot: process.env.GP_WEB_ROOT ?? join(here, '..', '..', 'web', 'dist'),
  port: Number(process.env.PORT ?? 8787),
});
console.log(`Gospel Presenter: ${pageUrl(server.url, OPERATOR)}`);
