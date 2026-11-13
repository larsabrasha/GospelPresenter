import { useState } from 'react';
import { t } from '../i18n.ts';
import { AppButton } from './AppButton.tsx';
import { Dialog, DialogButtons } from './Dialog.tsx';
import { FloatingInput } from './Floating.tsx';

/** Asks for a name (Components/Presentations/NameDialog.razor): a passkey's, or a library item's new one. */
export function NameDialog({
  title,
  text,
  label = t('logins.name'),
  maxLength = 100,
  initial,
  submit,
  onClose,
}: {
  title: string;
  text?: string;
  label?: string;
  maxLength?: number;
  initial: string;
  submit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} maxWidthClass="max-w-2xl">
      {text && <p className="text-sm text-stone-600 dark:text-stone-300">{text}</p>}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          await submit(name.trim());
          setBusy(false);
        }}
      >
        <FloatingInput label={label} hideLabel autoFocus maxLength={maxLength} value={name} onChange={(e) => setName(e.target.value)} />
        <DialogButtons>
          <AppButton variant="cancel" onClick={onClose}>
            {t('common.cancel')}
          </AppButton>
          <AppButton type="submit" disabled={!name.trim() || busy}>
            {t('common.save')}
          </AppButton>
        </DialogButtons>
      </form>
    </Dialog>
  );
}
