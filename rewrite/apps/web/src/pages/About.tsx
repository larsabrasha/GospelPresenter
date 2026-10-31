import type { ReactNode } from 'react';
import { t } from '../i18n.ts';
import { GitHubIcon, GlobeIcon, LogoIcon } from '../ui/icons.tsx';
import { PageContainer } from '../ui/PageContainer.tsx';
import { appCommit } from '../version.ts';

const REPO_URL = 'https://github.com/larsabrasha/GospelPresenter';
const WEBSITE_URL = 'https://www.gospelpresenter.com';

/** Om Gospel Presenter, last in the admin menu (as the About pages of Lars's other apps): the version, and links out. */
export function About() {
  return (
    <PageContainer>
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 pt-4 text-sm">
        <div className="flex items-center gap-3 text-sky-500">
          <LogoIcon className="size-11" />
          <span className="text-2xl font-semibold uppercase tracking-wide whitespace-nowrap">
            <span className="text-sky-500">Gospel</span> <span className="text-sky-400">Presenter</span>
          </span>
        </div>
        <p className="text-center text-base">{t('about.tagline')}</p>
        <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-neutral-100 dark:bg-neutral-700/50 p-3 select-text">
          <dt className="text-neutral-500 dark:text-neutral-400">{t('about.version')}</dt>
          <dd className="min-w-0 break-words" data-testid="about-version">
            <Commit />
          </dd>
        </dl>
        <p className="text-center text-neutral-500 dark:text-neutral-400">
          {t('about.credits')}
          <br />
          {t('about.creditsCode')}
        </p>
        {/* Links out of the app, not actions: a light row, as in an About box on macOS, in new tabs. */}
        <nav aria-label={t('about.links')} className="flex w-full flex-wrap justify-center gap-x-2 gap-y-1 border-t-[0.5px] border-neutral-200 dark:border-neutral-700 pt-3">
          <OutLink href={WEBSITE_URL}>
            <GlobeIcon className="size-4" />
            {t('about.website')}
          </OutLink>
          <OutLink href={REPO_URL}>
            <GitHubIcon className="size-4" />
            GitHub
          </OutLink>
        </nav>
      </div>
    </PageContainer>
  );
}

/** A link in the row at the foot: as text, with an area easy to hit with a finger. */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 whitespace-nowrap text-sky-500 no-underline hover:bg-neutral-100 dark:hover:bg-neutral-700">
      {children}
    </a>
  );
}

/** The commit, as a link to it on GitHub; from the dev server marked as a development build. */
function Commit() {
  const commit = appCommit();
  if (!commit) return <span>{t('about.unknown')}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <a href={`${REPO_URL}/commit/${commit}`} target="_blank" rel="noreferrer" className="font-mono text-inherit no-underline hover:underline" title={t('about.commitOnGitHub')}>
        {commit}
      </a>
      {import.meta.env.DEV && <span className="text-neutral-500 dark:text-neutral-400">{t('about.devBuild')}</span>}
    </span>
  );
}
