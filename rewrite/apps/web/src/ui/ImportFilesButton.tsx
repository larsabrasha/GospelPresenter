import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { ArrowDownTrayIcon } from './icons.tsx';

/** Importera: the system's file picker for any number of files of `accept`; the same files can be picked again. */
export function ImportFilesButton({ accept, busy, testId, secondary, onFiles }: { accept: string; busy: boolean; testId: string; secondary?: boolean; onFiles: (files: File[]) => void }) {
  return (
    <AppButton variant={secondary ? 'secondary' : undefined} asLabel disabled={busy} className="inline-flex items-center gap-1.5">
      <ArrowDownTrayIcon className="size-4 shrink-0" />
      {t('images.import')}
      <input
        type="file"
        accept={accept}
        multiple
        hidden
        disabled={busy}
        data-testid={testId}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </AppButton>
  );
}
