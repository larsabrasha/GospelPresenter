// A presentation's page as an iPad app of iOS 8 has it, after the Settings app: a split view, the running order at
// the left as a grouped table, every item's slides at the right, each side in a navigation controller of its own.
#import <UIKit/UIKit.h>
#import "Live.h"
#import "Presentations.h"

/// The app's tint, the web's sky (#0ea5e9).
UIColor *GPTint(void);

/// The split view, `list` (the presentations) at the root of its left column, the right one empty.
UISplitViewController *GPSplit(UIViewController *list);

/// A presentation's page (presentationPageView's answer, decoded) in the split view: its running order pushed onto
/// the left column over the list, its slides at the right; its events through a page model over `source`'s live state.
void GPShowPage(UISplitViewController *split, NSDictionary *page, id<GPPresentationSource> source, BOOL animated);

/// No presentation: the start page at the left, the right column empty (a presentation trashed here or gone in a sync).
void GPShowNothing(UISplitViewController *split);

/// The presentation whose running order the left column shows, nil on the start page.
NSString *GPShownPresentation(UISplitViewController *split);

/// A presentation's day and time: "söndag 8 november 2026 · 11:00".
NSString *GPWhen(NSDictionary *presentation);
