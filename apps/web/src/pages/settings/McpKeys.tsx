import { useEffect, useState } from 'react';
import { MCP_LIMITS, type McpKeyCreated, type McpKeyRow } from '@gp/core';
import { api } from '../../auth/api.ts';
import { errorText } from '../../auth/errors.ts';
import { locale, t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { copyText } from '../../ui/copyText.ts';
import { CopyField } from '../../ui/CopyField.tsx';
import { Dialog, DialogButtons, useConfirm } from '../../ui/Dialog.tsx';
import { ACTION_ROW, Group, GROUP_ROW, SMALL_DANGER } from '../../ui/Group.tsx';
import { NameDialog } from '../../ui/NameDialog.tsx';
import { useServerBase } from '../../ui/serverBase.ts';
import { useToast } from '../../ui/Toast.tsx';

const day = (ms: number) => new Date(ms).toLocaleDateString(locale());

/** The user's keys, or why they cannot be shown. Online only: keys are not synced. */
async function fetchKeys(): Promise<McpKeyRow[] | string> {
  try {
    const r = await api<McpKeyRow[]>('GET', '/api/auth/mcp-keys');
    return r.error ? errorText(r) : r.body;
  } catch {
    return t('auth.offline');
  }
}

/** A new key, shown this once (AUTH-R13), with how Claude Code and other MCP clients are given it. */
function NewKeyDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const toast = useToast();
  const url = `${useServerBase()}/api/mcp`;
  const command = `claude mcp add --transport http gospel-presenter ${url} --header "Authorization: Bearer ${secret}"`;
  const json = JSON.stringify({ mcpServers: { 'gospel-presenter': { type: 'http', url, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);
  const copy = (text: string) => void copyText(text).then((copied) => copied && toast(t('mcp.copied')));
  return (
    <Dialog title={t('mcp.created')} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-stone-600 dark:text-stone-300">{t('mcp.shownOnce')}</p>
        <CopyField value={secret} label={t('mcp.key')} copyLabel={t('mcp.copy')} onCopy={() => copy(secret)} />
        <p className="text-sm text-stone-600 dark:text-stone-300">{t('mcp.claudeCode')}</p>
        <CopyField value={command} label={t('mcp.claudeCode')} copyLabel={t('mcp.copy')} onCopy={() => copy(command)} />
        <p className="text-sm text-stone-600 dark:text-stone-300">{t('mcp.otherClients')}</p>
        <pre className="text-xs font-mono p-3 rounded-lg bg-raised border border-stone-200 dark:border-stone-600 overflow-x-auto select-all">{json}</pre>
        <DialogButtons>
          <AppButton onClick={onClose}>{t('common.close')}</AppButton>
        </DialogButtons>
      </div>
    </Dialog>
  );
}

/**
 * MCP (docs/mcp.md), under Mina inställningar for someone a Superadmin turned the experiment on for: their keys, each
 * acting as them in the organisation it was made in; a new one in this organisation, and deleting one.
 */
export function McpKeys() {
  const toast = useToast();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<McpKeyRow[] | string | null>(null);
  const [naming, setNaming] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const load = () => fetchKeys().then(setKeys);
  useEffect(() => {
    void fetchKeys().then(setKeys);
  }, []);

  const create = async (name: string) => {
    try {
      const r = await api<McpKeyCreated>('POST', '/api/auth/mcp-keys', { name });
      if (r.error) toast(errorText(r));
      else setSecret(r.body.secret);
    } catch {
      toast(t('auth.offline'));
    }
    setNaming(false);
    await load();
  };

  const remove = (k: McpKeyRow) =>
    void confirm.ask({
      title: t('mcp.delete'),
      text: t('mcp.confirmDelete', { name: k.name }),
      bold: k.name,
      confirm: t('common.delete'),
      busy: t('common.deleting'),
      run: async () => {
        const r = await api('DELETE', `/api/auth/mcp-keys/${encodeURIComponent(k.id)}`).catch(() => null);
        toast(!r ? t('auth.offline') : r.error ? errorText(r) : t('mcp.deleted'));
        await load();
      },
    });

  const full = Array.isArray(keys) && keys.length >= MCP_LIMITS.keysPerUser;
  return (
    <>
      <Group title={t('mcp.title')} footer={t('mcp.footer')}>
        {typeof keys === 'string' && <div className={`${GROUP_ROW} text-red-500 dark:text-red-400`}>{keys}</div>}
        {Array.isArray(keys) && keys.length === 0 && <div className={`${GROUP_ROW} text-stone-500 dark:text-stone-400`}>{t('mcp.none')}</div>}
        {Array.isArray(keys) && keys.length > 0 && (
          <ul aria-label={t('mcp.title')} className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator">
            {keys.map((k) => (
              <li key={k.id} className={GROUP_ROW}>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    <span className="font-medium">{k.name}</span> <span className="text-stone-500 dark:text-stone-400">{k.orgName}</span>
                  </div>
                  <div className="text-xs text-stone-500 dark:text-stone-400">
                    {k.lastUsedAt === null ? t('mcp.datesUnused', { created: day(k.createdAt) }) : t('mcp.dates', { created: day(k.createdAt), used: day(k.lastUsedAt) })}
                  </div>
                </div>
                <AppButton variant="plain" className={SMALL_DANGER} onClick={() => remove(k)}>
                  {t('common.delete')}
                </AppButton>
              </li>
            ))}
          </ul>
        )}
        <AppButton variant="plain" className={ACTION_ROW} disabled={!Array.isArray(keys) || full} title={full ? t('error.limit') : undefined} onClick={() => setNaming(true)}>
          {t('mcp.create')}
        </AppButton>
      </Group>
      {naming && <NameDialog title={t('mcp.create')} text={t('mcp.nameText')} label={t('mcp.name')} maxChars={MCP_LIMITS.keyName} initial="Claude" submit={create} onClose={() => setNaming(false)} />}
      {secret && <NewKeyDialog secret={secret} onClose={() => setSecret(null)} />}
      {confirm.dialog}
    </>
  );
}
