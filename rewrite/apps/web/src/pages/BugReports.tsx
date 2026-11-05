import { useEffect, useState } from 'react';
import type { BugReportRow } from '@gp/core';
import { locale, t } from '../i18n.ts';
import { EmptySmall } from '../ui/Empty.tsx';
import { BugIcon } from '../ui/icons.tsx';
import { CARD, ROW_HOVER, RowChevron } from '../ui/List.tsx';
import { ListSearch, matches, NoMatch } from '../ui/ListSearch.tsx';
import { PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
import { load } from './Orgs.tsx';

// Felrapporter (docs/bug-reports.md): what anyone reported with Rapportera fel, newest first, for the SuperAdmin. Online
// only, as Alla organisationer: the reports are the server's, not an organisation's.

/** When, short: the date and the time. */
export const reportedAt = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });

export function BugReports() {
  const [reports, setReports] = useState<BugReportRow[] | string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void load<BugReportRow[]>('/api/reports').then(setReports);
  }, []);
  const shown = Array.isArray(reports) ? reports.filter((r) => matches(query, `${r.text} ${r.userName} ${r.orgName}`)) : [];
  return (
    <PageContainer>
      <PageHeader title={t('nav.reports')} />
      {typeof reports === 'string' && <p className="px-5 text-sm text-red-500 dark:text-red-400">{reports}</p>}
      {Array.isArray(reports) && !!reports.length && <ListSearch query={query} onChange={setQuery} />}
      {Array.isArray(reports) && !!reports.length && !shown.length && <NoMatch query={query} />}
      {reports === null && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
      <div className={`${CARD} ${!Array.isArray(reports) || (!!reports.length && !shown.length) ? 'hidden' : ''}`}>
        {Array.isArray(reports) && !reports.length && <EmptySmall icon={<BugIcon className="size-8 mb-2 text-stone-300 dark:text-stone-600" />} title={t('reports.empty')} />}
        <ul aria-label={t('nav.reports')}>
          {shown.map((r) => (
            <li key={r.id} className="border-b border-separator last:border-b-0">
              <a href={href({ page: 'report', id: r.id })} className={`flex items-center gap-3 px-7 py-3 ${ROW_HOVER} cursor-pointer ${r.done ? 'opacity-60' : ''}`}>
                <span className={`size-2 shrink-0 rounded-full ${r.done && !r.unread ? 'bg-transparent' : 'bg-sky-500'}`} aria-label={r.done && !r.unread ? undefined : t('reports.new')} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.text}</div>
                  <div className="text-xs text-stone-400 dark:text-stone-500 truncate">
                    {[reportedAt(r.createdAt), r.userName, r.orgName, r.unread ? t('reports.unread', { n: r.unread }) : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <RowChevron />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </PageContainer>
  );
}
