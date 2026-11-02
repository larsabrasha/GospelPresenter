import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Display } from '@gp/core';
import { useData } from '../../db/react.tsx';
import { listDisplays } from '../../db/queries.ts';
import { t } from '../../i18n.ts';
import { chosenOutputs, REMOTE_CHANGED, setOutput } from '../../live/owner.ts';
import { useLiveSessions, type LiveLink } from '../../live/remote.ts';
import { rememberOutput } from '../../live/autoOutputs.ts';
import { OUTPUT_WINDOW, outputWindow, type OutputDisplay } from '../../live/outputWindow.ts';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useToast } from '../../ui/Toast.tsx';

/** A saved screen or a public output, as the outputs show it while presenting. */
interface OutputRow {
  display: Display;
  /** This window has chosen it; it may still be offline. */
  chosen: boolean;
  /** This window sends to it. */
  sending: boolean;
  /** A saved screen whose page is not open: it cannot be switched on (LIVE-A21). */
  offline: boolean;
  /** Another presentation's name, when that one sends to it. */
  elsewhere: string | null;
  /** How many watch a public output this window sends to. */
  viewers: number | undefined;
  /** Switches it; taking it from another presentation asks first (LIVE-R23). */
  toggle: (on: boolean) => Promise<void>;
}

/**
 * Utgångar (spec 04 §1), for whichever way they are drawn: this computer's own (`own`: one on each display the app's
 * window is not on, named by the operating system, or a window of its own with no other display), the saved screens then the public
 * outputs (each in the order they were made, LivePanel.razor), and the temporary screens paired from here.
 * `dialog` must be rendered: it is where taking an output over asks.
 */
export function useOutputs(link: LiveLink, sessionId: string) {
  const displays = useData(listDisplays, []);
  const { sessions, online, screens } = useLiveSessions(link);
  const { dialog, ask } = useConfirm();
  const [chosen, setChosen] = useState(chosenOutputs);
  const output = outputWindow();
  const openOwn = useSyncExternalStore(output.subscribe, output.openTargets);
  const [ownDisplays, setDisplays] = useState<OutputDisplay[]>([]);
  // The displays come and go, and change as the app's window moves to another.
  useEffect(() => {
    let current = true;
    const load = () => void output.displays().then((d) => current && setDisplays(d));
    load();
    const stop = output.watchDisplays(load);
    return () => {
      current = false;
      stop();
    };
  }, [output]);
  const toast = useToast();
  useEffect(() => {
    const on = () => setChosen(chosenOutputs());
    addEventListener(REMOTE_CHANGED, on);
    return () => removeEventListener(REMOTE_CHANGED, on);
  }, []);
  const mine = sessions.find((s) => s.id === sessionId);
  const rows: OutputRow[] = (displays ?? [])
    .toSorted((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1))
    .map((d) => {
      const elsewhere = sessions.find((s) => s.id !== sessionId && s.outputs.some((o) => o.id === d.id));
      const offline = d.kind === 'screen' && !online.includes(d.id);
      return {
        display: d,
        chosen: chosen.includes(d.id),
        sending: chosen.includes(d.id) && !elsewhere && !offline,
        offline,
        elsewhere: elsewhere ? (elsewhere.presentationName ?? '') : null,
        viewers: mine?.outputs.find((o) => o.id === d.id)?.viewers,
        toggle: async (on: boolean) => {
          if (on && elsewhere) {
            const ok = await ask({
              title: t('live.takeOverTitle'),
              text: elsewhere.presentationName ? t('live.takeOverText', { output: d.name, presentation: elsewhere.presentationName }) : t('live.takeOverTextUnknown', { output: d.name }),
              confirm: t('live.takeOver'),
            });
            if (ok) setOutput(d.id, true, true);
            return;
          }
          setOutput(d.id, on);
        },
      };
    });
  return {
    dialog,
    /** This computer's own outputs, each switched on its own; turning one on says so when the browser would not open it. */
    own: (ownDisplays.length ? ownDisplays.map((d) => ({ id: d.id, name: d.name || t('live.otherScreen') })) : [{ id: OUTPUT_WINDOW, name: t('live.outputWindow') }]).map((x) => ({
      ...x,
      on: openOwn.includes(x.id),
      turn: (on: boolean) => {
        if (!output.turn(on, x.id)) toast(t('live.outputFailed'));
        // Left as it is by hand, it comes on by itself the same way next time (live/autoOutputs.ts).
        else if (x.id !== OUTPUT_WINDOW) rememberOutput(ownDisplays.find((d) => d.id === x.id)?.name ?? '', on);
      },
    })),
    rows,
    temporary: screens.filter((x) => chosen.includes(x.id)).map((x) => ({ id: x.id, n: x.n, disconnect: () => setOutput(x.id, false) })),
  };
}
