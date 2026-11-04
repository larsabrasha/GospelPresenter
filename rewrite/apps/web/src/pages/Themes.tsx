import { useState, type ReactNode } from 'react';
import { can, isBuiltInTheme, listThemes, resolveTheme, type Role, type Slide, type Theme } from '@gp/core';
import { useData, useDb } from '../db/react.tsx';
import { orgDefaultThemeId, ownThemes } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { newId } from '../ids.ts';
import { themeDescription, themeName } from '../themes.ts';
import { AddButton } from '../ui/AddButton.tsx';
import { AppButton } from '../ui/AppButton.tsx';
import { useTrySave } from '../ui/AutoSave.tsx';
import { useConfirm } from '../ui/Dialog.tsx';
import { CONTEXT_ROW } from '../ui/ContextMenu.tsx';
import { CheckCircleIcon, CheckIcon, DocumentDuplicateIcon, PencilIcon, TrashIcon } from '../ui/icons.tsx';
import { freshName, markCreated } from '../ui/justCreated.ts';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { HoldMenu } from '../ui/RemoveMenu.tsx';
import { navigate } from '../ui/router.ts';
import { ICON_GROUP, Sheet } from '../ui/Sheet.tsx';
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

/** What an admin can do with a theme: make it the default, copy it, and edit or delete an own one. */
interface ThemeActions {
  manage: boolean;
  busy: boolean;
  onChoose: (theme: Theme) => void;
  onDuplicate: (theme: Theme) => void;
  onDelete: (theme: Theme) => void;
}

/** A sheet's row: an icon and a choice, in sky, as iOS's. */
const SHEET_ACTION =
  'w-full flex items-center gap-3.5 text-left cursor-pointer min-h-12 px-4 text-[17px] text-sky-600 dark:text-sky-400 hover:bg-black/5 dark:hover:bg-white/5 disabled:text-stone-400 dark:disabled:text-stone-500 disabled:cursor-default disabled:hover:bg-transparent';

/** A theme's choices, in its sheet or in the menu a held finger or a right click opens on its tile; Ta bort tema last, red. */
function themeChoices(theme: Theme, current: boolean, actions: ThemeActions) {
  const own = !isBuiltInTheme(theme.id);
  const { manage } = actions;
  return {
    choices: [
      ...(manage && !current ? [{ key: 'default', label: t('themes.useAsDefault'), Icon: CheckCircleIcon, run: () => actions.onChoose(theme) }] : []),
      ...(manage && own ? [{ key: 'edit', label: t('themes.edit'), Icon: PencilIcon, run: () => navigate({ page: 'theme', id: theme.id }) }] : []),
      ...(manage ? [{ key: 'duplicate', label: t('themes.duplicate'), Icon: DocumentDuplicateIcon, run: () => actions.onDuplicate(theme) }] : []),
    ],
    remove: manage && own ? () => actions.onDelete(theme) : null,
  };
}

/**
 * A theme looked at, as an iOS sheet: its preview large, what a built-in one is for, then its choices as rows of a
 * group and Ta bort tema red in a group of its own (Lars, 2026-11-04: a row of buttons did not fit a phone).
 */
function ThemeSheet({ theme, current, actions, onClose }: { theme: Theme; current: boolean; actions: ThemeActions; onClose: () => void }) {
  const { choices, remove } = themeChoices(theme, current, actions);
  return (
    <Sheet title={themeName(theme)} onClose={onClose}>
      <div className="aspect-video rounded-2xl overflow-hidden">
        <SlideView slide={SAMPLE} theme={theme} label={false} />
      </div>
      {isBuiltInTheme(theme.id) && <p className="px-4 text-sm text-stone-500 dark:text-stone-400 leading-relaxed">{themeDescription(theme)}</p>}
      {(current || choices.length > 0) && (
        <div className={ICON_GROUP}>
          {current && (
            <p className="flex items-center gap-3.5 min-h-12 px-4 py-2.5 text-[17px]">
              <CheckIcon className="size-5 shrink-0 text-sky-500" />
              {t('themes.isDefault')}
            </p>
          )}
          {choices.map((c) => (
            <AppButton key={c.key} variant="plain" disabled={actions.busy} className={SHEET_ACTION} onClick={c.run}>
              <c.Icon className="size-5 shrink-0" />
              {c.label}
            </AppButton>
          ))}
        </div>
      )}
      {remove && (
        <div className={ICON_GROUP}>
          <AppButton variant="plain" disabled={actions.busy} className={`${SHEET_ACTION} justify-center text-red-600! dark:text-red-400!`} onClick={remove}>
            {t('themes.delete')}
          </AppButton>
        </div>
      )}
    </Sheet>
  );
}

/** A tile's menu, held or right-clicked, with the sheet's choices; none for one who may not change themes. */
function ThemeMenu({ theme, current, actions, children }: { theme: Theme; current: boolean; actions: ThemeActions; children: ReactNode }) {
  const { choices, remove } = themeChoices(theme, current, actions);
  if (!choices.length && !remove) return children;
  return (
    <HoldMenu
      label={themeName(theme)}
      menu={
        <>
          {choices.map((c) => (
            <AppButton key={c.key} variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={c.run}>
              <c.Icon className="size-4" />
              {c.label}
            </AppButton>
          ))}
          {remove && (
            <>
              {choices.length > 0 && <div role="separator" className="h-px my-1 bg-separator" />}
              <AppButton variant="plain" role="menuitem" className={`${CONTEXT_ROW} text-red-600 dark:text-red-400`} onClick={remove}>
                <TrashIcon className="size-4" strokeWidth={1.5} />
                {t('themes.delete')}
              </AppButton>
            </>
          )}
        </>
      }
    >
      {children}
    </HoldMenu>
  );
}

/**
 * Teman (spec 05 `/admin/themes`) as iOS's wallpapers and the Watch's faces (Lars, 2026-11-04): a grid of previews,
 * the organisation's default ticked, the name under each; a tap opens the theme large, with Använd som standard for
 * an admin. Everyone sees it. The two built-in ones come first, then the organisation's own (docs/themes.md): an admin
 * makes one with + (a copy of the default, made at once and named in its editor) or Duplicera, and edits or deletes an own one from its sheet.
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

  /** A copy made at once and opened with its name picked (Lars, 2026-11-04): + copies the default, Duplicera this one. */
  const copy = async (from: Theme, base: string) => {
    const id = newId();
    const name = freshName(base, themes.map(themeName));
    if (await trySave(db.mutate('createTheme', { id, name, definition: from.definition, at: Date.now() }))) {
      markCreated(id);
      navigate({ page: 'theme', id });
    }
  };

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

  const actions: ThemeActions = {
    manage,
    busy: saving !== null,
    onChoose: (theme) => void choose(theme.id),
    onDuplicate: (theme) => (setLooking(null), void copy(theme, t('themes.copyName', { name: themeName(theme) }))),
    onDelete: (theme) => void remove(theme),
  };

  return (
    <PageContainer>
      {/* What a theme is: the card at the top (settingsLinks.ts `intro`). */}
      <PageHeader title={t('themes.title')}>{manage && <AddButton label={t('themes.new')} onClick={() => void copy(resolveTheme(null, saved, own), t('themes.new'))} />}</PageHeader>
      {dialog}
      {/* Columns by its own width (Inställningar's is narrow on an iPad held upright). */}
      <div className="@container">
        <ul className="grid grid-cols-2 @2xl:grid-cols-3 gap-x-4 gap-y-5" aria-label={t('themes.title')}>
          {themes.map((theme) => (
            <li key={theme.id} data-testid={`theme-${theme.id}`} className="min-w-0">
              <ThemeMenu theme={theme} current={theme.id === current} actions={actions}>
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
              </ThemeMenu>
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
          actions={actions}
          onClose={() => setLooking(null)}
        />
      )}
    </PageContainer>
  );
}
