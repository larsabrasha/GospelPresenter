import { useState } from 'react';
import { t } from '../../i18n.ts';
import type { LiveLink } from '../../live/remote.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CloseIcon, DesktopIcon, PlusIcon, QrCodeIcon } from '../../ui/icons.tsx';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { viewersText } from '../Displays.tsx';
import { PairScreenDialog } from '../PairScreen.tsx';
import { PanelSection } from './PanelSection.tsx';
import { useOutputs } from './useOutputs.ts';

/**
 * Utgångar (spec 04 §1) in the live column: the outputs this window sends to. Public outputs,
 * each with how many watch; saved screens, which can be switched on only
 * while their page is open (LIVE-A21); and temporary screens paired from
 * here, with ✕ to let one go. Taking an output from another presentation
 * asks first (LIVE-R23).
 */
export function OutputsPanel({ link, sessionId }: { link: LiveLink; sessionId: string }) {
  const { dialog, externalOn, turnExternal, rows, temporary } = useOutputs(link, sessionId);
  const [pairing, setPairing] = useState(false);
  return (
    <PanelSection title={t('live.outputs')} hint={t('live.outputsHint')} open>
      {dialog}
      <ToggleRow label={t('live.output')} checked={externalOn} onChange={turnExternal} icon={<DesktopIcon className="size-4 shrink-0" />} />
      <ul className="flex flex-col gap-3" aria-label={t('live.outputs')}>
        {rows.map(({ display: d, sending, offline, elsewhere, viewers, toggle }) => (
          <li key={d.id}>
            <ToggleRow
              label={d.name}
              checked={sending}
              disabled={offline}
              noSwitch={offline}
              onChange={(v) => void toggle(v)}
              icon={
                d.kind === 'public' ? (
                  <QrCodeIcon className={`size-4 shrink-0 ${sending ? 'text-green-500' : 'text-neutral-400 dark:text-neutral-500'}`} />
                ) : (
                  <DesktopIcon off={offline} className={`size-4 shrink-0 ${sending ? 'text-green-500' : offline ? 'text-neutral-300 dark:text-neutral-500' : 'text-neutral-500 dark:text-neutral-400'}`} />
                )
              }
              sub={elsewhere !== null && !offline ? t('displays.sending', { name: elsewhere }) : undefined}
              extra={
                d.kind === 'public' &&
                sending &&
                viewers !== undefined && <span className={`text-[11px] ${viewers > 0 ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}`}>{viewersText(viewers)}</span>
              }
            />
          </li>
        ))}
        {temporary.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-sky-100 dark:bg-sky-900/30 ring-1 ring-sky-500" aria-label={t('screens.temporary', { n: x.n })}>
            <span className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <DesktopIcon className="size-4 shrink-0" />
              {t('screens.temporary', { n: x.n })}
            </span>
            <AppButton
              variant="plain"
              aria-label={t('screens.disconnect', { n: x.n })}
              title={t('screens.disconnectShort')}
              onClick={x.disconnect}
              className="cursor-pointer text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400"
            >
              <CloseIcon className="size-4" />
            </AppButton>
          </li>
        ))}
      </ul>
      <AppButton variant="secondary" onClick={() => setPairing(true)} className="self-start flex items-center gap-1.5">
        <PlusIcon className="size-4" />
        {t('pairScreen.title')}
      </AppButton>
      {pairing && <PairScreenDialog sessionId={sessionId} onClose={() => setPairing(false)} />}
    </PanelSection>
  );
}
