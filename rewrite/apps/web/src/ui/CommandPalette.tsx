import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Me, Presentation, Song } from '@gp/core';
import { useData, useSongSearch } from '../db/react.tsx';
import { listPresentations } from '../db/queries.ts';
import { t } from '../i18n.ts';
import { dateLabel, localToday } from '../pages/dashboard.ts';
import { searchSettings, settingsGroups } from '../pages/settings/settingsLinks.ts';
import { AppButton } from './AppButton.tsx';
import { runCommand, type AppCommand } from './appKeys.ts';
import { Dialog } from './Dialog.tsx';
import { LIFTED } from './glass.ts';
import { CAPTION } from './Group.tsx';
import { CalendarIcon, ChevronRightIcon, CogIcon, MusicalNoteIcon, PlusIcon, SearchIcon } from './icons.tsx';
import { matches } from './ListSearch.tsx';
import { SearchField } from './Picker.tsx';
import { Keys, keyLabel } from './ShortcutHelp.tsx';
import { href, navigate } from './router.ts';
import { ctrlLabel } from './shortcuts.ts';
import { PalettePreview, type PreviewOf } from './PalettePreview.tsx';
import { useToast } from './Toast.tsx';

// ⌘K (Ctrl+K elsewhere), the search of everything as today's apps have it (Lars, 2026-11-05): one field, and under it,
// grouped as Spotlight's, the commands (the keys' list, so no key need be learnt), songs by title or a line, the
// presentations by name or date (the coming ones first), and the pages of Inställningar. ↑ ↓ move, ↵ opens the marked
// one. In a presentation ⌘↵ (or the marked row's own button, on a touch screen) adds a song where Lägg till would,
// picks it and scrolls to it, and while presenting shows it at once: the quickest way to a song asked for (Lars,
// 2026-11-05). Where the window is wide the marked one is shown beside the list (PalettePreview).

/** What a presentation's page offers the search while it is open: a song added to it, and + 's kinds to add. */
interface PaletteTarget {
  /** Adds the song, picks it and scrolls to it; while presenting, shows it. */
  addSong: (song: Song) => Promise<boolean>;
  /** Presenting: the song added is shown at once. */
  live: boolean;
  /** "Lägg till video…" and the rest, each opening what + opens for it. */
  adds: { key: string; label: string; icon: ReactNode; run: () => void }[];
  /**
   * What is likeliest here, first (Lars, 2026-11-07): Starta presentation and Lägg till sång before presenting; then
   * the next slide, Släck, the shown video's or audio's play and pause, Avsluta. Suggested at the top with nothing typed,
   * found among the commands by their words; each with its keys, so the search teaches them.
   */
  actions: PaletteAction[];
}

/** A command of the page open, with its keys. */
export interface PaletteAction {
  key: string;
  label: string;
  icon: ReactNode;
  keys?: string[];
  run: () => void;
}

let target: PaletteTarget | null = null;

/** Offers `t` to the search while the component is mounted. */
export function usePaletteTarget(own: PaletteTarget): void {
  // The page's latest, read when the search is drawn: an effect event may not be called while drawing.
  const latest = useRef(own);
  useLayoutEffect(() => {
    latest.current = own;
  });
  useEffect(() => {
    const mine: PaletteTarget = {
      addSong: (song) => latest.current.addSong(song),
      get live() {
        return latest.current.live;
      },
      get actions() {
        return latest.current.actions;
      },
      get adds() {
        return latest.current.adds;
      },
    };
    target = mine;
    return () => {
      if (target === mine) target = null;
    };
  }, []);
}

/** The page each `g` letter goes to, to tell a page of Inställningar a command already offers. */
const GO_PAGES: Record<string, string> = { p: 'presentations', s: 'songs', b: 'bibles', i: 'images', l: 'audios', v: 'videos', e: 'customSlides' };

/** At most this many of a kind, as Spotlight shows a few of each. */
const PER_GROUP = 5;

interface Hit {
  key: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** What ↵ does, in grey at the right of the marked one. */
  verb: string;
  /** A command's own keys, in grey at the right (not on a touch screen, which has none). */
  keys?: string[];
  run: () => void | Promise<unknown>;
  /** What ⌘↵ does instead, also a button on the marked row: a song added to the presentation open. */
  alt?: { verb: string; run: () => void | Promise<unknown> };
  /** What the preview beside the list shows of it. */
  preview?: PreviewOf;
}

const go = <ChevronRightIcon className="size-4" />;
/** The commands, each with its keys as the help writes them, so a command found here teaches its key; `desktop` the menu bar's. */
const COMMANDS: { text: () => string; icon: ReactNode; command: AppCommand; keys: string[]; desktop?: string }[] = [
  { text: () => t('shortcuts.goPresentations'), icon: go, command: 'go:p', keys: ['g p'], desktop: 'Ctrl+1' },
  { text: () => t('shortcuts.goSongs'), icon: go, command: 'go:s', keys: ['g s'], desktop: 'Ctrl+2' },
  { text: () => t('shortcuts.goBibles'), icon: go, command: 'go:b', keys: ['g b'], desktop: 'Ctrl+3' },
  { text: () => t('shortcuts.goImages'), icon: go, command: 'go:i', keys: ['g i'], desktop: 'Ctrl+4' },
  { text: () => t('shortcuts.goAudios'), icon: go, command: 'go:l', keys: ['g l'], desktop: 'Ctrl+5' },
  { text: () => t('shortcuts.goVideos'), icon: go, command: 'go:v', keys: ['g v'], desktop: 'Ctrl+6' },
  { text: () => t('shortcuts.goSlides'), icon: go, command: 'go:e', keys: ['g e'], desktop: 'Ctrl+7' },
  { text: () => t('songs.new'), icon: <PlusIcon className="size-4" />, command: 'newSong', keys: [] },
  { text: () => t('shortcuts.settings'), icon: <CogIcon className="size-4" />, command: 'settings', keys: [','], desktop: 'Ctrl+,' },
];

/** The presentations a search finds: by name, place or date as the start page writes it, the coming ones first. */
function foundPresentations(all: Presentation[], query: string, today: string): Presentation[] {
  const coming = (p: Presentation) => !!p.eventDate && p.eventDate >= today;
  return all
    .filter((p) => matches(query, p.name, p.location, p.eventDate, p.eventDate ? dateLabel(p.eventDate, today, true) : null))
    .toSorted((a, b) => Number(coming(b)) - Number(coming(a)) || (coming(a) ? a.eventDate!.localeCompare(b.eventDate!) : (b.eventDate ?? '').localeCompare(a.eventDate ?? '')));
}

function Palette({ me, host, onClose }: { me: Me; host: boolean; onClose: () => void }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const listId = useId();
  const { shown: songs, shownQuery } = useSongSearch(query);
  const presentations = useData(listPresentations, []);
  const today = localToday();
  const blank = !query.trim();
  // Over a presentation's page, not over Inställningar: there a song is added, else opened.
  const adding = target && !document.querySelector('[data-page-dialog]') ? target : null;

  const groups = useMemo(() => {
    const commands: Hit[] = COMMANDS.filter((c) => matches(query, c.text())).map((c) => ({
      key: `c:${c.command}`,
      icon: c.icon,
      title: c.text(),
      verb: '',
      keys: [...c.keys, ...(window.gpDesktop && c.desktop ? [c.desktop] : [])],
      run: () => runCommand(c.command),
    }));
    // The page's own, likeliest first: all of them suggested with nothing typed, else those the words name.
    const actionHits: Hit[] = (adding?.actions ?? [])
      .filter((a) => blank || matches(query, a.label))
      .map((a) => ({ key: `x:${a.key}`, icon: a.icon, title: a.label, verb: '', keys: a.keys, run: a.run }));
    // The kinds of +, in a presentation: "Lägg till video…" for "video", as the command they are.
    const addHits: Hit[] = (adding?.adds ?? [])
      .filter((a) => !blank && matches(query, a.label, t('palette.addKind', { kind: a.label.toLocaleLowerCase() })))
      .map((a) => ({ key: `a:${a.key}`, icon: a.icon, title: t('palette.addKind', { kind: a.label.toLocaleLowerCase() }), verb: '', run: a.run }));
    // The last answer stays until the next arrives, so the list does not jump at every key (Lars, 2026-11-05: "ska
    // gå instant"); ↵ meanwhile waits for it (`waiting`).
    const songHits: Hit[] = blank ? [] : (songs ?? []).slice(0, PER_GROUP).map((s) => ({
      key: `s:${s.id}`,
      icon: <MusicalNoteIcon className="size-4" />,
      title: s.name,
      subtitle: s.author ?? undefined,
      verb: t('palette.open'),
      run: () => navigate({ page: 'song', id: s.id }),
      alt: adding
        ? {
            verb: adding.live ? t('palette.addShow') : t('palette.add'),
            run: async () => {
              if (await adding.addSong(s)) toast(t('presentation.added', { name: s.name }));
            },
          }
        : undefined,
      preview: { kind: 'song', id: s.id, title: s.name },
    }));
    const presentationHits: Hit[] = foundPresentations(presentations ?? [], blank ? '' : query, today)
      .slice(0, blank ? 3 : PER_GROUP)
      .map((p) => ({
        key: `p:${p.id}`,
        icon: <CalendarIcon className="size-4" />,
        title: p.name,
        subtitle: [p.eventDate ? dateLabel(p.eventDate, today, true) : null, p.time].filter(Boolean).join(' · ') || undefined,
        verb: t('palette.open'),
        run: () => navigate({ page: 'presentation', id: p.id }),
        preview: { kind: 'presentation', id: p.id, title: p.name, when: [p.eventDate ? dateLabel(p.eventDate, today, true) : null, p.time].filter(Boolean).join(' · ') || null, place: p.location || null },
      }));
    // A page of Inställningar a command already goes to is not listed twice ("Gå till Videor" and Videor).
    const goneTo = new Set(commands.flatMap((c) => (c.key.startsWith('c:go:') ? [c.key] : [])).map((k) => GO_PAGES[k.slice(5)]));
    const settingsHits: Hit[] = searchSettings(settingsGroups(me, host), query, t)
      .filter((l) => !goneTo.has(l.route.page))
      .slice(0, PER_GROUP)
      .map((l) => ({
      key: `i:${href(l.route)}`,
      icon: (
        <span className={`size-5 rounded-md flex items-center justify-center text-white ${l.colour}`}>
          <l.icon className="size-3.5" />
        </span>
      ),
      title: t(l.label),
      subtitle: l.where ? t(l.where) : undefined,
      verb: t('palette.open'),
      run: () => navigate(l.route),
    }));
    // Blank: the coming presentations, then the commands; searching, what the words name most often first.
    const listed: [string, Hit[]][] = blank
        ? [
            [t('palette.suggested'), actionHits],
            [t('palette.presentations'), presentationHits],
            [t('palette.commands'), commands],
          ]
        : [
            [t('palette.songs'), songHits],
            [t('palette.presentations'), presentationHits],
            [t('palette.commands'), [...actionHits, ...addHits.filter((a) => !actionHits.some((x) => x.title === a.title)), ...commands]],
            [t('palette.settings'), settingsHits],
          ];
    return listed.filter(([, hits]) => hits.length);
  }, [query, blank, songs, presentations, today, me, host, adding, toast]);

  const all = groups.flatMap(([, hits]) => hits);
  const marked = Math.min(at, Math.max(0, all.length - 1));
  const run = (hit: Hit | undefined, alt = false) => {
    if (!hit || (alt && !hit.alt)) return;
    onClose();
    void (alt ? hit.alt!.run() : hit.run());
  };
  /** ↵ pressed while the songs still answer an earlier query: done once they answer this one. */
  const waiting = useRef<{ alt: boolean } | null>(null);
  const fresh = blank || shownQuery === query;
  const enter = (alt: boolean) => {
    if (fresh) run(all[marked], alt);
    else waiting.current = { alt };
  };
  const whenFresh = useEffectEvent(() => {
    const w = waiting.current;
    waiting.current = null;
    if (w) run(all[marked], w.alt);
  });
  useEffect(() => {
    if (fresh) whenFresh();
  }, [fresh]);
  const list = useRef<HTMLDivElement>(null);
  // In braces: Chromium's scrollIntoView now returns a promise, which an effect must not return.
  useEffect(() => {
    list.current?.querySelector(`[data-hit="${marked}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [marked]);

  return (
    // At the top on a phone, as iPhone's Spotlight, above the keyboard it brings up.
    // As wide from the first moment, its preview's room kept: it grew when the presentations came, a jolt (Lars, 2026-11-07).
    <Dialog title={t('palette.title')} onClose={onClose} maxWidthClass="sm:max-w-3xl max-w-xl max-sm:self-start" hideTitle>
      <div
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setAt(Math.max(0, Math.min(all.length - 1, marked + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            enter(e.metaKey || e.ctrlKey);
          }
        }}
      >
        <SearchField
          autoFocus
          label={t('palette.title')}
          placeholder={t('palette.placeholder')}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setAt(0);
          }}
        />
        <div className="mt-2 flex gap-3 h-[min(24rem,55vh)]">
        <div ref={list} id={listId} role="listbox" aria-label={t('palette.title')} className="flex-1 min-w-0 overflow-y-auto space-y-3 py-1">
          {groups.map(([title, hits]) => (
            <div key={title} role="group" aria-label={title} className="space-y-0.5">
              <p className={`${CAPTION} text-xs/5`}>{title}</p>
              {hits.map((hit) => {
                const i = all.indexOf(hit);
                const on = i === marked;
                return (
                  <AppButton
                    key={hit.key}
                    variant="plain"
                    role="option"
                    aria-selected={on}
                    data-hit={i}
                    tabIndex={-1}
                    className={`w-full flex items-center gap-3 px-4 min-h-10 py-1.5 rounded-lg text-left text-sm cursor-pointer ${on ? 'bg-sky-500 text-white' : 'hover:bg-raised'}`}
                    onPointerMove={() => i !== marked && setAt(i)}
                    onClick={() => run(hit)}
                  >
                    <span className={`shrink-0 ${on ? 'text-white' : 'text-stone-500 dark:text-stone-400'}`}>{hit.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{hit.title}</span>
                      {hit.subtitle && <span className={`block truncate text-xs ${on ? 'text-white/80' : 'text-stone-500 dark:text-stone-400'}`}>{hit.subtitle}</span>}
                    </span>
                    {!!hit.keys?.length && (
                      <span className="shrink-0 touch:hidden flex items-center gap-2">
                        {hit.keys.map((k) => (
                          <Keys key={k} spec={k} onBlue={on} />
                        ))}
                      </span>
                    )}
                    {on && hit.verb && (
                      <span className="shrink-0 text-xs text-white/80 touch:hidden">
                        {hit.verb} ↵
                      </span>
                    )}
                    {/* ⌘↵'s choice as a button of its own, for a pointer and a finger too. */}
                    {on && hit.alt && (
                      <span
                        role="button"
                        tabIndex={-1}
                        className="shrink-0 h-7 px-2.5 rounded-full bg-white/20 hover:bg-white/30 text-xs font-semibold flex items-center gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          run(hit, true);
                        }}
                      >
                        {hit.alt.verb}
                        <span className="touch:hidden font-normal opacity-80">{keyLabel('Ctrl+Enter')}</span>
                      </span>
                    )}
                  </AppButton>
                );
              })}
            </div>
          ))}
          {!all.length && <p className="px-4 py-6 text-center text-sm text-stone-500 dark:text-stone-400">{t('palette.none')}</p>}
        </div>
        <div className="max-sm:hidden flex-1 min-w-0">
          <PalettePreview of={all[marked]?.preview ?? null} />
        </div>
        </div>
      </div>
    </Dialog>
  );
}

/** The mounted search's way to open, for its button. */
let openIt: (() => void) | null = null;

/**
 * The search's button, a magnifier beside Inställningar's cog in the bars (Lars, 2026-11-05: a phone has no ⌘K);
 * `className` is the bar's round button.
 */
export function SearchButton({ className, iconClassName }: { className: string; iconClassName: string }) {
  const label = `${t('palette.title')} (${ctrlLabel('K')})`;
  return (
    <AppButton variant="plain" aria-label={t('palette.title')} title={label} className={className} onClick={() => openIt?.()}>
      <SearchIcon className={iconClassName} />
    </AppButton>
  );
}

/**
 * On a phone the search floats at the bottom left, the + at the right, as iOS 26 puts search where the thumb is
 * (Lars, 2026-11-05: the bar at the top had no room); white and lifted, so the blue + stays the first.
 */
export function FloatingSearchButton() {
  return (
    <SearchButton
      className={`fixed z-10 left-7 bottom-[max(1.75rem,env(safe-area-inset-bottom))] size-14 rounded-full flex items-center justify-center cursor-pointer text-stone-700 dark:text-stone-200 ${LIFTED}`}
      iconClassName="size-6"
    />
  );
}

/** ⌘K and the search it opens; mounted once, in the signed-in app. */
export function CommandPalette({ me, host }: { me: Me; host: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    openIt = () => setOpen(true);
    return () => {
      openIt = null;
    };
  }, []);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen((o) => !o);
  });
  useEffect(() => {
    // In the capture phase, from a field too, as every app's ⌘K; the desktop app's menu bar sends `searchAll`.
    addEventListener('keydown', onKey, true);
    const off = window.gpDesktop?.onMenu?.((c) => c === 'searchAll' && setOpen(true));
    return () => {
      removeEventListener('keydown', onKey, true);
      off?.();
    };
  }, []);
  return open ? <Palette me={me} host={host} onClose={() => setOpen(false)} /> : null;
}
