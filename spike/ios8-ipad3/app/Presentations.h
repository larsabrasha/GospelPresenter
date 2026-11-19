// The presentations at the root of the left column, as Settings and Mail list theirs: a row each, its day under its
// name; a tap opens its page. Pulled down, it syncs; "Anslut" pairs with a desktop host.
#import <UIKit/UIKit.h>

/// Where the presentations come from: the demo data, or an organisation synced from a host (AppDelegate.m).
@protocol GPPresentationSource <NSObject>
/// The list's title: the organisation's name, or the demo's.
- (NSString *)sourceName;
/// Under the list: what it is synced with, or that it is the demo.
- (NSString *)sourceNote;
/// presentationsView's rows.
- (NSArray *)presentations;
/// presentationPageView's answer for one.
- (NSDictionary *)page:(NSString *)presentationId;
/// A pull from the host; `done` with an error's text or nil.
- (void)refresh:(void (^)(NSString *error))done;
/// Pairs with a host, asking for its address (and its code) from `controller`.
- (void)connectFrom:(UIViewController *)controller;
@end

@interface GPPresentationsController : UITableViewController
- (instancetype)initWithSource:(id<GPPresentationSource>)source;
/// Reads the presentations again.
- (void)reload;
@end
