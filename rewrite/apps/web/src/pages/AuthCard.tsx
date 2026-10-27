import type { ReactNode } from 'react';
import { LogoIcon } from '../ui/icons.tsx';

/** The logo and the name in two blues (Login.razor, Setup.razor). */
function Brand({ className }: { className: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <LogoIcon className="size-20 text-sky-500" />
      <div className="text-2xl uppercase">
        <span className="text-sky-500 font-semibold">Gospel</span> <span className="text-sky-400">Presenter</span>
      </div>
    </div>
  );
}

/** A line of grey text under the title (Setup.razor's description). */
export const AUTH_TEXT = 'text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed text-center';

/** The wide sky button at the foot of a form (Setup.razor's Kom igång). */
export const AUTH_SUBMIT = 'mt-2 px-6 py-3 rounded-full bg-sky-500 text-white text-lg cursor-pointer hover:bg-sky-600 disabled:opacity-50 disabled:cursor-default';

/** The title as Setup.razor's. */
const TITLE = 'text-2xl font-semibold text-neutral-800 dark:text-neutral-100 mb-3 text-center px-4';

/**
 * The frame of the screens before the app: sign-in, setup, invite and pairing.
 * `centered` is the sign-in page (Login.razor): in the middle of the screen,
 * over the slowly moving blue blobs; otherwise the logo sits at the top, as
 * on Setup.razor and InvitePage.razor. `titleClassName` replaces the title's look.
 */
export function AuthCard({ title, children, centered, titleClassName }: { title: ReactNode; children?: ReactNode; centered?: boolean; titleClassName?: string }) {
  return (
    <main className={`flex-1 w-full flex flex-col items-center ${centered ? 'animated-bg justify-center' : ''}`}>
      {centered && <div className="blob-3" />}
      <div className="relative z-10 w-full flex flex-col items-center pb-10">
        <Brand className={centered ? 'pb-16' : 'py-20'} />
        <h1 className={titleClassName ?? TITLE}>{title}</h1>
        <div className="w-full max-w-sm px-4 flex flex-col gap-4">{children}</div>
      </div>
    </main>
  );
}

/** A message in red, as Setup.razor's; `center` under centred text, as SignIn.razor's. */
export function FormError({ text, center }: { text: string | null; center?: boolean }) {
  return text ? (
    <p className={`text-sm text-red-500 dark:text-red-400 ${center ? 'text-center' : ''}`} role="alert">
      {text}
    </p>
  ) : null;
}
