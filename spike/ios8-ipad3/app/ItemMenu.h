// An item's menu and +'s, as the native app's ItemMenus.swift: what it offers, in which groups and which entries can
// be chosen is the core's (`itemActionsView`), where an addition goes too (`addPositionView`); here each entry in an
// iOS 8 action sheet (a popover on an iPad), a choice of several (Arrangemang, Överlägg, Lägg till efter) a second
// sheet with ✓ at the one chosen, a name or a comment asked for in an alert with a text field, Radera asked first.
// Drawn: Byt namn, Kommentar, Arrangemang, Överlägg, Lägg till efter, Radera; + offers Sång, then Programpunkt. Left
// out as the native app leaves them: Redigera (the song's page), Markera.
#import <UIKit/UIKit.h>
#import "Live.h"

/// The item's menu over `controller`, pointing at `rect` of `view`.
void GPItemMenu(UIViewController *controller, UIView *view, CGRect rect, NSDictionary *item, GPPageModel *model);

/// +'s menu (Sång, Programpunkt) from `button`; `chosenId` the item Lägg till efter named, nil for +.
void GPAddMenu(UIViewController *controller, UIBarButtonItem *button, UIView *view, CGRect rect, NSString *chosenId, GPPageModel *model);
