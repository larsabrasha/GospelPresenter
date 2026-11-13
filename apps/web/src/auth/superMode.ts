import type { SuperModeResponse } from '@gp/core';
import { t } from '../i18n.ts';
import { api } from './api.ts';
import { errorText } from './errors.ts';
import { enterWith } from './orgs.ts';
import { storedSession } from './session.ts';

// Superadminläge (docs/accounts-and-roles.md): a Superadmin's powers wait behind it. The role is part of the
// session the database worker syncs with, so the page loads again with it, as switching organisation does.

/**
 * Turns superadminläge on (after a sign-in of one's own from the last few minutes) or off, and loads the page again;
 * a refusal is the text returned. Turned off in an organisation one is no member of, the page opens one's own.
 */
export async function setSuperMode(on: boolean): Promise<string | void> {
  try {
    const r = await api<SuperModeResponse>('POST', '/api/auth/superadmin', { on });
    if (r.error) return errorText(r);
    const token = r.body.token ?? storedSession()?.token;
    if (!token) return t('auth.failed');
    enterWith({ token, me: r.body.me }, r.body.token ? '/' : location.pathname + location.search);
  } catch {
    return t('auth.offline');
  }
}
