import { useRef, useState, type PointerEvent } from 'react';
import { AppButton } from './AppButton.tsx';

// The index along a sectioned list's edge, as Contacts' on an iPhone (Lars, 2026-11-05: drag and swipe on it): a tap
// jumps to a caption, and a finger kept on it and moved up and down jumps to the caption under it as it goes, with the
// letter shown big beside the finger, which covers the small one. Only on a touch screen (ui/Library.tsx).

/**
 * The key under a finger `y` points down an index `height` tall, whose keys are evenly spaced: the nearest one, the
 * first above it and the last below it, so a finger that slides off an end keeps the end's.
 */
export function keyAt(y: number, height: number, keys: readonly string[]): string | null {
  if (!keys.length || height <= 0) return null;
  const i = Math.floor((y / height) * keys.length);
  return keys[Math.min(keys.length - 1, Math.max(0, i))]!;
}

export function LetterIndex({ sections, label, jump }: { sections: { key: string; title: string }[]; label: string; jump: (key: string) => void }) {
  const last = useRef<string | null>(null);
  /** While a finger is on it: the key under it, and where, for the big letter. */
  const [held, setHeld] = useState<{ key: string; y: number } | null>(null);
  const pick = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - box.top;
    const key = keyAt(y, box.height, sections.map((s) => s.key));
    if (!key) return;
    setHeld({ key, y: Math.min(box.height, Math.max(0, y)) });
    if (key === last.current) return;
    last.current = key;
    jump(key);
  };
  const release = () => {
    last.current = null;
    setHeld(null);
  };
  const title = held && sections.find((s) => s.key === held.key)?.title;
  return (
    <nav
      aria-label={label}
      // The page does not scroll under the finger: the finger moves along the index.
      className="sticky top-2 self-start hidden pointer-coarse:flex flex-col items-center px-1 py-1 touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pick(e)}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {sections.map((s) => (
        <AppButton
          key={s.key}
          variant="plain"
          // The keyboard and a screen reader press the letter itself.
          onClick={() => jump(s.key)}
          className={`w-5 text-[11px]/4 font-semibold cursor-pointer ${held?.key === s.key ? 'text-sky-700 dark:text-sky-300' : 'text-sky-600 dark:text-sky-400'}`}
        >
          {s.title}
        </AppButton>
      ))}
      {title && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-full mr-3 size-14 -translate-y-1/2 rounded-full bg-stone-500/80 text-white text-3xl font-semibold flex items-center justify-center"
          style={{ top: held.y }}
        >
          {title}
        </span>
      )}
    </nav>
  );
}
