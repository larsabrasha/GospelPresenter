import { useCallback, useEffect, useState } from 'react';
import { emailSchema, inviteRefusal, removeUserRefusal, roleChangeRefusal, ROLES, userEditRefusal, type LoginMethod, type Me, type Role, type UserRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField, useSavedIndicator } from '../ui/AutoSave.tsx';
import { CopyField } from '../ui/CopyField.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { FloatingInput, FloatingSelect } from '../ui/Floating.tsx';
import { KeyPicture, LinkIcon } from '../ui/icons.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { acceptHere, copy, forgetInvite, freshInvite, inviteUrl, timeLeft } from './Users.tsx';

const CARD = 'bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 rounded-xl shadow-sm border-t-[0.5px] border-white dark:border-neutral-700 p-5 space-y-4';
const ERROR = 'text-sm text-red-500 dark:text-red-400';

const providerName = (l: LoginMethod) => t(`userDetail.provider.${l.provider}`);

type Detail = { user: UserRow | string; logins: LoginMethod[] | string | null } | 'gone';

/** The user and their logins, or why they cannot be shown. */
async function fetchDetail(path: string): Promise<Detail> {
  try {
    const [u, l] = await Promise.all([api<UserRow>('GET', path), api<LoginMethod[]>('GET', `${path}/logins`)]);
    if (u.status === 404) return 'gone';
    return { user: u.error ? errorText(u) : u.body, logins: l.error ? errorText(l) : l.body };
  } catch {
    return { user: t('auth.offline'), logins: null };
  }
}

/**
 * One user of the organisation (spec 01 `/admin/users/{id}`, UserDetail.razor):
 * name and e-mail saved as they are typed, the role, the linked logins, the
 * invite while there are none, and Radera användare. Online only, as the list.
 * The server checks every change again; the page only stops offering what it
 * would refuse. Not here yet: the profile picture (profiles come later).
 */
export function UserDetail({ id, me, host }: { id: string; me: Me; host: boolean }) {
  const [user, setUser] = useState<UserRow | string | null>(null);
  const [logins, setLogins] = useState<LoginMethod[] | string | null>(null);
  /** The new invite's link, shown once (AUTH-R13): only until the page is left. A user just made comes with theirs. */
  const [link, setLink] = useState<string | null>(() => freshInvite(id));
  const [emailError, setEmailError] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const saved = useSavedIndicator();
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const path = `/api/users/${encodeURIComponent(id)}`;

  const apply = useCallback((d: Detail) => {
    // Another organisation's user, or one removed meanwhile: back to the list, as the old page.
    if (d === 'gone') return navigate({ page: 'users' });
    setUser(d.user);
    setLogins(d.logins);
  }, []);
  const load = useCallback(() => fetchDetail(path).then(apply), [path, apply]);
  useEffect(() => {
    void fetchDetail(path).then(apply);
  }, [path, apply]);
  useEffect(() => () => forgetInvite(id), [id]);

  /** Runs a change and reloads; a refusal is a toast. True when it went through. */
  const act = async (method: string, url: string): Promise<boolean> => {
    try {
      const r = await api(method, url);
      if (r.error) toast(errorText(r));
      await load();
      return !r.error;
    } catch {
      toast(t('auth.offline'));
      return false;
    }
  };

  /** Saves name or e-mail; a taken address is answered, anything else refused throws ("Kunde inte spara"). */
  const patch = async (body: { name?: string; email?: string | null }): Promise<'ok' | 'email-taken'> => {
    const r = await api('PATCH', path, body);
    if (r.error === 'email-taken') return 'email-taken';
    if (r.error) throw new Error(r.error);
    setUser((u) => (u && typeof u === 'object' ? { ...u, ...body } : u));
    return 'ok';
  };

  if (user === null || typeof user === 'string') {
    return (
      <PageContainer>
        <DetailHeader backHref="/admin/users" title="" className="px-5" />
        <div className={`px-7 ${user ? ERROR : 'text-neutral-400'}`}>{user ?? t('common.loading')}</div>
      </PageContainer>
    );
  }

  const actor = { id: me.userId, role: me.role };
  const self = user.id === me.userId;
  const canEdit = !userEditRefusal(actor, user);
  const roles = ROLES.filter((r) => r === user.role || !roleChangeRefusal(actor, user, r));

  const changeRole = async (role: Role) => {
    setRoleError(null);
    try {
      const r = await api('PATCH', path, { role });
      if (r.error) return setRoleError(errorText(r));
      setUser({ ...user, role });
      saved.show();
    } catch {
      setRoleError(t('auth.offline'));
    }
  };

  /** A new invite; `replace` deletes the user's other invites first, so the link that got lost stops working. */
  const createInvite = async (replace = false) => {
    try {
      if (replace) {
        const d = await api('DELETE', `${path}/invites`);
        if (d.error) {
          toast(errorText(d));
          return;
        }
      }
      const r = await api<{ inviteToken: string }>('POST', `${path}/invites`);
      if (r.error) toast(errorText(r));
      else setLink(await inviteUrl(r.body.inviteToken));
    } catch {
      toast(t('auth.offline'));
    }
    await load();
  };

  const deleteUser = async () => {
    setDeleteError(null);
    try {
      const r = await api('DELETE', path);
      if (r.error) return setDeleteError(errorText(r));
      navigate({ page: 'users' });
    } catch {
      setDeleteError(t('auth.offline'));
    }
  };

  const invite = user.invite;
  return (
    <PageContainer>
      {dialog}
      <DetailHeader backHref="/admin/users" title={user.name} saved={saved.node} className="px-5" />
      <div className={CARD}>
        {canEdit ? (
          <>
            {/* A blank name is not saved. */}
            <AutoSaveField label={t('users.name')} maxLength={200} value={user.name} onSave={(v) => (v.trim() ? patch({ name: v.trim() }) : undefined)} onSaved={saved.show} />
            <div>
              <AutoSaveField
                label={t('users.email')}
                type="email"
                maxLength={320}
                hasError={!!emailError}
                value={user.email ?? ''}
                onSave={(v) => {
                  setEmailError(null);
                  const email = v.trim();
                  // Checked here first, as UserDetail.razor; the field keeps what was typed, with the error under it.
                  if (email && !emailSchema.safeParse(email).success) {
                    setEmailError(t('error.invalid-email'));
                    return Promise.resolve();
                  }
                  return patch({ email: email ? emailSchema.parse(email) : null }).then((r) => (r === 'ok' ? saved.show() : setEmailError(t('error.email-taken'))));
                }}
              />
              {emailError && (
                <p className={`${ERROR} mt-1`} role="alert">
                  {emailError}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <FloatingInput label={t('users.name')} value={user.name} disabled readOnly />
            <FloatingInput label={t('users.email')} type="email" value={user.email ?? ''} disabled readOnly />
          </>
        )}
        <div>
          <FloatingSelect label={t('users.role')} value={user.role} disabled={self || !canEdit} onChange={(e) => void changeRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </FloatingSelect>
          {self ? (
            <div className="text-sm text-neutral-500 mt-1">{t('users.ownRole')}</div>
          ) : (
            !canEdit && <div className="text-sm text-neutral-500 mt-1">{t('userDetail.superAdminOnly')}</div>
          )}
          {roleError && (
            <div className={`${ERROR} mt-1`} role="alert">
              {roleError}
            </div>
          )}
        </div>
      </div>

      <div className={CARD}>
        <div className="font-semibold">{t('userDetail.login')}</div>
        {logins === null && <div className="text-neutral-400">{t('common.loading')}</div>}
        {typeof logins === 'string' && <div className={ERROR}>{logins}</div>}
        {Array.isArray(logins) && logins.length > 0 && (
          <ul aria-label={t('userDetail.login')} className="space-y-4">
            {logins.map((l) => (
              <li
                key={`${l.provider}:${l.id}`}
                className="flex items-center justify-between gap-3 p-3 bg-white dark:bg-neutral-700 rounded-xl border border-neutral-200 dark:border-neutral-600"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm">{providerName(l)}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono break-all">{l.id}</div>
                </div>
                {canEdit && (
                  <AppButton
                    variant="danger"
                    className="px-3 py-1.5"
                    aria-label={`${t('common.delete')} ${providerName(l)}`}
                    onClick={() =>
                      void ask({
                        title: t('userDetail.deleteLogin'),
                        text: t('userDetail.confirmDeleteLogin', { provider: providerName(l) }),
                        confirm: t('common.delete'),
                        busy: t('common.deleting'),
                        run: () => act('DELETE', `${path}/logins/${encodeURIComponent(l.provider)}/${encodeURIComponent(l.id)}`),
                      })
                    }
                  >
                    {t('common.delete')}
                  </AppButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {Array.isArray(logins) && logins.length === 0 && (
          <>
            {!invite && (
              <div className="flex flex-col items-center text-center py-4 select-none">
                <KeyPicture className="w-32 h-auto mb-3 text-neutral-300 dark:text-neutral-600" />
                <p className="text-sm text-neutral-400 dark:text-neutral-500 leading-relaxed">
                  {t('userDetail.noLogins')}
                  <br />
                  {t('userDetail.noLoginsText')}
                </p>
              </div>
            )}
            {invite && (
              <div
                data-testid="invite"
                className={`p-4 bg-white dark:bg-neutral-700 rounded-xl border border-neutral-200 dark:border-neutral-600 space-y-2 ${invite.expired ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <LinkIcon className="size-4 text-neutral-400" />
                    <span className="text-sm font-medium">{t('userDetail.inviteLink')}</span>
                    {invite.expired ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">{t('userDetail.expired')}</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                        {t('userDetail.active')}
                      </span>
                    )}
                  </div>
                  {!inviteRefusal(actor, user) && (
                    <AppButton
                      variant="danger"
                      className="px-3 py-1.5"
                      onClick={() =>
                        void ask({
                          title: t('userDetail.deleteInvite'),
                          text: t('userDetail.confirmDeleteInvite'),
                          confirm: t('common.delete'),
                          busy: t('common.deleting'),
                          run: async () => {
                            if (await act('DELETE', `${path}/invites`)) setLink(null);
                          },
                        })
                      }
                    >
                      {t('common.delete')}
                    </AppButton>
                  )}
                </div>
                {!invite.expired && (
                  <>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('userDetail.expiresIn', { time: timeLeft(invite.expiresAt) })}</div>
                    {/* The link exists only in this page, from when it was made (AUTH-R13); on a host it is accepted here (Users.tsx). */}
                    {link && !host && (
                      <div className="space-y-2">
                        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('users.inviteText', { name: user.name })}</p>
                        <CopyField
                          inputRef={setInput}
                          value={link}
                          label={t('userDetail.inviteLink')}
                          copyLabel={t('userDetail.copy')}
                          onCopy={() => void copy(input, link).then(() => toast(t('users.copied')))}
                        />
                        {/* Where the system's share sheet exists (phones, Safari): to send it in a message. */}
                        {'share' in navigator && (
                          <AppButton variant="secondary" onClick={() => void navigator.share({ title: t('userDetail.inviteLink'), url: link }).catch(() => undefined)}>
                            {t('userDetail.share')}
                          </AppButton>
                        )}
                      </div>
                    )}
                    {link && host && (
                      <div className="space-y-2">
                        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('users.inviteHost', { name: user.name })}</p>
                        <AppButton variant="secondary" onClick={() => acceptHere(link.slice(link.indexOf('#') + 1))}>
                          {t('users.acceptHere', { name: user.name })}
                        </AppButton>
                      </div>
                    )}
                    {!link && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">{t('userDetail.linkShownOnce')}</div>
                        {!inviteRefusal(actor, user) && (
                          <AppButton variant="secondary" onClick={() => void createInvite(true)}>
                            {t('userDetail.newLink')}
                          </AppButton>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {(!invite || invite.expired) && !inviteRefusal(actor, user) && (
              <div className="flex justify-center">
                <AppButton onClick={() => void createInvite()}>{t('userDetail.createInvite')}</AppButton>
              </div>
            )}
          </>
        )}
      </div>

      {!self && !removeUserRefusal(actor, user) && (
        <div className="flex flex-col items-end gap-1">
          <AppButton
            variant="danger"
            onClick={() =>
              void ask({
                title: t('users.remove'),
                text: t('users.removeConfirm', { name: user.name }),
                bold: user.name,
                confirm: t('common.delete'),
                busy: t('common.deleting'),
                run: deleteUser,
              })
            }
          >
            {t('users.remove')}
          </AppButton>
          {deleteError && <div className={ERROR}>{deleteError}</div>}
        </div>
      )}
    </PageContainer>
  );
}
