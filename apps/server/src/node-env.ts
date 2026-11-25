// What a Node server takes from its environment (GP_*): sign-in, the Superadmins and e-mail. The desktop's plain-Node
// server and the Docker image (docs/self-hosting.md) read the same names.
import { mailConfigFrom } from './mail.ts';
import type { NodeServerOptions } from './node.ts';

type Env = Record<string, string | undefined>;

const list = (value: string | undefined) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : undefined);

export function signInFromEnv(env: Env): Pick<NodeServerOptions, 'google' | 'passkeys' | 'superAdmins' | 'mail'> {
  const origins = list(env.GP_PASSKEY_ORIGINS);
  return {
    google:
      env.GP_GOOGLE_CLIENT_ID && env.GP_GOOGLE_CLIENT_SECRET
        ? { clientId: env.GP_GOOGLE_CLIENT_ID, clientSecret: env.GP_GOOGLE_CLIENT_SECRET, redirectBaseUrl: env.GP_GOOGLE_REDIRECT_BASE_URL || undefined }
        : undefined,
    // Passkeys need an RP ID and the exact origins, e.g. GP_PASSKEY_RP_ID=localhost GP_PASSKEY_ORIGINS=http://localhost:8787.
    passkeys: env.GP_PASSKEY_RP_ID && origins ? { rpId: env.GP_PASSKEY_RP_ID, origins } : undefined,
    // The Superadmins (docs/accounts-and-roles.md): their addresses, comma-separated. Without them the mark setup gave counts.
    superAdmins: list(env.GP_SUPER_ADMINS),
    // E-mail through Resend: GP_RESEND_API_KEY, GP_MAIL_FROM and GP_APP_URL (the address links point at), all three or none.
    mail: mailConfigFrom({ apiKey: env.GP_RESEND_API_KEY, from: env.GP_MAIL_FROM, appUrl: env.GP_APP_URL, endpoint: env.GP_RESEND_URL }),
  };
}

/** Reverse proxies whose X-Forwarded-For names the client (docs/lan-https-and-addresses.md, "Behind a reverse proxy"). */
export const proxiesFromEnv = (env: Env) => list(env.GP_TRUSTED_PROXIES);
