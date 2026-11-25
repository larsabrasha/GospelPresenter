import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CONTEXT_ROW } from '../../ui/ContextMenu.tsx';
import { ItemBadge } from '../../ui/icons.tsx';
import { Keys } from '../../ui/ShortcutHelp.tsx';
import { addKinds, type AddChoice } from '../presentation-editor/AddItemDialog.tsx';

/**
 * What + offers on a computer, as on a phone (Lars, 2026-11-05: as ProPresenter's and Planning Center's +): the kinds in
 * their order, Bildspel last, then under a line Rubrik, which is made, not chosen from a library. With `numbered`, each
 * has its number at the right, 1 to 7, which chooses it while the menu is open: A opens it, then a number (Lars,
 * 2026-11-25); a touch screen, with no keys, shows none.
 */
export function AddChoices({ onChoose, numbered }: { onChoose: (choice: AddChoice) => void; numbered?: boolean }) {
  const choices: [AddChoice, string, Parameters<typeof ItemBadge>[0]['type']][] = [...addKinds().map(([kind, label, , type]) => [kind, label, type] as [AddChoice, string, typeof type]), ['header', t('header.kind'), 'header']];
  return (
    <>
      {/* Each kind on its colour, as the running order's rows and Inställningar's libraries (Lars, 2026-11-25). */}
      {choices.map(([choice, label, type], i) => (
        <div key={choice} className="contents">
          {choice === 'header' && <div className="h-px my-1 mx-1 bg-separator" />}
          <AppButton
            variant="plain"
            role="menuitem"
            data-shortcut={numbered ? String(i + 1) : undefined}
            // Its key said as the menu item's own, not in its name: the cap beside it is for the eye.
            aria-keyshortcuts={numbered ? String(i + 1) : undefined}
            className={CONTEXT_ROW}
            onClick={() => onChoose(choice)}
          >
            <ItemBadge type={type} />
            {label}
            {numbered && (
              <span aria-hidden className="ml-auto pl-6 touch:hidden">
                <Keys spec={String(i + 1)} />
              </span>
            )}
          </AppButton>
        </div>
      ))}
    </>
  );
}
