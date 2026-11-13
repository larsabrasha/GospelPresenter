import { useEffect, useState } from 'react';
import type { BugReport } from '@gp/core';
import { api } from '../auth/api.ts';
import { errorText } from '../auth/errors.ts';
import { t, type TextKey } from '../i18n.ts';
import type { StepKind } from '../report/trail.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { deleteAsk, useConfirm } from '../ui/Dialog.tsx';
import { ACTION_ROW, DANGER_ROW, GROUP_ROW, Group } from '../ui/Group.tsx';
import { DetailHeader, PageContainer } from '../ui/PageContainer.tsx';
import { href, navigate } from '../ui/router.ts';
import { useToast } from '../ui/Toast.tsx';
import { ReportThread } from '../report/ReportThread.tsx';
import { reportedAt } from './BugReports.tsx';
import { load } from './Orgs.tsx';

// One bug report (docs/bug-reports.md): what the user wrote, who and where, the thread with them, the screenshot, the
// steps before it, and the whole state; Markera som klar and Radera.

const STEP: Record<StepKind, TextKey> = {
  page: 'reports.step.page',
  press: 'reports.step.press',
  command: 'reports.step.command',
  change: 'reports.step.change',
  live: 'reports.step.live',
  error: 'reports.step.error',
};

interface SentStep {
  secondsBefore: number;
  kind: StepKind;
  what: string;
  times?: number;
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

/** A label and its value, as a row of a group; nothing without a value. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className={GROUP_ROW}>
      <span className="text-stone-500 dark:text-stone-400 shrink-0">{label}</span>
      <span className="min-w-0 text-right break-words select-text">{children}</span>
    </div>
  );
}

export function BugReportDetail({ id }: { id: string }) {
  const [report, setReport] = useState<BugReport | string | null>(null);
  const { dialog, ask } = useConfirm();
  const toast = useToast();
  const path = `/api/reports/${encodeURIComponent(id)}`;
  useEffect(() => {
    void load<BugReport>(path).then(setReport);
  }, [path]);
  if (report === null || typeof report === 'string')
    return (
      <PageContainer>
        <DetailHeader backHref={href({ page: 'reports' })} title="" className="px-5" />
        <div className={`px-7 ${report ? 'text-red-500 dark:text-red-400' : 'loading-line text-stone-400'}`}>{report ?? t('common.loading')}</div>
      </PageContainer>
    );
  const s = report.state;
  const steps = Array.isArray(s.steps) ? (s.steps as SentStep[]) : [];
  const setDone = async (done: boolean) => {
    const r = await api('PATCH', path, { done });
    if (r.error) setReport(errorText(r));
    else setReport({ ...report, done });
  };
  return (
    <PageContainer>
      <DetailHeader backHref={href({ page: 'reports' })} title={t('reports.one')} className="px-5" />
      <p className="px-5 whitespace-pre-wrap break-words select-text">{report.text}</p>
      <Group>
        <Fact label={t('reports.when')}>{reportedAt(report.createdAt)}</Fact>
        <Fact label={t('reports.who')}>
          {report.userName}
          {report.userEmail && (
            <>
              {' · '}
              <a href={`mailto:${report.userEmail}`}>{report.userEmail}</a>
            </>
          )}
        </Fact>
        <Fact label={t('reports.org')}>{report.orgName}</Fact>
        <Fact label={t('reports.page')}>{str(s.page)}</Fact>
        <Fact label={t('reports.app')}>{str(s.app)}</Fact>
        <Fact label={t('about.version')}>{str(s.version)}</Fact>
      </Group>
      <ReportThread
        messages={report.messages}
        asAdmin
        empty={t('reports.noMessages')}
        send={async (text) => {
          try {
            const r = await api<{ mailed: boolean }>('POST', `${path}/messages`, { text });
            if (r.error) return errorText(r);
            if (r.body.mailed && report.userEmail) toast(t('reports.mailed', { email: report.userEmail }));
            setReport(await load<BugReport>(path));
            return null;
          } catch {
            return t('auth.offline');
          }
        }}
      />
      {report.shot && (
        <Group title={t('reports.screenshot')}>
          <img src={report.shot} alt={t('reports.screenshot')} className="block w-full" data-testid="report-detail-shot" />
        </Group>
      )}
      {!!steps.length && (
        <Group title={t('reports.steps')}>
          <ol className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-separator">
            {steps.map((step, i) => (
              <li key={i} className={`${GROUP_ROW} justify-start`}>
                <span className="w-16 shrink-0 text-xs text-stone-400 dark:text-stone-500 tabular-nums">{t('reports.secondsBefore', { n: step.secondsBefore })}</span>
                <span className="w-20 shrink-0 text-xs text-stone-500 dark:text-stone-400">{STEP[step.kind] ? t(STEP[step.kind]) : step.kind}</span>
                <span className={`min-w-0 break-words select-text ${step.kind === 'error' ? 'text-red-500 dark:text-red-400' : ''}`}>{step.what}</span>
                {!!step.times && <span className="shrink-0 text-xs text-stone-400 dark:text-stone-500">×{step.times}</span>}
              </li>
            ))}
          </ol>
        </Group>
      )}
      <details className="px-5 text-sm">
        <summary className="cursor-pointer text-sky-600 dark:text-sky-400">{t('reports.state')}</summary>
        <pre className="mt-2 overflow-auto rounded-lg bg-stone-100 dark:bg-raised/50 p-3 text-xs whitespace-pre-wrap break-all select-text">{JSON.stringify(s, null, 2)}</pre>
      </details>
      <Group>
        <AppButton variant="plain" className={ACTION_ROW} onClick={() => void setDone(!report.done)}>
          {report.done ? t('reports.markNew') : t('reports.markDone')}
        </AppButton>
      </Group>
      <Group>
        <AppButton
          variant="plain"
          className={DANGER_ROW}
          onClick={() =>
            void ask(
              deleteAsk(t('reports.deleteText'), undefined, async () => {
                const r = await api('DELETE', path);
                if (!r.error) navigate({ page: 'reports' });
              }),
            )
          }
        >
          {t('common.delete')}
        </AppButton>
      </Group>
      {dialog}
    </PageContainer>
  );
}
