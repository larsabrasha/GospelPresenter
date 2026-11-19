// A slide as a picture: the theme's background, the text fitted into the theme's area, the part's label in a corner.
#import <UIKit/UIKit.h>

UIColor *GPColor(NSString *css);

@interface GPSlideView : UIView
/// A slide of presentationPageView's (key, kind, text, label {text, color}) and the presentation's theme.
- (void)showSlide:(NSDictionary *)slide theme:(NSDictionary *)theme title:(NSString *)title;
@end
