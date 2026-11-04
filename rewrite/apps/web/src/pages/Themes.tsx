import { useState } from 'react';
import { can, isBuiltInTheme, listThemes, resolveTheme, type Role, type Slide, type Theme } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { orgDefaultThemeId, ownThemes } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { themeDescription, themeName } from '../themes.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { Dialog, DialogButtons, useConfirm } from '../ui/Dialog.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { NameDialog } from '../ui/NameDialog.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { navigate } from '../ui/router.ts';
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

/** What can be done with a theme looked at: an admin makes it the default, copies it, and edits or deletes an own one. */
interface SheetActions {
  manage: boolean;
  busy: boolean;
  onChoose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** A theme looked at: its preview large, what it is for, and an admin's choices. */
function ThemeSheet({ theme, current, actions, onClose }: { theme: Theme; current: boolean; actions: SheetActions; onClose: () => void }) {
  const own = !isBuiltInTheme(theme.id);
  const { manage, busy } = actions;
  return (
    <Dialog title={themeName(theme)} onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-4">
        <div className="aspect-video rounded-xl overflow-hidden">
          <SlideView slide={SAMPLE} theme={theme} label={false} />
        </div>
        {!own && <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{themeDescription(theme)}</p>}
        <DialogButtons>
          {manage && own && (
            <AppButton variant="danger" disabled={busy} onClick={actions.onDelete}>
              {t('themes.delete')}
            </AppButton>
          )}
          {manage && (
            <AppButton variant="cancel" disabled={busy} onClick={actions.onDuplicate}>
              {t('themes.duplicate')}
            </AppButton>
          )}
          {manage && own && (
            <AppButton variant="cancel" disabled={busy} onClick={() => navigate({ page: 'theme', id: theme.id })}>
              {t('themes.edit')}
            </AppButton>
          )}
          {current ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
              <CheckIcon className="size-4 text-sky-500" />
              {t('themes.isDefault')}
            </span>
          ) : (
            manage && (
              <AppButton disabled={busy} onClick={actions.onChoose}>
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
 * an admin. Everyone sees it. The two built-in ones come first, then the organisation's own (docs/themes.md): an admin
 * makes one with + (a copy of the default, named first) or Duplicera, and edits or deletes an own one from its sheet.
 */
export function Themes({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  const saved = useData(orgDefaultThemeId, []);
  const own = useData(ownThemes, []);
  const [saving, setSaving] = useState<string | null>(null);
  const [looking, setLooking] = useState<Theme | null>(null);
  /** The theme a new one copies, and the name it starts with, while it is named. */
  const [copying, setCopying] = useState<{ from: Theme; name: string } | null>(null);
  if (saved === undefined || own === undefined)
    return (
      <PageContainer>
        {/* The intro card while loading too, so the bar's name does not show and go (ui/PageContainer.tsx). */}
        <PageHeader title={t('themes.title')} />
        <p className="loading-line px-7 py-4 text-stone-400">{t('auth.loading')}</p>
      </PageContainer>
    );
  const current = saving ?? saved ?? 'classic'; // optimistic while saving; no default saved shows Classic
  const manage = can(role, 'ManageThemes');
  const themes = listThemes(own);

  const remove = async (theme: Theme) => {
    const name = themeName(theme);
    if (await ask({ title: t('themes.delete'), text: t('themes.deleteAsk', { name }), bold: name, confirm: t('themes.delete'), run: () => db.mutate('deleteTheme', { id: theme.id }) })) setLooking(null);
  };

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
      <PageHeader title={t('themes.title')}>{manage && <AddButton label={t('themes.new')} onClick={() => setCopying({ from: resolveTheme(null, saved, own), name: '' })} />}</PageHeader>
      {dialog}
      {/* Columns by its own width (Inställningar's is narrow on an iPad held upright). */}
      <div className="@container">
        <ul className="grid grid-cols-2 @2xl:grid-cols-3 gap-x-4 gap-y-5" aria-label={t('themes.title')}>
          {themes.map((theme) => (
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
        <ThemeSheet
          theme={looking}
          current={looking.id === current}
          actions={{ manage, busy: saving !== null, onChoose: () => void choose(looking.id), onDuplicate: () => (setCopying({ from: looking, name: t('themes.copyName', { name: themeName(looking) }) }), setLooking(null)), onDelete: () => void remove(looking) }}
          onClose={() => setLooking(null)}
        />
      )}
      {copying && (
        <NameDialog
          title={t('themes.createTitle')}
          label={t('song.name')}
          maxLength={100}
          initial={copying.name}
          onClose={() => setCopying(null)}
          submit={async (name) => {
            const id = newId();
            if (await trySave(db.mutate('createTheme', { id, name, definition: copying.from.definition, at: Date.now() }))) navigate({ page: 'theme', id });
          }}
        />
      )}
    </PageContainer>
  );
}
