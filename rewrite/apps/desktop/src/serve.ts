// The embedded server under plain Node, for `pnpm dev` in apps/web and for
// browsers on this machine. On localhost it has no pairing; with GP_LAN=1 it
// pairs devices like the desktop app, with codes made by whoever holds the
// host token it prints.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mailConfigFrom } from '@gp/server/node';
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
  // The Superadmins (docs/accounts-and-roles.md): their addresses, comma-separated. Without them the mark setup gave counts.
  superAdmins: process.env.GP_SUPER_ADMINS ? process.env.GP_SUPER_ADMINS.split(',').map((e) => e.trim()).filter(Boolean) : undefined,
  // E-mail through Resend: GP_RESEND_API_KEY, GP_MAIL_FROM and GP_APP_URL (the address links point at), all three or none.
  mail: mailConfigFrom({ apiKey: process.env.GP_RESEND_API_KEY, from: process.env.GP_MAIL_FROM, appUrl: process.env.GP_APP_URL, endpoint: process.env.GP_RESEND_URL }),
});
console.log(`Gospel Presenter: ${pageUrl(server.url)}`);
if (server.tls) console.log(`Over https: ${pageUrl(server.tls.url)}`);
if (hostToken) console.log(`Host device token (send as x-gp-device to make pairing codes): ${hostToken}`);
if (server.setupToken) console.log(`Setup token: ${server.setupToken}`);
