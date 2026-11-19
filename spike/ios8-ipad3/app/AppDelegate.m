// The app: the presentations of an organisation synced from a desktop host (Sync.m), or, before it is paired, a fresh
// copy of the demo data (Resources/demo.sqlite, copied in by ../build-core.sh); the next presentation's page opened
// at once. What it took is logged, and where the views stand in the first seconds (ScrollTest.m's GPLaunchWatch);
// gpcore8:// URLs drive it and take pictures of it over SSH (../README.md).
#import <UIKit/UIKit.h>
#import "AddSong.h"
#import "Core.h"
#import "ItemMenu.h"
#import "Live.h"
#import "LivePanel.h"
#import "PresentationController.h"
#import "Presentations.h"
#import "ScrollTest.h"
#import "Sync.h"
#import "Texts.h"

@interface GPAppDelegate : UIResponder <UIApplicationDelegate, GPPresentationSource>
@property (nonatomic, strong) UIWindow *window;
@end

static double since(NSDate *t) { return -[t timeIntervalSinceNow] * 1000; }

@implementation GPAppDelegate {
    sqlite3 *db;          // the synced organisation's, or the demo's
    GPSync *sync;
    UISplitViewController *split;
    GPPresentationsController *list;
    GPLive *live;         // what this device presents, one for the app
}

- (GPLive *)live { return live; }

/// The demo data, copied afresh and migrated by the core.
- (void)openDemo {
    NSString *caches = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES)[0];
    NSString *path = [caches stringByAppendingPathComponent:@"gpcore8.sqlite"];
    NSFileManager *files = [NSFileManager defaultManager];
    [files createDirectoryAtPath:caches withIntermediateDirectories:YES attributes:nil error:NULL];
    for (NSString *end in @[@"", @"-wal", @"-shm", @"-journal"]) [files removeItemAtPath:[path stringByAppendingString:end] error:NULL];
    [files copyItemAtPath:[[NSBundle mainBundle] pathForResource:@"demo" ofType:@"sqlite"] toPath:path error:NULL];
    if (sqlite3_open(path.UTF8String, &db) != SQLITE_OK) { NSLog(@"GPCore8: cannot open %@", path); return; }
    NSDate *t = [NSDate date];
    NSString *refusal = nil;
    GPCoreCommand(db, @"migrateOrgSchema", @"{}", &refusal);
    NSLog(@"GPCore8: migrateOrgSchema %@, %.1f ms", refusal ?: @"ok", since(t));
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    NSDate *t = [NSDate date];
    sync = [GPSync saved];
    if (sync) db = sync.db; else [self openDemo];
    live = [[GPLive alloc] initWithSource:self];
    [GPOutput startWithLive:live];
    list = [[GPPresentationsController alloc] initWithSource:self];
    split = GPSplit(list);
    [self openNext:NO];
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    self.window.tintColor = GPTint();
    self.window.rootViewController = split;
    [self.window makeKeyAndVisible];
    [GPLaunchWatch watch:self.window];
    NSLog(@"GPCore8: launched in %.1f ms, %@", since(t), sync ? sync.server : @"the demo");
    // No picture of its own at launch: one taken 1.5 s in made the split view fold the running order away and back
    // on the screen (Lars filmed it). Pictures are taken when asked for.
    [self listen];
    return YES;
}

/// The poke socket open, and what a sync changes read again (it syncs at once on opening).
- (void)listen {
    __weak GPAppDelegate *me = self;
    sync.onChange = ^{ [me changed]; };
    [sync start];
}

/// A sync changed rows: the start page read again, the presented page with its marks, and the presentation shown, if
/// one is.
- (void)changed {
    [live reload];
    [list reload];
    NSString *shown = GPShownPresentation(split);
    NSDictionary *page = shown ? [self page:shown] : nil;
    GPDetailController *detail = (GPDetailController *)[split.viewControllers.lastObject topViewController];
    // Read again in place, where the page stands (built anew, it went back to its top).
    if (page && [detail isKindOfClass:[GPDetailController class]]) [detail.model reloadPage:page];
    else if (page) GPShowPage(split, page, self, NO);
    else if (shown) [(UINavigationController *)split.viewControllers.firstObject popToRootViewControllerAnimated:NO];   // gone
}

// In the background the socket closes; back in front it opens again, catching up as it does.
- (void)applicationDidEnterBackground:(UIApplication *)application { [sync stopListening]; }
- (void)applicationWillEnterForeground:(UIApplication *)application { [sync start]; }

/// The next presentation, from today on (the most recent one when none is coming), its page shown.
- (void)openNext:(BOOL)animated {
    NSArray *rows = [self presentations];
    NSDateFormatter *iso = [[NSDateFormatter alloc] init];
    iso.dateFormat = @"yyyy-MM-dd";
    NSString *today = [iso stringFromDate:[NSDate date]];
    NSDictionary *next = nil, *latest = nil;
    for (NSDictionary *p in rows) {
        NSString *day = [p[@"eventDate"] isKindOfClass:[NSString class]] ? p[@"eventDate"] : nil;
        if (day && [day compare:today] != NSOrderedAscending && (!next || [day compare:next[@"eventDate"]] == NSOrderedAscending)) next = p;
        if (day && (!latest || [day compare:latest[@"eventDate"]] == NSOrderedDescending)) latest = p;
    }
    NSDictionary *chosen = next ?: latest ?: rows.firstObject;
    NSDictionary *page = chosen ? [self page:chosen[@"id"]] : nil;
    if (page) GPShowPage(split, page, self, animated);
}

#pragma mark - GPPresentationSource

/// Who calls the core: the signed-in member, or in the demo an admin of its own, as the native app's demo.
- (NSDictionary *)caller { return sync ? sync.caller : @{@"userId": @"demo", @"role": @"admin"}; }

- (id)view:(NSString *)name args:(NSDictionary *)args {
    NSDate *t = [NSDate date];
    NSData *text = [NSJSONSerialization dataWithJSONObject:args ?: @{} options:0 error:NULL];
    NSString *json = GPCoreCallAs(db, name, [[NSString alloc] initWithData:text encoding:NSUTF8StringEncoding], [self caller], NULL);
    NSLog(@"GPCore8: %@ %.1f ms", name, since(t));
    return json ? [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL] : nil;
}

- (NSString *)mutate:(NSString *)name args:(NSDictionary *)args {
    if (sync) return [sync mutate:name args:args];
    NSData *text = [NSJSONSerialization dataWithJSONObject:args options:0 error:NULL];
    NSString *refused = nil;
    GPCoreCommandAs(db, name, [[NSString alloc] initWithData:text encoding:NSUTF8StringEncoding], [self caller], &refused);
    NSLog(@"GPCore8: %@ %@ (the demo)", name, refused ?: @"ok");
    return refused;
}

- (NSString *)accountName { return sync ? sync.me[@"name"] : nil; }

- (NSString *)sourceNote {
    if (!sync) return GPOwnText(@"demoNote");
    NSString *note = [NSString stringWithFormat:GPOwnText(@"syncedNote"), sync.server, sync.me[@"orgName"] ?: @"?"];
    return sync.stopped ? [NSString stringWithFormat:@"%@ (%@)", note, GPRefusalText(sync.stopped)] : note;
}

- (void)signOut {
    [sync signOut];
    sync = nil;
    [self openDemo];
    [list reload];
    [self openNext:NO];
}

- (NSArray *)presentations {
    NSArray *rows = [self view:@"presentationsView" args:@{}];
    return [rows isKindOfClass:[NSArray class]] ? rows : @[];
}

- (NSDictionary *)page:(NSString *)presentationId {
    NSDate *t = [NSDate date];
    NSDictionary *page = GPCoreView(db, @"presentationPageView", @{@"id": presentationId});
    NSLog(@"GPCore8: presentationPageView %lu items, %.1f ms", (unsigned long)[page[@"items"] count], since(t));
    return [page[@"presentation"] isKindOfClass:[NSDictionary class]] ? page : nil;
}

- (void)refresh:(void (^)(NSString *))done {
    if (!sync) { done(GPOwnText(@"demoNote")); return; }
    NSDate *t = [NSDate date];
    BOOL hadAny = [self presentations].count > 0;
    [sync sync:^(BOOL changed, NSString *error) {
        NSLog(@"GPCore8: pull %@ in %.0f ms%@", changed ? @"changed rows" : @"changed nothing", since(t), error ? [@", " stringByAppendingString:error] : @"");
        if (changed) {
            [self->list reload];
            if (!hadAny) [self openNext:NO];
        }
        done(error);
    }];
}

- (void)connectFrom:(UIViewController *)controller {
    UIAlertController *ask = [UIAlertController alertControllerWithTitle:GPOwnText(@"connectTitle")
        message:GPOwnText(@"connectHint") preferredStyle:UIAlertControllerStyleAlert];
    [ask addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.text = [[NSUserDefaults standardUserDefaults] stringForKey:@"gp.host"];
        field.placeholder = @"192.168.1.184:47800";
        field.keyboardType = UIKeyboardTypeURL;
        field.autocorrectionType = UITextAutocorrectionTypeNo;
        field.autocapitalizationType = UITextAutocapitalizationTypeNone;
    }];
    [ask addAction:[UIAlertAction actionWithTitle:GPText(@"common.cancel", nil) style:UIAlertActionStyleCancel handler:nil]];
    [ask addAction:[UIAlertAction actionWithTitle:GPOwnText(@"connect") style:UIAlertActionStyleDefault handler:^(UIAlertAction *a) {
        NSString *address = ask.textFields.firstObject.text;
        [[NSUserDefaults standardUserDefaults] setObject:address forKey:@"gp.host"];
        [GPSync askHost:address done:^(NSString *how, NSString *error) {
            if (error) { [self tell:GPOwnText(@"noContact") message:error from:controller]; return; }
            if ([how isEqual:@"dev"]) { [self pair:address code:nil from:controller]; return; }
            [self askCode:address from:controller];
        }];
    }]];
    [controller presentViewController:ask animated:YES completion:nil];
}

/// The six digits the host shows under "Para ihop en enhet".
- (void)askCode:(NSString *)address from:(UIViewController *)controller {
    UIAlertController *ask = [UIAlertController alertControllerWithTitle:GPOwnText(@"code") message:GPOwnText(@"codeHint")
                                                          preferredStyle:UIAlertControllerStyleAlert];
    [ask addTextFieldWithConfigurationHandler:^(UITextField *field) { field.keyboardType = UIKeyboardTypeNumberPad; }];
    [ask addAction:[UIAlertAction actionWithTitle:GPText(@"common.cancel", nil) style:UIAlertActionStyleCancel handler:nil]];
    [ask addAction:[UIAlertAction actionWithTitle:GPOwnText(@"pair") style:UIAlertActionStyleDefault handler:^(UIAlertAction *a) {
        [self pair:address code:ask.textFields.firstObject.text from:controller];
    }]];
    [controller presentViewController:ask animated:YES completion:nil];
}

- (void)pair:(NSString *)address code:(NSString *)code from:(UIViewController *)controller {
    [GPSync pair:address code:code done:^(GPSync *paired, NSString *error) {
        if (!paired) { [self tell:GPOwnText(@"pairFailed") message:GPRefusalText(error) from:controller]; return; }
        NSLog(@"GPCore8: paired with %@ as %@ in %@", paired.server, paired.me[@"name"], paired.me[@"orgName"]);
        [self->sync stopListening];
        self->sync = paired;
        [self listen];
        self->db = paired.db;
        [self->list reload];
        [self refresh:^(NSString *pullError) {
            if (pullError) [self tell:GPOwnText(@"syncFailed") message:GPRefusalText(pullError) from:controller];
            else [self openNext:YES];
        }];
    }];
}

- (void)tell:(NSString *)title message:(NSString *)message from:(UIViewController *)controller {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:title message:message preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [controller presentViewController:a animated:YES completion:nil];
}

#pragma mark - Checks over SSH

/// gpcore8://picture writes the picture now, gpcore8://item/<n> taps the running order's row n and writes it once the
/// slides have scrolled, gpcore8://open/<id> opens a presentation, gpcore8://scrolltest scrolls the slides through
/// and logs how smoothly (ScrollTest.m), gpcore8://connect/<host:port> pairs as "Anslut" does, without asking.
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url sourceApplication:(NSString *)source annotation:(id)annotation {
    // A menu, a sheet or an alert a check left open goes first, so that the next can open (not for a picture of it).
    if (![url.host isEqual:@"picture"]) [split dismissViewControllerAnimated:NO completion:nil];
    if ([url.host isEqual:@"open"] && url.pathComponents.count > 1) {
        NSDictionary *page = [self page:url.pathComponents[1]];
        if (!page) return NO;
        GPShowPage(split, page, self, NO);
        return YES;
    }
    // The open page's events: gpcore8://send/<type> (start, black, step, escape), gpcore8://show/<item>/<part> as a
    // tap on that slide, gpcore8://end as ■ answered yes; a picture a second later.
    GPDetailController *detail = (GPDetailController *)[split.viewControllers.lastObject topViewController];
    GPPageModel *page = [detail isKindOfClass:[GPDetailController class]] ? detail.model : nil;
    // The menus: gpcore8://menu/<row> the item's, gpcore8://add +'s, gpcore8://addsong/<query> Lägg till sång searched,
    // gpcore8://run/<change>?<JSON> a change as a menu's entry makes it; a picture a second later.
    UITableViewController *order = (UITableViewController *)[split.viewControllers.firstObject topViewController];
    if (page && [url.host isEqual:@"menu"] && url.pathComponents.count > 1) {
        NSInteger row = [url.pathComponents[1] integerValue];
        GPItemMenu(order, order.tableView, [order.tableView rectForRowAtIndexPath:[NSIndexPath indexPathForRow:row inSection:0]], page.page[@"items"][row], page);
        [self performSelector:@selector(picture) withObject:nil afterDelay:1];
        return YES;
    }
    if (page && [url.host isEqual:@"add"]) {
        GPAddMenu(order, order.navigationItem.rightBarButtonItem, nil, CGRectZero, nil, page);
        [self performSelector:@selector(picture) withObject:nil afterDelay:1];
        return YES;
    }
    if (page && [url.host isEqual:@"addsong"]) {
        GPAddSongController *add = [[GPAddSongController alloc] initWithModel:page after:nil];
        [add presentFrom:order];
        if (url.pathComponents.count > 1) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2), dispatch_get_main_queue(), ^{
            UISearchBar *bar = (UISearchBar *)add.tableView.tableHeaderView;
            bar.text = url.pathComponents[1];
            [bar.delegate searchBar:bar textDidChange:bar.text];
        });
        [self performSelector:@selector(picture) withObject:nil afterDelay:1.5];
        return YES;
    }
    if (page && [url.host isEqual:@"run"] && url.pathComponents.count > 1) {
        NSData *json = [[url.query stringByRemovingPercentEncoding] dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *args = json ? [NSJSONSerialization JSONObjectWithData:json options:0 error:NULL] : @{};
        NSLog(@"GPCore8: run %@ %@", url.pathComponents[1], [page run:url.pathComponents[1] args:args ?: @{}] ?: @"ok");
        [self performSelector:@selector(picture) withObject:nil afterDelay:1];
        return YES;
    }
    if (page && ([url.host isEqual:@"send"] || [url.host isEqual:@"show"] || [url.host isEqual:@"end"])) {
        NSArray *at = url.pathComponents;
        if ([url.host isEqual:@"end"]) [page liveEnded];
        else if ([url.host isEqual:@"send"] && at.count > 1) [page send:@{@"type": at[1], @"delta": @1}];
        else if (at.count > 2) {
            NSDictionary *item = page.page[@"items"][[at[1] integerValue]];
            [page send:@{@"type": @"show", @"itemId": item[@"id"], @"partIndex": @([at[2] integerValue])}];
        }
        [self performSelector:@selector(picture) withObject:nil afterDelay:1];
        return YES;
    }
    if ([url.host isEqual:@"new"]) {   // + tapped: Skapa presentation's form
        [list performSelector:@selector(create)];
        [self performSelector:@selector(picture) withObject:nil afterDelay:1];
        return YES;
    }
    if ([url.host isEqual:@"start"]) {   // the start page, the left column back at its root
        [(UINavigationController *)split.viewControllers.firstObject popToRootViewControllerAnimated:NO];
        return YES;
    }
    if ([url.host isEqual:@"create"] && url.pathComponents.count > 1) {   // a presentation made as Skapa makes one
        NSString *made = [[NSUUID UUID].UUIDString lowercaseString];
        NSString *refused = [self mutate:@"createPresentation" args:@{@"id": made, @"name": url.pathComponents[1], @"eventDate": [NSNull null],
                                                                     @"time": [NSNull null], @"location": @"", @"description": @""}];
        [list reload];
        if (!refused) GPShowPage(split, [self page:made], self, NO);
        return YES;
    }
    if ([url.host isEqual:@"connect"] && url.pathComponents.count > 1) {
        NSString *address = url.pathComponents[1];
        [GPSync askHost:address done:^(NSString *how, NSString *error) {
            if ([how isEqual:@"dev"]) [self pair:address code:nil from:self->list];
            else NSLog(@"GPCore8: connect: %@", error ?: @"the host asks for a code");
        }];
        return YES;
    }
    if ([url.host isEqual:@"scrolltest"]) {
        // gpcore8://scrolltest/<speed>/list scrolls the running order instead. The collection view itself: on iOS 8
        // the controller's view is a wrapper around it.
        CGFloat speed = url.pathComponents.count > 1 ? [url.pathComponents[1] floatValue] : 1200;
        UIScrollView *scrolled;
        if (url.pathComponents.count > 2 && [url.pathComponents[2] isEqual:@"list"]) {
            scrolled = ((UITableViewController *)[split.viewControllers.firstObject topViewController]).tableView;
        } else {
            scrolled = ((UICollectionViewController *)[split.viewControllers.lastObject topViewController]).collectionView;
        }
        [GPScrollTest run:scrolled speed:speed];
        return YES;
    }
    if ([url.host isEqual:@"item"] && url.pathComponents.count > 1) {
        UITableViewController *order = (UITableViewController *)[split.viewControllers.firstObject topViewController];
        NSIndexPath *at = [NSIndexPath indexPathForRow:[url.pathComponents[1] integerValue] inSection:0];
        [order.tableView selectRowAtIndexPath:at animated:NO scrollPosition:UITableViewScrollPositionMiddle];
        [order tableView:order.tableView didSelectRowAtIndexPath:at];
        [self performSelector:@selector(picture) withObject:nil afterDelay:1];
        return YES;
    }
    if ([url.host isEqual:@"picture"]) {
        [GPLaunchWatch watch:self.window];   // and whether taking it moves anything
        [self picture];
    }
    return YES;
}

/// The window as a PNG in /tmp, as the screen shows it. As it stands: with afterScreenUpdates:YES, UIKit lays the
/// window out once more to draw it, and the split view folded the running order away and back on the screen.
- (void)picture {
    UIGraphicsBeginImageContextWithOptions(self.window.bounds.size, YES, 0);
    [self.window drawViewHierarchyInRect:self.window.bounds afterScreenUpdates:NO];
    UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    BOOL written = [UIImagePNGRepresentation(image) writeToFile:@"/tmp/gpcore8.png" atomically:YES];
    NSLog(@"GPCore8: picture %@", written ? @"written" : @"not written");
}
@end
