// OneColumn.h: the list of parts, the live block over it, and the floating +.
#import "OneColumn.h"
#import "ItemMenu.h"
#import "LivePanel.h"
#import "PresentationController.h"
#import "PresentationMenu.h"
#import "SlideView.h"
#import "Texts.h"

static const CGFloat kSide = 16, kPill = 18, kMedia = 220;

static UIFont *partFont(void) { return [UIFont systemFontOfSize:17]; }

/// A pill: a part's label in its colour, VISAS (red), NÄSTA (the tint on its pale ground), as Pill in PhoneLayout.swift.
static UILabel *pill(void) {
    UILabel *p = [[UILabel alloc] init];
    p.font = [UIFont boldSystemFontOfSize:11];
    p.textAlignment = NSTextAlignmentCenter;
    p.layer.cornerRadius = kPill / 2;
    p.layer.masksToBounds = YES;
    return p;
}

static void setPill(UILabel *p, NSString *text, UIColor *ground, UIColor *ink) {
    p.hidden = text == nil;
    if (!text) return;
    p.text = text;
    p.backgroundColor = ground;
    p.textColor = ink;
    p.bounds = CGRectMake(0, 0, ceil([text sizeWithAttributes:@{NSFontAttributeName: p.font}].width) + 16, kPill);
}

#pragma mark - A part's row

@interface GPPartCell : UITableViewCell
@property (nonatomic, readonly) UILabel *label, *mark, *words;
@property (nonatomic, readonly) UIImageView *media;
@end

@implementation GPPartCell
- (instancetype)initWithStyle:(UITableViewCellStyle)style reuseIdentifier:(NSString *)reuse {
    if ((self = [super initWithStyle:UITableViewCellStyleDefault reuseIdentifier:reuse])) {
        _label = pill();
        _mark = pill();
        _words = [[UILabel alloc] init];
        _words.font = partFont();
        _words.numberOfLines = 0;
        _media = [[UIImageView alloc] init];
        for (UIView *v in @[_label, _mark, _words, _media]) [self.contentView addSubview:v];
        self.selectionStyle = UITableViewCellSelectionStyleNone;   // marked by its ground, as the native app's
    }
    return self;
}

- (void)layoutSubviews {
    [super layoutSubviews];
    CGFloat w = self.contentView.bounds.size.width - 2 * kSide, y = 8;
    BOOL pills = !self.label.hidden || !self.mark.hidden;
    self.label.frame = CGRectMake(kSide, y, self.label.bounds.size.width, kPill);
    self.mark.frame = CGRectMake(kSide + w - self.mark.bounds.size.width, y, self.mark.bounds.size.width, kPill);
    if (pills) y += kPill + 6;
    if (!self.media.hidden) self.media.frame = CGRectMake(kSide, y, kMedia, round(kMedia * 9 / 16));
    // At the top, as tall as its lines: given just the height measured, a label cut its second line to "…".
    CGSize fits = [self.words sizeThatFits:CGSizeMake(w, CGFLOAT_MAX)];
    self.words.frame = CGRectMake(kSide, y, w, ceil(fits.height));
}
@end

#pragma mark - An item's heading

@interface GPItemHeader : UITableViewHeaderFooterView
@property (nonatomic, readonly) UILabel *name;
@property (nonatomic, readonly) UIView *dot;
@property (nonatomic, readonly) UIButton *more;
@property (nonatomic, copy) void (^onMore)(UIButton *more);
@end

@implementation GPItemHeader
- (instancetype)initWithReuseIdentifier:(NSString *)reuse {
    if ((self = [super initWithReuseIdentifier:reuse])) {
        _dot = [[UIView alloc] init];
        _dot.backgroundColor = [UIColor redColor];
        _dot.layer.cornerRadius = 3.5;
        _name = [[UILabel alloc] init];
        _name.font = [UIFont boldSystemFontOfSize:13];
        _more = [UIButton buttonWithType:UIButtonTypeSystem];
        [_more setTitle:@"•••" forState:UIControlStateNormal];
        _more.titleLabel.font = [UIFont boldSystemFontOfSize:13];
        [_more addTarget:self action:@selector(tapped) forControlEvents:UIControlEventTouchUpInside];
        for (UIView *v in @[_dot, _name, _more]) [self.contentView addSubview:v];
    }
    return self;
}

- (void)tapped { if (self.onMore) self.onMore(self.more); }

- (void)layoutSubviews {
    [super layoutSubviews];
    CGRect b = self.contentView.bounds;
    CGFloat x = kSide;
    self.dot.frame = CGRectMake(x, (b.size.height - 7) / 2, 7, 7);
    if (!self.dot.hidden) x += 13;
    self.more.frame = CGRectMake(b.size.width - 44 - kSide + 10, 0, 44, b.size.height);
    self.name.frame = CGRectMake(x, 0, self.more.frame.origin.x - x - 8, b.size.height);
}
@end

#pragma mark - The column

@implementation GPOneColumnController {
    GPPageModel *model;
    NSDictionary *page;
    NSArray *items;
    UITableView *table;
    UIView *liveBlock;
    GPLivePicture *picture;
    UIButton *blackOut, *plus;
    NSString *followed;       // the part shown the list last followed
    BOOL tapped;              // the part shown was tapped in the list: it is in view, not followed
    NSDictionary *standing;   // the items on the screen before a reload, each its section's distance below the top
}

- (instancetype)initWithModel:(GPPageModel *)m {
    if ((self = [super initWithNibName:nil bundle:nil])) {
        model = m;
        page = m.page;
        items = page[@"items"];
        GPTitleMenu(self, m, 420);
        __weak GPOneColumnController *me = self;
        m.onScreen = ^NSArray *{ return [me itemsOnScreen]; };
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(liveChanged) name:GPLiveChanged object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(pageChanged:) name:GPPageChanged object:m];
    }
    return self;
}

- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor whiteColor];
    table = [[UITableView alloc] initWithFrame:self.view.bounds style:UITableViewStylePlain];
    table.dataSource = (id<UITableViewDataSource>)self;
    table.delegate = (id<UITableViewDelegate>)self;
    [table registerClass:[GPPartCell class] forCellReuseIdentifier:@"part"];
    [table registerClass:[GPItemHeader class] forHeaderFooterViewReuseIdentifier:@"item"];
    // Room at the foot, so the last item's ••• scrolls clear of the +.
    table.tableFooterView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 88)];
    [self.view addSubview:table];
    liveBlock = [[UIView alloc] init];
    liveBlock.backgroundColor = [UIColor colorWithRed:0xF7 / 255.0 green:0xF7 / 255.0 blue:0xF7 / 255.0 alpha:1];
    picture = [[GPLivePicture alloc] init];
    blackOut = [UIButton buttonWithType:UIButtonTypeSystem];
    [blackOut setTitle:GPText(@"live.clear", nil) forState:UIControlStateNormal];
    blackOut.titleLabel.font = [UIFont systemFontOfSize:17];
    blackOut.layer.borderWidth = 1;
    blackOut.layer.cornerRadius = 20;
    [blackOut addTarget:self action:@selector(black) forControlEvents:UIControlEventTouchUpInside];
    [liveBlock addSubview:picture];
    [liveBlock addSubview:blackOut];
    [self.view addSubview:liveBlock];
    plus = [UIButton buttonWithType:UIButtonTypeCustom];
    plus.backgroundColor = GPTint();
    plus.layer.cornerRadius = 28;
    plus.layer.shadowOpacity = 0.25;
    plus.layer.shadowRadius = 4;
    plus.layer.shadowOffset = CGSizeMake(0, 2);
    [plus setTitle:@"+" forState:UIControlStateNormal];
    plus.titleLabel.font = [UIFont systemFontOfSize:34 weight:UIFontWeightLight];
    [plus addTarget:self action:@selector(add) forControlEvents:UIControlEventTouchUpInside];
    [self.view addSubview:plus];
    [self liveChanged];
}

/// While presenting the live block over the list: the picture half the width at the left, Släck at its right.
- (void)viewWillLayoutSubviews {
    [super viewWillLayoutSubviews];
    CGRect b = self.view.bounds;
    CGFloat top = 0;
    if (model.isLive) {
        CGFloat w = floor((b.size.width - 3 * kSide) / 2), h = round(w * 9 / 16);
        liveBlock.frame = CGRectMake(0, 0, b.size.width, h + 20);
        picture.frame = CGRectMake(kSide, 10, w, h);
        blackOut.frame = CGRectMake(2 * kSide + w, 10, w, 40);
        top = h + 20;
    }
    liveBlock.hidden = !model.isLive;
    table.frame = CGRectMake(0, top, b.size.width, b.size.height - top);
    plus.frame = CGRectMake(b.size.width - 56 - 20, b.size.height - 56 - 20, 56, 56);
}

- (void)add { GPAddMenu(self, nil, plus, plus.bounds, nil, model); }
- (void)black { [model send:@{@"type": @"black"}]; }

/// ▶ or ■, the live block, the marks; and the part shown brought into view when it changed some other way than a tap
/// in the list (a key, Släck's neighbour, a remote control), as PhoneLayout's onChange of shownKey.
- (void)liveChanged {
    self.navigationItem.rightBarButtonItem = GPStartStopItem(self, model, NO);
    GPLive *live = model.live;
    if (model.isLive) [picture showSlide:live.slide theme:live.page[@"theme"] title:live.slideTitle radius:0];
    blackOut.enabled = live.slide != nil;
    blackOut.layer.borderColor = (blackOut.enabled ? GPTint() : [UIColor lightGrayColor]).CGColor;
    [table reloadData];
    [self.view setNeedsLayout];
    NSString *shown = model.isLive ? live.shownKey : nil;
    if (shown && ![shown isEqual:followed]) {
        followed = shown;
        NSIndexPath *at = [self pathOf:shown];
        if (at && !tapped) [table scrollToRowAtIndexPath:at atScrollPosition:UITableViewScrollPositionMiddle animated:NO];
    }
    if (!shown) followed = nil;
    tapped = NO;
}

- (NSIndexPath *)pathOf:(NSString *)key {
    for (NSInteger s = 0; s < (NSInteger)items.count; s++) {
        NSInteger n = (NSInteger)GPSlidesOf(page, items[s]).count;
        for (NSInteger r = 0; r < n; r++) if ([GPSlideKey(items[s][@"id"], r) isEqual:key]) return [NSIndexPath indexPathForRow:r inSection:s];
    }
    return nil;
}

#pragma mark - The page read again, where it stands

- (NSArray *)itemsOnScreen {
    if (!table.window) return @[];
    CGFloat top = table.contentOffset.y + table.contentInset.top, bottom = table.contentOffset.y + table.bounds.size.height;
    NSMutableArray *ids = [NSMutableArray array];
    NSMutableDictionary *at = [NSMutableDictionary dictionary];
    for (NSInteger s = 0; s < (NSInteger)items.count; s++) {
        CGRect r = [table rectForSection:s];
        if (CGRectGetMaxY(r) <= top || r.origin.y >= bottom) continue;
        [ids addObject:items[s][@"id"]];
        at[items[s][@"id"]] = @(r.origin.y - top);
    }
    standing = at;
    return ids;
}

- (void)pageChanged:(NSNotification *)note {
    page = model.page;
    items = page[@"items"];
    GPTitleName(self, page[@"presentation"][@"name"]);
    [table reloadData];
    NSString *stay = note.userInfo[@"stay"];
    NSUInteger index = stay ? [[items valueForKey:@"id"] indexOfObject:stay] : NSNotFound;
    if (index == NSNotFound || !standing[stay]) return;
    [table layoutIfNeeded];
    CGFloat top = -table.contentInset.top;
    CGFloat bottom = MAX(top, table.contentSize.height + table.contentInset.bottom - table.bounds.size.height);
    CGFloat y = [table rectForSection:(NSInteger)index].origin.y - [standing[stay] doubleValue] + top;
    [table setContentOffset:CGPointMake(0, MIN(MAX(top, y), bottom)) animated:NO];
}

#pragma mark - The list

- (NSInteger)numberOfSectionsInTableView:(UITableView *)t { return (NSInteger)items.count; }
- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)GPSlidesOf(page, items[s]).count; }
- (CGFloat)tableView:(UITableView *)t heightForHeaderInSection:(NSInteger)s { return 36; }

- (UIView *)tableView:(UITableView *)t viewForHeaderInSection:(NSInteger)s {
    GPItemHeader *h = [t dequeueReusableHeaderFooterViewWithIdentifier:@"item"];
    NSDictionary *item = items[s];
    NSString *problem = GPItemProblem(page, item);
    NSString *note = [item[@"note"] isKindOfClass:[NSString class]] && [item[@"note"] length] ? item[@"note"] : nil;
    NSMutableAttributedString *name = [[NSMutableAttributedString alloc] initWithString:item[@"title"] ?: @""];
    if (note) [name appendAttributedString:[[NSAttributedString alloc] initWithString:[@"  " stringByAppendingString:note]
                                                                           attributes:@{NSForegroundColorAttributeName: [UIColor orangeColor]}]];
    if (problem) [name appendAttributedString:[[NSAttributedString alloc] initWithString:[@" · " stringByAppendingString:problem]
                                                                              attributes:@{NSForegroundColorAttributeName: [UIColor grayColor]}]];
    h.name.attributedText = name;
    h.dot.hidden = !(model.isLive && [model.liveItemId isEqual:item[@"id"]]);
    __weak GPOneColumnController *me = self;
    GPPageModel *m = model;
    h.onMore = ^(UIButton *more) { GPOneColumnController *c = me; if (c) GPItemMenu(c, more, more.bounds, item, m); };
    [h setNeedsLayout];
    return h;
}

- (NSDictionary *)slideAt:(NSIndexPath *)at { return GPSlidesOf(page, items[at.section])[at.row]; }
- (BOOL)isMedia:(NSDictionary *)slide { return [slide[@"kind"] isEqual:@"media"]; }
- (NSString *)wordsOf:(NSDictionary *)slide { return [slide[@"text"] isKindOfClass:[NSString class]] ? slide[@"text"] : @""; }

/// "shown", "next" or nil, as the slides' tiles are marked.
- (NSString *)markAt:(NSIndexPath *)at {
    if (!model.isLive) return nil;
    NSString *key = GPSlideKey(items[at.section][@"id"], at.row);
    return [key isEqual:model.live.shownKey] ? @"shown" : [key isEqual:model.live.nextKey] ? @"next" : nil;
}

- (CGFloat)tableView:(UITableView *)t heightForRowAtIndexPath:(NSIndexPath *)at {
    NSDictionary *slide = [self slideAt:at];
    BOOL pills = [slide[@"label"] isKindOfClass:[NSDictionary class]] || [self markAt:at];
    CGFloat body = [self isMedia:slide] ? round(kMedia * 9 / 16)
        : ceil([[self wordsOf:slide] boundingRectWithSize:CGSizeMake(t.bounds.size.width - 2 * kSide, CGFLOAT_MAX)
                                                  options:NSStringDrawingUsesLineFragmentOrigin attributes:@{NSFontAttributeName: partFont()} context:nil].size.height);
    return 8 + (pills ? kPill + 6 : 0) + MAX(body, 22) + 10;
}

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    GPPartCell *cell = [t dequeueReusableCellWithIdentifier:@"part" forIndexPath:at];
    NSDictionary *slide = [self slideAt:at], *label = [slide[@"label"] isKindOfClass:[NSDictionary class]] ? slide[@"label"] : nil;
    setPill(cell.label, label[@"text"], label ? GPColor(label[@"color"]) : nil, [UIColor whiteColor]);
    NSString *mark = [self markAt:at];
    BOOL shown = [mark isEqual:@"shown"];
    setPill(cell.mark, mark ? GPText(shown ? @"live.shownBadge" : @"live.nextBadge", nil) : nil,
            shown ? [UIColor redColor] : [GPTint() colorWithAlphaComponent:0.15], shown ? [UIColor whiteColor] : GPTint());
    BOOL media = [self isMedia:slide];
    cell.media.hidden = !media;
    cell.words.hidden = media;
    if (media) cell.media.image = GPSlideImage(slide, page[@"theme"], items[at.section][@"title"], CGSizeMake(kMedia, round(kMedia * 9 / 16)), [UIColor whiteColor]);
    else cell.words.text = [self wordsOf:slide];
    BOOL picked = [GPSlideKey(items[at.section][@"id"], at.row) isEqual:model.pickedKey];
    cell.backgroundColor = shown ? [[UIColor redColor] colorWithAlphaComponent:0.14] : picked ? [GPTint() colorWithAlphaComponent:0.16] : [UIColor whiteColor];
    [cell setNeedsLayout];
    return cell;
}

/// A tap: shown while presenting; before, made ready and its item selected, so + adds after it.
- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    tapped = YES;
    [model send:@{@"type": @"show", @"itemId": items[at.section][@"id"], @"partIndex": @(at.row)}];
    tapped = NO;
}

#pragma mark - Keys

- (BOOL)canBecomeFirstResponder { return YES; }

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self becomeFirstResponder];
}

- (NSArray *)keyCommands { return GPKeyCommands(@selector(key:)); }
- (void)key:(UIKeyCommand *)key { NSDictionary *event = GPKeyEvent(key); if (event) [model send:event]; }
@end
