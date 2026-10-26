import { t, type TextKey } from '../i18n.ts';
import type { ApiResult } from './api.ts';

const known = new Set<string>([
  'google-disabled',
  'google-failed',
  'passkey-disabled',
  'passkey-failed',
  'last-login',
  'reauth-required',
  'not-linked',
  'login-taken',
  'callback-scheme',
  'not-a-member',
  'invalid-request',
  'setup-token',
  'setup-done',
  'email-taken',
  'limit',
  'forbidden',
  'super-admin-only',
  'own-role',
  'own-account',
  'pair-code-invalid',
  'invite-invalid',
  'invite-expired',
]);

/** The Swedish text for a refusal from the auth API (one error contract, spec README). */
export function errorText(r: Pick<ApiResult<unknown>, 'error' | 'body'>): string {
  if (r.error === 'too-many-attempts') {
    const seconds = (r.body as { retryAfter?: number } | null)?.retryAfter ?? 60;
    return t('error.too-many-attempts', { minutes: Math.max(1, Math.ceil(seconds / 60)) });
  }
  return r.error && known.has(r.error) ? t(`error.${r.error}` as TextKey) : t('error.unknown');
}
