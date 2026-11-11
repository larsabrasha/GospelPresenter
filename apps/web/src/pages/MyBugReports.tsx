import { useEffect, useState } from 'react';
import type { MyBugReport, MyBugReportRow } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t } from '../i18n.ts';
import { ReportThread } from '../report/ReportThread.tsx';
import { refreshUnread } from '../report/unread.ts';
import { EmptySmall } from '../ui/Empty.tsx';
import { BugIcon } from '../ui/icons.tsx';
import { CARD, ROW_HOVER, RowChevron } from '../ui/List.tsx';
import { DetailHeader, PageContainer, PageHeader } from '../ui/PageContainer.tsx';
import { href } from '../ui/router.ts';
import { reportedAt } from './BugReports.tsx';
import { load } from './Orgs.tsx';

// Mina felrapporter (docs/bug-reports.md), under Mina inställningar: what the user reported, newest first, a dot on
// those with an answer not read yet; one opened is its thread with the Superadmin, where the user answers. Online only.

export function MyBugReports() {
  const [reports, setReports] = useState<MyBugReportRow[] | string | null>(null);
  useEffect(() => {
    void load<MyBugReportRow[]>('/api/my-reports').then(setReports);
  }, []);
  return (
    <PageContainer>
      <PageHeader title={t('myReports.title')} />
      {typeof reports === 'string' && <p className="px-5 text-sm text-red-500 dark:text-red-400">{reports}</p>}
      {reports === null && <div className="loading-line px-7 py-4 text-stone-400">{t('common.loading')}</div>}
      {Array.isArray(reports) && (
        <div className={CARD}>
          {!reports.length && <EmptySmall icon={<BugIcon className="size-8 mb-2 text-stone-300 dark:text-stone-600" />} title={t('myReports.empty')} />}
          <ul aria-label={t('myReports.title')}>
            {reports.map((r) => (
              <li key={r.id} className="border-b border-separator last:border-b-0">
                <a href={href({ page: 'myReport', id: r.id })} className={`flex items-center gap-3 px-7 py-3 ${ROW_HOVER} cursor-pointer`}>
                  <span className={`size-2 shrink-0 rounded-full ${r.unread ? 'bg-sky-500' : 'bg-transparent'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.text}</div>
                    <div className="text-xs text-stone-400 dark:text-stone-500 truncate">
                      {[reportedAt(r.createdAt), r.unread ? t('reports.unread', { n: r.unread }) : null, r.done ? t('myReports.done') : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <RowChevron />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </PageContainer>
  );
}

/** One of the user's reports: what they wrote, and the thread with the Superadmin. */
export function MyBugReportPage({ id }: { id: string }) {
  const [report, setReport] = useState<MyBugReport | string | null>(null);
  const path = `/api/my-reports/${encodeURIComponent(id)}`;
  useEffect(() => {
    // Reading it reads its answers: the dot on the picture goes.
    void load<MyBugReport>(path).then((r) => (setReport(r), void refreshUnread()));
  }, [path]);
  if (report === null || typeof report === 'string')
    return (
      <PageContainer>
        <DetailHeader backHref={href({ page: 'myReports' })} title="" className="px-5" />
        <div className={`px-7 ${report ? 'text-red-500 dark:text-red-400' : 'loading-line text-stone-400'}`}>{report ?? t('common.loading')}</div>
      </PageContainer>
    );
  return (
    <PageContainer>
      <DetailHeader backHref={href({ page: 'myReports' })} title={t('reports.one')} className="px-5" />
      <p className="px-5 text-xs text-stone-400 dark:text-stone-500">{reportedAt(report.createdAt)}</p>
      <p className="px-5 whitespace-pre-wrap break-words select-text">{report.text}</p>
      {report.shot && <img src={report.shot} alt={t('reports.screenshot')} className="mx-5 block max-h-64 w-auto rounded-lg" />}
      <ReportThread
        messages={report.messages}
        asAdmin={false}
        empty={t('myReports.noAnswer')}
        send={async (text) => {
          try {
            const r = await api('POST', `${path}/messages`, { text });
            if (r.error) return errorText(r);
            setReport(await load<MyBugReport>(path));
            return null;
          } catch {
            return t('auth.offline');
          }
        }}
      />
    </PageContainer>
  );
}
