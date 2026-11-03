import type { HTMLAttributes, ReactNode } from 'react';
import { ChevronRightIcon } from './icons.tsx';

/**
 * A row's hover on a card: a shade darker than the page's ground, so the card stays a card (Lars, 2026-11-03: the
 * ground's own colour made it vanish).
 */
export const ROW_HOVER = 'hover:bg-stone-200/60 dark:hover:bg-white/[0.06]';

/** The › at the end of a row that opens a page, as iOS's lists. */
export function RowChevron() {
  return <ChevronRightIcon className="size-4 shrink-0 -mr-1 text-stone-400 dark:text-stone-600" />;
}

// The current app's lists: a light card of rows, with an optional small
// caption above (Components/Presentations/PresentationSection.razor, PresentationRow.razor).

/** The card the rows sit in; also the card for a block of content on a page. */
export const CARD = 'bg-surface dark:text-stone-100 rounded-xl border-[0.5px] border-separator overflow-hidden';

export function ListCard({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul className={`${CARD} ${className ?? ''}`} aria-label={label}>
      {children}
    </ul>
  );
}

/** A captioned list: "Idag", then its rows; the caption in sentence case, as iOS 26 writes it (Lars, 2026-11-02). */
export function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm/5 font-semibold text-stone-500 dark:text-stone-400 px-5">{title}</h2>
      <ListCard label={title}>{children}</ListCard>
    </section>
  );
}

/** A row that opens something: a title, a grey line under it, and whatever goes at the end. */
export function ListLinkRow({
  href,
  title,
  subtitle,
  subtitleTitle,
  end,
  after,
  nav,
}: {
  href: string;
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleTitle?: string;
  end?: ReactNode;
  /** A control at the end of the row, outside the link (a button cannot sit in a link). */
  after?: ReactNode;
  /** Its place in a roving list (ui/listNav.ts `item(i)`). */
  nav?: HTMLAttributes<HTMLAnchorElement>;
}) {
  return (
    <li className="flex items-center border-b border-separator last:border-b-0">
      <a
        {...nav}
        href={href}
        className={`flex-1 min-w-0 flex items-center gap-3 px-5 py-3 ${ROW_HOVER} no-underline text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500`}
      >
        <div className="flex-1 min-w-0">
          <div className="truncate">{title}</div>
          {subtitle && (
            <div className="text-xs text-stone-400 dark:text-stone-500 truncate" title={subtitleTitle}>
              {subtitle}
            </div>
          )}
        </div>
        {end}
        {/* A row that opens a page says so, as iOS's lists do (Lars, 2026-11-03); not beside a control of its own. */}
        {!after && <RowChevron />}
      </a>
      {after && <div className="shrink-0 pr-3 -ml-2">{after}</div>}
    </li>
  );
}
