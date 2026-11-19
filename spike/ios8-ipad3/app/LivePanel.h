// Presenting on the iPad, as the native app's PresentationScreen.swift and WideLayout.swift's live column have it:
// the right column holds the slides and, while presenting, the live column beside them (the picture shown with a red
// ring, Släck, the slide NÄSTA); ▶ or ■ in its bar, ■ asking first; the keys of a keyboard or a presenter's clicker
// as the page's events. And the output: what is shown, full screen on an external screen (the 30-pin Digital AV
// Adapter's HDMI, or AirPlay mirroring), black fading over 500 ms, every other change a cut.
#import <UIKit/UIKit.h>
#import "Live.h"

@interface GPDetailController : UIViewController
- (instancetype)initWithSlides:(UIViewController *)slides model:(GPPageModel *)model split:(UISplitViewController *)split;
@property (nonatomic, readonly) GPPageModel *model;
@end

/// The external screens' output, one for the app: started once, it follows the live state and the screens connected.
@interface GPOutput : NSObject
+ (void)startWithLive:(GPLive *)live;
@end
