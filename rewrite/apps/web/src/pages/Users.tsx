import { useCallback, useEffect, useState } from 'react';
import {
  assignableRoles,
  can,
  emailSchema,
  inviteRefusal,
  removeUserRefusal,
  roleChangeRefusal,
  ROLES,
  type Me,
  type Role,
  type UserRow,
} from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CopyField } from '../ui/CopyField.tsx';
import { deleteAsk, Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { EmptyPicture, PICTURE } from '../ui/Empty.tsx';
import { FloatingInput, FloatingSelect } from '../ui/Floating.tsx';
import { ChevronDownIcon, PlusIcon, UserIcon, UsersPicture } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { useToast } from '../ui/Toast.tsx';

/** Where an invite link points: the address other devices reach this server at (DESK-R8). */
async function inviteUrl(token: string): Promise<string> {
  const [lan] = (await window.gpDesktop?.lanUrls()) ?? [];
  return `${lan ?? location.origin}/invite#${token}`;
}

function copy(input: HTMLInputElement | null, text: string): Promise<void> {
  // The clipboard API needs a secure context, which a LAN address over http is not.
  if (navigator.clipboard && isSecureContext) return navigator.clipboard.writeText(text);
  input?.select();
  document.execCommand('copy');
  return Promise.resolve();
}

/** Accepts an invite in this window: on a desktop host, Google sign-in happens at the host, in its system browser. */
function acceptHere(token: string) {
  history.replaceState(null, '', `/invite${location.search}#${token}`);
  location.reload();
}

/**
 * The link, shown once (AUTH-R13): it is not stored in a form that could
 * show it again. On a desktop host the invited person accepts it at the
 * host; other devices join by pairing, never by Google against the host.
 */
function InviteLinkDialog({ name, url, host, onClose }: { name: string; url: string; host: boolean; onClose: () => void }) {
  const toast = useToast();
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  if (host) {
    return (
      <Dialog title={t('users.inviteTitle')} onClose={onClose} maxWidthClass="max-w-lg">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('users.inviteHost', { name })}</p>
        <DialogButtons>
          <AppButton variant="secondary" onClick={() => acceptHere(url.slice(url.indexOf('#') + 1))}>
            {t('users.acceptHere', { name })}
          </AppButton>
          <AppButton onClick={onClose}>{t('common.close')}</AppButton>
        </DialogButtons>
      </Dialog>
    );
  }
  return (
    <Dialog title={t('users.inviteTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('users.inviteText', { name })}</p>
      <CopyField inputRef={setInput} value={url} label={t('users.inviteLink')} copyLabel={t('users.copy')} onCopy={() => void copy(input, url).then(() => toast(t('users.copied')))} />
      <DialogButtons>
        <AppButton onClick={onClose}>{t('common.close')}</AppButton>
      </DialogButtons>
    </Dialog>
  );
}

function CreateUserDialog({ me, onCreated, onClose }: { me: Me; onCreated: (name: string, token: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={t('users.createTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          if (!emailSchema.safeParse(email).success) return setError(t('error.invalid-email')); // ORG-A2
          setSaving(true);
          try {
            const r = await api<{ inviteToken: string }>('POST', '/api/users', { name, email, role });
            if (!r.error) return onCreated(name.trim(), r.body.inviteToken);
            setError(errorText(r));
          } catch {
            setError(t('auth.offline'));
          }
          setSaving(false);
        }}
      >
        <FloatingInput label={t('users.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        <FloatingInput label={t('users.email')} type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
        <div>
          {/* ORG-A3: SuperAdmin is offered only to a SuperAdmin. */}
          <FloatingSelect label={t('users.role')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {assignableRoles(me.role).map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </FloatingSelect>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{t(`role.${role}.description`)}</p>
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
const ROLE_BADGE: Record<Role, string> = {
  superAdmin: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
  admin: 'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300',
  user: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
};

function inviteStatus(u: UserRow): string {
  if (u.active) return t('users.active');
  if (!u.invite) return t('users.noLogin');
  if (u.invite.expired) return t('users.inviteExpired');
  const days = Math.ceil((u.invite.expiresAt - Date.now()) / 86_400_000);
  return t('users.inviteActive', { days: days > 1 ? t('users.days', { n: days }) : days === 1 ? t('users.oneDay') : t('users.lessThanDay') });
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
 * not synced (spec 06). Needs ViewUsers; the actions need ManageUsers, and the
 * server checks each one again.
 */
export function Users({ me, host }: { me: Me; host: boolean }) {
  const [users, setUsers] = useState<UserRow[] | string | null>(null);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const toast = useToast();
  const { dialog, ask } = useConfirm();
  const manage = can(me.role, 'ManageUsers');

  const load = useCallback(() => fetchUsers().then(setUsers), []);
  useEffect(() => {
    void fetchUsers().then(setUsers);
  }, []);

  /** Runs an action and reloads; a refusal is shown as a toast. */
  const act = async (fn: () => Promise<{ error: string | null; body: unknown }>, done?: string) => {
    try {
      const r = await fn();
      toast(r.error ? errorText(r) : (done ?? ''));
    } catch {
      toast(t('auth.offline'));
    }
    await load();
  };

  const showLink = async (name: string, token: string) => setLink({ name, url: await inviteUrl(token) });

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
        {empty && (
          <EmptyPicture picture={<UsersPicture className={PICTURE} />} title={t('users.empty')}>
            {manage && create}
          </EmptyPicture>
        )}
        <ul aria-label={t('users.title')}>
          {Array.isArray(users) &&
            users.map((u) => {
              const self = u.id === me.userId;
              const roleRefusal = roleChangeRefusal({ id: me.userId, role: me.role }, u, u.role);
              const roles = ROLES.filter((r) => r === u.role || !roleChangeRefusal({ id: me.userId, role: me.role }, u, r));
              const locked = !manage || !!roleRefusal;
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-3 px-7 py-3 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0">
                  <span className="size-8 rounded-full bg-neutral-300 dark:bg-neutral-600 shrink-0 flex items-center justify-center text-neutral-500 dark:text-neutral-400">
                    <UserIcon className="size-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      <span className="font-medium">{u.name}</span> {u.email && <span className="text-sm text-neutral-400 dark:text-neutral-500">{u.email}</span>}
                    </div>
                    <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate">{inviteStatus(u)}</div>
                    {self && <div className="text-xs text-neutral-400 dark:text-neutral-500">{t('users.ownRole')}</div>}
                  </div>
                  {/* The role as the current app's badge; a menu when it may be changed. */}
                  <span className="relative inline-flex">
                    <select
                      aria-label={t('users.roleOf', { name: u.name })}
                      value={u.role}
                      disabled={locked}
                      title={self ? t('users.ownRole') : undefined}
                      onChange={(e) => void act(() => api('PATCH', `/api/users/${encodeURIComponent(u.id)}`, { role: e.target.value }), t('users.roleSaved'))}
                      className={`appearance-none text-xs py-0.5 rounded-full border-0 ${locked ? 'pl-2 pr-2 opacity-100' : 'pl-2 pr-6 cursor-pointer'} ${ROLE_BADGE[u.role]} focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {t(`role.${r}`)}
                        </option>
                      ))}
                    </select>
                    {!locked && <ChevronDownIcon className="size-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />}
                  </span>
                  {manage && !inviteRefusal({ id: me.userId, role: me.role }, u) && !self && (
                    <AppButton
                      variant="neutral"
                      className="text-xs"
                      onClick={async () => {
                        try {
                          const r = await api<{ inviteToken: string }>('POST', `/api/users/${encodeURIComponent(u.id)}/invites`);
                          if (r.error) toast(errorText(r));
                          else await showLink(u.name, r.body.inviteToken);
                        } catch {
                          toast(t('auth.offline'));
                        }
                        await load();
                      }}
                    >
                      {t('users.newInvite')}
                    </AppButton>
                  )}
                  {manage && !removeUserRefusal({ id: me.userId, role: me.role }, u) && (
                    <AppButton
                      variant="danger"
                      className="text-xs"
                      onClick={async () => {
                        await ask(deleteAsk(t('users.removeConfirm', { name: u.name }), u.name, () => act(() => api('DELETE', `/api/users/${encodeURIComponent(u.id)}`), t('users.removed', { name: u.name }))));
                      }}
                    >
                      {t('users.remove')}
                    </AppButton>
                  )}
                </li>
              );
            })}
        </ul>
      </div>
      {creating && (
        <CreateUserDialog
          me={me}
          onClose={() => setCreating(false)}
          onCreated={async (name, token) => {
            setCreating(false);
            await showLink(name, token);
            await load();
          }}
        />
      )}
      {link && <InviteLinkDialog name={link.name} url={link.url} host={host} onClose={() => setLink(null)} />}
      {dialog}
    </PageContainer>
  );
}
