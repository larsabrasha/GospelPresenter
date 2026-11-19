// One screen: what the core answers, and how long it took.
#import <UIKit/UIKit.h>

NSString *GPCoreView(NSString *name, NSString *args);

@interface GPAppDelegate : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

@implementation GPAppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    NSDate *t = [NSDate date];
    NSString *info = GPCoreView(@"coreInfoView", @"{}");
    NSString *mark = GPCoreView(@"highlightView", @"{\"text\":\"Härlig är jorden\",\"query\":\"harlig\"}");
    NSString *refused = GPCoreView(@"noSuchView", @"{}");
    NSString *text = [NSString stringWithFormat:@"coreInfoView\n%@\n\nhighlightView\n%@\n\nnoSuchView\n%@\n\n%.1f ms",
                      info, mark, refused, -[t timeIntervalSinceNow] * 1000];
    NSLog(@"%@", text);
    UIViewController *root = [[UIViewController alloc] init];
    UILabel *label = [[UILabel alloc] initWithFrame:CGRectInset(root.view.bounds, 24, 48)];
    label.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    label.numberOfLines = 0;
    label.text = text;
    root.view.backgroundColor = [UIColor whiteColor];
    [root.view addSubview:label];
    self.window = [[UIWindow alloc] initWithFrame:[[UIScreen mainScreen] bounds]];
    self.window.rootViewController = root;
    [self.window makeKeyAndVisible];
    return YES;
}
@end
