// "Skapa presentation" and "Redigera detaljer", as the native app's DetailsSheet (Sheets.swift): the core's title,
// groups and buttons (`detailsDialogView`), the fields in iOS 8's parts (text fields, a switch and a date picker for
// the day and the time), in a form sheet with Avbryt and the confirm button in its bar.
#import <UIKit/UIKit.h>
#import "Presentations.h"

@interface GPDetailsController : UITableViewController
/// `presentationId` nil makes one; `done` gets the presentation's id when saved, nil when cancelled.
- (instancetype)initWithSource:(id<GPPresentationSource>)source presentationId:(NSString *)presentationId
                          done:(void (^)(NSString *presentationId))done;
/// Shown as a form sheet over `controller`.
- (void)presentFrom:(UIViewController *)controller;
@end
