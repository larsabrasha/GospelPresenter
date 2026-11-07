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
import { MoreMenu, type MoreChoice } from '../ui/MoreMenu.tsx';
import { CONTEXT_ROW } from '../ui/ContextMenu.tsx';
import { CheckCircleIcon, CheckIcon, DocumentDuplicateIcon, PencilIcon, TrashIcon } from '../ui/icons.tsx';
import { freshName, markCreated } from '../ui/justCreated.ts';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { HoldMenu } from '../ui/RemoveMenu.tsx';
import { navigate } from '../ui/router.ts';
import { SelectButtons, SelectionBar, Tick, useSelection } from '../ui/Selecting.tsx';
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

/** A theme's choices, in its ⋯ menu or in the menu a held finger or a right click opens on its tile; Ta bort tema last, red. */
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

/** The ⋯ beside a theme's name, with the choices its held menu has (Lars, 2026-11-07: as every library's item). */
function ThemeMore({ theme, current, actions }: { theme: Theme; current: boolean; actions: ThemeActions }) {
  const { choices, remove } = themeChoices(theme, current, actions);
  const all: MoreChoice[] = [
    ...choices.map((c) => ({ label: c.label, icon: <c.Icon className="size-4" />, disabled: actions.busy, onChoose: c.run })),
    ...(remove ? [{ label: t('themes.delete'), icon: <TrashIcon className="size-4" strokeWidth={1.5} />, danger: true, onChoose: remove }] : []),
  ];
  return all.length ? <MoreMenu name={themeName(theme)} choices={all} /> : null;
}

/** A tile's menu, held or right-clicked, with the ⋯ menu's choices; none for one who may not change themes. */
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
 * the organisation's default ticked, the name under each with its ⋯ (Använd som standard, Duplicera, and for an own
 * one Redigera and Ta bort tema). Everyone sees it. The two built-in ones come first, then the organisation's own
 * (docs/themes.md): an admin makes one with + (a copy of the default, made at once and named in its editor) or
 * Duplicera; a tap on an own one opens its editor, as a song's opens its page (Lars, 2026-11-07: a sheet in between
 * added little); Välj ticks own ones to delete together.
 */
export function Themes({ role }: { role: Role }) {
  const db = useDb();
  const toast = useToast();
  const trySave = useTrySave();
  const { dialog, ask } = useConfirm();
  const saved = useData(orgDefaultThemeId, []);
  const own = useData(ownThemes, []);
  const [saving, setSaving] = useState<string | null>(null);
  const selection = useSelection();
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
  /** The own themes as the grid has them, for Välj. */
  const ownIds = themes.filter((th) => !isBuiltInTheme(th.id)).map((th) => th.id);

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
    await ask({ title: t('themes.delete'), text: t('themes.deleteAsk', { name }), bold: name, confirm: t('themes.delete'), run: () => db.mutate('deleteTheme', { id: theme.id }) });
  };
  const picked = own.filter((th) => selection.picked.has(th.id));
  const removePicked = async () => {
    const [one] = picked;
    if (!one) return;
    const name = themeName(one);
    const text = picked.length === 1 ? t('themes.deleteAsk', { name }) : t('themes.deleteMany', { n: picked.length });
    const run = () => Promise.all(picked.map((th) => trySave(db.mutate('deleteTheme', { id: th.id }))));
    if (await ask({ title: t('themes.delete'), text, bold: picked.length === 1 ? name : undefined, confirm: t('themes.delete'), run })) selection.stop();
  };

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

  const actions: ThemeActions = {
    manage,
    busy: saving !== null,
    onChoose: (theme) => void choose(theme.id),
    onDuplicate: (theme) => void copy(theme, t('themes.copyName', { name: themeName(theme) })),
    onDelete: (theme) => void remove(theme),
  };

  return (
    <PageContainer>
      {/* Escape ends Välj, and only that; the toolbar floats elsewhere, but its events come here through React. */}
      <div className="flex flex-col space-y-5" onKeyDown={selection.escape}>
        {/* What a theme is: the card at the top (settingsLinks.ts `intro`). */}
        <PageHeader title={t('themes.title')}>
          {selection.selecting ? (
            <SelectionBar count={picked.length}>
              <AppButton variant="danger" filled disabled={!picked.length} onClick={() => void removePicked()}>
                {t('common.delete')}
              </AppButton>
            </SelectionBar>
          ) : (
            manage && <AddButton label={t('themes.new')} onClick={() => void copy(resolveTheme(null, saved, own), t('themes.new'))} />
          )}
        </PageHeader>
        {dialog}
        {/* Välj only where there is something to delete: the built-in ones never are. */}
        {manage && !!own.length && (
          <div className="flex justify-end -mt-3 mb-2">
            <SelectButtons selection={selection} ids={ownIds} />
          </div>
        )}
        {/* Columns by its own width (Inställningar's is narrow on an iPad held upright). */}
        <div className="@container">
          <ul className="grid grid-cols-2 @2xl:grid-cols-3 gap-x-4 gap-y-5" aria-label={t('themes.title')}>
            {themes.map((theme) => {
              const isCurrent = theme.id === current;
              const builtIn = isBuiltInTheme(theme.id);
              const tile = <SlideView slide={SAMPLE} theme={theme} label={false} />;
              const look = 'relative block w-full aspect-video rounded-xl overflow-hidden ring-offset-2 ring-offset-ground';
              return (
                <li key={theme.id} data-testid={`theme-${theme.id}`} className="min-w-0">
                  {selection.selecting ? (
                    builtIn ? (
                      <div role="img" className={`${look} opacity-40`} aria-label={themeName(theme)}>
                        {tile}
                      </div>
                    ) : (
                      <AppButton variant="plain" role="checkbox" aria-checked={selection.picked.has(theme.id)} aria-label={themeName(theme)} className={`${look} cursor-pointer`} onClick={(e) => selection.toggle(theme.id, e, ownIds)}>
                        {tile}
                        <Tick on={selection.picked.has(theme.id)} className="absolute bottom-2 right-2" />
                      </AppButton>
                    )
                  ) : (
                    <ThemeMenu theme={theme} current={isCurrent} actions={actions}>
                      {/* An own one opens its editor; a built-in one, which cannot be edited, says what it is for. */}
                      {builtIn ? (
                        <div role="img" className={`${look} ${isCurrent ? 'ring-2 ring-sky-500' : ''}`} aria-label={themeName(theme)} title={themeDescription(theme)} tabIndex={manage ? 0 : undefined}>
                          {tile}
                          {isCurrent && <DefaultTick />}
                        </div>
                      ) : (
                        <AppButton variant="plain" aria-label={themeName(theme)} className={`${look} cursor-pointer ${isCurrent ? 'ring-2 ring-sky-500' : 'hover:opacity-90'}`} onClick={() => navigate({ page: 'theme', id: theme.id })}>
                          {tile}
                          {isCurrent && <DefaultTick />}
                        </AppButton>
                      )}
                    </ThemeMenu>
                  )}
                  <div className="mt-1 h-8 flex items-center justify-center gap-0.5 min-w-0">
                    <p className="text-sm font-medium truncate">{themeName(theme)}</p>
                    {!selection.selecting && <ThemeMore theme={theme} current={isCurrent} actions={actions} />}
                  </div>
                  {isCurrent && <p className="text-xs text-center text-sky-600 dark:text-sky-400">{t('themes.default')}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PageContainer>
  );
}

/** The organisation's default, ticked on its tile. */
const DefaultTick = () => (
  <span className="absolute bottom-2 right-2 size-6 rounded-full bg-sky-500 text-white flex items-center justify-center shadow">
    <CheckIcon className="size-4" />
  </span>
);
