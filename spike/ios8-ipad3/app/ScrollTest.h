// A scroll view scrolled from the top to the end by the display's frames, and how smoothly it went, logged.
#import <UIKit/UIKit.h>

@interface GPLaunchWatch : NSObject
+ (void)watch:(UIWindow *)window;
@end

@interface GPScrollTest : NSObject
/// At `speed` points a second (a finger's flick goes up to some thousands).
+ (void)run:(UIScrollView *)scrollView speed:(CGFloat)speed;
@end
