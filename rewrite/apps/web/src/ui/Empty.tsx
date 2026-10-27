import type { ReactNode } from 'react';

// What an admin page's card shows when its list is empty, in the current app's
// two sizes: a large picture with a heading (Overlays.razor, Users.razor,
// Displays.razor), and a small icon with a line or two (Images.razor, Songs.razor).

/** The large one: a 200×160 picture, a heading, a text and an optional button. */
export function EmptyPicture({ picture, title, text, children }: { picture: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 select-none">
      {picture}
      <h2 className="text-lg/7 font-semibold text-neutral-500 dark:text-neutral-400 mb-2">{title}</h2>
      {text && <p className="text-sm text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed mb-4">{text}</p>}
      {children}
    </div>
  );
}

/** The class of the large picture. */
export const PICTURE = 'w-48 h-auto mb-6 text-neutral-300 dark:text-neutral-600';

/** The small one: an icon, a line and a smaller grey text. */
export function EmptySmall({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center text-sm py-12 px-6 select-none">
      {icon}
      <p className="font-medium text-neutral-500 dark:text-neutral-400 mb-1">{title}</p>
      {text && <p className="text-xs text-neutral-400 dark:text-neutral-500 max-w-xs leading-relaxed">{text}</p>}
    </div>
  );
}

/** A grey line in a card: "Inga bilder matchar din sökning", or a loading line. */
export function CardNote({ children }: { children: ReactNode }) {
  return <p className="px-5 py-4 text-neutral-400 text-sm">{children}</p>;
}
