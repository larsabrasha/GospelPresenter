import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HeaderFloatProvider, useFloatSlot } from './headerFloat.ts';
import { useWide } from './useWide.ts';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { ChevronLeftIcon } from './icons.tsx';

const Filled = createContext(false);

/** Pages in a box of their own width, as the admin dialog: they fill it rather than keep their centred column. */
export const PageFill = Filled.Provider;

const Alone = createContext(false);

/** A page opened alone in Inställningar (router.ts `aloneInSettings`): its detail header has no way back. */
export const PageAlone = Alone.Provider;

const BackInBar = createContext(false);

/** A page in Inställningar's dialog, whose bar has the ‹ and the name: the detail header shows neither. */
export const PageBackInBar = BackInBar.Provider;

const BarSlot = createContext<HTMLElement | null>(null);

/** The place in Inställningar's content bar (from `lg`) where a detail page puts its name and Sparad. */
export const PageBarSlot = BarSlot.Provider;

/** What a page in Inställningar is for, shown as a card at its top (settingsLinks.ts `intro`). */
interface PageIntro {
  icon: (p: { className?: string }) => ReactNode;
  colour: string;
  text: string;
  /** Whether the card's title is in view: the dialog's bar names the page only once it has scrolled away, as iOS. */
  onTitleInView: (inView: boolean) => void;
}

const Intro = createContext<PageIntro | null>(null);

export const PageIntroProvider = Intro.Provider;

/**
 * A page's scrolling area and its centred column (Components/PageContainer.razor):
 * 720 px wide from the `sm` size, the full width below it; in a `PageFill`, the full width.
 */
export function PageContainer({ children, maxWidthClass, className }: { children: ReactNode; maxWidthClass?: string; className?: string }) {
  const filled = useContext(Filled);
  // In Inställningar the room at the foot is always there, so the floating + never covers the last row.
  const column = filled ? 'pt-5 pb-24' : `pt-8 pb-24 lg:pb-3 ${maxWidthClass ?? 'sm:w-180'} mx-auto`;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className={`flex flex-col p-3 w-full ${column} space-y-5 ${className ?? ''}`}>{children}</div>
    </div>
  );
}

/**
 * A page's heading row: its title, and its buttons at the right. `large` for a phone's large title, as iOS's. In
 * Inställningar's dialog its bar names the page (the dialog's below `lg`, the content column's from it), so the
 * title is for screen readers there, and its + floats at the column's bottom right.
 */
export function PageHeader({ title, large, children }: { title: string; large?: boolean; children?: ReactNode }) {
  const inBar = useContext(BackInBar);
  const intro = useContext(Intro);
  const float = useFloatSlot();
  const actions = children && <HeaderFloatProvider value={float}>{children}</HeaderFloatProvider>;
  if (intro)
    return (
      <>
        <IntroCard title={title} intro={intro} />
        {actions && <div className="flex items-center justify-end gap-2 px-2 -mt-2 empty:hidden">{actions}</div>}
      </>
    );
  return (
    <div className={`relative flex items-center justify-between px-5 ${inBar ? 'justify-end' : ''}`}>
      <h1 className={`text-xl/7 font-bold dark:text-stone-100 ${large ? 'max-sm:text-[34px]/tight' : ''} ${inBar ? 'sr-only' : ''}`}>{title}</h1>
      {actions}
    </div>
  );
}

/** The card at the top of a page in Inställningar, as iOS's Settings: the row's icon, the page's name, what it is for. */
function IntroCard({ title, intro }: { title: string; intro: PageIntro }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { onTitleInView } = intro;
  useEffect(() => {
    const el = heading.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const seen = new IntersectionObserver(([entry]) => onTitleInView(!!entry?.isIntersecting));
    seen.observe(el);
    return () => {
      seen.disconnect();
      onTitleInView(false);
    };
  }, [onTitleInView]);
  return (
    <div className="flex flex-col gap-2 p-5 rounded-[22px] lg:rounded-xl bg-surface border-[0.5px] border-separator">
      <span className={`size-14 lg:size-11 rounded-2xl lg:rounded-xl flex items-center justify-center text-white ${intro.colour}`}>
        <intro.icon className="size-8 lg:size-6" />
      </span>
      <h1 ref={heading} className="mt-1 text-[22px]/7 lg:text-xl/7 font-bold dark:text-stone-100">
        {title}
      </h1>
      <p className="text-[15px]/snug lg:text-sm/snug text-stone-500 dark:text-stone-400 max-w-2xl">{intro.text}</p>
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
  const alone = useContext(Alone);
  const inBar = useContext(BackInBar);
  const slot = useContext(BarSlot);
  // From `lg` the bar is shown, below it the page's own header: one or the other, never both.
  const wide = useWide();
  const toBar = inBar && !!slot && wide;
  return (
    <>
      {/* In Inställningar from `lg`, the name and Sparad are in the content column's bar, as a macOS window's title. */}
      {toBar &&
        slot &&
        createPortal(
          <>
            <h1 className="min-w-0 font-semibold text-[17px] truncate">{title}</h1>
            {saved}
          </>,
          slot,
        )}
      {!toBar && (
    <div className={`relative flex items-center justify-center min-h-10 ${className ?? ''}`}>
      {!alone && (backHref || onBack) && (
        <AppButton
          variant="plain"
          {...(backHref ? { href: backHref } : { onClick: onBack })}
          aria-label={t('common.back')}
          title={t('common.back')}
          className={`absolute left-0 cursor-pointer ${inBar ? 'hidden' : ''} p-2.5 bg-surface text-stone-700 dark:text-stone-200 rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]`}
        >
          <ChevronLeftIcon className="size-5" />
        </AppButton>
      )}
      <h1 className="text-xl/7 font-bold dark:text-stone-100 truncate max-w-[60%]">{title}</h1>
      {saved}
    </div>
      )}
    </>
  );
}
