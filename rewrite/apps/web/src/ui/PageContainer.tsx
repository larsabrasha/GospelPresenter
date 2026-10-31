import { createContext, useContext, type ReactNode } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { ChevronLeftIcon } from './icons.tsx';

const Filled = createContext(false);

/** Pages in a box of their own width, as the admin dialog: they fill it rather than keep their centred column. */
export const PageFill = Filled.Provider;

/**
 * A page's scrolling area and its centred column (Components/PageContainer.razor):
 * 720 px wide from the `sm` size, the full width below it; in a `PageFill`, the full width.
 */
export function PageContainer({ children, maxWidthClass, className }: { children: ReactNode; maxWidthClass?: string; className?: string }) {
  const filled = useContext(Filled);
  const column = filled ? 'pt-5' : `pt-8 ${maxWidthClass ?? 'sm:w-180'} mx-auto`;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className={`flex flex-col p-3 pb-24 lg:pb-3 w-full ${column} space-y-5 ${className ?? ''}`}>{children}</div>
    </div>
  );
}

/** A page's heading row: its title, and its buttons at the right. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="relative flex items-center justify-between px-5">
      <h1 className="text-xl/7 font-bold dark:text-neutral-100">{title}</h1>
      {children}
    </div>
  );
}

/**
 * A detail page's heading row (Components/DetailHeader.razor): the round back
 * button at the left, the title in the middle, and `saved` ("✓ Sparad", see
 * ui/AutoSave.tsx) at the right. The back button is a link with `backHref`, a
 * button with `onBack`; with neither, the title alone (Profile.razor).
 */
export function DetailHeader({ backHref, onBack, title, saved, className }: { backHref?: string; onBack?: () => void; title: string; saved?: ReactNode; className?: string }) {
  return (
    <div className={`relative flex items-center justify-center min-h-10 ${className ?? ''}`}>
      {(backHref || onBack) && (
        <AppButton
          variant="plain"
          {...(backHref ? { href: backHref } : { onClick: onBack })}
          aria-label={t('common.back')}
          title={t('common.back')}
          className="absolute left-0 cursor-pointer p-2.5 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
        >
          <ChevronLeftIcon className="size-5" />
        </AppButton>
      )}
      <h1 className="text-xl/7 font-bold dark:text-neutral-100 truncate max-w-[60%]">{title}</h1>
      {saved}
    </div>
  );
}
