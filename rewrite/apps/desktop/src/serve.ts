// The embedded server under plain Node, for `pnpm dev` in apps/web and for
// browsers on this machine. On localhost it has no pairing; with GP_LAN=1 it
// pairs devices like the desktop app, with codes made by whoever holds the
// host token it prints.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onLan, pageUrl, startHost } from './host.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const hostToken = onLan() ? `gphost_${randomBytes(32).toString('base64url')}` : null;
const server = await startHost({
  dataDir: process.env.GP_DATA_DIR ?? join(here, '..', '.data'),
  webRoot: process.env.GP_WEB_ROOT ?? join(here, '..', '..', 'web', 'dist'),
  port: Number(process.env.PORT ?? 8787),
  hostToken,
  google:
    process.env.GP_GOOGLE_CLIENT_ID && process.env.GP_GOOGLE_CLIENT_SECRET
      ? { clientId: process.env.GP_GOOGLE_CLIENT_ID, clientSecret: process.env.GP_GOOGLE_CLIENT_SECRET, redirectBaseUrl: process.env.GP_GOOGLE_REDIRECT_BASE_URL || undefined }
      : undefined,
  // Passkeys need an RP ID and the exact origins, e.g. GP_PASSKEY_RP_ID=localhost GP_PASSKEY_ORIGINS=http://localhost:8787.
  passkeys:
    process.env.GP_PASSKEY_RP_ID && process.env.GP_PASSKEY_ORIGINS
      ? { rpId: process.env.GP_PASSKEY_RP_ID, origins: process.env.GP_PASSKEY_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) }
      : undefined,
});
console.log(`Gospel Presenter: ${pageUrl(server.url)}`);
if (server.tls) console.log(`Over https: ${pageUrl(server.tls.url)}`);
if (hostToken) console.log(`Host device token (send as x-gp-device to make pairing codes): ${hostToken}`);
if (server.setupToken) console.log(`Setup token: ${server.setupToken}`);
