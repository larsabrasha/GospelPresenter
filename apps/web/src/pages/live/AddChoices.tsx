import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CONTEXT_ROW } from '../../ui/ContextMenu.tsx';
import { ItemBadge } from '../../ui/icons.tsx';
import { addKinds, type AddChoice } from '../presentation-editor/AddItemDialog.tsx';

/**
 * What + offers on a computer, as on a phone (Lars, 2026-11-05: as ProPresenter's and Planning Center's +): the kinds in
 * their order, Bildspel last, then under a line Rubrik, which is made, not chosen from a library.
 */
export function AddChoices({ onChoose }: { onChoose: (choice: AddChoice) => void }) {
  return (
    <>
      {/* Each kind on its colour, as the running order's rows and Inställningar's libraries (Lars, 2026-11-25). */}
      {addKinds().map(([kind, label, , type]) => (
        <AppButton key={kind} variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => onChoose(kind)}>
          <ItemBadge type={type} />
          {label}
        </AppButton>
      ))}
      <div className="h-px my-1 mx-1 bg-separator" />
      <AppButton variant="plain" role="menuitem" className={CONTEXT_ROW} onClick={() => onChoose('header')}>
        <ItemBadge type="header" />
        {t('header.kind')}
      </AppButton>
    </>
  );
}
