// A presentation's page in columns, as the native app's WideLayout: the items at the left, every item's slides in
// a grid at the right.
#import <UIKit/UIKit.h>

@interface GPPresentationController : UIViewController
/// presentationPageView's answer, decoded.
- (instancetype)initWithPage:(NSDictionary *)page;
@end
