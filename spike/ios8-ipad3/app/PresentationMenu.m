// PresentationMenu.h: the sheet, and what each entry does.
#import "PresentationMenu.h"
#import "Details.h"
#import "PresentationController.h"
#import "Texts.h"

/// The start page at the root of the left column, read again (a name or a day changed, a presentation gone).
static void startPageChanged(UIViewController *c) {
    UIViewController *root = c.navigationController.viewControllers.firstObject;
    if ([root isKindOfClass:[GPPresentationsController class]]) [(GPPresentationsController *)root reload];
}

static void trash(UIViewController *c, UIView *view, GPPageModel *model) {
    NSDictionary *p = model.page[@"presentation"];
    UIAlertController *sure = [UIAlertController alertControllerWithTitle:GPText(@"presentation.trash", nil)
        message:GPText(@"presentation.trashConfirm", @{@"name": p[@"name"] ?: @""}) preferredStyle:UIAlertControllerStyleActionSheet];
    [sure addAction:[UIAlertAction actionWithTitle:GPText(@"common.cancel", nil) style:UIAlertActionStyleCancel handler:nil]];
    [sure addAction:[UIAlertAction actionWithTitle:GPText(@"presentation.trash", nil) style:UIAlertActionStyleDestructive handler:^(UIAlertAction *a) {
        GPTrashPresentation(c, model);
    }]];
    sure.popoverPresentationController.sourceView = view;
    sure.popoverPresentationController.sourceRect = view.bounds;
    [c presentViewController:sure animated:YES completion:nil];
}

void GPTrashPresentation(UIViewController *c, GPPageModel *model) {
    long long at = (long long)([[NSDate date] timeIntervalSince1970] * 1000);
    NSString *refused = [model.source mutate:@"trashPresentation" args:@{@"id": model.page[@"presentation"][@"id"], @"at": @(at)}];
    if (refused) {
        UIAlertController *no = [UIAlertController alertControllerWithTitle:GPText(@"presentation.trash", nil) message:GPRefusalText(refused)
                                                             preferredStyle:UIAlertControllerStyleAlert];
        [no addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
        [c presentViewController:no animated:YES completion:nil];
        return;
    }
    UISplitViewController *split = c.splitViewController;
    startPageChanged(c);
    GPShowNothing(split);
}

void GPPresentationMenu(UIViewController *c, UIView *view, GPPageModel *model) {
    // The role only decides Spara som mall, which is not drawn here.
    NSDictionary *menu = [model.source view:@"presentationActionsView" args:@{@"isTemplate": @NO, @"presenting": @(model.isLive), @"role": @""}];
    UIAlertController *sheet = [UIAlertController alertControllerWithTitle:nil message:nil preferredStyle:UIAlertControllerStyleActionSheet];
    NSString *pid = model.page[@"presentation"][@"id"];
    for (NSDictionary *group in menu[@"groups"]) for (NSDictionary *a in group[@"actions"]) {
        if (![a[@"enabled"] boolValue]) continue;
        void (^handler)(UIAlertAction *) = nil;
        if ([a[@"id"] isEqual:@"editDetails"]) handler = ^(UIAlertAction *x) {
            GPDetailsController *details = [[GPDetailsController alloc] initWithSource:model.source presentationId:pid done:^(NSString *saved) {
                if (!saved) return;
                [model reloadPage:[model.source page:saved]];
                startPageChanged(c);
            }];
            [details presentFrom:c];
        };
        else if ([a[@"id"] isEqual:@"trash"]) handler = ^(UIAlertAction *x) { trash(c, view, model); };
        if (!handler) continue;   // Noter och länkar, Spara som mall: not here yet
        [sheet addAction:[UIAlertAction actionWithTitle:GPText(a[@"text"], nil)
                                                  style:[a[@"destructive"] boolValue] ? UIAlertActionStyleDestructive : UIAlertActionStyleDefault
                                                handler:handler]];
    }
    sheet.popoverPresentationController.sourceView = view;
    sheet.popoverPresentationController.sourceRect = view.bounds;
    [c presentViewController:sheet animated:YES completion:nil];
}
