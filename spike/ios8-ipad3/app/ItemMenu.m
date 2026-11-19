// ItemMenu.h: the sheets, the prompts, and the core's answers they are built from.
#import "ItemMenu.h"
#import "AddSong.h"
#import "Texts.h"

static id orNull(id v) { return v ?: [NSNull null]; }
static NSString *text(id v) { return [v isKindOfClass:[NSString class]] ? v : nil; }

static void present(UIViewController *c, UIAlertController *sheet, UIBarButtonItem *button, UIView *view, CGRect rect) {
    if (button) sheet.popoverPresentationController.barButtonItem = button;
    else { sheet.popoverPresentationController.sourceView = view; sheet.popoverPresentationController.sourceRect = rect; }
    [c presentViewController:sheet animated:YES completion:nil];
}

static void refused(UIViewController *c, NSString *title, NSString *code) {
    if (!code) return;
    UIAlertController *a = [UIAlertController alertControllerWithTitle:title message:GPRefusalText(code) preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [c presentViewController:a animated:YES completion:nil];
}

/// A one-line question (a name, a comment): an alert with a text field, `done` with what was typed.
static void ask(UIViewController *c, NSString *title, NSString *placeholder, NSString *start, void (^done)(NSString *)) {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:title message:nil preferredStyle:UIAlertControllerStyleAlert];
    [a addTextFieldWithConfigurationHandler:^(UITextField *f) { f.text = start; f.placeholder = placeholder; f.clearButtonMode = UITextFieldViewModeWhileEditing; }];
    [a addAction:[UIAlertAction actionWithTitle:GPText(@"common.cancel", nil) style:UIAlertActionStyleCancel handler:nil]];
    [a addAction:[UIAlertAction actionWithTitle:GPText(@"common.save", nil) style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) {
        done(a.textFields.firstObject.text ?: @"");
    }]];
    [c presentViewController:a animated:YES completion:nil];
}

/// The item an addition goes after: the core's one rule (`addPositionView`).
static NSString *afterFor(GPPageModel *model, NSString *chosenId) {
    NSDictionary *state = model.state;
    NSDictionary *args = @{@"order": [model.page[@"items"] valueForKey:@"id"] ?: @[], @"shownId": orNull(model.liveItemId),
                           @"lastAddedId": orNull(text(state[@"lastAddedId"])), @"chosenId": orNull(chosenId),
                           @"selectedId": orNull(text(state[@"selectedId"]))};
    return text([model.source view:@"addPositionView" args:args]);
}

void GPAddMenu(UIViewController *c, UIBarButtonItem *button, UIView *view, CGRect rect, NSString *chosenId, GPPageModel *model) {
    UIAlertController *sheet = [UIAlertController alertControllerWithTitle:nil message:nil preferredStyle:UIAlertControllerStyleActionSheet];
    [sheet addAction:[UIAlertAction actionWithTitle:GPText(@"add.song", nil) style:UIAlertActionStyleDefault handler:^(UIAlertAction *a) {
        GPAddSongController *add = [[GPAddSongController alloc] initWithModel:model after:afterFor(model, chosenId)];
        [add presentFrom:c];
    }]];
    [sheet addAction:[UIAlertAction actionWithTitle:GPText(@"header.kind", nil) style:UIAlertActionStyleDefault handler:^(UIAlertAction *a) {
        ask(c, GPText(@"header.new", nil), GPText(@"header.name", nil), @"", ^(NSString *title) {
            NSString *itemId = [[NSUUID UUID].UUIDString lowercaseString];
            NSMutableDictionary *args = [@{@"itemId": itemId, @"presentationId": model.page[@"presentation"][@"id"], @"title": title} mutableCopy];
            NSString *after = afterFor(model, chosenId);
            if (after) args[@"afterItemId"] = after;
            NSString *no = [model run:@"addHeaderToPresentation" args:args];
            if (no) refused(c, GPText(@"header.new", nil), no);
            else [model send:@{@"type": @"added", @"itemId": itemId}];
        });
    }]];
    present(c, sheet, button, view, rect);
}

/// A choice of several: a second sheet, ✓ at the one chosen.
static void choose(UIViewController *c, UIView *view, CGRect rect, NSDictionary *action, void (^picked)(NSString *choiceId)) {
    UIAlertController *sheet = [UIAlertController alertControllerWithTitle:GPText(action[@"text"], nil) message:nil
                                                            preferredStyle:UIAlertControllerStyleActionSheet];
    NSString *chosen = text(action[@"chosen"]) ?: ([action[@"id"] isEqual:@"overlay"] ? @"" : nil);
    for (NSDictionary *choice in action[@"choices"]) {
        NSString *name = text(choice[@"name"]) ?: (text(choice[@"text"]) ? GPText(choice[@"text"], nil)
                         : [NSString stringWithFormat:@"%@ %@", GPText(@"song.arrangement", nil), choice[@"n"] ?: @""]);
        BOOL on = chosen && [choice[@"id"] isEqual:chosen];
        [sheet addAction:[UIAlertAction actionWithTitle:on ? [@"✓ " stringByAppendingString:name] : name style:UIAlertActionStyleDefault
                                                handler:^(UIAlertAction *a) { picked(choice[@"id"]); }]];
    }
    present(c, sheet, nil, view, rect);
}

void GPItemMenu(UIViewController *c, UIView *view, CGRect rect, NSDictionary *item, GPPageModel *model) {
    NSDictionary *page = model.page;
    NSString *sourceId = text(item[@"sourceId"]);
    NSDictionary *song = nil;
    for (NSDictionary *s in page[@"songs"]) if ([s[@"id"] isEqual:sourceId]) song = s;
    NSMutableArray *arrangements = [NSMutableArray array];
    for (NSDictionary *a in page[@"arrangements"]) if ([a[@"songId"] isEqual:sourceId]) [arrangements addObject:@{@"id": a[@"id"], @"name": orNull(text(a[@"name"]))}];
    NSDictionary *args = @{@"item": @{@"id": item[@"id"], @"type": item[@"type"], @"arrangementId": orNull(text(item[@"arrangementId"])),
                                      @"overlayId": orNull(text(item[@"overlayId"]))},
                           @"song": orNull(song), @"arrangements": arrangements, @"overlays": page[@"overlays"] ?: @[],
                           @"shownId": orNull(model.liveItemId)};
    NSDictionary *menu = [model.source view:@"itemActionsView" args:args];
    UIAlertController *sheet = [UIAlertController alertControllerWithTitle:item[@"title"] message:nil preferredStyle:UIAlertControllerStyleActionSheet];
    NSString *itemId = item[@"id"];
    for (NSDictionary *group in menu[@"groups"]) for (NSDictionary *a in group[@"actions"]) {
        NSString *kind = a[@"id"], *title = GPText(a[@"text"], nil);
        if (![a[@"enabled"] boolValue]) continue;   // an action sheet has no greyed entry: one that cannot be chosen is left out
        void (^handler)(UIAlertAction *) = nil;
        if ([kind isEqual:@"rename"]) handler = ^(UIAlertAction *x) {
            ask(c, title, GPText(@"header.name", nil), item[@"title"], ^(NSString *t) { refused(c, title, [model run:@"renameItem" args:@{@"itemId": itemId, @"title": t}]); });
        };
        else if ([kind isEqual:@"note"]) handler = ^(UIAlertAction *x) {
            ask(c, title, title, text(item[@"note"]) ?: @"", ^(NSString *t) { refused(c, title, [model run:@"setItemNote" args:@{@"itemId": itemId, @"note": t}]); });
        };
        else if ([kind isEqual:@"arrangement"]) handler = ^(UIAlertAction *x) {
            choose(c, view, rect, a, ^(NSString *choiceId) { refused(c, title, [model run:@"setItemArrangement" args:@{@"itemId": itemId, @"arrangementId": orNull(choiceId)}]); });
        };
        else if ([kind isEqual:@"overlay"]) handler = ^(UIAlertAction *x) {
            choose(c, view, rect, a, ^(NSString *choiceId) {
                refused(c, title, [model run:@"setItemOverlay" args:@{@"itemId": itemId, @"overlayId": choiceId.length ? choiceId : [NSNull null]}]);
            });
        };
        else if ([kind isEqual:@"addAfter"]) handler = ^(UIAlertAction *x) { GPAddMenu(c, nil, view, rect, itemId, model); };
        else if ([kind isEqual:@"delete"]) handler = ^(UIAlertAction *x) {
            UIAlertController *sure = [UIAlertController alertControllerWithTitle:GPText(@"common.delete", nil)
                message:GPText(@"presentation.removeConfirm", @{@"title": item[@"title"] ?: @""}) preferredStyle:UIAlertControllerStyleAlert];
            [sure addAction:[UIAlertAction actionWithTitle:GPText(@"common.cancel", nil) style:UIAlertActionStyleCancel handler:nil]];
            [sure addAction:[UIAlertAction actionWithTitle:GPText(@"common.delete", nil) style:UIAlertActionStyleDestructive handler:^(UIAlertAction *y) {
                refused(c, title, [model run:@"removeItem" args:@{@"itemId": itemId}]);
            }]];
            [c presentViewController:sure animated:YES completion:nil];
        };
        if (!handler) continue;   // the core's entries this app does not draw yet
        BOOL more = [kind isEqual:@"arrangement"] || [kind isEqual:@"overlay"] || [kind isEqual:@"addAfter"];
        [sheet addAction:[UIAlertAction actionWithTitle:more && ![title hasSuffix:@"…"] ? [title stringByAppendingString:@" …"] : title
                                                  style:[a[@"destructive"] boolValue] ? UIAlertActionStyleDestructive : UIAlertActionStyleDefault
                                                handler:handler]];
    }
    present(c, sheet, nil, view, rect);
}
