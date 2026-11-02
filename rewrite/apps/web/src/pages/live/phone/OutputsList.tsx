import { useState, type ReactNode } from 'react';
import { t } from '../../../i18n.ts';
import type { LiveLink } from '../../../live/remote.ts';
import { AppButton } from '../../../ui/AppButton.tsx';
import { CloseIcon, DesktopIcon, PlusIcon, QrCodeIcon } from '../../../ui/icons.tsx';
import { GROUP } from '../../../ui/Sheet.tsx';
import { IOS_SWITCH } from '../../../ui/Toggle.tsx';
import { viewersText } from '../../Displays.tsx';
import { PairScreenDialog } from '../../PairScreen.tsx';
import { useOutputs } from '../useOutputs.ts';

/**
 * Utgångar in a sheet (docs/layout-2-0.md): each output a row of its own, equals, with its state under its name and
 * a switch; the temporary screens with ✕; then Anslut tillfällig skärm.
 */
export function OutputsList({ link, sessionId }: { link: LiveLink; sessionId: string }) {
  const { dialog, externalOn, turnExternal, rows, temporary } = useOutputs(link, sessionId);
  const [pairing, setPairing] = useState(false);
  return (
    <>
      {dialog}
      <ul className={GROUP} aria-label={t('live.outputs')}>
        <Row icon={<DesktopIcon className="size-4" />} on={externalOn} name={t('live.output')} state={externalOn ? t('live.outputShowing') : t('live.outputOff')}>
          <input type="checkbox" className={IOS_SWITCH} aria-label={t('live.output')} checked={externalOn} onChange={(e) => turnExternal(e.target.checked)} />
        </Row>
        {rows.map(({ display: d, sending, offline, elsewhere, viewers, toggle }) => (
          <Row
            key={d.id}
            icon={d.kind === 'public' ? <QrCodeIcon className="size-4" /> : <DesktopIcon off={offline} className="size-4" />}
            on={sending}
            name={d.name}
            state={
              offline
                ? t('live.outputOffline')
                : elsewhere !== null
                  ? t('displays.sending', { name: elsewhere })
                  : !sending
                    ? t('live.outputOff')
                    : d.kind === 'public' && viewers !== undefined
                      ? viewersText(viewers)
                      : t('live.outputShowing')
            }
          >
            <input type="checkbox" className={IOS_SWITCH} aria-label={d.name} checked={sending} disabled={offline} onChange={(e) => void toggle(e.target.checked)} />
          </Row>
        ))}
        {temporary.map((x) => (
          <Row key={x.id} icon={<DesktopIcon className="size-4" />} on name={t('screens.temporary', { n: x.n })} state={t('live.outputShowing')}>
            <AppButton
              variant="plain"
              aria-label={t('screens.disconnect', { n: x.n })}
              onClick={x.disconnect}
              className="size-9 rounded-full flex items-center justify-center cursor-pointer text-stone-400 hover:text-red-500"
            >
              <CloseIcon className="size-4" />
            </AppButton>
          </Row>
        ))}
        <li>
          <AppButton variant="plain" onClick={() => setPairing(true)} className="w-full min-h-[52px] px-4 flex items-center gap-3 text-[17px] text-sky-500 text-left cursor-pointer">
            <PlusIcon className="size-5 mx-1" />
            {t('pairScreen.title')}
          </AppButton>
        </li>
      </ul>
      {pairing && <PairScreenDialog sessionId={sessionId} onClose={() => setPairing(false)} />}
    </>
  );
}

/** One output: a square icon, green while it shows, its name and state, and its control at the end. */
function Row({ icon, on, name, state, children }: { icon: ReactNode; on: boolean; name: string; state: string; children: ReactNode }) {
  return (
    <li className="min-h-[60px] px-4 py-2 flex items-center gap-3">
      <span className={`size-[30px] shrink-0 rounded-lg flex items-center justify-center text-white ${on ? 'bg-green-600' : 'bg-stone-400 dark:bg-stone-600'}`}>{icon}</span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[17px] truncate">{name}</span>
        <span className={`text-[13px] truncate ${on ? 'text-green-600 dark:text-green-400' : 'text-stone-500 dark:text-stone-400'}`}>{state}</span>
      </span>
      {children}
    </li>
  );
}
