import { useState } from 'react';
import { can, listThemes, type Role, type Slide, type Theme } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { orgDefaultThemeId } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { themeDescription, themeName } from '../themes.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { Dialog, DialogButtons } from '../ui/Dialog.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
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

/** A theme looked at: its preview large, what it is for, and Använd som standard for an admin. */
function ThemeSheet({ theme, current, manage, busy, onChoose, onClose }: { theme: Theme; current: boolean; manage: boolean; busy: boolean; onChoose: () => void; onClose: () => void }) {
  return (
    <Dialog title={themeName(theme)} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <div className="aspect-video rounded-xl overflow-hidden">
          <SlideView slide={SAMPLE} theme={theme} label={false} />
        </div>
        <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{themeDescription(theme)}</p>
        <DialogButtons>
          {current ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
              <CheckIcon className="size-4 text-sky-500" />
              {t('themes.isDefault')}
            </span>
          ) : (
            manage && (
              <AppButton disabled={busy} onClick={onChoose}>
                {t('themes.useAsDefault')}
              </AppButton>
            )
          )}
        </DialogButtons>
      </div>
    </Dialog>
  );
}

/**
 * Teman (spec 05 `/admin/themes`) as iOS's wallpapers and the Watch's faces (Lars, 2026-11-04): a grid of previews,
 * the organisation's default ticked, the name under each; a tap opens the theme large, with Använd som standard for
 * an admin. Everyone sees it. Themes are not created or edited yet (ADR 0001: the editor comes later).
 */
export function Themes({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const saved = useData(orgDefaultThemeId, []);
  const [saving, setSaving] = useState<string | null>(null);
  const [looking, setLooking] = useState<Theme | null>(null);
  if (saved === undefined)
    return (
      <PageContainer>
        {/* The intro card while loading too, so the bar's name does not show and go (ui/PageContainer.tsx). */}
        <PageHeader title={t('themes.title')} />
        <p className="loading-line px-7 py-4 text-stone-400">{t('auth.loading')}</p>
      </PageContainer>
    );
  const current = saving ?? saved ?? 'classic'; // optimistic while saving; no default saved shows Classic
  const manage = can(role, 'ManageThemes');

  const choose = async (id: string) => {
    setSaving(id);
    try {
      await db.mutate('setDefaultTheme', { themeId: id });
      toast(t('themes.saved'));
      setLooking(null);
    } catch {
      toast(t('themes.saveFailed'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <PageContainer>
      {/* What a theme is: the card at the top (settingsLinks.ts `intro`). */}
      <PageHeader title={t('themes.title')} />
      {/* Columns by its own width (Inställningar's is narrow on an iPad held upright). */}
      <div className="@container">
        <ul className="grid grid-cols-2 @2xl:grid-cols-3 gap-x-4 gap-y-5" aria-label={t('themes.title')}>
          {listThemes().map((theme) => (
            <li key={theme.id} data-testid={`theme-${theme.id}`} className="min-w-0">
              <AppButton
                variant="plain"
                aria-label={themeName(theme)}
                className={`relative block w-full aspect-video rounded-xl overflow-hidden cursor-pointer ring-offset-2 ring-offset-ground ${theme.id === current ? 'ring-2 ring-sky-500' : 'hover:opacity-90'}`}
                onClick={() => setLooking(theme)}
              >
                <SlideView slide={SAMPLE} theme={theme} label={false} />
                {theme.id === current && (
                  <span className="absolute bottom-2 right-2 size-6 rounded-full bg-sky-500 text-white flex items-center justify-center shadow">
                    <CheckIcon className="size-4" />
                  </span>
                )}
              </AppButton>
              <p className="mt-2 text-sm text-center font-medium truncate">{themeName(theme)}</p>
              {theme.id === current && <p className="text-xs text-center text-sky-600 dark:text-sky-400">{t('themes.default')}</p>}
            </li>
          ))}
        </ul>
      </div>
      {looking && (
        <ThemeSheet theme={looking} current={looking.id === current} manage={manage} busy={saving !== null} onChoose={() => void choose(looking.id)} onClose={() => setLooking(null)} />
      )}
    </PageContainer>
  );
}
