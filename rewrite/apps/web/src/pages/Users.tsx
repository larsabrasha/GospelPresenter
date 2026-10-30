import { useEffect, useState } from 'react';
import { assignableRoles, can, emailSchema, type Me, type Role, type UserRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput, FloatingSelect } from '../ui/Floating.tsx';
import { PlusIcon, UserIcon, UsersPicture } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';

/** Where an invite link points: the address other devices reach this server at (DESK-R8). */
export async function inviteUrl(token: string): Promise<string> {
  const [lan] = (await window.gpDesktop?.lanUrls()) ?? [];
  return `${lan ?? location.origin}/invite#${token}`;
}

export function copy(input: HTMLInputElement | null, text: string): Promise<void> {
  // The clipboard API needs a secure context, which a LAN address over http is not.
  if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(text);
  input?.select();
  document.execCommand('copy');
  return Promise.resolve();
}

/**
 * A new user's invite link, for their page to show (AUTH-R13: once). Held in
 * this window only, until that page is left (`forgetInvite`).
 */
const freshInvites = new Map<string, string>();

export function showInviteOnce(userId: string, url: string) {
  freshInvites.set(userId, url);
}

export function freshInvite(userId: string): string | null {
  return freshInvites.get(userId) ?? null;
}

export function forgetInvite(userId: string) {
  freshInvites.delete(userId);
}

/** Accepts an invite in this window: on a desktop host, Google sign-in happens at the host, in its system browser. */
export function acceptHere(token: string) {
  history.replaceState(null, '', `/invite${location.search}#${token}`);
  location.reload();
}

function CreateUserDialog({ me, onCreated, onClose }: { me: Me; onCreated: (id: string, token: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [error, setError] = useState<string | null>(null);
  /** What is wrong with the address, under its field (Users.razor): not an address, or another user's. */
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const roles = assignableRoles(me.role);
  return (
    <Dialog title={t('users.createTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      {/* noValidate: a bad address gets the app's own text under the field, not the browser's bubble. */}
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          setError(null);
          setEmailError(null);
          if (!emailSchema.safeParse(email).success) return setEmailError(t('error.invalid-email')); // ORG-A2
          setSaving(true);
          try {
            // The server refuses a taken address before it creates anyone.
            const r = await api<{ id: string; inviteToken: string }>('POST', '/api/users', { name, email, role });
            if (!r.error) return onCreated(r.body.id, r.body.inviteToken);
            if (r.error === 'email-taken') setEmailError(errorText(r));
            else setError(errorText(r));
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
        <div>
          {/* ORG-A3: SuperAdmin is offered only to a SuperAdmin. */}
          <FloatingSelect label={t('users.role')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </FloatingSelect>
          {/* Every role offered, with what it may do (Users.razor). */}
          <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 space-y-1" data-testid="role-descriptions">
            {roles.map((r) => (
              <div key={r}>
                <span className="font-medium">{t(`role.${r}`)}:</span> {t(`role.${r}.description`)}
              </div>
            ))}
          </div>
        </div>
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

/** A role's badge colours (Users.razor). */
export const ROLE_BADGE: Record<Role, string> = {
  superAdmin: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
  admin: 'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300',
  user: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
};

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

/** The organisation's users, or why they cannot be shown. */
async function fetchUsers(): Promise<UserRow[] | string> {
  try {
    const r = await api<UserRow[]>('GET', '/api/users');
    return r.error ? errorText(r) : r.body;
  } catch {
    return t('auth.offline');
  }
}

/**
 * The organisation's users (spec 01 `/admin/users`), online only: users are
 * not synced (spec 06). Needs ViewUsers. Each row links to the user's page
 * (`UserDetail.tsx`), where they are changed, as in Users.razor; the row also
 * shows the e-mail and the invite state, which the old one does not. A new
 * user's page opens with their invite link, shown that once (spec 01).
 */
export function Users({ me }: { me: Me }) {
  const [users, setUsers] = useState<UserRow[] | string | null>(null);
  const [creating, setCreating] = useState(false);
  const manage = can(me.role, 'ManageUsers');

  useEffect(() => {
    void fetchUsers().then(setUsers);
  }, []);

  const empty = Array.isArray(users) && !users.length;
  const create = (
    <AppButton onClick={() => setCreating(true)} className="flex items-center gap-1.5">
      <PlusIcon className="size-4" />
      {t('users.create')}
    </AppButton>
  );
  return (
    <PageContainer>
      <PageHeader title={t('users.title')}>{manage && !empty && create}</PageHeader>
      {typeof users === 'string' && <p className="px-5 text-sm text-red-500 dark:text-red-400">{users}</p>}
      <div className={CARD}>
        {users === null && <div className="px-7 py-4 text-neutral-400">{t('common.loading')}</div>}
        {empty && (
          <EmptyPicture picture={<UsersPicture className={PICTURE} />} title={t('users.empty')} text={t('users.emptyText')}>
            {manage && create}
          </EmptyPicture>
        )}
        <ul aria-label={t('users.title')}>
          {Array.isArray(users) &&
            users.map((u) => (
              <li key={u.id} className="border-b border-neutral-200 dark:border-neutral-700 last:border-b-0">
                <a href={href({ page: 'user', id: u.id })} className="flex items-center gap-3 px-7 py-3 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer">
                  <span className="size-8 rounded-full bg-neutral-300 dark:bg-neutral-600 shrink-0 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
                    <UserIcon className="size-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      <span className="font-medium">{u.name}</span> {u.email && <span className="text-sm text-neutral-400 dark:text-neutral-500">{u.email}</span>}
                    </div>
                    <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{inviteStatus(u)}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}>{t(`role.${u.role}`)}</span>
                </a>
              </li>
            ))}
        </ul>
      </div>
      {creating && (
        <CreateUserDialog
          me={me}
          onClose={() => setCreating(false)}
          onCreated={async (id, token) => {
            showInviteOnce(id, await inviteUrl(token));
            navigate({ page: 'user', id });
          }}
        />
      )}
    </PageContainer>
  );
}
