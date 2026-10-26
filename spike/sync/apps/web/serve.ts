// The manual LAN test: the Node server on every interface, serving the web
// app, with users "mac" and "ipad" in organisation "demo".
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNodeServer } from '@spike/server/node';

// Runs bundled from dist-node/, so paths are relative to the app folder.
const here = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ?? join(here, '.data');
mkdirSync(dataDir, { recursive: true });
const s = await startNodeServer({ dataDir, debug: true, hostname: '0.0.0.0', port: Number(process.env.PORT ?? 8787), webRoot: join(here, 'dist') });
for (const userId of ['mac', 'ipad']) {
  await fetch(`http://127.0.0.1:${s.port}/debug/membership`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, orgId: 'demo', role: 'editor' }),
  });
}
const lan = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
console.log(`Mac:  http://localhost:${s.port}/app.html?user=mac`);
for (const a of lan) console.log(`iPad: http://${a!.address}:${s.port}/app.html?user=ipad`);
