import { t } from '../../i18n.ts';
import { AppButton } from '../../ui/AppButton.tsx';
import { CONTEXT_ROW } from '../../ui/ContextMenu.tsx';
import { ItemBadge } from '../../ui/icons.tsx';
import { Keys } from '../../ui/ShortcutHelp.tsx';
import { SECTIONS } from '../../ui/appKeys.ts';
import type { Route } from '../../ui/router.ts';
import { addKinds, type AddChoice, type AddKind } from '../presentation-editor/AddItemDialog.tsx';

/** Each kind's library, whose letter after G goes there (ui/appKeys.ts `SECTIONS`). */
const LIBRARY: Record<AddKind, Route['page']> = { songs: 'songs', bible: 'bibles', images: 'images', audio: 'audios', video: 'videos', slides: 'customSlides' };
/** A choice's letter after A: its library's after G, so A S adds a song as G S goes to the songs; P a programme point. */
const letterOf = (choice: AddChoice) => (choice === 'header' ? 'p' : SECTIONS.find((s) => s.page === LIBRARY[choice])!.letter);

/**
 * What + offers on a computer, as on a phone (Lars, 2026-11-05: as ProPresenter's and Planning Center's +): the kinds in
 * their order, Bildspel last, then under a line Rubrik, which is made, not chosen from a library. With `numbered`, each
 * has its letter at the right, which chooses it while the menu is open: A opens it, then the letter G takes to that
 * library (Lars, 2026-11-25: A S as G S); a touch screen, with no keys, shows none.
 */
export function AddChoices({ onChoose, numbered }: { onChoose: (choice: AddChoice) => void; numbered?: boolean }) {
  const choices: [AddChoice, string, Parameters<typeof ItemBadge>[0]['type']][] = [...addKinds().map(([kind, label, , type]) => [kind, label, type] as [AddChoice, string, typeof type]), ['header', t('header.kind'), 'header']];
  return (
    <>
      {/* Each kind on its colour, as the running order's rows and Inställningar's libraries (Lars, 2026-11-25). */}
      {choices.map(([choice, label, type]) => (
        <div key={choice} className="contents">
          {choice === 'header' && <div className="h-px my-1 mx-1 bg-separator" />}
          <AppButton
            variant="plain"
            role="menuitem"
            data-shortcut={numbered ? letterOf(choice) : undefined}
            // Its key said as the menu item's own, not in its name: the cap beside it is for the eye.
            aria-keyshortcuts={numbered ? letterOf(choice).toUpperCase() : undefined}
            className={CONTEXT_ROW}
            onClick={() => onChoose(choice)}
          >
            <ItemBadge type={type} />
            {label}
            {numbered && (
              <span aria-hidden className="ml-auto pl-6 touch:hidden">
                <Keys spec={letterOf(choice)} />
              </span>
            )}
          </AppButton>
        </div>
      ))}
    </>
  );
}
