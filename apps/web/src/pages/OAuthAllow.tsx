import { useEffect, useState } from 'react';
import type { OAuthClientInfo } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { OAUTH_RETURN } from '../auth/session.ts';
import { t } from '../i18n.ts';
import { signOut } from '../Shell.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { AUTH_SUBMIT, AUTH_TEXT, AuthCard, FormError, TEXT_CHOICE } from './AuthCard.tsx';

type Client = OAuthClientInfo & { redirectUri: string };

/**
 * Signs out and in again, then back to this page: for a sign-in from the last ten minutes, as a key needs, or a
 * session the server has ended.
 */
function signInAgain() {
  sessionStorage.setItem(OAUTH_RETURN, location.pathname + location.search);
  void signOut();
}

/**
 * `/oauth/authorize` (docs/mcp.md, "OAuth"): an assistant (Claude on claude.ai or a phone) asks to use Gospel Presenter
 * through MCP; the signed-in person allows it in the session's organisation, or not. Signed out, the app signs in first
 * and comes back here (main.tsx). Allowed, the answer goes to the assistant's own address with a code.
 */
export function OAuthAllow({ query }: { query: string }) {
  const q = new URLSearchParams(query);
  const [client, setClient] = useState<Client | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; again: boolean } | null>(null);
  useEffect(() => {
    const ask = new URLSearchParams({ client_id: q.get('client_id') ?? '', redirect_uri: q.get('redirect_uri') ?? '' });
    api<Client>('GET', `/api/oauth/client?${ask}`).then(
      (r) => {
        // A session the server has ended, though this device still keeps it: signed in again, back here.
        if (r.error === 'unauthenticated') return signInAgain();
        setClient(r.error === 'not-found' ? t('oauth.unknown') : r.error ? errorText(r) : r.body);
      },
      () => setClient(t('auth.offline')),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the address it was opened with
  }, [query]);

  // A request no assistant could have made (no PKCE) is refused before anything is asked.
  const wrong = q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge');
  if (client === null) return <AuthCard title={t('oauth.checking')} titleClassName="loading-line text-base/6 font-normal text-stone-400" centered />;
  if (typeof client === 'string' || wrong) return <AuthCard title={t('oauth.unknownTitle')} centered><FormError text={typeof client === 'string' ? client : t('oauth.unknown')} center /></AuthCard>;

  const back = (params: Record<string, string>) => {
    const u = new URL(client.redirectUri);
    for (const [k, v] of Object.entries({ ...params, state: q.get('state') ?? '' })) if (v) u.searchParams.set(k, v);
    location.assign(u.toString());
  };
  const allow = async () => {
    setBusy(true);
    const r = await api<{ redirect: string }>('POST', '/api/oauth/authorize', {
      clientId: q.get('client_id'),
      redirectUri: client.redirectUri,
      codeChallenge: q.get('code_challenge'),
      state: q.get('state') ?? '',
    }).catch(() => null);
    if (r && !r.error) return location.assign(r.body.redirect);
    setBusy(false);
    setError({ text: r ? errorText(r) : t('auth.offline'), again: r?.error === 'reauth-required' });
  };
  return (
    <AuthCard title={t('oauth.title', { name: client.name })} centered>
      {client.mcp ? (
        <>
          <p className={AUTH_TEXT}>{t('oauth.text', { org: client.orgName })}</p>
          <p className={AUTH_TEXT}>{t('oauth.to', { host: client.redirectHost })}</p>
          <FormError text={error?.text ?? null} center />
          <div className="flex flex-col items-center gap-2">
            {error?.again ? (
              <AppButton variant="plain" className={AUTH_SUBMIT} onClick={signInAgain}>
                {t('status.signInAgain')}
              </AppButton>
            ) : (
              <AppButton variant="plain" className={AUTH_SUBMIT} disabled={busy} onClick={() => void allow()}>
                {t('oauth.allow')}
              </AppButton>
            )}
            <AppButton variant="plain" className={TEXT_CHOICE} disabled={busy} onClick={() => back({ error: 'access_denied' })}>
              {t('common.cancel')}
            </AppButton>
          </div>
        </>
      ) : (
        <FormError text={t('oauth.mcpOff')} center />
      )}
    </AuthCard>
  );
}
