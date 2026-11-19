// How smoothly a scroll view scrolls, measured on the device: gpcore8://scrolltest/<pt a second> (AppDelegate.m;
// 1200 when none) moves the slides down and up for 5 s, a step on every frame the display shows, and logs how many frames
// there were, how many came later than a 60 Hz frame should (over 25 ms after the last), and the slowest: the app's
// own side. And the render server's side, which composites the layers on the GPU: how many frames it drew meanwhile,
// by QuartzCore's private CARenderServerGetFrameCounter (what FPS meters for jailbroken devices read), looked up at
// run time so that the app starts where it is missing. Fewer drawn than shown is a stutter the eye sees.
#import "ScrollTest.h"
#include <dlfcn.h>

typedef uint32_t (*FrameCounter)(mach_port_t);

/// What moves on screen in the first 3 s after launch, or after a picture: on every frame the display shows, where the window's root
/// view and the split view's two columns stand as the screen draws them (their presentation layers, mid-animation),
/// logged when that changed. Every launch has it (AppDelegate.m).
@implementation GPLaunchWatch {
    UIWindow *window;
    CADisplayLink *link;
    CFTimeInterval started;
    NSString *last;
}

+ (void)watch:(UIWindow *)window {
    static GPLaunchWatch *running;
    running = [[GPLaunchWatch alloc] init];
    running->window = window;
    running->link = [CADisplayLink displayLinkWithTarget:running selector:@selector(step:)];
    [running->link addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

static NSString *placed(UIView *v) {
    CALayer *shown = v.layer.presentationLayer ?: v.layer;
    CGRect f = [shown convertRect:shown.bounds toLayer:nil];
    return [NSString stringWithFormat:@"%.0f,%.0f %.0fx%.0f a%.2f", f.origin.x, f.origin.y, f.size.width, f.size.height, shown.opacity];
}

- (void)step:(CADisplayLink *)l {
    if (started == 0) started = l.timestamp;
    UIViewController *root = window.rootViewController;
    // The window itself, as the screen draws it: a move of the whole window does not show in the views' places
    // within it.
    CALayer *w = window.layer.presentationLayer ?: window.layer;
    CATransform3D t = w.transform;
    NSMutableString *now = [NSMutableString stringWithFormat:@"window %.0f,%.0f t(%.0f,%.0f s%.2f) a%.2f | root %@",
                            w.frame.origin.x, w.frame.origin.y, t.m41, t.m42, t.m11, w.opacity, placed(root.view)];
    if ([root isKindOfClass:[UISplitViewController class]])
        for (UIViewController *c in ((UISplitViewController *)root).viewControllers) [now appendFormat:@" | %@", placed(c.view)];
    if (![now isEqual:last]) NSLog(@"GPCore8: launch +%.0f ms: %@", (l.timestamp - started) * 1000, now);
    last = now;
    if (l.timestamp - started > 3) [link invalidate];
}
@end

@implementation GPScrollTest {
    UIScrollView *view;
    CADisplayLink *link;
    CFTimeInterval last, slowest, started;
    NSInteger frames, late;
    FrameCounter drawn;
    uint32_t drawnAtStart;
    CGFloat speed;
}

+ (void)run:(UIScrollView *)scrollView speed:(CGFloat)speed {
    static GPScrollTest *running;   // kept while it runs
    running = [[GPScrollTest alloc] init];
    running->view = scrollView;
    running->speed = speed;
    running->drawn = (FrameCounter)dlsym(RTLD_DEFAULT, "CARenderServerGetFrameCounter");
    [scrollView setContentOffset:CGPointMake(0, -scrollView.contentInset.top) animated:NO];
    running->link = [CADisplayLink displayLinkWithTarget:running selector:@selector(step:)];
    [running->link addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
}

- (void)step:(CADisplayLink *)l {
    if (last > 0) {
        CFTimeInterval gap = l.timestamp - last;
        frames++;
        if (gap > 0.025) late++;
        if (gap > slowest) slowest = gap;
    } else {
        started = l.timestamp;
        if (drawn) drawnAtStart = drawn(0);
    }
    last = l.timestamp;
    // Down to the end and back up, over and over for 5 s, so that a short list is measured as long as a long one and
    // the frames at the start and the end, when nothing moves, weigh little.
    CGFloat top = -view.contentInset.top;
    CGFloat span = MAX(1, view.contentSize.height + view.contentInset.bottom - view.bounds.size.height - top);
    CGFloat run = fmod((CGFloat)(l.timestamp - started) * speed, 2 * span);
    view.contentOffset = CGPointMake(0, top + (run < span ? run : 2 * span - run));
    if (l.timestamp - started < 5) return;
    [link invalidate];
    CFTimeInterval took = l.timestamp - started;
    NSString *server = drawn ? [NSString stringWithFormat:@"render server drew %u frames, %.1f fps",
                                drawn(0) - drawnAtStart, (drawn(0) - drawnAtStart) / took] : @"no render server counter";
    NSLog(@"GPCore8: scrolltest at %.0f pt/s: %ld frames in %.1f s, %ld late (%.0f %%), slowest %.0f ms; %@", speed, (long)frames,
          took, (long)late, frames ? 100.0 * late / frames : 0, slowest * 1000, server);
}
@end
