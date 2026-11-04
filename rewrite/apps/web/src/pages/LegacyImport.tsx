import { useState } from 'react';
import type { LegacyManifest } from '@gp/core';
import { isTextKey, t } from '../i18n.ts';
import { importLegacy, LegacyImportError, readLegacyManifest, type LegacyImportResult, type LegacyProgress } from '../media/legacyImport.ts';
import { AppButton } from '../ui/AppButton.tsx';
import { GROUP_ROW, Group } from '../ui/Group.tsx';
import { ImportFilesButton } from '../ui/ImportFilesButton.tsx';

type State =
  | { at: 'idle' }
  | { at: 'picked'; file: File; manifest: LegacyManifest }
  | { at: 'running'; progress: LegacyProgress }
  | { at: 'done'; result: LegacyImportResult }
  | { at: 'failed'; error: string };

function errorText(e: unknown): string {
  const reason = e instanceof LegacyImportError ? e.reason : e instanceof Error ? e.message : String(e);
  const key = `legacy.error.${reason}`;
  const text = isTextKey(key) ? t(key) : reason;
  return e instanceof LegacyImportError && e.detail ? `${text} (${e.detail})` : text;
}

function progressText(p: LegacyProgress): string {
  if (p.step === 'files') return t('legacy.files', { done: p.done, total: p.total });
  return p.step === 'rows' ? t('legacy.rows') : t('legacy.users');
}

const summary = (m: LegacyManifest) =>
  t('legacy.summary', { name: m.orgName, songs: m.counts.songs ?? 0, presentations: m.counts.presentations ?? 0, users: m.counts.users ?? 0, files: m.counts.blobs ?? 0 });

/**
 * "Importera från version 1" (docs/import-from-1x.md): an export zip of the current app picked, what it holds shown,
 * then its users, files and rows sent to the server. What the organisation has already is kept.
 */
export function LegacyImport() {
  const [state, setState] = useState<State>({ at: 'idle' });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setState({ at: 'picked', file, manifest: await readLegacyManifest(file) });
    } catch (e) {
      setState({ at: 'failed', error: errorText(e) });
    }
  };
  const run = async (file: File) => {
    setState({ at: 'running', progress: { step: 'files', done: 0, total: 0 } });
    try {
      const result = await importLegacy(file, (progress) => setState({ at: 'running', progress }));
      setState({ at: 'done', result });
    } catch (e) {
      setState({ at: 'failed', error: errorText(e) });
    }
  };

  const idle = state.at === 'idle' || state.at === 'failed';
  return (
    <Group title={t('legacy.title')} footer={t('legacy.text')}>
      {idle && (
        <div className={`${GROUP_ROW} flex-wrap`}>
          <span className={state.at === 'failed' ? 'min-w-0 break-words text-red-600 dark:text-red-400' : ''}>{state.at === 'failed' ? t('legacy.failed', { error: state.error }) : t('legacy.pick')}</span>
          <ImportFilesButton secondary accept=".zip" busy={false} testId="legacy-zip" onFiles={(files) => void pick(files[0])} />
        </div>
      )}
      {state.at === 'picked' && (
        <div className={`${GROUP_ROW} flex-wrap`}>
          <span className="min-w-0">{summary(state.manifest)}</span>
          <span className="flex gap-2 shrink-0 ml-auto">
            <AppButton variant="secondary" onClick={() => setState({ at: 'idle' })}>
              {t('common.cancel')}
            </AppButton>
            <AppButton onClick={() => void run(state.file)}>{t('legacy.start')}</AppButton>
          </span>
        </div>
      )}
      {state.at === 'running' && (
        <div role="status" className={`${GROUP_ROW} loading-line`}>
          {progressText(state.progress)}
        </div>
      )}
      {state.at === 'done' && (
        <div role="status" className={`${GROUP_ROW} flex-col items-start!`}>
          <span>{t('legacy.done', { name: state.result.manifest.orgName })}</span>
          <span className="text-stone-500 dark:text-stone-400">{t('legacy.usersDone', { created: state.result.users.created, member: state.result.users.member })}</span>
          {state.result.users.limit > 0 && <span className="text-red-600 dark:text-red-400">{t('legacy.usersLimit', { n: state.result.users.limit })}</span>}
        </div>
      )}
    </Group>
  );
}
