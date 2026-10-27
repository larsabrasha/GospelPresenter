import type { ReactNode } from 'react';

/**
 * A page's scrolling area and its centred column (Components/PageContainer.razor):
 * 720 px wide from the `sm` size, the full width below it.
 */
export function PageContainer({ children, maxWidthClass, className }: { children: ReactNode; maxWidthClass?: string; className?: string }) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className={`flex flex-col p-3 pt-8 pb-24 lg:pb-3 w-full ${maxWidthClass ?? 'sm:w-180'} mx-auto space-y-5 ${className ?? ''}`}>{children}</div>
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
