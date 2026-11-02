import { useState } from 'react';
import type { RemoteControlPolicy } from '@gp/core';
import { orgRemoteControl } from '../db/queries.ts';
import { useData, useDb } from '../db/react.tsx';
import { t, type TextKey } from '../i18n.ts';
import { GROUP_ROW, Group, PopUp } from '../ui/Group.tsx';
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
        {/* The intro card while loading too, so the bar's name does not show and go (ui/PageContainer.tsx). */}
        <PageHeader title={t('orgSettings.title')} />
        <p className="px-7 py-4 text-stone-400">{t('auth.loading')}</p>
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

  // As macOS's System Settings has a choice of a few: a row with a pop-up menu, what the chosen one means under it
  // (Lars, 2026-11-02: not three boxes in a box).
  const chosen = POLICIES.find((p) => p.value === current) ?? POLICIES[1]!;
  return (
    <PageContainer>
      <PageHeader title={t('orgSettings.title')} />
      <Group footer={t(chosen.description)}>
        <label className={GROUP_ROW}>
          <span>{t('orgSettings.remote')}</span>
          <PopUp value={current} disabled={saving !== null} onChange={(e) => void choose(e.target.value as RemoteControlPolicy)}>
            {POLICIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </PopUp>
        </label>
      </Group>
    </PageContainer>
  );
}
