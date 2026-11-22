import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Display } from '@gp/core';
import { pageCore } from '../../db/pageCore.ts';
import { useData } from '../../db/react.tsx';
import { listDisplays } from '../../db/queries.ts';
import { t, type TextKey } from '../../i18n.ts';
import { chosenOutputs, REMOTE_CHANGED, setOutput } from '../../live/owner.ts';
import { useLiveSessions, type LiveLink } from '../../live/remote.ts';
import { rememberOutput } from '../../live/autoOutputs.ts';
import { OUTPUT_WINDOW, outputWindow, type OutputDisplay } from '../../live/outputWindow.ts';
import { useConfirm } from '../../ui/Dialog.tsx';
import { useToast } from '../../ui/Toast.tsx';

/** The texts `outputRowsView` asks a take-over with, written out so each is known to be used (packages/architecture). */
const TAKE_OVER = ['live.takeOverTitle', 'live.takeOverText', 'live.takeOverTextUnknown', 'live.takeOver'] as const;
/** The texts the line under a row may say. */
const LINES = ['screens.offline', 'displays.sending'] as const satisfies readonly TextKey[];

/** What is written under a row (the core's): a text, in orange when `warn`; or how many watch. */
type OutputLine = { text: (typeof LINES)[number]; args: Record<string, string>; warn: boolean } | { viewers: number } | null;

/** A row as the core answers it. */
interface CoreRow {
  id: string;
  chosen: boolean;
  sending: boolean;
  offline: boolean;
  elsewhere: string | null;
  viewers: number | null;
  line: OutputLine;
  takeOver: { title: (typeof TAKE_OVER)[number]; text: (typeof TAKE_OVER)[number]; args: Record<string, string>; confirm: (typeof TAKE_OVER)[number] } | null;
}

/** A saved screen or a public output, as the outputs show it while presenting. */
interface OutputRow {
  display: Display;
  /** This window has chosen it; it may still be offline. */
  chosen: boolean;
  /** This window sends to it. */
  sending: boolean;
  /** A saved screen whose page is not open: it cannot be switched on (LIVE-A21). */
  offline: boolean;
  /** What is written under it. */
  line: OutputLine;
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
  // Which are sent to, offline or another presentation's, and the question before taking one over: the core's
  // (`outputRowsView`), the same in every shell.
  const answer = pageCore().pure<{ rows: CoreRow[] }>('outputRowsView', { displays: displays ?? [], sessions, online, chosen, sessionId });
  const byId = new Map((displays ?? []).map((d) => [d.id, d]));
  const rows: OutputRow[] = answer.rows.flatMap((r) => {
    const display = byId.get(r.id);
    if (!display) return [];
    return [{
      display,
      chosen: r.chosen,
      sending: r.sending,
      offline: r.offline,
      line: r.line,
      toggle: async (on: boolean) => {
        if (on && r.takeOver) {
          const ok = await ask({ title: t(r.takeOver.title), text: t(r.takeOver.text, r.takeOver.args), confirm: t(r.takeOver.confirm) });
          if (ok) setOutput(r.id, true, true);
          return;
        }
        setOutput(r.id, on);
      },
    }];
  });
  return {
    dialog,
    /** This computer's own outputs, each switched on its own; turning one on says so when the browser would not open it. */
    // The phone app has no window to put one in: an AirPlay screen, or none.
    own: (ownDisplays.length ? ownDisplays.map((d) => ({ id: d.id, name: d.name || t('live.otherScreen') })) : output.kind() === 'phone' ? [] : [{ id: OUTPUT_WINDOW, name: t('live.outputWindow') }]).map((x) => ({
      ...x,
      on: openOwn.includes(x.id),
      turn: (on: boolean) => {
        if (!output.turn(on, x.id)) toast(t('live.outputFailed'));
        // Left as it is by hand, it comes on by itself the same way next time (live/autoOutputs.ts).
        else if (x.id !== OUTPUT_WINDOW) rememberOutput(ownDisplays.find((d) => d.id === x.id)?.name ?? '', on);
      },
    })),
    /** Chrome, before the user let it see the screens: asks, so the outputs can go on them by name (Lars, 2026-11-07). */
    askScreens: !ownDisplays.length && output.canAskScreens() ? () => void output.askScreens() : undefined,
    rows,
    temporary: screens.filter((x) => chosen.includes(x.id)).map((x) => ({ id: x.id, n: x.n, disconnect: () => setOutput(x.id, false) })),
  };
}
