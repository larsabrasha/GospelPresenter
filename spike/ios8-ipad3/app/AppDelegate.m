// The app: a fresh copy of the demo data (Resources/demo.sqlite, copied in by ../build-core.sh), migrated by the
// core, and its first presentation's page. What it took is logged, and where the views stand in the first seconds
// (ScrollTest.m's GPLaunchWatch); gpcore8:// URLs drive it and take pictures of it over SSH (../README.md).
#import <UIKit/UIKit.h>
#import "Core.h"
#import "PresentationController.h"
#import "ScrollTest.h"

@interface GPAppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

static double since(NSDate *t) { return -[t timeIntervalSinceNow] * 1000; }

@implementation GPAppDelegate {
    sqlite3 *db;
}

- (NSDictionary *)openPage {
    NSString *caches = NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES)[0];
    NSString *path = [caches stringByAppendingPathComponent:@"gpcore8.sqlite"];
    NSFileManager *files = [NSFileManager defaultManager];
    [files createDirectoryAtPath:caches withIntermediateDirectories:YES attributes:nil error:NULL];
    for (NSString *end in @[@"", @"-wal", @"-shm", @"-journal"]) [files removeItemAtPath:[path stringByAppendingString:end] error:NULL];
    [files copyItemAtPath:[[NSBundle mainBundle] pathForResource:@"demo" ofType:@"sqlite"] toPath:path error:NULL];
    if (sqlite3_open(path.UTF8String, &db) != SQLITE_OK) { NSLog(@"GPCore8: cannot open %@", path); return nil; }
    NSDate *t = [NSDate date];
    NSString *refusal = nil;
    GPCoreCommand(db, @"migrateOrgSchema", @"{}", &refusal);
    NSLog(@"GPCore8: migrateOrgSchema %@, %.1f ms", refusal ?: @"ok", since(t));
    t = [NSDate date];
    NSArray *rows = GPCoreView(db, @"presentationsView", @{});
    NSLog(@"GPCore8: presentationsView %lu rows, %.1f ms", (unsigned long)rows.count, since(t));
    if (rows.count == 0) return nil;
    t = [NSDate date];
    NSDictionary *page = GPCoreView(db, @"presentationPageView", @{@"id": rows[0][@"id"]});
    NSLog(@"GPCore8: presentationPageView %lu items, %.1f ms", (unsigned long)[page[@"items"] count], since(t));
    return page;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    NSDate *t = [NSDate date];
    NSLog(@"GPCore8: launching, the bar %ld, the screen %.0f x %.0f", (long)application.statusBarOrientation,
          [UIScreen mainScreen].bounds.size.width, [UIScreen mainScreen].bounds.size.height);
    NSDictionary *page = [self openPage];
    UIViewController *root;
    if (page) {
        root = GPPresentationPage(page);
    } else {
        root = [[UIViewController alloc] init];
        root.view.backgroundColor = [UIColor whiteColor];
        UILabel *label = [[UILabel alloc] initWithFrame:CGRectInset(root.view.bounds, 24, 48)];
        label.text = @"Ingen presentation (se loggen)";
        [root.view addSubview:label];
    }
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    self.window.tintColor = GPTint();
    self.window.rootViewController = root;
    [self.window makeKeyAndVisible];
    [GPLaunchWatch watch:self.window];
    NSLog(@"GPCore8: launched in %.1f ms", since(t));
    // No picture of its own at launch: one taken 1.5 s in made the split view fold the running order away and back
    // on the screen (Lars filmed it). Pictures are taken when asked for.
    return YES;
}

/// For checks over SSH (`uiopen`): gpcore8://picture writes the picture now, gpcore8://item/<n> taps the running
/// order's row n and writes it once the slides have scrolled, gpcore8://scrolltest scrolls the slides through and
/// logs how smoothly (ScrollTest.m).
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url sourceApplication:(NSString *)source annotation:(id)annotation {
    if ([url.host isEqual:@"open"] && url.pathComponents.count > 1) {
        // gpcore8://open/<presentation id>: that presentation's page instead.
        NSDate *t = [NSDate date];
        NSDictionary *page = GPCoreView(db, @"presentationPageView", @{@"id": url.pathComponents[1]});
        NSLog(@"GPCore8: presentationPageView %lu items, %.1f ms", (unsigned long)[page[@"items"] count], since(t));
        if (!page[@"presentation"] || page[@"presentation"] == [NSNull null]) return NO;
        self.window.rootViewController = GPPresentationPage(page);
        return YES;
    }
    if ([url.host isEqual:@"scrolltest"]) {
        UISplitViewController *split = (UISplitViewController *)self.window.rootViewController;
        if (![split isKindOfClass:[UISplitViewController class]]) return NO;
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
        UISplitViewController *split = (UISplitViewController *)self.window.rootViewController;
        if (![split isKindOfClass:[UISplitViewController class]]) return NO;
        UITableViewController *list = (UITableViewController *)[split.viewControllers[0] topViewController];
        NSIndexPath *at = [NSIndexPath indexPathForRow:[url.pathComponents[1] integerValue] inSection:0];
        [list.tableView selectRowAtIndexPath:at animated:NO scrollPosition:UITableViewScrollPositionMiddle];
        [list tableView:list.tableView didSelectRowAtIndexPath:at];
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
