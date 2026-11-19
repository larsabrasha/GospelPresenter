// How smoothly a scroll view scrolls, measured on the device: gpcore8://scrolltest/<pt a second> (AppDelegate.m;
// 1200 when none) moves the slides from the top to the end, a step on every frame the display shows, and logs how many frames
// there were, how many came later than a 60 Hz frame should (over 25 ms after the last), and the slowest: the app's
// own side. And the render server's side, which composites the layers on the GPU: how many frames it drew meanwhile,
// by QuartzCore's private CARenderServerGetFrameCounter (what FPS meters for jailbroken devices read), looked up at
// run time so that the app starts where it is missing. Fewer drawn than shown is a stutter the eye sees.
#import "ScrollTest.h"
#include <dlfcn.h>

typedef uint32_t (*FrameCounter)(mach_port_t);

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
    CGFloat end = view.contentSize.height + view.contentInset.bottom - view.bounds.size.height;
    CGFloat y = -view.contentInset.top + (CGFloat)(l.timestamp - started) * speed;
    view.contentOffset = CGPointMake(0, MIN(y, end));
    if (y < end) return;
    [link invalidate];
    CFTimeInterval took = l.timestamp - started;
    NSString *server = drawn ? [NSString stringWithFormat:@"render server drew %u frames, %.1f fps",
                                drawn(0) - drawnAtStart, (drawn(0) - drawnAtStart) / took] : @"no render server counter";
    NSLog(@"GPCore8: scrolltest at %.0f pt/s: %ld frames in %.1f s, %ld late (%.0f %%), slowest %.0f ms; %@", speed, (long)frames,
          took, (long)late, frames ? 100.0 * late / frames : 0, slowest * 1000, server);
}
@end
