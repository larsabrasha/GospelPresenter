// "Lägg till sång", as the native app's AddSongSheet (Slides.swift): the library searched as the core searches it
// (`searchSongsView`, in the app's language), a song chosen with a tap (✓), added after `after` by
// `addSongToPresentation`, then the page told (`added`). A form sheet with a search bar, Avbryt and Lägg till.
#import <UIKit/UIKit.h>
#import "Live.h"

@interface GPAddSongController : UITableViewController
- (instancetype)initWithModel:(GPPageModel *)model after:(NSString *)afterItemId;
- (void)presentFrom:(UIViewController *)controller;
@end
