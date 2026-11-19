// A presentation's page as an iPad app of iOS 8 has it, after the Settings app: a split view, the running order at
// the left as a grouped table, every item's slides at the right, each side in a navigation controller of its own; and
// the app's two scenes, the start page and a presentation, as the Mac's NavigationStack has them.
#import <UIKit/UIKit.h>
#import "Live.h"
#import "Presentations.h"

/// The app's tint, the web's sky (#0ea5e9).
UIColor *GPTint(void);

/// The scenes in `window`: `list` (the start page) over the whole screen in a column of 720 pt, as the Mac's; shown
/// by GPShowStart, not yet.
void GPScenes(UIWindow *window, UIViewController *list);

/// The start page (‹ in a running order, a presentation trashed here or gone in a sync), faded in when `animated`.
void GPShowStart(BOOL animated);

/// The start page's lists read again (a name or a day changed, a presentation gone).
void GPStartPageChanged(void);

/// A presentation's page (presentationPageView's answer, decoded) as a split view of its own, made anew: its running
/// order at the left over ‹ to the start page, its slides at the right; its events through a page model over
/// `source`'s live state; faded in when `animated`.
void GPShowPage(NSDictionary *page, id<GPPresentationSource> source, BOOL animated);

/// The presentation's split view shown, nil on the start page.
UISplitViewController *GPShownSplit(void);

/// The presentation whose running order is shown, nil on the start page.
NSString *GPShownPresentation(void);

/// A presentation's day and time: "söndag 8 november 2026 · 11:00".
NSString *GPWhen(NSDictionary *presentation);
