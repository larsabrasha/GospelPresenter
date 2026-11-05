import { listLabels, itemsOf, songPartsOf } from '../db/queries.ts';
import { useData } from '../db/react.tsx';
import { t } from '../i18n.ts';

// ⌘K's look at the marked one, beside the list where the window is wide (Lars, 2026-11-05: "förhandsgranskas på ett
// smutt sätt"): a song's words, part by part under their labels, or a presentation's running order. It fades in as the
// mark moves, as Spotlight's preview does.

/** What the marked hit can show. */
export type PreviewOf = { kind: 'song'; id: string; title: string } | { kind: 'presentation'; id: string; title: string };

function SongWords({ id }: { id: string }) {
  const parts = useData((db) => songPartsOf(db, [id]), [id]);
  const labels = useData(listLabels, []);
  if (!parts) return null;
  if (!parts.length) return <p className="text-sm text-stone-400">{t('palette.noWords')}</p>;
  return (
    <div className="space-y-3">
      {parts.map((p) => {
        const label = p.labelId ? labels?.get(p.labelId) : undefined;
        return (
          <div key={p.id}>
            {label && <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">{label.text}</p>}
            <p className="text-sm whitespace-pre-line text-stone-700 dark:text-stone-200">{p.content}</p>
          </div>
        );
      })}
    </div>
  );
}

function RunningOrder({ id }: { id: string }) {
  const items = useData((db) => itemsOf(db, id), [id]);
  if (!items) return null;
  if (!items.length) return <p className="text-sm text-stone-400">{t('palette.noItems')}</p>;
  return (
    <ol className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className={`text-sm truncate ${item.type === 'header' ? 'pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500' : 'text-stone-700 dark:text-stone-200'}`}>
          {item.title}
        </li>
      ))}
    </ol>
  );
}

export function PalettePreview({ of }: { of: PreviewOf | null }) {
  if (!of) return null;
  return (
    <div key={`${of.kind}:${of.id}`} className="dialog-in h-full overflow-y-auto rounded-xl bg-raised/60 dark:bg-white/[0.04] p-4 space-y-3" data-testid="palette-preview">
      <p className="font-semibold truncate">{of.title}</p>
      {of.kind === 'song' ? <SongWords id={of.id} /> : <RunningOrder id={of.id} />}
    </div>
  );
}
