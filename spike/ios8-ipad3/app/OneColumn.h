// A presentation in one column, an iPad held upright, as the native app's PhoneLayout.swift has it under 1 000 pt
// (docs/layout-2-0.md, "Live, one column"): no pictures of the slides but their whole text, the running order as a
// plain table, each item a section whose heading sticks (a red dot while it is shown, its name, its note, ••• for its
// menu), each part a row (its label, VISAS or NÄSTA, its text; tinted red while shown, the tint's blue while made
// ready); a tap the page's `show`; while presenting the picture shown small at the top with Släck beside it, the list
// following the part shown; + floating at the bottom right; the title the presentation's menu, ▶ or ■ beside it.
#import <UIKit/UIKit.h>
#import "Live.h"

@interface GPOneColumnController : UIViewController
- (instancetype)initWithModel:(GPPageModel *)model;
@end
