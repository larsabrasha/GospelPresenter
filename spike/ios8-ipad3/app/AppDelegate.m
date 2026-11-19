// The app: a fresh copy of the demo data (Resources/demo.sqlite, copied in by ../build-core.sh), migrated by the
// core, and its first presentation's page. What it took is logged; a second after the page shows, a picture of it is
// written to /tmp/gpcore8.png, to be fetched over SSH (../README.md).
#import <UIKit/UIKit.h>
#import "Core.h"
#import "PresentationController.h"

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
    NSLog(@"GPCore8: launched in %.1f ms", since(t));
    [self performSelector:@selector(picture) withObject:nil afterDelay:1.5];
    return YES;
}

/// The window as a PNG in /tmp, as the screen shows it.
- (void)picture {
    UIGraphicsBeginImageContextWithOptions(self.window.bounds.size, YES, 0);
    [self.window drawViewHierarchyInRect:self.window.bounds afterScreenUpdates:YES];
    UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    BOOL written = [UIImagePNGRepresentation(image) writeToFile:@"/tmp/gpcore8.png" atomically:YES];
    NSLog(@"GPCore8: picture %@", written ? @"written" : @"not written");
}
@end
