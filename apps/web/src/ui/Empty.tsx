import type { ReactNode } from 'react';

// What an admin page's card shows when its list is empty, in the current app's
// two sizes: a large picture with a heading (Overlays.razor, Users.razor,
// Displays.razor), and a small icon with a line (Images.razor, Songs.razor). Only the picture and the heading, on no
// card of their own: the card around them loses its background (app.css `[data-empty-list]`), so an empty list is
// quiet and does not compete with an intro card above it (Lars, 2026-11-02). As Apple's empty states (Lars,
// 2026-11-04): under the heading what the page is for, where no intro card says it, and the button for the first step.

/** What the page is for, in grey under the heading. */
function Text({ text }: { text?: string }) {
  return text ? <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-stone-400 dark:text-stone-500">{text}</p> : null;
}

/** The first step's buttons, under the text. */
function Actions({ children }: { children?: ReactNode }) {
  return children ? <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div> : null;
}

/** The large one: a 200×160 picture, a heading, what the page is for, and the first step. */
export function EmptyPicture({ picture, title, text, children }: { picture: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div data-empty-list className="flex flex-col items-center justify-center text-center px-6 py-12 select-none">
      {picture}
      <h2 className="text-lg/7 font-semibold text-stone-500 dark:text-stone-400">{title}</h2>
      <Text text={text} />
      <Actions>{children}</Actions>
    </div>
  );
}

/** The class of the large picture. */
export const PICTURE = 'w-48 h-auto mb-6 text-stone-300 dark:text-stone-600';

/** The small one: an icon, a line, what the page is for, and the first step. */
export function EmptySmall({
  icon,
  title,
  text,
  dropHint,
  children,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  /**
   * "Släpp filer här", in grey under the rest where there is a mouse. No frame is drawn: the page shows where to drop
   * while files are dragged over it, as Apple's apps do (Lars, 2026-11-04).
   */
  dropHint?: string;
  children?: ReactNode;
}) {
  return (
    <div data-empty-list className="flex flex-col items-center justify-center text-center text-sm py-12 px-6 select-none">
      {icon}
      <p className="font-medium text-stone-500 dark:text-stone-400">{title}</p>
      <Text text={text} />
      <Actions>{children}</Actions>
      {dropHint && <p className="hidden pointer-fine:block mt-3 text-stone-400 dark:text-stone-500">{dropHint}</p>}
    </div>
  );
}
