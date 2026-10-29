import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { Debounced, SaveBaseline } from './debounce.ts';
import { FloatingInput, FloatingTextarea } from './Floating.tsx';
import { TickIcon } from './icons.tsx';
import { useToast } from './Toast.tsx';

/** Tells the user a save was refused: a warning toast "Kunde inte spara". The current app shows nothing (spec 02, open question 10). */
export function useSaveFailed(): () => void {
  const toast = useToast();
  return useCallback(() => toast(t('common.saveFailed'), 'warning'), [toast]);
}

/** Waits for a write the next step depends on: true once it went through; false, logged and "Kunde inte spara" when it was refused. */
export function useTrySave(): (write: Promise<unknown>) => Promise<boolean> {
  const saveFailed = useSaveFailed();
  return useCallback(
    async (write) => {
      try {
        await write;
        return true;
      } catch (e) {
        console.error('save failed', e);
        saveFailed();
        return false;
      }
    },
    [saveFailed],
  );
}

/**
 * The fading "✓ Sparad" at the right of a detail page's header
 * (Components/AutoSaveIndicator.razor): shown at each `show()`, faded after 2 s
 * over 300 ms. `node` goes into the header.
 */
export function useSavedIndicator(): { node: ReactNode; show: () => void } {
  const [state, setState] = useState<'hidden' | 'shown' | 'fading'>('hidden');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const show = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    setState('shown');
    timers.current = [setTimeout(() => setState('fading'), 2000), setTimeout(() => setState('hidden'), 2300)];
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const node =
    state === 'hidden' ? null : (
      <span
        data-testid="saved"
        className={`text-xs text-neutral-400 dark:text-neutral-500 transition-opacity duration-300 ${state === 'fading' ? 'opacity-0' : 'opacity-100'} absolute right-0`}
      >
        <TickIcon strokeWidth={2} className="size-3.5 inline -mt-0.5 mr-0.5" />
        {t('common.saved')}
      </span>
    );
  return { node, show };
}

/**
 * A field that saves 500 ms after the last keystroke, and at once when it
 * loses focus, unmounts or the window closes. While it has focus, and after
 * that until the stored value changes, it shows what the user typed rather
 * than the stored value, so neither its own save nor a sync arriving
 * meanwhile moves the cursor or takes back a letter. `onSave` returns the
 * write, or nothing when the value is not to be written (a blank name, say):
 * the field then shows the stored value again once the user leaves it.
 * `onSaved` hears of each write that succeeded; a refused write shows
 * "Kunde inte spara", and the field keeps what the user typed.
 * With `warnOnClash` (a song part, D18), a stored value that changes from elsewhere while the user is typing in
 * the field, to something else than they have, stops the saving and shows a warning with the other text, and the
 * choice to keep theirs (written at once) or take the other.
 */
export function AutoSaveField({
  label,
  value,
  onSave,
  onSaved,
  multiline,
  warnOnClash,
  rows = 8,
  showLabel,
  className,
  maxLength,
  type,
  min,
  max,
  hasError,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<unknown> | undefined;
  onSaved?: () => void;
  multiline?: boolean;
  /** Warns when another device changes the value while the user types in it (D18). */
  warnOnClash?: boolean;
  /** A multiline field's height in rows. */
  rows?: number;
  /** Shows a multiline field's label in the box, as other fields do; a part's text has none. */
  showLabel?: boolean;
  className?: string;
  /** The field's limits (AppConstraints): its length, and for a number its type and range. */
  maxLength?: number;
  type?: 'text' | 'number' | 'email';
  min?: number;
  max?: number;
  /** A red border, for an error shown under the field (an e-mail that is taken). */
  hasError?: boolean;
}) {
  // What the user has typed, shown in place of `value`; null shows `value`.
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [saver] = useState(() => new Debounced<string>());
  const [baseline] = useState(() => new SaveBaseline());
  const saveFailed = useSaveFailed();
  // Whether `onSave` turned down the last value; read after a flush, so refs rather than state.
  const refused = useRef(false);
  const hasFocus = useRef(false);
  // The values this field wrote since it got focus, which come back as the stored value and are no clash;
  // whether the user typed since; and the other text while a clash waits for the user's choice.
  const [own] = useState(() => new Set<string>());
  const [typed, setTyped] = useState(false);
  const [clash, setClash] = useState<string | null>(null);
  useEffect(() => {
    saver.use(
      (v) => {
        // Typed back to what is stored (or to this field's last write): nothing to write.
        if (baseline.unchanged(v, value)) {
          refused.current = false;
          return undefined;
        }
        const write = onSave(v);
        refused.current = !write;
        if (write) {
          baseline.wrote(v, value);
          own.add(v);
        }
        return write;
      },
      (result) => {
        if (result === 'saved') onSaved?.();
        else if (result === 'failed') {
          // Saves run one at a time, so the next one has not yet compared against this refused write.
          baseline.forget();
          saveFailed();
        }
      },
    );
  });

  // A new stored value (this field's own save coming back, or a sync) shows once the user has left the field.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (warnOnClash && !own.has(value) && (focused || saver.busy || clash !== null) && typed && draft !== null && draft !== value) {
      // Changed elsewhere while the user types here: nothing more is written until they choose.
      saver.cancel();
      setClash(value);
    } else if (!focused && !saver.busy && clash === null) setDraft(null);
  }

  useEffect(() => {
    const flush = () => void saver.flush();
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', flush);
    return () => {
      removeEventListener('pagehide', flush);
      removeEventListener('beforeunload', flush);
      flush();
    };
  }, [saver]);

  const shown = draft ?? value;
  const onFocus = () => {
    hasFocus.current = true;
    setFocused(true);
    setDraft(shown);
    if (clash === null) {
      own.clear();
      setTyped(false);
    }
  };
  const onChange = (e: { currentTarget: { value: string } }) => {
    setDraft(e.currentTarget.value);
    setTyped(true);
    if (clash === null) saver.schedule(e.currentTarget.value);
  };
  const onBlur = () => {
    hasFocus.current = false;
    setFocused(false);
    const waiting = clash !== null;
    void saver.flush().then(() => {
      if (refused.current && !hasFocus.current && !waiting) setDraft(null);
    });
  };
  const keepMine = () => {
    setClash(null);
    saver.schedule(shown);
    void saver.flush();
  };
  const takeTheirs = () => {
    setClash(null);
    setTyped(false);
    setDraft(focused ? value : null);
  };
  // A part's text has no visible label, as in the current app; its name is for screen readers and tests.
  const field = multiline ? (
    <FloatingTextarea label={showLabel ? label : ''} aria-label={showLabel ? undefined : label} rows={rows} maxLength={maxLength} value={shown} onFocus={onFocus} onChange={onChange} onBlur={onBlur} className={className} />
  ) : (
    <FloatingInput label={label} type={type} min={min} max={max} maxLength={maxLength} hasError={hasError} value={shown} onFocus={onFocus} onChange={onChange} onBlur={onBlur} className={className} />
  );
  if (clash === null) return field;
  return (
    <>
      {field}
      <div role="alert" className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2 text-sm text-amber-800 dark:text-amber-200">
        <p className="font-medium">{t('autosave.clash')}</p>
        <p className="max-h-32 overflow-y-auto whitespace-pre-line text-neutral-700 dark:text-neutral-300" data-testid="clash-theirs">
          {clash}
        </p>
        <div className="flex flex-wrap gap-2">
          <AppButton variant="secondary" onClick={keepMine}>
            {t('autosave.keepMine')}
          </AppButton>
          <AppButton variant="neutral" onClick={takeTheirs}>
            {t('autosave.takeTheirs')}
          </AppButton>
        </div>
      </div>
    </>
  );
}
