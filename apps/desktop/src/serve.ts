// The embedded server under plain Node, for `pnpm dev` in apps/web and for
// browsers on this machine. On localhost it has no pairing; with GP_LAN=1 it
// pairs devices like the desktop app, with codes made by whoever holds the
// host token it prints.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signInFromEnv } from '@gp/server/node';
import { onLan, pageUrl, startHost } from './host.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const hostToken = onLan() ? `gphost_${randomBytes(32).toString('base64url')}` : null;
const server = await startHost({
  dataDir: process.env.GP_DATA_DIR ?? join(here, '..', '.data'),
  webRoot: process.env.GP_WEB_ROOT ?? join(here, '..', '..', 'web', 'dist'),
  port: Number(process.env.PORT ?? 8787),
  hostToken,
  // Google, passkeys, the Superadmins and e-mail, from the same GP_* names as the Docker image (docs/self-hosting.md).
  ...signInFromEnv(process.env),
});
console.log(`Gospel Presenter: ${pageUrl(server.url)}`);
if (server.tls) console.log(`Over https: ${pageUrl(server.tls.url)}`);
if (hostToken) console.log(`Host device token (send as x-gp-device to make pairing codes): ${hostToken}`);
if (server.setupToken) console.log(`Setup token: ${server.setupToken}`);
