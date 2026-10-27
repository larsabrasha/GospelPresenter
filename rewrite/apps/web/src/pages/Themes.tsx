import { useState } from 'react';
import { can, listThemes, type Role, type Slide } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { orgDefaultThemeId } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { CARD } from '../ui/List.tsx';
import { PageContainer } from '../ui/PageContainer.tsx';
import { SlideView } from '../ui/SlideView.tsx';
import { useToast } from '../ui/Toast.tsx';

/** The sample every card shows, as spec 05 has it. */
const SAMPLE: Slide = {
  key: 'sample',
  kind: 'song',
  text: 'Amazing grace\nhow sweet the sound',
  verses: null,
  image: null,
  label: null,
  credits: 'John Newton · 1779',
};

/**
 * Teman (spec 05 `/admin/themes`): the built-in themes with a preview, and
 * the organisation's default. Everyone sees it; admins set the default.
 * Themes are not created or edited yet (ADR 0001: the editor comes later).
 */
export function Themes({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const saved = useData(orgDefaultThemeId, []);
  const [saving, setSaving] = useState<string | null>(null);
  if (saved === undefined)
    return (
      <PageContainer>
        <p className="px-7 py-4 text-neutral-400">{t('auth.loading')}</p>
      </PageContainer>
    );
  const current = saving ?? saved ?? 'classic'; // optimistic while saving; no default saved shows Classic
  const manage = can(role, 'ManageThemes');

  const choose = async (id: string) => {
    setSaving(id);
    try {
      await db.mutate('setDefaultTheme', { themeId: id });
      toast(t('themes.saved'));
    } catch {
      toast(t('themes.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <PageContainer>
      <div className="px-5">
        <h1 className="text-xl/7 font-bold dark:text-neutral-100">{t('themes.title')}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 max-w-2xl leading-relaxed">{t('themes.text')}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2" aria-label={t('themes.title')}>
        {listThemes().map((theme) => (
          <li key={theme.id} className={CARD} data-testid={`theme-${theme.id}`}>
            <div className="aspect-video">
              <SlideView slide={SAMPLE} theme={theme} label={false} />
            </div>
            {/* The name and text get the full width; the button has its own row. */}
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{theme.name}</span>
                {theme.id === current && (
                  <span className="text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">{t('themes.default')}</span>
                )}
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{theme.description}</p>
              {manage && theme.id !== current && (
                <div className="flex justify-end mt-3">
                  <AppButton disabled={saving !== null} onClick={() => void choose(theme.id)}>
                    {t('themes.useAsDefault')}
                  </AppButton>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
