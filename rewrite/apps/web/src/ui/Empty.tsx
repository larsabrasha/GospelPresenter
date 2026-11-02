import type { ReactNode } from 'react';

// What an admin page's card shows when its list is empty, in the current app's
// two sizes: a large picture with a heading (Overlays.razor, Users.razor,
// Displays.razor), and a small icon with a line (Images.razor, Songs.razor). Only the picture and the heading, on no
// card of their own: the card around them loses its background (app.css `[data-empty-list]`), so an empty list is
// quiet and does not compete with an intro card above it (Lars, 2026-11-02).

/** The large one: a 200×160 picture, a heading and an optional button. */
export function EmptyPicture({ picture, title, children }: { picture: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div data-empty-list className="flex flex-col items-center justify-center text-center px-6 py-12 select-none">
      {picture}
      <h2 className="text-lg/7 font-semibold text-stone-500 dark:text-stone-400">{title}</h2>
      {children}
    </div>
  );
}

/** The class of the large picture. */
export const PICTURE = 'w-48 h-auto mb-6 text-stone-300 dark:text-stone-600';

/** The small one: an icon and a line. */
export function EmptySmall({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div data-empty-list className="flex flex-col items-center justify-center text-center text-sm py-12 px-6 select-none">
      {icon}
      <p className="font-medium text-stone-500 dark:text-stone-400">{title}</p>
    </div>
  );
}

/** A grey line in a card: "Inga bilder matchar din sökning", or a loading line. */
export function CardNote({ children }: { children: ReactNode }) {
  return <p className="px-5 py-4 text-stone-400 text-sm">{children}</p>;
}
