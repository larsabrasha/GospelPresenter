import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { useRoundAdd } from './AddButton.tsx';
import { ArrowDownTrayIcon, PlusIcon } from './icons.tsx';

/**
 * Importera: the system's file picker for any number of files of `accept`; the same files can be picked again. `round`
 * draws it as a heading row's + (ui/AddButton.tsx), named Importera for screen readers and as its tooltip.
 */
export function ImportFilesButton(props: { accept: string; busy: boolean; testId: string; secondary?: boolean; round?: boolean; onFiles: (files: File[]) => void }) {
  const roundAdd = useRoundAdd((className) => <Picker {...props} className={className} />);
  return props.round ? roundAdd : <Picker {...props} />;
}

function Picker({ accept, busy, testId, secondary, round, className, onFiles }: { accept: string; busy: boolean; testId: string; secondary?: boolean; round?: boolean; className?: string; onFiles: (files: File[]) => void }) {
  return (
    <AppButton
      variant={round ? 'plain' : secondary ? 'secondary' : undefined}
      asLabel
      disabled={busy}
      aria-label={round ? t('images.import') : undefined}
      title={round ? t('images.import') : undefined}
      className={className ?? 'inline-flex items-center gap-1.5'}
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
