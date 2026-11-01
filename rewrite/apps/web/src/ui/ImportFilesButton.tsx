import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { ROUND_ADD } from './AddButton.tsx';
import { ArrowDownTrayIcon, PlusIcon } from './icons.tsx';

/**
 * Importera: the system's file picker for any number of files of `accept`; the same files can be picked again. `round`
 * draws it as a heading row's + (ui/AddButton.tsx), named Importera for screen readers and as its tooltip.
 */
export function ImportFilesButton({ accept, busy, testId, secondary, round, onFiles }: { accept: string; busy: boolean; testId: string; secondary?: boolean; round?: boolean; onFiles: (files: File[]) => void }) {
  return (
    <AppButton
      variant={round ? 'plain' : secondary ? 'secondary' : undefined}
      asLabel
      disabled={busy}
      aria-label={round ? t('images.import') : undefined}
      title={round ? t('images.import') : undefined}
      className={round ? ROUND_ADD : 'inline-flex items-center gap-1.5'}
    >
      {round ? <PlusIcon className="size-5" strokeWidth={2.25} /> : <ArrowDownTrayIcon className="size-4 shrink-0" />}
      {!round && t('images.import')}
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
