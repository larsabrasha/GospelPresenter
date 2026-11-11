import { t } from '../../i18n.ts';
import { FloatingInput } from '../../ui/Floating.tsx';

/** A presentation's or template's name at the top of its dialog: focused first, and Enter saves the dialog. */
export function PresentationNameField({ value, onChange, onEnter }: { value: string; onChange: (value: string) => void; onEnter: () => void }) {
  return (
    <FloatingInput
      label={t('presentation.name')}
      hideLabel
      autoFocus
      maxLength={200}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}
