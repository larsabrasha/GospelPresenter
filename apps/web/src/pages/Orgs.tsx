import { useEffect, useState } from 'react';
import { ListSearch, matches, NoMatch } from '../ui/ListSearch.tsx';
import type { Me, OrgRow, UserRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { enterWith, sessionIn, switchOrg } from '../auth/orgs.ts';
import { t } from '../i18n.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { AutoSaveField, useSavedIndicator } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { EmptySmall } from '../ui/Empty.tsx';
import { FloatingInput } from '../ui/Floating.tsx';
import { ViewGridIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { DANGER_ROW, GROUP_ROW, Group } from '../ui/Group.tsx';
import { DetailHeader, PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { ROLE_VALUE } from './Users.tsx';
import { ROW_HOVER, RowChevron } from '../ui/List.tsx';

// The Superadmin's organisations (spec 01 `/admin/organizations`, Organizations.razor and OrganizationDetail.razor;
// decided on 2026-10-31). Online only: organisations are not synced (spec 06). No logo yet (GAPS.md: later).

/** An organisation's round mark: its first letter (OrganizationAvatar.razor without a logo). */
function Avatar({ name }: { name: string }) {
  return (
    <span className="size-8 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 shrink-0 flex items-center justify-center text-sm font-semibold">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** A server read for an online-only page: the answer, or what went wrong as text. */
export async function load<T>(path: string): Promise<T | string> {
  try {
    const r = await api<T>('GET', path);
    return r.error ? errorText(r) : r.body;
  } catch {
    return t('auth.offline');
  }
}

/** "Skapa organisation": the name; Skapa makes it and opens its users, as the Superadmin visiting it (Organizations.razor). */
function CreateOrgDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog title={t('orgs.createTitle')} onClose={onClose} maxWidthClass="max-w-lg">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          try {
            const r = await api<{ id: string }>('POST', '/api/orgs', { name });
            const failed = r.error ? errorText(r) : await switchOrg(r.body.id, href({ page: 'users' }));
            if (failed) setError(failed);
          } catch {
            setError(t('auth.offline'));
          }
          setSaving(false);
        }}
      >
        <FloatingInput label={t('orgs.name')} autoFocus maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim()} loading={saving}>
            {t('common.create')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}

/** Organisationer: every organisation by name, with its number of members; Skapa makes one. */
export function Orgs() {
  const [orgs, setOrgs] = useState<OrgRow[] | string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void load<OrgRow[]>('/api/orgs').then(setOrgs);
  }, []);
  const shown = Array.isArray(orgs) ? orgs.filter((o) => matches(query, o.name)) : [];
  return (
    <PageContainer>
      <PageHeader title={t('orgs.title')}>
        <AddButton label={t('common.create')} onClick={() => setCreating(true)} />
      </PageHeader>
      {typeof orgs === 'string' && <p className="px-5 text-sm text-red-500 dark:text-red-400">{orgs}</p>}
      {Array.isArray(orgs) && !!orgs.length && <ListSearch query={query} onChange={setQuery} />}
      {Array.isArray(orgs) && !!orgs.length && !shown.length && <NoMatch query={query} />}
      {/* No card until the list is here: an empty card while it comes from the server flashes by (Lars, 2026-11-05). */}
      {orgs === null && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
      <div className={`${CARD} ${!Array.isArray(orgs) || (!!orgs.length && !shown.length) ? 'hidden' : ''}`}>
        {Array.isArray(orgs) && !orgs.length && <EmptySmall icon={<ViewGridIcon className="size-8 mb-2 text-stone-300 dark:text-stone-600" />} title={t('orgs.empty')} />}
        <ul aria-label={t('orgs.title')}>
          {shown.map((o) => (
              <li key={o.id} className="border-b border-separator last:border-b-0">
                <a href={href({ page: 'org', id: o.id })} className={`flex items-center gap-3 px-7 py-3 ${ROW_HOVER} cursor-pointer`}>
                  <Avatar name={o.name} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{o.name}</div>
                    <div className="text-xs text-stone-400 dark:text-stone-500">{t('orgs.members', { n: o.members })}</div>
                  </div>
                  <RowChevron />
                </a>
              </li>
            ))}
        </ul>
      </div>
      {creating && <CreateOrgDialog onClose={() => setCreating(false)} />}
    </PageContainer>
  );
}

/**
 * "Radera organisation" (OrganizationDetail.razor): what goes, and Radera once the name is typed exactly. Deleting the
 * organisation the Superadmin is in moves them to another first, which they then are in.
 */
function DeleteOrgDialog({ org, me, onClose }: { org: OrgRow; me: Me; onClose: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      let moved = null;
      if (org.id === me.orgId) {
        const others = await load<{ id: string }[]>('/api/auth/orgs');
        const other = Array.isArray(others) ? others.find((o) => o.id !== org.id) : undefined;
        moved = other ? await sessionIn(other.id) : null;
        if (typeof moved === 'string') throw new Error(moved);
      }
      const r = await api('DELETE', `/api/orgs/${encodeURIComponent(org.id)}`, undefined, moved ? { token: moved.token } : {});
      if (r.error) {
        setError(errorText(r));
        setDeleting(false);
        return;
      }
      if (moved) return enterWith(moved, href({ page: 'orgs' }));
      toast(t('org.deleted', { name: org.name }));
      navigate({ page: 'orgs' });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('auth.offline'));
      setDeleting(false);
    }
  };
  return (
    <Dialog title={t('org.delete')} onClose={onClose} maxWidthClass="max-w-md">
      <div className="space-y-3 text-sm text-stone-600 dark:text-stone-300">
        <p>{t('org.deleteConfirm', { name: org.name })}</p>
        <p>{t('org.willBeDeleted')}</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>{t('org.deleteSettings')}</li>
          <li>{t('org.deleteMembers')}</li>
          <li>{t('org.deleteSongs')}</li>
          <li>{t('org.deletePresentations')}</li>
          <li>{t('org.deleteMedia')}</li>
        </ul>
        <FloatingInput label={t('org.typeToConfirm', { name: org.name })} value={typed} onChange={(e) => setTyped(e.target.value)} />
        {error && (
          <p className="text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogButtons>
        <AppButton variant="cancel" onClick={onClose}>
          {t('common.cancel')}
        </AppButton>
        <AppButton variant="danger" filled disabled={typed !== org.name} loading={deleting} onClick={() => void remove()}>
          {deleting ? t('common.deleting') : t('common.delete')}
        </AppButton>
      </DialogButtons>
    </Dialog>
  );
}

/** One organisation: its name, saved as it is typed, its members, and Radera organisation. */
export function OrgDetail({ id, me }: { id: string; me: Me }) {
  const [org, setOrg] = useState<(OrgRow & { users: UserRow[] }) | string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const saved = useSavedIndicator();
  const path = `/api/orgs/${encodeURIComponent(id)}`;
  useEffect(() => {
    void load<OrgRow & { users: UserRow[] }>(path).then(setOrg);
  }, [path]);
  if (org === null || typeof org === 'string')
    return (
      <PageContainer>
        <DetailHeader backHref={href({ page: 'orgs' })} title="" className="px-5" />
        <div className={`px-7 ${org ? 'text-red-500 dark:text-red-400' : 'loading-line text-stone-400'}`}>{org ?? t('common.loading')}</div>
      </PageContainer>
    );
  return (
    <PageContainer>
      <DetailHeader backHref={href({ page: 'orgs' })} title={org.name} saved={saved.node} className="px-5" />
      {/* The field with no card around it, the members as a group of rows (Lars, 2026-11-02: no box in a box). */}
      <div>
        <AutoSaveField
          label={t('org.name')}
          maxLength={200}
          value={org.name}
          onSave={async (name) => {
            if (!name.trim()) return;
            const r = await api('PATCH', path, { name });
            if (r.error) throw new Error(r.error);
            setOrg({ ...org, name: name.trim() });
          }}
          onSaved={saved.show}
        />
      </div>
      <Group title={t('org.membersTitle', { n: org.users.length })}>
        {!org.users.length && <p className={`${GROUP_ROW} text-stone-400`}>{t('org.noMembers')}</p>}
        <ul aria-label={t('org.membersTitle', { n: org.users.length })} className="flex flex-col empty:hidden [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator">
          {org.users.map((u) => (
            <li key={u.id} className={GROUP_ROW}>
              <div className="flex-1 min-w-0">
                <div className="truncate">{u.name}</div>
                {u.email && <div className="text-xs text-stone-400 dark:text-stone-500 truncate">{u.email}</div>}
              </div>
              <span className={ROLE_VALUE}>{t(`role.${u.role}`)}</span>
            </li>
          ))}
        </ul>
      </Group>
      <Group>
        <AppButton variant="plain" className={DANGER_ROW} onClick={() => setDeleting(true)}>
          {t('org.delete')}
        </AppButton>
      </Group>
      {deleting && <DeleteOrgDialog org={org} me={me} onClose={() => setDeleting(false)} />}
    </PageContainer>
  );
}
