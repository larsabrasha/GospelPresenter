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
import { Button } from '../ui/Button.tsx';
import { Dialog, useConfirm } from '../ui/Dialog.tsx';
import { useToast } from '../ui/Toast.tsx';

/** Where an invite link points: the address other devices reach this server at (DESK-R8). */
async function inviteUrl(token: string): Promise<string> {
  const [lan] = (await window.gpDesktop?.lanUrls()) ?? [];
  return `${lan ?? location.origin}${location.pathname}#/invite/${token}`;
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
  history.replaceState(null, '', `${location.pathname}${location.search}#/invite/${token}`);
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
      <Dialog title={t('users.inviteTitle')} onClose={onClose}>
        <p>{t('users.inviteHost', { name })}</p>
        <div className="row end">
          <Button onClick={() => acceptHere(url.slice(url.indexOf('#/invite/') + '#/invite/'.length))}>{t('users.acceptHere', { name })}</Button>
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={t('users.inviteTitle')} onClose={onClose}>
      <p>{t('users.inviteText', { name })}</p>
      <label className="field">
        {t('users.inviteLink')}
        <input ref={setInput} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="row end">
        <Button onClick={() => void copy(input, url).then(() => toast(t('users.copied')))}>{t('users.copy')}</Button>
        <Button variant="primary" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
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
    <Dialog title={t('users.createTitle')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || saving) return;
          if (!emailSchema.safeParse(email).success) return setError(t('error.invalid-email')); // ORG-A2
          setSaving(true);
          try {
            const r = await api<{ inviteToken: string }>('POST', '/users', { name, email, role });
            if (!r.error) return onCreated(name.trim(), r.body.inviteToken);
            setError(errorText(r));
          } catch {
            setError(t('auth.offline'));
          }
          setSaving(false);
        }}
      >
        <label className="field">
          {t('users.name')}
          <input autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('users.email')}
          <input type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          {t('users.role')}
          {/* ORG-A3: SuperAdmin is offered only to a SuperAdmin. */}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {assignableRoles(me.role).map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="small muted hint">{t(`role.${role}.description`)}</p>
        {error && (
          <p className="danger" role="alert">
            {error}
          </p>
        )}
        <div className="row end">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || saving}>
            {saving ? t('users.creating') : t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

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
    const r = await api<UserRow[]>('GET', '/users');
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

  return (
    <section>
      <div className="row">
        <h1 className="grow">{t('users.title')}</h1>
        {manage && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('users.create')}
          </Button>
        )}
      </div>
      {typeof users === 'string' && <p className="danger">{users}</p>}
      {Array.isArray(users) && !users.length && <p className="empty">{t('users.empty')}</p>}
      <ul className="list users" aria-label={t('users.title')}>
        {Array.isArray(users) &&
          users.map((u) => {
            const self = u.id === me.userId;
            const roleRefusal = roleChangeRefusal({ id: me.userId, role: me.role }, u, u.role);
            const roles = ROLES.filter((r) => r === u.role || !roleChangeRefusal({ id: me.userId, role: me.role }, u, r));
            return (
              <li key={u.id} className="user-row">
                <div className="grow">
                  <strong>{u.name}</strong> {u.email && <span className="muted">{u.email}</span>}
                  <div className="small muted">{inviteStatus(u)}</div>
                </div>
                <select
                    aria-label={t('users.roleOf', { name: u.name })}
                    value={u.role}
                    disabled={!manage || !!roleRefusal}
                    title={self ? t('users.ownRole') : undefined}
                    onChange={(e) => void act(() => api('PATCH', `/users/${encodeURIComponent(u.id)}`, { role: e.target.value }), t('users.roleSaved'))}
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {t(`role.${r}`)}
                      </option>
                    ))}
                  </select>
                {self && <span className="small muted">{t('users.ownRole')}</span>}
                {manage && !inviteRefusal({ id: me.userId, role: me.role }, u) && !self && (
                  <Button
                    onClick={async () => {
                      try {
                        const r = await api<{ inviteToken: string }>('POST', `/users/${encodeURIComponent(u.id)}/invites`);
                        if (r.error) toast(errorText(r));
                        else await showLink(u.name, r.body.inviteToken);
                      } catch {
                        toast(t('auth.offline'));
                      }
                      await load();
                    }}
                  >
                    {t('users.newInvite')}
                  </Button>
                )}
                {manage && !removeUserRefusal({ id: me.userId, role: me.role }, u) && (
                  <Button
                    variant="danger"
                    onClick={async () => {
                      const ok = await ask({ title: t('users.remove'), text: t('users.removeConfirm', { name: u.name }), confirm: t('common.delete') });
                      if (ok) await act(() => api('DELETE', `/users/${encodeURIComponent(u.id)}`), t('users.removed', { name: u.name }));
                    }}
                  >
                    {t('users.remove')}
                  </Button>
                )}
              </li>
            );
          })}
      </ul>
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
    </section>
  );
}
