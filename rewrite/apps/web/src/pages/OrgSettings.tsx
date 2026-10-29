import { useState } from 'react';
import type { RemoteControlPolicy } from '@gp/core';
import { orgRemoteControl } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t, type TextKey } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { useToast } from '../ui/Toast.tsx';

const POLICIES: { value: RemoteControlPolicy; label: TextKey; description: TextKey }[] = [
  { value: 'never', label: 'orgSettings.remoteNever', description: 'orgSettings.remoteNeverDescription' },
  { value: 'presenter', label: 'orgSettings.remotePresenter', description: 'orgSettings.remotePresenterDescription' },
  { value: 'always', label: 'orgSettings.remoteAlways', description: 'orgSettings.remoteAlwaysDescription' },
];

/**
 * The organisation's settings (`/admin/settings`, TODO.md "Remote control for
 * the whole organisation"): remote control so far. There is no such page in
 * the current app; it looks like "Mina inställningar" (Pages/Settings.razor).
 */
export function OrgSettings() {
  const db = useDb();
  const toast = useToast();
  const saved = useData(orgRemoteControl, []);
  const [saving, setSaving] = useState<RemoteControlPolicy | null>(null);
  if (saved === undefined)
    return (
      <PageContainer>
        <p className="px-7 py-4 text-neutral-400">{t('auth.loading')}</p>
      </PageContainer>
    );
  const current = saving ?? saved; // optimistic while saving

  const choose = async (policy: RemoteControlPolicy) => {
    if (policy === current) return;
    setSaving(policy);
    try {
      await db.mutate('setRemoteControl', { policy });
      toast(t('orgSettings.saved'));
    } catch {
      toast(t('orgSettings.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t('orgSettings.title')} />
      <div className={`${CARD} p-5`}>
        <h2 id="remote-label" className="block text-sm/5 font-medium mb-1">
          {t('orgSettings.remote')}
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">{t('orgSettings.remoteDescription')}</p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="remote-label">
          {POLICIES.map(({ value, label, description }) => {
            const selected = value === current;
            return (
              <AppButton
                key={value}
                variant="plain"
                role="radio"
                aria-checked={selected}
                disabled={saving !== null}
                onClick={() => void choose(value)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left cursor-pointer transition ${
                  selected ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 dark:border-sky-400' : 'border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block">{t(label)}</span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t(description)}</span>
                </span>
                {selected && <CheckIcon className="w-5 h-5 shrink-0 text-sky-500" />}
              </AppButton>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
