import { useState } from 'react';
import { t } from '../../i18n.ts';
import type { LiveLink } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CloseIcon, DesktopIcon, PlusIcon, QrCodeIcon } from '../../ui/icons.tsx';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { viewersText } from '../Displays.tsx';
import { PairScreenDialog } from '../PairScreen.tsx';
import { GROUP_LIST, PanelGroup, SHEET_LIST } from './PanelGroup.tsx';
import { useOutputs } from './useOutputs.ts';
import { OUTPUT_WINDOW } from '../../live/outputWindow.ts';

/**
 * Utgångar (spec 04 §1) in the live column, a group as iOS's Settings has (Lars, 2026-11-02): this computer's own, one
 * row for each display the app's window is not on, named as the operating system names it (or one for a window of its
 * own); public outputs, each with how many watch; saved screens, which can be switched on only while their page is
 * open (LIVE-A21), an output gone saying so on its row; temporary screens paired from here, with ✕ to let one go; and
 * last "Anslut tillfällig skärm" as a row of its own. Taking an output from another presentation asks first
 * (LIVE-R23).
 */
export function OutputsPanel({ link, sessionId, sheet }: { link: LiveLink; sessionId: string; sheet?: boolean }) {
  const { dialog, own, rows, temporary } = useOutputs(link, sessionId);
  const [pairing, setPairing] = useState(false);
  return (
    <>
      {dialog}
      <PanelGroup title={t('live.outputs')} hint={t('live.outputsHint')} sheet={sheet}>
        {own.map((x) => (
          <ToggleRow
            key={x.id}
            cell
            label={x.name}
            checked={x.on}
            onChange={x.turn}
            icon={<DesktopIcon className={`size-4 shrink-0 ${x.on ? 'text-green-500' : 'text-stone-500 dark:text-stone-400'}`} />}
            // With no other display, where the window goes: a desktop has none to put it on, a browser leaves it to the user.
            sub={x.id === OUTPUT_WINDOW ? t(window.gpDesktop ? 'live.noOtherScreen' : 'live.dragWindow') : undefined}
          />
        ))}
        <ul className={sheet ? SHEET_LIST : GROUP_LIST} aria-label={t('live.outputs')}>
          {rows.map(({ display: d, chosen, sending, offline, elsewhere, viewers, toggle }) => (
            <li key={d.id}>
              <ToggleRow
                cell
                label={d.name}
                checked={sending}
                disabled={offline}
                noSwitch={offline}
                onChange={(v) => void toggle(v)}
                icon={
                  d.kind === 'public' ? (
                    <QrCodeIcon className={`size-4 shrink-0 ${sending ? 'text-green-500' : 'text-stone-400 dark:text-stone-500'}`} />
                  ) : (
                    <DesktopIcon off={offline} className={`size-4 shrink-0 ${sending ? 'text-green-500' : offline ? 'text-stone-300 dark:text-stone-500' : 'text-stone-500 dark:text-stone-400'}`} />
                  )
                }
                // An output gone says so on its own row, in orange while it is one chosen for this presentation.
                sub={offline ? t('screens.offline') : elsewhere !== null ? t('displays.sending', { name: elsewhere }) : undefined}
                warn={offline && chosen}
                extra={
                  d.kind === 'public' &&
                  sending &&
                  viewers !== undefined && <span className={`text-[11px] ${viewers > 0 ? 'text-green-600 dark:text-green-400' : 'text-stone-400 dark:text-stone-500'}`}>{viewersText(viewers)}</span>
                }
              />
            </li>
          ))}
          {temporary.map((x) => (
            <li key={x.id} className={`flex items-center justify-between gap-2 py-1.5 ${sheet ? 'px-4 min-h-12' : 'px-3 min-h-11'}`} aria-label={t('screens.temporary', { n: x.n })}>
              <span className={`flex items-center ${sheet ? 'gap-3.5 text-[17px] text-stone-900 dark:text-stone-100' : 'gap-2 text-sm text-stone-700 dark:text-stone-200'}`}>
                <DesktopIcon className={`${sheet ? 'size-5' : 'size-4'} shrink-0 text-green-500`} />
                {t('screens.temporary', { n: x.n })}
              </span>
              <AppButton
                variant="plain"
                aria-label={t('screens.disconnect', { n: x.n })}
                title={t('screens.disconnectShort')}
                onClick={x.disconnect}
                className="cursor-pointer touch:size-11 touch:-m-3 flex items-center justify-center text-stone-400 dark:text-stone-500 hover:text-red-500 dark:hover:text-red-400"
              >
                <CloseIcon className="size-4" />
              </AppButton>
            </li>
          ))}
        </ul>
        {/* A row at the foot of the group, in grey: seldom needed, so it stays out of the way (Lars, 2026-11-02). */}
        <AppButton variant="plain" onClick={() => setPairing(true)} className={`w-full flex items-center text-left cursor-pointer ${sheet ? 'gap-3.5 min-h-12 px-4 text-[17px] text-sky-600 dark:text-sky-400' : 'gap-2 min-h-11 px-3 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'} hover:bg-black/5 dark:hover:bg-white/5`}>
          <PlusIcon className={`${sheet ? 'size-5' : 'size-4'} shrink-0`} />
          {t('pairScreen.title')}
        </AppButton>
      </PanelGroup>
      {pairing && <PairScreenDialog sessionId={sessionId} onClose={() => setPairing(false)} />}
    </>
  );
}
