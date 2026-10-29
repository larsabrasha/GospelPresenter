import type { LivePointer, Overlay, Slide, Theme } from '@gp/core';
import { orgRemoteControl, type ShownOverlay } from '../../db/queries.ts';
import { useData } from '../../db/react.tsx';
import { t } from '../../i18n.ts';
import type { LiveControl, LiveLink } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { ArrowsPointingOutIcon, ChevronDownIcon, CloseIcon, StopIcon } from '../../ui/icons.tsx';
import { navigate } from '../../ui/router.ts';
import { outputWindow } from '../../live/outputWindow.ts';
import { SlideView } from '../../ui/SlideView.tsx';
import { CAPTION } from '../../ui/Toggle.tsx';
import { OutputsPanel } from './OutputsPanel.tsx';
import { OverlaysPanel } from './OverlaysPanel.tsx';
import { RemotePanel } from './RemotePanel.tsx';

/**
 * The live panel (LivePanel.razor): the preview and Rensa, Utgångar, Overlays,
 * Fjärrstyrning, Scenläge and Avsluta. Below `lg` it floats at the bottom right
 * and folds to its caption; `collapsed` and the fold toggle are the page's.
 */
export function LivePanel({
  id,
  owner,
  link,
  live,
  pointer,
  current,
  overlay,
  theme,
  overlays,
  name,
  collapsed,
  panelId,
  onToggle,
  onStage,
}: {
  id: string;
  owner: { sessionId: string } | null;
  link: LiveLink;
  live: LiveControl;
  pointer: LivePointer;
  current: Slide | null;
  overlay: ShownOverlay | null;
  theme: Theme;
  overlays: Overlay[];
  name: string | undefined;
  collapsed: boolean;
  panelId: string;
  onToggle: () => void;
  onStage: () => void;
}) {
  // Under "Aldrig" the organisation allows no remote control: no section at all.
  const remotePolicy = useData(orgRemoteControl, []);
  return (
    <aside
      className="absolute bottom-3 right-3 z-30 w-72 max-w-[calc(100%-1.5rem)] max-h-[calc(100dvh-7rem)] flex flex-col overflow-hidden rounded-2xl shadow-xl bg-white/90 dark:bg-neutral-800/90 backdrop-blur-sm lg:static lg:max-w-none lg:max-h-none lg:shrink-0 lg:rounded-none lg:bg-white lg:dark:bg-neutral-800 lg:backdrop-blur-none"
      data-testid="live-panel"
    >
      <div className="p-4 flex flex-col gap-3 min-h-0 lg:h-full">
        <AppButton
          variant="plain"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          aria-label={t('live.togglePanel')}
          onClick={onToggle}
          className={`lg:hidden cursor-pointer flex items-center justify-between gap-3 text-left -mx-4 -mt-4 px-4 pt-4 pb-2 ${collapsed ? '-mb-5' : '-mb-2'}`}
        >
          <span className={CAPTION}>{t('live.preview')}</span>
          <span className="flex items-center gap-3">
            {collapsed && (
              <span className="block w-16 aspect-video rounded overflow-hidden">
                <SlideView slide={pointer.black ? null : current} theme={theme} label={false} overlay={pointer.black ? null : overlay} />
              </span>
            )}
            <ChevronDownIcon className={`size-4 text-neutral-400 dark:text-neutral-500 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`} />
          </span>
        </AppButton>
        <h2 className={`hidden lg:block ${CAPTION}`}>{t('live.preview')}</h2>
        <div
          id={panelId}
          inert={collapsed}
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${collapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr] grow min-h-0'}`}
        >
          <div className="overflow-hidden flex flex-col min-h-0">
            <div className="flex flex-col gap-3 min-h-0 px-1 -mx-1 grow overflow-y-auto">
              <div className="w-48 mx-auto lg:w-auto lg:mx-0 aspect-video rounded-lg overflow-hidden">
                <SlideView slide={pointer.black ? null : current} theme={theme} label={false} overlay={pointer.black ? null : overlay} />
              </div>
              {/* Rensa only blanks, and is gone while the screen is black: a slide brings the picture back (LivePanel.razor). */}
              <div className={`mx-1 ${pointer.black ? 'invisible pointer-events-none' : ''}`}>
                <AppButton variant="secondary" title={t('live.clear')} onClick={() => live.set({ black: true })} className="w-full flex items-center justify-center gap-1.5">
                  <CloseIcon className="size-4" />
                  <span>{t('live.clear')}</span>
                </AppButton>
              </div>
              {owner && (
                <div className="mt-3">
                  <OutputsPanel link={link} sessionId={owner.sessionId} />
                </div>
              )}
              {!!overlays.length && (
                <div className="mt-3">
                  <OverlaysPanel overlays={overlays} pointer={pointer} live={live} />
                </div>
              )}
              {owner && remotePolicy && remotePolicy !== 'never' && (
                <div className="mt-3">
                  <RemotePanel id={id} sessionId={owner.sessionId} name={name} always={remotePolicy === 'always'} />
                </div>
              )}
              <AppButton variant="secondary" onClick={onStage} className="mt-3 flex items-center justify-center gap-2">
                <ArrowsPointingOutIcon className="size-5" />
                <span className="font-medium">{t('live.stage')}</span>
              </AppButton>
            </div>
            {/* Outside the part that scrolls, so it is always in view (LivePanel.razor). */}
            <div className="shrink-0 pt-4">
              {owner ? (
                <AppButton
                  variant="plain"
                  title={t('live.end')}
                  onClick={() => {
                    live.set({ presentationId: null, itemId: null, partIndex: 0, black: false });
                    // The output window closes with the presentation (Live.razor, Lars 2026-10-29).
                    outputWindow().turn(false);
                    navigate({ page: 'presentation', id });
                  }}
                  className="w-full px-4 py-2.5 rounded-full flex items-center justify-center gap-2 shadow-lg cursor-pointer bg-red-500 text-white hover:bg-red-600"
                >
                  <StopIcon className="size-5" />
                  <span className="text-sm font-medium">{t('live.end')}</span>
                </AppButton>
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">{t('remote.onlyOwnerStops')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
