// The presentation's menu, from a tap on its title, as the native app's titleMenu (PresentationScreen.swift): what it
// offers is the core's (`presentationActionsView`), here in an iOS 8 action sheet (a popover on an iPad). Drawn:
// Redigera detaljer (the Details form) and Radera presentation (asked first, then to the trash; not offered while it is
// presented). Left out as the native app leaves them: Noter och länkar, Spara som mall.
#import <UIKit/UIKit.h>
#import "Live.h"

/// The menu over `controller`, pointing at `view`; the page read again after Redigera detaljer, and the start page
/// shown with nothing beside it after Radera.
void GPPresentationMenu(UIViewController *controller, UIView *view, GPPageModel *model);

/// Radera presentation answered yes: to the trash, then the start page; a refusal shown over `controller`.
void GPTrashPresentation(UIViewController *controller, GPPageModel *model);

/// `controller`'s title as the native app's: the presentation's name as a button that opens this menu, no wider than
/// `widest`; set again with GPTitleName when the name changes.
void GPTitleMenu(UIViewController *controller, GPPageModel *model, CGFloat widest);
void GPTitleName(UIViewController *controller, NSString *name);
