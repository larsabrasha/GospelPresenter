import { useEffect, useState } from 'react';
import { ListSearch, matches, NoMatch } from '../ui/ListSearch.tsx';
import { can, emailSchema, ROLES, type InvitationResponse, type InvitationRow, type MemberRole, type UserRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { language, t } from '../i18n.ts';
import { copyText } from '../ui/copyText.ts';
import { CopyField } from '../ui/CopyField.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { useToast } from '../ui/Toast.tsx';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput, FloatingSelect } from '../ui/Floating.tsx';
import { UserIcon, UsersPicture } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { serverOrigin } from '../server.ts';
import type { Me } from '@gp/core';
import { ROW_HOVER, RowChevron } from '../ui/List.tsx';

/** Where an invite link points: the address other devices reach this server at (DESK-R8). */
export async function inviteUrl(token: string): Promise<string> {
  const [lan] = (await window.gpDesktop?.lanUrls()) ?? [];
  return `${lan ?? serverOrigin()}/invite#${token}`;
}

/** Accepts an invite in this window: on a desktop host, Google sign-in happens at the host, in its system browser. */
export function acceptHere(token: string) {
  history.replaceState(null, '', `/invite${location.search}#${token}`);
  location.reload();
}

/** The roles to pick from, each with what it may do (Users.razor). */
function RolePicker({ role, onChange }: { role: MemberRole; onChange: (r: MemberRole) => void }) {
  return (
    <div>
      <FloatingSelect label={t('users.role')} value={role} onChange={(e) => onChange(e.target.value as MemberRole)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`role.${r}`)}
          </option>
        ))}
      </FloatingSelect>
      <div className="mt-2 text-xs text-stone-500 dark:text-stone-400 space-y-1" data-testid="role-descriptions">
        {ROLES.map((r) => (
          <div key={r}>
            <span className="font-medium">{t(`role.${r}`)}:</span> {t(`role.${r}.description`)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Bjud in (docs/accounts-and-roles.md): an address and a role. Where the server mails, the link goes only by mail;
 * elsewhere the dialog shows it, to be copied and sent, once.
 */
function InviteDialog({ onInvited, onClose }: { onInvited: (email: string) => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('user');
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const toast = useToast();
  if (link) {
    return (
      <Dialog title={t('users.inviteTitle')} onClose={onClose} maxWidthClass="max-w-lg">
        <div className="space-y-4">
          <p className="text-sm text-stone-600 dark:text-stone-300">{t('users.inviteLinkText', { email })}</p>
          <CopyField value={link} label={t('userDetail.inviteLink')} copyLabel={t('userDetail.copy')} onCopy={() => void copyText(link).then((copied) => copied && toast(t('users.copied')))} />
          <DialogButtons>
            <AppButton onClick={onClose}>{t('common.close')}</AppButton>
          </DialogButtons>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={t('users.inviteTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      {/* noValidate: a bad address gets the app's own text under the field, not the browser's bubble. */}
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!email.trim() || saving) return;
          setError(null);
          setEmailError(null);
          if (!emailSchema.safeParse(email).success) return setEmailError(t('error.invalid-email')); // ORG-A2
          setSaving(true);
          try {
            const r = await api<InvitationResponse>('POST', '/api/invitations', { email, role, language: language() });
            if (!r.error) {
              onInvited(emailSchema.parse(email));
              if (r.body.mailed) {
                toast(t('users.inviteMailed', { email: emailSchema.parse(email) }));
                return onClose();
              }
              setSaving(false);
              return setLink(await inviteUrl(r.body.inviteToken));
            }
            if (r.error === 'email-taken') setEmailError(t('users.alreadyMember'));
            else setError(errorText(r));
          } catch {
            setError(t('auth.offline'));
          }
          setSaving(false);
        }}
      >
        <div>
          <FloatingInput label={t('users.email')} type="email" autoFocus maxLength={320} hasError={!!emailError} value={email} onChange={(e) => setEmail(e.target.value)} />
          {emailError && (
            <p className="text-sm text-red-500 dark:text-red-400 mt-1" role="alert">
              {emailError}
            </p>
          )}
        </div>
        <RolePicker role={role} onChange={setRole} />
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!email.trim() || saving}>
            {saving ? t('users.inviting') : t('users.invite')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/**
 * A person at a desktop host (docs/accounts-and-roles.md, "The desktop host"): a name, maybe an address (unconfirmed,
 * for a link mailed from their page), and a role, to pair devices as. Only the host's own window signs in, so a host
 * makes people rather than inviting them.
 */
function CreateUserDialog({ onCreated, onClose }: { onCreated: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('user');
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={t('users.createTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setError(null);
          setEmailError(null);
          if (email.trim() && !emailSchema.safeParse(email).success) return setEmailError(t('error.invalid-email'));
          setSaving(true);
          try {
            const r = await api<{ id: string }>('POST', '/api/users', { name, role, email: email.trim() ? email : null });
            if (!r.error) return onCreated(r.body.id);
            setError(errorText(r));
          } catch {
            setError(t('auth.offline'));
          }
          setSaving(false);
        }}
      >
        <FloatingInput label={t('users.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <FloatingInput label={t('users.email')} type="email" maxLength={320} hasError={!!emailError} value={email} onChange={(e) => setEmail(e.target.value)} />
          {emailError && (
            <p className="text-sm text-red-500 dark:text-red-400 mt-1" role="alert">
              {emailError}
            </p>
          )}
        </div>
        <RolePicker role={role} onChange={setRole} />
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || saving}>
            {saving ? t('users.creating') : t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** A row's role, in grey at its end, as iOS's rows say a value (Lars, 2026-11-04: no coloured badge). */
export const ROLE_VALUE = 'shrink-0 text-sm text-stone-500 dark:text-stone-400';

/** How long an invite has left: "3 dagar", "1 dag", "mindre än en dag" (UserDetail.razor, days rounded up). */
export function timeLeft(expiresAt: number): string {
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000);
  return days > 1 ? t('users.days', { n: days }) : days === 1 ? t('users.oneDay') : t('users.lessThanDay');
}

function inviteStatus(u: UserRow): string {
  if (u.active) return t('users.active');
  if (!u.invite) return t('users.noLogin');
  if (u.invite.expired) return t('users.inviteExpired');
  return t('users.inviteActive', { days: timeLeft(u.invite.expiresAt) });
}

/** The organisation's users and the invitations not yet accepted, or why they cannot be shown. */
async function fetchUsers(): Promise<{ users: UserRow[]; invited: InvitationRow[] } | string> {
  try {
    const [u, i] = await Promise.all([api<UserRow[]>('GET', '/api/users'), api<InvitationRow[]>('GET', '/api/invitations')]);
    if (u.error) return errorText(u);
    return { users: u.body, invited: i.error ? [] : i.body };
  } catch {
    return t('auth.offline');
  }
}

function invitationStatus(i: InvitationRow): string {
  return i.expired ? t('users.inviteExpired') : t('users.inviteActive', { days: timeLeft(i.expiresAt) });
}

/**
 * The organisation's users (spec 01 `/admin/users`), online only: users are
 * not synced (spec 06). Needs ViewUsers. Each row links to the user's page
 * (`UserDetail.tsx`), where their role is changed, as in Users.razor; the row
 * also shows the e-mail and whether they can sign in. Under them, the
 * invitations not yet accepted, by address (Inbjuden; docs/accounts-and-roles.md).
 * A desktop host makes people instead of inviting them.
 */
export function Users({ me, hostServer }: { me: Me; hostServer: boolean | null }) {
  const [list, setList] = useState<{ users: UserRow[]; invited: InvitationRow[] } | string | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const manage = can(me.role, 'ManageUsers');
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const reload = () => void fetchUsers().then(setList);

  useEffect(() => {
    void fetchUsers().then(setList);
  }, []);
  // A desktop host makes people rather than inviting them; the button waits until it is known which.
  const host = !!hostServer;

  const users = typeof list === 'object' && list ? list.users : list;
  const invited = typeof list === 'object' && list ? list.invited.filter((i) => matches(query, i.email)) : [];
  const empty = Array.isArray(users) && !users.length;
  const shown = Array.isArray(users) ? users.filter((u) => matches(query, u.name, u.email)) : [];
  return (
    <PageContainer>
      {dialog}
      <PageHeader title={t('users.title')}>{manage && hostServer !== null && <AddButton label={host ? t('users.create') : t('users.invite')} onClick={() => setAdding(true)} />}</PageHeader>
      {typeof list === 'string' && <p className="px-5 text-sm text-red-500 dark:text-red-400">{list}</p>}
      {Array.isArray(users) && !!users.length && <ListSearch query={query} onChange={setQuery} />}
      {Array.isArray(users) && !!users.length && !shown.length && <NoMatch query={query} />}
      {/* No card until the list is here: an empty card while it comes from the server flashes by (Lars, 2026-11-05). */}
      {users === null && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
      <div className={`${CARD} ${!Array.isArray(users) || (!!users.length && !shown.length) ? 'hidden' : ''}`}>
        {empty && (
          <EmptyPicture picture={<UsersPicture className={PICTURE} />} title={t('users.empty')} />
        )}
        <ul aria-label={t('users.title')}>
          {shown.map((u) => (
              <li key={u.id} className="border-b border-separator last:border-b-0">
                <a href={href({ page: 'user', id: u.id })} className={`flex items-center gap-3 px-7 py-3 ${ROW_HOVER} cursor-pointer`}>
                  <span className="size-8 rounded-full bg-stone-300 dark:bg-raised-2 shrink-0 flex items-center justify-center text-stone-500 dark:text-stone-400">
                    <UserIcon className="size-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      <span className="font-medium">{u.name}</span> {u.email && <span className="text-sm text-stone-400 dark:text-stone-500">{u.email}</span>}
                    </div>
                    <div className="text-xs text-stone-400 dark:text-stone-500 truncate">{inviteStatus(u)}</div>
                  </div>
                  <span className={ROLE_VALUE}>{t(`role.${u.role}`)}</span>
                  <RowChevron />
                </a>
              </li>
            ))}
        </ul>
      </div>
      {invited.length > 0 && (
        <>
          <h2 className="px-7 mt-6 mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{t('users.invited')}</h2>
          <div className={CARD}>
            <ul aria-label={t('users.invited')}>
              {invited.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-7 py-3 border-b border-separator last:border-b-0">
                  <span className="size-8 rounded-full border border-dashed border-stone-300 dark:border-stone-600 shrink-0 flex items-center justify-center text-stone-400">
                    <UserIcon className="size-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{i.email}</div>
                    <div className={`text-xs truncate ${i.expired ? 'text-red-600 dark:text-red-400' : 'text-stone-400 dark:text-stone-500'}`}>{invitationStatus(i)}</div>
                  </div>
                  <span className={ROLE_VALUE}>{t(`role.${i.role}`)}</span>
                  {manage && (
                    <AppButton
                      variant="plain"
                      className="shrink-0 text-sm text-red-600 dark:text-red-400 cursor-pointer hover:underline"
                      aria-label={`${t('users.withdraw')} ${i.email}`}
                      onClick={() =>
                        void ask({
                          title: t('users.withdraw'),
                          text: t('users.withdrawConfirm', { email: i.email }),
                          bold: i.email,
                          confirm: t('users.withdraw'),
                          busy: t('common.deleting'),
                          run: async () => {
                            const r = await api('DELETE', `/api/invitations/${encodeURIComponent(i.id)}`).catch(() => null);
                            if (!r || r.error) toast(r ? errorText(r) : t('auth.offline'));
                            reload();
                          },
                        })
                      }
                    >
                      {t('users.withdraw')}
                    </AppButton>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {adding && host && <CreateUserDialog onClose={() => setAdding(false)} onCreated={(id) => navigate({ page: 'user', id })} />}
      {adding && !host && <InviteDialog onClose={() => setAdding(false)} onInvited={reload} />}
    </PageContainer>
  );
}
