import { useState } from 'react';
import { useDb } from '../db/react.tsx';
import { isTextKey, t } from '../i18n.ts';
import { saveBlob } from '../media/download.ts';
import { exportName, exportOrg, OrgExportError, type OrgExportProgress } from '../media/orgExport.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { GROUP_ROW, Group } from '../ui/Group.tsx';

type State = { at: 'idle' } | { at: 'running'; progress: OrgExportProgress | null } | { at: 'done' } | { at: 'failed'; error: string };

function errorText(e: unknown): string {
  const reason = e instanceof OrgExportError ? e.reason : e instanceof Error ? e.message : String(e);
  const key = `orgExport.error.${reason}`;
  const text = isTextKey(key) ? t(key) : reason;
  return e instanceof OrgExportError && e.detail ? `${text} (${e.detail})` : text;
}

const progressText = (p: OrgExportProgress | null) =>
  !p ? t('orgExport.files', { done: 0, total: 0 }) : p.step === 'files' ? t('orgExport.files', { done: p.done, total: p.total }) : t('orgExport.zip', { done: p.done, total: p.total });

/** Exportera (orgExport.ts): the whole organisation as a zip file that Importera takes, on this server or another. */
export function OrgExport({ orgName }: { orgName: string }) {
  const db = useDb();
  const [state, setState] = useState<State>({ at: 'idle' });

  const run = async () => {
    setState({ at: 'running', progress: null });
    try {
      const zip = await exportOrg(db, orgName, (progress) => setState({ at: 'running', progress }));
      saveBlob(exportName(orgName), zip);
      setState({ at: 'done' });
    } catch (e) {
      setState({ at: 'failed', error: errorText(e) });
    }
  };

  return (
    <Group title={t('orgExport.title')} footer={t('orgExport.text')}>
      {state.at === 'running' ? (
        <div role="status" className={`${GROUP_ROW} loading-line`}>
          {progressText(state.progress)}
        </div>
      ) : (
        <div className={`${GROUP_ROW} flex-wrap`}>
          <span role={state.at === 'idle' ? undefined : 'status'} className={state.at === 'failed' ? 'min-w-0 break-words text-red-600 dark:text-red-400' : 'min-w-0'}>
            {state.at === 'failed' ? t('orgExport.failed', { error: state.error }) : state.at === 'done' ? t('orgExport.done') : t('orgExport.label')}
          </span>
          <AppButton variant="secondary" className="shrink-0 ml-auto" onClick={() => void run()}>
            {t('orgExport.start')}
          </AppButton>
        </div>
      )}
    </Group>
  );
}
