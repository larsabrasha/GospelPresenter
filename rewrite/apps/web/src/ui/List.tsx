import type { HTMLAttributes, ReactNode } from 'react';

// The current app's lists: a light card of rows, with an optional small
// caption above (Components/Presentations/PresentationSection.razor, PresentationRow.razor).

/** The card the rows sit in; also the card for a block of content on a page. */
export const CARD = 'bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 rounded-xl shadow-sm border-t-[0.5px] border-white dark:border-neutral-700 overflow-hidden';

export function ListCard({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul className={`${CARD} ${className ?? ''}`} aria-label={label}>
      {children}
    </ul>
  );
}

/** A captioned list: "IDAG", then its rows. */
export function ListSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs/4 font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 px-5">{title}</h2>
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
  nav,
}: {
  href: string;
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleTitle?: string;
  end?: ReactNode;
  /** Its place in a roving list (ui/listNav.ts `item(i)`). */
  nav?: HTMLAttributes<HTMLAnchorElement>;
}) {
  return (
    <li className="border-b border-neutral-200 dark:border-neutral-700 last:border-b-0">
      <a
        {...nav}
        href={href}
        className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 no-underline text-inherit focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
      >
        <div className="flex-1 min-w-0">
          <div className="truncate">{title}</div>
          {subtitle && (
            <div className="text-xs text-neutral-400 dark:text-neutral-500 truncate" title={subtitleTitle}>
              {subtitle}
            </div>
          )}
        </div>
        {end}
      </a>
    </li>
  );
}

/** A row that is not a link, for content the page lays out itself. */
export function ListRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={`px-5 py-3 border-b border-neutral-200 dark:border-neutral-700 last:border-b-0 ${className ?? ''}`}>{children}</li>;
}
