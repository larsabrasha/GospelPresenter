// LivePanel.h: the right column while presenting, and the output on an external screen. Every picture is
// GPSlidePicture's, drawn once and kept; a slide shown is a picture swapped, a cut.
#import "LivePanel.h"
#import <objc/runtime.h>
#import "PresentationController.h"
#import "SlideView.h"
#import "Texts.h"

static const CGFloat kPanelWidth = 300;

// GPLivePicture: black fades as every output of the web's fades it; any other change a cut (Lars: no transitions).
@implementation GPLivePicture {
    UIImageView *picture;
    UIView *black;
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        self.backgroundColor = [UIColor blackColor];
        picture = [[UIImageView alloc] initWithFrame:self.bounds];
        picture.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        black = [[UIView alloc] initWithFrame:self.bounds];
        black.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        black.backgroundColor = [UIColor blackColor];
        [self addSubview:picture];
        [self addSubview:black];
    }
    return self;
}

- (void)showSlide:(NSDictionary *)slide theme:(NSDictionary *)theme title:(NSString *)title radius:(CGFloat)radius {
    if (slide) picture.image = GPSlidePicture(slide, theme, title, self.bounds.size, [UIColor blackColor], NO, radius);
    CGFloat alpha = slide ? 0 : 1;
    if (black.alpha == alpha) return;
    [UIView animateWithDuration:0.5 animations:^{ self->black.alpha = alpha; }];
}
@end

#pragma mark - The live column

@interface GPLivePanel : UIView
- (void)showLive:(GPLive *)live;
@property (nonatomic, readonly) UIButton *blackOut;
@end

@implementation GPLivePanel {
    GPLivePicture *shown;
    UILabel *nextLabel;
    UIImageView *next;
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        self.backgroundColor = [UIColor whiteColor];
        CGFloat w = kPanelWidth - 32;
        shown = [[GPLivePicture alloc] initWithFrame:CGRectMake(16, 16, w, round(w * 9 / 16))];
        shown.layer.borderColor = [UIColor redColor].CGColor;
        _blackOut = [UIButton buttonWithType:UIButtonTypeSystem];
        _blackOut.frame = CGRectMake(16, CGRectGetMaxY(shown.frame) + 12, w, 40);
        [_blackOut setTitle:GPText(@"live.clear", nil) forState:UIControlStateNormal];
        _blackOut.titleLabel.font = [UIFont systemFontOfSize:17];
        _blackOut.layer.borderWidth = 1;
        _blackOut.layer.cornerRadius = 20;
        nextLabel = [[UILabel alloc] initWithFrame:CGRectMake(16, CGRectGetMaxY(_blackOut.frame) + 18, w, 18)];
        nextLabel.text = GPText(@"live.nextBadge", nil);
        nextLabel.font = [UIFont boldSystemFontOfSize:12];
        nextLabel.textColor = [UIColor grayColor];
        next = [[UIImageView alloc] initWithFrame:CGRectMake(16, CGRectGetMaxY(nextLabel.frame) + 6, w, round(w * 9 / 16))];
        for (UIView *v in @[shown, _blackOut, nextLabel, next]) [self addSubview:v];
        // The line between it and the slides, as the split view's own.
        UIView *line = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 0.5, frame.size.height)];
        line.autoresizingMask = UIViewAutoresizingFlexibleHeight;
        line.backgroundColor = [UIColor colorWithWhite:0.7 alpha:1];
        [self addSubview:line];
    }
    return self;
}

- (void)showLive:(GPLive *)live {
    NSDictionary *theme = live.page[@"theme"];
    [shown showSlide:live.slide theme:theme title:live.slideTitle radius:0];
    shown.layer.borderWidth = live.slide ? 2 : 0;
    // Släck while something is shown; showing a slide again lights it (BlackButton in PhoneLayout.swift).
    _blackOut.enabled = live.slide != nil;
    _blackOut.layer.borderColor = (_blackOut.enabled ? self.tintColor : [UIColor lightGrayColor]).CGColor;
    nextLabel.hidden = next.hidden = live.nextSlide == nil;
    if (live.nextSlide) next.image = GPSlideImage(live.nextSlide, theme, live.nextTitle, next.bounds.size, [UIColor whiteColor]);
}
@end

#pragma mark - The right column

@implementation GPDetailController {
    UIViewController *slides;
    GPPageModel *model;
    GPLivePanel *panel;
}

- (GPPageModel *)model { return model; }

- (instancetype)initWithSlides:(UIViewController *)s model:(GPPageModel *)m split:(UISplitViewController *)split {
    if ((self = [super initWithNibName:nil bundle:nil])) {
        slides = s;
        model = m;
        // iOS 8's button that folds the running order away, and back.
        self.navigationItem.leftBarButtonItem = split.displayModeButtonItem;
        self.navigationItem.leftItemsSupplementBackButton = YES;
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(liveChanged) name:GPLiveChanged object:nil];
    }
    return self;
}

- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }

- (void)viewDidLoad {
    [super viewDidLoad];
    [self addChildViewController:slides];
    [self.view addSubview:slides.view];
    [slides didMoveToParentViewController:self];
    self.title = slides.title;
    panel = [[GPLivePanel alloc] initWithFrame:CGRectMake(0, 0, kPanelWidth, 600)];
    [panel.blackOut addTarget:self action:@selector(blackOut) forControlEvents:UIControlEventTouchUpInside];
    [self.view addSubview:panel];
    [self liveChanged];
}

- (void)viewWillLayoutSubviews {
    [super viewWillLayoutSubviews];
    CGRect b = self.view.bounds;
    CGFloat side = model.isLive ? kPanelWidth : 0;
    slides.view.frame = CGRectMake(0, 0, b.size.width - side, b.size.height);
    panel.frame = CGRectMake(b.size.width - side, 0, kPanelWidth, b.size.height);
    panel.hidden = !model.isLive;
}

/// ▶ or ■, the live column shown or not, and what it shows.
- (void)liveChanged {
    self.navigationItem.rightBarButtonItem = GPStartStopItem(self, model, YES);
    [panel showLive:model.live];
    [self.view setNeedsLayout];
}

- (void)blackOut { [model send:@{@"type": @"black"}]; }

// The keys, each the page's event, what it does the core's.
- (BOOL)canBecomeFirstResponder { return YES; }

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self becomeFirstResponder];
}

- (NSArray *)keyCommands { return GPKeyCommands(@selector(key:)); }
- (void)key:(UIKeyCommand *)key { NSDictionary *event = GPKeyEvent(key); if (event) [model send:event]; }
@end

#pragma mark - What both layouts share: ▶ or ■, and the keys

/// The bar button's target: ▶ sends `start`, ■ asks.
@interface GPStartStop : NSObject
@property (nonatomic, weak) UIViewController *controller;
@property (nonatomic, strong) GPPageModel *model;
@end

@implementation GPStartStop
- (void)start { [self.model send:@{@"type": @"start"}]; }
- (void)end { if (self.controller) GPAskEnd(self.controller, self.model); }
@end

UIBarButtonItem *GPStartStopItem(UIViewController *controller, GPPageModel *model, BOOL worded) {
    GPStartStop *target = [[GPStartStop alloc] init];
    target.controller = controller;
    target.model = model;
    BOOL live = model.isLive;
    NSString *text = live ? (worded ? [@"■ " stringByAppendingString:GPText(@"live.end", nil)] : @"■")
                          : (worded ? [@"▶︎ " stringByAppendingString:GPText(@"presentation.start", nil)] : @"▶︎");
    UIBarButtonItem *button = [[UIBarButtonItem alloc] initWithTitle:text style:live ? UIBarButtonItemStylePlain : UIBarButtonItemStyleDone
                                                              target:target action:live ? @selector(end) : @selector(start)];
    button.tintColor = live ? [UIColor redColor] : [UIColor colorWithRed:0.2 green:0.7 blue:0.3 alpha:1];
    button.enabled = live || model.canStart;
    // The item holds its target weakly: kept with the item.
    objc_setAssociatedObject(button, @selector(start), target, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return button;
}

void GPAskEnd(UIViewController *controller, GPPageModel *model) {
    UIAlertController *ask = [UIAlertController alertControllerWithTitle:GPText(@"live.end", nil) message:GPText(@"live.endText", nil)
                                                          preferredStyle:UIAlertControllerStyleAlert];
    [ask addAction:[UIAlertAction actionWithTitle:GPText(@"common.cancel", nil) style:UIAlertActionStyleCancel handler:nil]];
    [ask addAction:[UIAlertAction actionWithTitle:GPText(@"live.end", nil) style:UIAlertActionStyleDestructive
                                          handler:^(UIAlertAction *a) { [model liveEnded]; }]];
    [controller presentViewController:ask animated:YES completion:nil];
}

NSArray *GPKeyCommands(SEL action) {
    NSMutableArray *keys = [NSMutableArray array];
    NSArray *plain = @[UIKeyInputRightArrow, UIKeyInputLeftArrow, UIKeyInputDownArrow, UIKeyInputUpArrow, @" ", @"\r", @"b", @".", UIKeyInputEscape];
    for (NSString *input in plain) [keys addObject:[UIKeyCommand keyCommandWithInput:input modifierFlags:0 action:action]];
    for (NSString *input in @[UIKeyInputRightArrow, UIKeyInputLeftArrow, UIKeyInputDownArrow, UIKeyInputUpArrow])
        [keys addObject:[UIKeyCommand keyCommandWithInput:input modifierFlags:UIKeyModifierCommand action:action]];
    return keys;
}

NSDictionary *GPKeyEvent(UIKeyCommand *key) {
    NSString *pressed = key.input;
    BOOL command = (key.modifierFlags & UIKeyModifierCommand) != 0;
    BOOL forward = [pressed isEqual:UIKeyInputRightArrow] || [pressed isEqual:UIKeyInputDownArrow];
    BOOL back = [pressed isEqual:UIKeyInputLeftArrow] || [pressed isEqual:UIKeyInputUpArrow];
    if (command && (forward || back)) return @{@"type": @"item", @"delta": forward ? @1 : @-1};
    if (forward || back) return @{@"type": @"pick", @"delta": forward ? @1 : @-1};
    if ([pressed isEqual:@" "]) return @{@"type": @"step", @"delta": @1};
    if ([pressed isEqual:@"\r"]) return @{@"type": @"enter", @"onPage": @YES};
    if ([pressed isEqual:@"b"] || [pressed isEqual:@"."]) return @{@"type": @"black"};
    if ([pressed isEqual:UIKeyInputEscape]) return @{@"type": @"escape"};
    return nil;
}

#pragma mark - The output

@implementation GPOutput {
    GPLive *live;
    UIWindow *window;
    GPLivePicture *picture;
}

+ (void)startWithLive:(GPLive *)live {
    static GPOutput *output;
    if (output) return;
    output = [[GPOutput alloc] init];
    output->live = live;
    NSNotificationCenter *n = [NSNotificationCenter defaultCenter];
    [n addObserver:output selector:@selector(screens) name:UIScreenDidConnectNotification object:nil];
    [n addObserver:output selector:@selector(screens) name:UIScreenDidDisconnectNotification object:nil];
    [n addObserver:output selector:@selector(show) name:GPLiveChanged object:nil];
    [output screens];
}

/// A window of its own on the first external screen, in its largest mode, while there is one; else none, and the
/// iPad mirrors itself as the system does.
- (void)screens {
    UIScreen *external = [UIScreen screens].count > 1 ? [UIScreen screens][1] : nil;
    if (!external) { window.hidden = YES; window = nil; picture = nil; return; }
    if (window.screen == external) return;
    UIScreenMode *largest = external.preferredMode;
    for (UIScreenMode *m in external.availableModes) if (m.size.width * m.size.height > largest.size.width * largest.size.height) largest = m;
    external.currentMode = largest;
    external.overscanCompensation = UIScreenOverscanCompensationInsetBounds;
    window = [[UIWindow alloc] initWithFrame:external.bounds];
    window.screen = external;
    window.backgroundColor = [UIColor blackColor];
    picture = [[GPLivePicture alloc] initWithFrame:window.bounds];
    picture.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [window addSubview:picture];
    window.hidden = NO;
    NSLog(@"GPCore8: output on an external screen, %.0f x %.0f (%.0f x %.0f pixels)", external.bounds.size.width, external.bounds.size.height,
          largest.size.width, largest.size.height);
    [self show];
}

- (void)show {
    [picture showSlide:live.slide theme:live.page[@"theme"] title:live.slideTitle radius:0];
}
@end
