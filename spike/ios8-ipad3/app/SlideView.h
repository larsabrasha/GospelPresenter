// A slide as a picture: the theme's background, the text fitted into the theme's area, the part's label in a corner.
#import <UIKit/UIKit.h>

UIColor *GPColor(NSString *css);

/// The slide (presentationPageView's: key, kind, text, label {text, color}) drawn once at `size`, its corners rounded
/// on `ground`, and kept: the same slide at the same size is the same picture, opaque, so that scrolling only moves
/// pictures (the iPad 3's GPU stuttered drawing the tiles' rounded clips and labels anew on every frame).
UIImage *GPSlideImage(NSDictionary *slide, NSDictionary *theme, NSString *title, CGSize size, UIColor *ground);

/// The same with its label or without (an output shows none), and its corners rounded by `radius` (0: square).
UIImage *GPSlidePicture(NSDictionary *slide, NSDictionary *theme, NSString *title, CGSize size, UIColor *ground,
                        BOOL labelled, CGFloat radius);
