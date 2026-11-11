import { useEffect, useState } from 'react';
import { emailSchema, type AuthState, type ChangeEmailResponse, type Me } from '@gp/core';
import { api } from '../../auth/api.ts';
import { errorText } from '../../auth/errors.ts';
import { setSuperMode } from '../../auth/superMode.ts';
import { language, t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { AutoSaveField, useSavedIndicator } from '../../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../../ui/Dialog.tsx';
import { FloatingInput } from '../../ui/Floating.tsx';
import { ACTION_ROW, GROUP_ROW, Group, SwitchRow } from '../../ui/Group.tsx';
import { useToast } from '../../ui/Toast.tsx';

/** A new address of one's own: where the server mails, a link goes to it, and it is used once the link is opened. */
function EmailDialog({ me, onMe, onClose }: { me: Me; onMe: (m: Me) => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  return (
    <Dialog title={t('profile.changeEmail')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          if (!emailSchema.safeParse(email).success) return setError(t('error.invalid-email'));
          setSaving(true);
          setError(null);
          try {
            const address = emailSchema.parse(email);
            const r = await api<ChangeEmailResponse>('POST', '/api/auth/email', { email: address, language: language() });
            if (r.error) {
              setSaving(false);
              return setError(errorText(r));
            }
            if ('sent' in r.body) toast(t('profile.linkSent', { email: address }));
            else onMe({ ...me, email: address, emailConfirmed: false });
            onClose();
          } catch {
            setSaving(false);
            setError(t('auth.offline'));
          }
        }}
      >
        <FloatingInput label={t('profile.newEmail')} type="email" autoFocus maxLength={320} hasError={!!error} value={email} onChange={(e) => setEmail(e.target.value)} />
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!email.trim()} loading={saving}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/**
 * Profil, under Mina inställningar (docs/accounts-and-roles.md): the account is the person's, so their name and address
 * are changed here, by them; an address counts as confirmed once a link reached it or Google vouches for it. A
 * Superadmin turns superadminläge on here.
 */
export function Profile({ me, onMe }: { me: Me; onMe: (m: Me) => void }) {
  const saved = useSavedIndicator();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  /** Whether the server can send e-mail: then an unconfirmed address can be confirmed by a link. */
  const [mail, setMail] = useState(false);
  useEffect(() => {
    api<AuthState>('GET', '/api/auth/state').then(
      (r) => setMail(!r.error && r.body.mail),
      () => undefined,
    );
  }, []);
  const confirm = async () => {
    try {
      const r = await api('POST', '/api/auth/email', { email: me.email, language: language() });
      toast(r.error ? errorText(r) : t('profile.linkSent', { email: me.email ?? '' }));
    } catch {
      toast(t('auth.offline'));
    }
  };
  return (
    <>
      <Group title={t('profile.title')}>
        <div className="p-3">
          <AutoSaveField
            label={t('users.name')}
            maxLength={200}
            value={me.name}
            onSave={(v) =>
              v.trim()
                ? api('PATCH', '/api/auth/me', { name: v.trim() }).then((r) => {
                    if (r.error) throw new Error(r.error);
                    onMe({ ...me, name: v.trim() });
                  })
                : undefined
            }
            onSaved={saved.show}
          />
        </div>
        <div className={GROUP_ROW}>
          <span className="min-w-0">
            <span className="block">{t('users.email')}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400 truncate">{me.email ?? t('profile.noEmail')}</span>
          </span>
          {me.email && (
            <span className={`shrink-0 text-xs ${me.emailConfirmed ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {me.emailConfirmed ? t('profile.confirmed') : t('profile.unconfirmed')}
            </span>
          )}
        </div>
        {me.email && !me.emailConfirmed && mail && (
          <AppButton variant="plain" className={ACTION_ROW} onClick={() => void confirm()}>
            {t('profile.confirm')}
          </AppButton>
        )}
        <AppButton variant="plain" className={ACTION_ROW} onClick={() => setChanging(true)}>
          {t('profile.changeEmail')}
        </AppButton>
      </Group>
      {me.superAdmin && (
        <Group footer={t('superMode.description')}>
          <SwitchRow title={t('superMode.title')} checked={me.role === 'superAdmin'} onChange={(on) => void setSuperMode(on).then((e) => e && toast(e))} />
        </Group>
      )}
      {changing && <EmailDialog me={me} onMe={onMe} onClose={() => setChanging(false)} />}
    </>
  );
}
