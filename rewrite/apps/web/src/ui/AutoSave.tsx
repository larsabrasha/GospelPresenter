import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { Debounced, SaveBaseline } from './debounce.ts';
import { FloatingInput, FloatingTextarea } from './Floating.tsx';
import { TickIcon } from './icons.tsx';

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
 * `onSaved` hears of each write that succeeded.
 */
export function AutoSaveField({
  label,
  value,
  onSave,
  onSaved,
  multiline,
  className,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<unknown> | undefined;
  onSaved?: () => void;
  multiline?: boolean;
  className?: string;
}) {
  // What the user has typed, shown in place of `value`; null shows `value`.
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [saver] = useState(() => new Debounced<string>());
  const [baseline] = useState(() => new SaveBaseline());
  // Whether `onSave` turned down the last value; read after a flush, so refs rather than state.
  const refused = useRef(false);
  const hasFocus = useRef(false);
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
        if (write) baseline.wrote(v, value);
        return write;
      },
      (result) => {
        if (result === 'saved') onSaved?.();
      },
    );
  });

  // A new stored value (this field's own save coming back, or a sync) shows once the user has left the field.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!focused && !saver.busy) setDraft(null);
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
  };
  const onChange = (e: { currentTarget: { value: string } }) => {
    setDraft(e.currentTarget.value);
    saver.schedule(e.currentTarget.value);
  };
  const onBlur = () => {
    hasFocus.current = false;
    setFocused(false);
    void saver.flush().then(() => {
      if (refused.current && !hasFocus.current) setDraft(null);
    });
  };
  // A part's text has no visible label, as in the current app; its name is for screen readers and tests.
  return multiline ? (
    <FloatingTextarea label="" aria-label={label} rows={8} value={shown} onFocus={onFocus} onChange={onChange} onBlur={onBlur} className={className} />
  ) : (
    <FloatingInput label={label} value={shown} onFocus={onFocus} onChange={onChange} onBlur={onBlur} className={className} />
  );
}
