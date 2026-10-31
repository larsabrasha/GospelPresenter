import type { SignInResponse } from '@gp/core';
import { t } from '../i18n.ts';
import { api } from './api.ts';
import { errorText } from './errors.ts';
import { saveSession } from './session.ts';

// Switching organisation (spec 01 switcher, ORG-R7): the server gives a session in the other organisation, which this
// device keeps; the page then loads again, so the database worker opens that organisation's database (D3).

/** The session the server gives for `orgId`, or why not. `token` is the session to ask with (the stored one by default). */
export async function sessionIn(orgId: string, token?: string): Promise<SignInResponse | string> {
  try {
    const r = await api<SignInResponse>('POST', '/api/auth/switch', { orgId }, token ? { token } : {});
    return r.error ? errorText(r) : r.body;
  } catch {
    return t('auth.offline');
  }
}

/** Keeps `s` on this device and loads `path` with it. */
export function enterWith(s: SignInResponse, path = '/') {
  saveSession(s);
  history.replaceState(null, '', path);
  location.reload();
}

/** Switches to `orgId` and opens `path` there; a refusal is the text returned. */
export async function switchOrg(orgId: string, path = '/'): Promise<string | void> {
  const s = await sessionIn(orgId);
  if (typeof s === 'string') return s;
  enterWith(s, path);
}
