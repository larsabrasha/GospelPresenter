import { useEffect, useState, useSyncExternalStore } from 'react';
import { useData } from '../../db/react.tsx';
import { listDisplays } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { chosenOutputs, REMOTE_CHANGED, setOutput } from '../../live/owner.ts';
import { useLiveSessions, type LiveLink } from '../../live/remote.ts';
import { outputWindow } from '../../live/outputWindow.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { useConfirm } from '../../ui/Dialog.tsx';
import { CloseIcon, DesktopIcon, PlusIcon } from '../../ui/icons.tsx';
import { useToast } from '../../ui/Toast.tsx';
import { ToggleRow } from '../../ui/Toggle.tsx';
import { viewersText } from '../Displays.tsx';
import { PairScreenDialog } from '../PairScreen.tsx';
import { PanelSection } from './PanelSection.tsx';

/**
 * Utgångar (spec 04 §1): the outputs this window sends to. Public outputs,
 * each with how many watch; saved screens, which can be switched on only
 * while their page is open (LIVE-A21); and temporary screens paired from
 * here, with ✕ to let one go. Taking an output from another presentation
 * asks first (LIVE-R23).
 */
export function OutputsPanel({ link, sessionId }: { link: LiveLink; sessionId: string }) {
  const displays = useData(listDisplays, []);
  const { sessions, online, screens } = useLiveSessions(link);
  const { dialog, ask } = useConfirm();
  const [chosen, setChosen] = useState(chosenOutputs);
  const [pairing, setPairing] = useState(false);
  const output = outputWindow();
  const externalOn = useSyncExternalStore(output.subscribe, output.isOpen);
  const toast = useToast();
  useEffect(() => {
    const on = () => setChosen(chosenOutputs());
    addEventListener(REMOTE_CHANGED, on);
    return () => removeEventListener(REMOTE_CHANGED, on);
  }, []);
  const mine = sessions.find((s) => s.id === sessionId);
  const temporary = screens.filter((x) => chosen.includes(x.id));
  return (
    <PanelSection title={t('live.outputs')} hint={t('live.outputsHint')} open>
      {dialog}
      <ToggleRow
        label={t('live.output')}
        checked={externalOn}
        onChange={(on) => {
          if (!output.turn(on)) toast(t('live.outputFailed'));
        }}
        icon={<DesktopIcon className="size-4 shrink-0" />}
      />
      <ul className="flex flex-col gap-3" aria-label={t('live.outputs')}>
        {displays?.map((d) => {
          const elsewhere = sessions.find((s) => s.id !== sessionId && s.outputs.some((o) => o.id === d.id));
          const viewers = mine?.outputs.find((o) => o.id === d.id)?.viewers;
          const offline = d.kind === 'screen' && !online.includes(d.id);
          const sending = chosen.includes(d.id) && !elsewhere && !offline;
          const toggle = async (on: boolean) => {
            if (on && elsewhere) {
              const ok = await ask({
                title: t('live.takeOverTitle'),
                text: t('live.takeOverText', { output: d.name, presentation: elsewhere.presentationName }),
                confirm: t('live.takeOver'),
              });
              if (!ok) return;
              return setOutput(d.id, true, true);
            }
            setOutput(d.id, on);
          };
          return (
            <li key={d.id}>
              <ToggleRow
                label={d.name}
                checked={sending}
                disabled={offline}
                onChange={(v) => void toggle(v)}
                icon={<DesktopIcon className={`size-4 shrink-0 ${sending ? 'text-green-500' : 'text-neutral-400 dark:text-neutral-500'}`} />}
                sub={offline ? t('screens.offline') : elsewhere ? t('displays.sending', { name: elsewhere.presentationName }) : undefined}
                extra={
                  d.kind === 'public' &&
                  viewers !== undefined && <span className={`text-[11px] ${viewers > 0 ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-500'}`}>{viewersText(viewers)}</span>
                }
              />
            </li>
          );
        })}
        {temporary.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-sky-100 dark:bg-sky-900/30 ring-1 ring-sky-500" aria-label={t('screens.temporary', { n: x.n })}>
            <span className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <DesktopIcon className="size-4 shrink-0" />
              {t('screens.temporary', { n: x.n })}
            </span>
            <AppButton
              variant="plain"
              aria-label={t('screens.disconnect', { n: x.n })}
              title={t('screens.disconnect', { n: x.n })}
              onClick={() => setOutput(x.id, false)}
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
