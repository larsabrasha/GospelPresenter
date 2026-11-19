// A presentation's page as an iPad app of iOS 8 has it, after the Settings app: a split view, the running order at
// the left as a grouped table, every item's slides at the right, each side in a navigation controller of its own.
#import <UIKit/UIKit.h>

/// The app's tint, the web's sky (#0ea5e9).
UIColor *GPTint(void);

/// The page's split view, for presentationPageView's answer, decoded.
UISplitViewController *GPPresentationPage(NSDictionary *page);
