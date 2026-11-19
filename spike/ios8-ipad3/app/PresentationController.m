// The presentation page with iOS 8's own parts, laid out as the Settings app on an iPad: a UISplitViewController,
// both columns shown, the left one 320 pt; at the left the running order as a grouped UITableView, every item a row
// with a coloured 29 pt icon and a song's number of slides; at the right a UICollectionView of slide tiles 300 to 384
// pt wide on the grouped table's grey, each item a section headed as a grouped table heads one. A row brings its
// item's slides to the top, the slides scrolled choose their row; a tile tapped is the page's `show` event, and the
// core's marks (VISAS, NÄSTA, the slide made ready) are drawn over the tiles (Live.m).
#import "PresentationController.h"
#import "ItemMenu.h"
#import "PresentationMenu.h"
#import "LivePanel.h"
#import "SlideView.h"
#import "Texts.h"

UIColor *GPTint(void) { return [UIColor colorWithRed:0.055 green:0.647 blue:0.914 alpha:1]; }

static UIColor *rgb(unsigned hex) {
    return [UIColor colorWithRed:(hex >> 16 & 255) / 255.0 green:(hex >> 8 & 255) / 255.0 blue:(hex & 255) / 255.0 alpha:1];
}

/// The Settings app's kind of icon: a glyph in white on a rounded square of the type's colour (iOS 8's palette).
static UIImage *iconFor(NSString *type) {
    static NSMutableDictionary *made;
    if (!made) made = [NSMutableDictionary dictionary];
    if (made[type]) return made[type];
    NSDictionary *looks = @{@"song": @[@"♪", @0xFF2D55], @"video": @[@"▶︎", @0xFF3B30], @"audio": @[@"◉", @0xFF9500],
                            @"image": @[@"▣", @0x5856D6], @"bible": @[@"✚", @0x4CD964], @"header": @[@"¶", @0x8E8E93]};
    NSArray *look = looks[type] ?: @[@"▢", @0x8E8E93];
    CGRect box = CGRectMake(0, 0, 29, 29);
    UIGraphicsBeginImageContextWithOptions(box.size, NO, 0);
    [rgb([look[1] unsignedIntValue]) setFill];
    [[UIBezierPath bezierPathWithRoundedRect:box cornerRadius:6.5] fill];
    NSDictionary *attributes = @{NSFontAttributeName: [UIFont boldSystemFontOfSize:17], NSForegroundColorAttributeName: [UIColor whiteColor]};
    CGSize size = [look[0] sizeWithAttributes:attributes];
    [look[0] drawAtPoint:CGPointMake((29 - size.width) / 2, (29 - size.height) / 2) withAttributes:attributes];
    UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    made[type] = image;
    return image;
}

static NSArray *slidesOf(NSDictionary *page, NSDictionary *item) {
    NSArray *slides = page[@"slides"][item[@"id"]][@"slides"];
    return [slides isKindOfClass:[NSArray class]] ? slides : @[];
}

static BOOL isHeader(NSDictionary *item) { return [item[@"type"] isEqual:@"header"]; }

#pragma mark - The slides

/// A tile: the slide's picture (GPSlideImage, drawn once); over it the core's marks, VISAS (red) or NÄSTA (dark) in
/// its corner, and a ring around it, red for the slide shown and the tint for the one made ready (SlideTile in
/// Thumbnails.swift). The marks have rounded corners and no clip, which the GPU draws without an offscreen pass.
@interface GPSlideCell : UICollectionViewCell
@property (nonatomic, readonly) UIImageView *picture;
/// "shown", "next" or nil; and whether it is the slide made ready.
- (void)mark:(NSString *)mark picked:(BOOL)picked;
@end

@implementation GPSlideCell {
    UIView *outline, *pill;
    UILabel *pillText;
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _picture = [[UIImageView alloc] initWithFrame:self.contentView.bounds];
        _picture.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        _picture.opaque = YES;
        [self.contentView addSubview:_picture];
        outline = [[UIView alloc] initWithFrame:CGRectInset(self.bounds, -5, -5)];
        outline.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        outline.layer.borderWidth = 3;
        outline.layer.cornerRadius = 8;
        outline.userInteractionEnabled = NO;
        outline.hidden = YES;
        [self addSubview:outline];
        pill = [[UIView alloc] init];
        pill.layer.cornerRadius = 4;
        pill.hidden = YES;
        pillText = [[UILabel alloc] init];
        pillText.font = [UIFont boldSystemFontOfSize:11];
        pillText.textColor = [UIColor whiteColor];
        [pill addSubview:pillText];
        [self.contentView addSubview:pill];
    }
    return self;
}

- (void)mark:(NSString *)mark picked:(BOOL)picked {
    BOOL shown = [mark isEqual:@"shown"];
    outline.hidden = !(picked || shown);
    outline.layer.borderColor = (picked ? GPTint() : [UIColor redColor]).CGColor;
    pill.hidden = mark == nil;
    if (!mark) return;
    pillText.text = GPText(shown ? @"live.shownBadge" : @"live.nextBadge", nil);
    [pillText sizeToFit];
    pill.backgroundColor = shown ? [UIColor redColor] : [UIColor colorWithWhite:0 alpha:0.6];
    // At the top right: the part's label is drawn in the picture's top left.
    CGSize size = pillText.bounds.size;
    pill.frame = CGRectMake(self.contentView.bounds.size.width - size.width - 18, 8, size.width + 10, size.height + 4);
    pillText.frame = CGRectMake(5, 2, size.width, size.height);
}
@end

@interface GPHeadingView : UICollectionReusableView
@property (nonatomic, readonly) UILabel *title;
/// The item's menu, from its … at the heading's end, as WideLayout's heading has one.
@property (nonatomic, readonly) UIButton *more;
@property (nonatomic, copy) void (^onMore)(UIButton *more);
@end

@implementation GPHeadingView
- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _title = [[UILabel alloc] initWithFrame:CGRectMake(28, 0, frame.size.width - 100, frame.size.height - 6)];
        _title.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        [self addSubview:_title];
        _more = [UIButton buttonWithType:UIButtonTypeSystem];
        _more.frame = CGRectMake(frame.size.width - 72, 0, 44, frame.size.height - 6);
        _more.autoresizingMask = UIViewAutoresizingFlexibleLeftMargin | UIViewAutoresizingFlexibleHeight;
        [_more setTitle:@"•••" forState:UIControlStateNormal];
        _more.titleLabel.font = [UIFont boldSystemFontOfSize:13];
        [_more addTarget:self action:@selector(tappedMore) forControlEvents:UIControlEventTouchUpInside];
        [self addSubview:_more];
    }
    return self;
}

- (void)tappedMore { if (self.onMore) self.onMore(self.more); }

/// An item's heading as a grouped table's (13 pt, capitals, grey), a programme point's as every other item's.
- (void)showItem:(NSDictionary *)item problem:(NSString *)problem {
    NSString *text = problem ? [NSString stringWithFormat:@"%@ · %@", item[@"title"], problem] : item[@"title"];
    _title.text = text.uppercaseString;
    _title.font = [UIFont systemFontOfSize:13];
    _title.textColor = rgb(0x6D6D72);
}
@end

/// A flow layout whose rows stand at the left, 18 pt apart: a plain one centres a row of one and spreads one that is
/// not full.
@interface GPLeftFlowLayout : UICollectionViewFlowLayout
@end

@implementation GPLeftFlowLayout
- (NSArray *)layoutAttributesForElementsInRect:(CGRect)rect {
    NSMutableArray *out = [NSMutableArray array];
    CGFloat rowY = -1, x = 0;
    for (UICollectionViewLayoutAttributes *a in [super layoutAttributesForElementsInRect:rect]) {
        UICollectionViewLayoutAttributes *b = [a copy];
        if (b.representedElementCategory == UICollectionElementCategoryCell) {
            if (b.frame.origin.y != rowY) { rowY = b.frame.origin.y; x = self.sectionInset.left; }
            b.frame = CGRectMake(x, b.frame.origin.y, b.frame.size.width, b.frame.size.height);
            x += b.frame.size.width + self.minimumInteritemSpacing;
        }
        [out addObject:b];
    }
    return out;
}
@end

@class GPItemsController;

@interface GPSlidesController : UICollectionViewController <UICollectionViewDelegateFlowLayout>
@property (nonatomic, weak) GPItemsController *runningOrder;
- (instancetype)initWithModel:(GPPageModel *)model;
- (void)scrollToItem:(NSInteger)index;
@end

#pragma mark - The running order

@interface GPItemsController : UITableViewController
@property (nonatomic, weak) GPSlidesController *slides;
- (instancetype)initWithModel:(GPPageModel *)model;
- (void)selectItem:(NSInteger)index;
/// The presentation it shows.
- (NSString *)presentationId;
@end

@implementation GPItemsController {
    GPPageModel *model;
    NSDictionary *page;
    NSArray *items;
}

- (instancetype)initWithModel:(GPPageModel *)m {
    if ((self = [super initWithStyle:UITableViewStyleGrouped])) {
        model = m;
        page = m.page;
        items = page[@"items"];
        // The title a button, as the native app's: the presentation's menu (PresentationMenu.m).
        UIButton *name = [UIButton buttonWithType:UIButtonTypeSystem];
        name.titleLabel.font = [UIFont boldSystemFontOfSize:17];
        name.titleLabel.lineBreakMode = NSLineBreakByTruncatingTail;
        [name setTitleColor:[UIColor blackColor] forState:UIControlStateNormal];
        [name addTarget:self action:@selector(menu:) forControlEvents:UIControlEventTouchUpInside];
        self.navigationItem.titleView = name;
        [self name:page[@"presentation"][@"name"]];
        // + in the bar: Sång, Programpunkt (ItemMenu.m).
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemAdd
                                                                                               target:self action:@selector(add:)];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(liveChanged) name:GPLiveChanged object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(pageChanged) name:GPPageChanged object:m];
    }
    return self;
}

- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }

- (void)add:(UIBarButtonItem *)button { GPAddMenu(self, button, nil, CGRectZero, nil, model); }

- (void)menu:(UIButton *)button { GPPresentationMenu(self, button, model); }

/// The title and its button, no wider than the bar leaves between ‹ and + in the 320 pt column.
- (void)name:(NSString *)text {
    self.title = text;
    UIButton *name = (UIButton *)self.navigationItem.titleView;
    [name setTitle:text forState:UIControlStateNormal];
    CGSize fits = [name sizeThatFits:CGSizeMake(CGFLOAT_MAX, 44)];
    name.frame = CGRectMake(0, 0, MIN(fits.width, 190), 44);
}

/// The item shown gets its red dot, the selection kept.
- (void)liveChanged {
    NSIndexPath *chosen = self.tableView.indexPathForSelectedRow;
    [self.tableView reloadData];
    if (chosen && chosen.row < (NSInteger)items.count) [self.tableView selectRowAtIndexPath:chosen animated:NO scrollPosition:UITableViewScrollPositionNone];
}

/// The page read again: its items, the title, the day.
- (void)pageChanged {
    page = model.page;
    items = page[@"items"];
    [self name:page[@"presentation"][@"name"]];
    ((UILabel *)self.tableView.tableHeaderView).text = GPWhen(page[@"presentation"]);
    [self liveChanged];
}

/// The presentation's day and time over its one group, as a grouped table's note reads: "söndag 8 november 2026 ·
/// 11:00". A long press on a row opens its item's menu.
- (void)viewDidLoad {
    [super viewDidLoad];
    UILabel *when = [[UILabel alloc] initWithFrame:CGRectMake(0, 0, 320, 44)];
    when.text = GPWhen(page[@"presentation"]);
    when.textAlignment = NSTextAlignmentCenter;
    when.font = [UIFont systemFontOfSize:13];
    when.textColor = rgb(0x6D6D72);
    self.tableView.tableHeaderView = when;
    [self.tableView addGestureRecognizer:[[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(pressed:)]];
}

- (void)pressed:(UILongPressGestureRecognizer *)press {
    if (press.state != UIGestureRecognizerStateBegan) return;
    NSIndexPath *at = [self.tableView indexPathForRowAtPoint:[press locationInView:self.tableView]];
    if (!at) return;
    GPItemMenu(self, self.tableView, [self.tableView rectForRowAtIndexPath:at], items[at.row], model);
}

// One group, every item a row in the order presented, a programme point (type "header") as much a row as a song.
- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)items.count; }

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    UITableViewCell *cell = [t dequeueReusableCellWithIdentifier:@"item"]
        ?: [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleValue1 reuseIdentifier:@"item"];
    NSDictionary *item = items[at.row];
    cell.imageView.image = iconFor(item[@"type"]);
    cell.textLabel.text = item[@"title"];
    NSUInteger n = slidesOf(page, item).count;
    cell.detailTextLabel.text = [item[@"type"] isEqual:@"song"] ? [NSString stringWithFormat:@"%lu", (unsigned long)n] : nil;
    // The item shown while presenting: a small red dot in the margin before its icon, as WideLayout's row has it. A
    // picture, not a background colour: a cell chosen clears its subviews' backgrounds, and the dot went with it.
    static UIImage *red;
    if (!red) {
        UIGraphicsBeginImageContextWithOptions(CGSizeMake(7, 7), NO, 0);
        [[UIColor redColor] setFill];
        [[UIBezierPath bezierPathWithOvalInRect:CGRectMake(0, 0, 7, 7)] fill];
        red = UIGraphicsGetImageFromCurrentImageContext();
        UIGraphicsEndImageContext();
    }
    UIImageView *dot = (UIImageView *)[cell.contentView viewWithTag:7];
    if (!dot) {
        dot = [[UIImageView alloc] initWithImage:red];
        dot.frame = CGRectMake(4, 18, 7, 7);
        dot.tag = 7;
        [cell.contentView addSubview:dot];
    }
    dot.hidden = !(model.isLive && [model.liveItemId isEqual:item[@"id"]]);
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    [model send:@{@"type": @"select", @"itemId": items[at.row][@"id"]}];
    [self.slides scrollToItem:at.row];
}

- (NSString *)presentationId { return page[@"presentation"][@"id"]; }

- (void)selectItem:(NSInteger)index {
    NSIndexPath *at = [NSIndexPath indexPathForRow:index inSection:0];
    if (![self.tableView.indexPathForSelectedRow isEqual:at])
        [self.tableView selectRowAtIndexPath:at animated:NO scrollPosition:UITableViewScrollPositionNone];
}
@end

#pragma mark - The slides' column

static NSString *const kSlide = @"slide", *const kHeading = @"heading";

@implementation GPSlidesController {
    GPPageModel *model;
    NSDictionary *page;
    NSArray *items;
    NSString *followedSelection;   // the item the core last selected, which the slides were brought to
    BOOL following;   // jumped to a row's item: the row stays chosen until the slides are dragged
    CGFloat laidOutWidth;
    BOOL appeared;
    NSInteger drawingRound;   // drawAhead's: a round whose number is no longer this stops
    NSString *namedId;        // the item the column is named after, named again when the page changes
    NSDictionary *standing;   // each item on the screen: how far its heading stood below the top, before a reload
}

/// The items on the screen, the top first, each one's place noted in `standing` (onScreen, for the core's `changed`).
- (NSArray *)itemsOnScreen {
    if (!appeared) return @[];
    UICollectionView *c = self.collectionView;
    CGFloat top = c.contentOffset.y + c.contentInset.top, bottom = c.contentOffset.y + c.bounds.size.height;
    NSMutableArray *ids = [NSMutableArray array];
    NSMutableDictionary *at = [NSMutableDictionary dictionary];
    for (NSInteger i = 0; i < (NSInteger)items.count; i++) {
        CGFloat from = [self headingAt:i], to = i + 1 < (NSInteger)items.count ? [self headingAt:i + 1] : c.contentSize.height;
        if (to <= top || from >= bottom) continue;
        [ids addObject:items[i][@"id"]];
        at[items[i][@"id"]] = @(from - top);
    }
    standing = at;
    return ids;
}

- (CGFloat)headingAt:(NSInteger)section {
    return [self.collectionViewLayout layoutAttributesForSupplementaryViewOfKind:UICollectionElementKindSectionHeader
                                                                     atIndexPath:[NSIndexPath indexPathForItem:0 inSection:section]].frame.origin.y;
}

- (void)nameAfter:(NSInteger)index {
    NSDictionary *item = index < (NSInteger)items.count ? items[index] : nil;
    namedId = item[@"id"];
    self.title = item[@"title"];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    appeared = YES;
    [self scrollViewDidScroll:self.collectionView];
    [self drawAhead];
}

/// Every slide's picture drawn on a thread of its own, in the order presented, at the tiles' size now, so that the
/// main thread finds them drawn when the slides scroll into view (it drew them as they came, the first time through,
/// and the render server drew 56 frames a second, not 60). Begun again when the size changes; an older round stops.
- (void)drawAhead {
    NSIndexPath *first = [NSIndexPath indexPathForItem:0 inSection:0];
    CGSize size = [self collectionView:self.collectionView layout:self.collectionViewLayout sizeForItemAtIndexPath:first];
    UIColor *ground = self.collectionView.backgroundColor;
    NSInteger round = ++drawingRound;
    NSDictionary *p = page;
    __weak GPSlidesController *me = self;
    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_LOW, 0), ^{
        NSDate *t = [NSDate date];
        NSInteger n = 0;
        for (NSDictionary *item in p[@"items"]) {
            for (NSDictionary *slide in slidesOf(p, item)) {
                GPSlidesController *still = me;
                if (!still || still->drawingRound != round) return;
                GPSlideImage(slide, p[@"theme"], item[@"title"], size, ground);
                n++;
            }
        }
        NSLog(@"GPCore8: drew %ld slides ahead at %.0f x %.0f in %.0f ms", (long)n, size.width, size.height, -[t timeIntervalSinceNow] * 1000);
    });
}

- (instancetype)initWithModel:(GPPageModel *)m {
    GPLeftFlowLayout *flow = [[GPLeftFlowLayout alloc] init];
    flow.minimumInteritemSpacing = 18;
    flow.minimumLineSpacing = 18;
    flow.sectionInset = UIEdgeInsetsMake(0, 28, 28, 28);
    flow.headerReferenceSize = CGSizeMake(100, 44);
    if ((self = [super initWithCollectionViewLayout:flow])) {
        model = m;
        page = m.page;
        items = page[@"items"];
        followedSelection = m.state[@"selectedId"];
        [self nameAfter:0];
        __weak GPSlidesController *me = self;
        m.onScreen = ^NSArray *{ return [me itemsOnScreen]; };
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(liveChanged) name:GPLiveChanged object:nil];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(pageChanged:) name:GPPageChanged object:m];
    }
    return self;
}

- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; }

/// The column is named after its item; in the container (LivePanel.m) the container's bar shows the name.
- (void)setTitle:(NSString *)title {
    [super setTitle:title];
    self.parentViewController.title = title;
}

/// The marks of the tiles on screen as the live state and the page's state now have them; the slides brought to an
/// item the core selected (a key stepping into the next item, a slide of another item shown), as WideLayout scrolls.
- (void)liveChanged {
    for (GPSlideCell *cell in self.collectionView.visibleCells) {
        NSIndexPath *at = [self.collectionView indexPathForCell:cell];
        if (at) [self markCell:cell at:at];
    }
    NSString *selected = [model.state[@"selectedId"] isKindOfClass:[NSString class]] ? model.state[@"selectedId"] : nil;
    if (selected && ![selected isEqual:followedSelection]) {
        followedSelection = selected;
        NSUInteger index = [[items valueForKey:@"id"] indexOfObject:selected];
        if (index != NSNotFound) { [self scrollToItem:(NSInteger)index]; [self.runningOrder selectItem:(NSInteger)index]; }
    }
}

- (void)markCell:(GPSlideCell *)cell at:(NSIndexPath *)at {
    NSString *key = GPSlideKey(items[at.section][@"id"], at.item);
    GPLive *live = model.live;
    NSString *mark = !model.isLive ? nil : [key isEqual:live.shownKey] ? @"shown" : [key isEqual:live.nextKey] ? @"next" : nil;
    [cell mark:mark picked:[key isEqual:model.pickedKey]];
}

/// A tap: the page's `show` event; before presenting it makes the slide ready, while presenting it shows it.
- (void)collectionView:(UICollectionView *)c didSelectItemAtIndexPath:(NSIndexPath *)at {
    [c deselectItemAtIndexPath:at animated:NO];
    [model send:@{@"type": @"show", @"itemId": items[at.section][@"id"], @"partIndex": @(at.item)}];
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.collectionView.backgroundColor = rgb(0xEFEFF4);
    self.collectionView.alwaysBounceVertical = YES;
    [self.collectionView registerClass:[GPSlideCell class] forCellWithReuseIdentifier:kSlide];
    [self.collectionView registerClass:[GPHeadingView class] forSupplementaryViewOfKind:UICollectionElementKindSectionHeader withReuseIdentifier:kHeading];
}

/// The tiles' size follows the width: the layout made again when it changes, and only then (the collection view is
/// this controller's view, so invalidating it lays it out again, which calls this again).
- (void)viewWillLayoutSubviews {
    [super viewWillLayoutSubviews];
    if (self.collectionView.bounds.size.width == laidOutWidth) return;
    laidOutWidth = self.collectionView.bounds.size.width;
    NSLog(@"GPCore8: slides %.0f pt wide, the order %@, the bar %ld", laidOutWidth,
          self.splitViewController.displayMode == UISplitViewControllerDisplayModeAllVisible ? @"shown" : @"hidden",
          (long)[UIApplication sharedApplication].statusBarOrientation);
    [self.collectionViewLayout invalidateLayout];
    if (appeared) [self drawAhead];   // turned: the tiles have another size
}

- (NSInteger)numberOfSectionsInCollectionView:(UICollectionView *)c { return (NSInteger)items.count; }
- (NSInteger)collectionView:(UICollectionView *)c numberOfItemsInSection:(NSInteger)s { return (NSInteger)slidesOf(page, items[s]).count; }

/// 384 pt, shrunk where that fits one more to a row, as the web's SlideGrid does, but to no less than 300 pt where
/// the web stops at 340 (Lars): lying down, the 703 pt column takes two of 314 pt, not one of 384 and half of it
/// empty; standing, one of 384; the running order folded away, three of 310.
- (CGSize)collectionView:(UICollectionView *)c layout:(UICollectionViewLayout *)l sizeForItemAtIndexPath:(NSIndexPath *)at {
    CGFloat available = c.bounds.size.width - 56, spacing = 18;
    NSInteger columns = MAX(1, (NSInteger)((available + spacing) / (300 + spacing)));
    CGFloat width = floor(MIN(384, (available - spacing * (columns - 1)) / columns));
    return CGSizeMake(width, round(width * 9 / 16));
}

/// A programme point has no slides: less room under its heading.
- (UIEdgeInsets)collectionView:(UICollectionView *)c layout:(UICollectionViewLayout *)l insetForSectionAtIndex:(NSInteger)s {
    return UIEdgeInsetsMake(0, 28, isHeader(items[s]) ? 8 : 28, 28);
}

- (UICollectionViewCell *)collectionView:(UICollectionView *)c cellForItemAtIndexPath:(NSIndexPath *)at {
    GPSlideCell *cell = [c dequeueReusableCellWithReuseIdentifier:kSlide forIndexPath:at];
    CGSize size = [self collectionView:c layout:c.collectionViewLayout sizeForItemAtIndexPath:at];
    cell.picture.image = GPSlideImage(slidesOf(page, items[at.section])[at.item], page[@"theme"], items[at.section][@"title"],
                                      size, c.backgroundColor);
    [self markCell:cell at:at];
    return cell;
}

- (UICollectionReusableView *)collectionView:(UICollectionView *)c viewForSupplementaryElementOfKind:(NSString *)kind atIndexPath:(NSIndexPath *)at {
    GPHeadingView *h = [c dequeueReusableSupplementaryViewOfKind:kind withReuseIdentifier:kHeading forIndexPath:at];
    NSString *problem = page[@"slides"][items[at.section][@"id"]][@"problem"];
    [h showItem:items[at.section] problem:[problem isKindOfClass:[NSString class]] ? problem : nil];
    NSDictionary *item = items[at.section];
    __weak GPSlidesController *me = self;
    h.onMore = ^(UIButton *more) {
        GPSlidesController *s = me;
        if (s) GPItemMenu(s, more, more.bounds, item, s->model);
    };
    return h;
}

/// The page read again (a change here, or one the sync brought): the slides reloaded, the item the core keeps at the
/// top (`changed`'s `stay`) where it stood on the screen, though the items above it grew, shrank or went.
- (void)pageChanged:(NSNotification *)note {
    page = model.page;
    items = page[@"items"];
    UICollectionView *c = self.collectionView;
    [c reloadData];
    NSString *stay = note.userInfo[@"stay"];
    NSUInteger index = stay ? [[items valueForKey:@"id"] indexOfObject:stay] : NSNotFound;
    if (index != NSNotFound && standing[stay]) {
        [c layoutIfNeeded];
        CGFloat top = -c.contentInset.top;
        CGFloat bottom = MAX(top, c.contentSize.height + c.contentInset.bottom - c.bounds.size.height);
        CGFloat y = [self headingAt:(NSInteger)index] - [standing[stay] doubleValue] + top;
        [c setContentOffset:CGPointMake(0, MIN(MAX(top, y), bottom)) animated:NO];
    }
    followedSelection = [model.state[@"selectedId"] isKindOfClass:[NSString class]] ? model.state[@"selectedId"] : nil;   // no jump in liveChanged
    NSUInteger named = [[items valueForKey:@"id"] indexOfObject:namedId ?: @""];
    if (named == NSNotFound) named = index == NSNotFound ? 0 : index;   // gone: the item that stays, else the first
    [self nameAfter:(NSInteger)named];
    if (appeared) [self drawAhead];
}

/// A row's item at the top at once, not scrolled to (Lars: the slides rushing past made him dizzy). The row stays
/// chosen though an item near the end cannot reach the top.
- (void)scrollToItem:(NSInteger)index {
    UICollectionView *c = self.collectionView;
    UICollectionViewLayoutAttributes *heading = [self.collectionViewLayout layoutAttributesForSupplementaryViewOfKind:UICollectionElementKindSectionHeader
                                                                                                         atIndexPath:[NSIndexPath indexPathForItem:0 inSection:index]];
    CGFloat top = -c.contentInset.top;
    CGFloat bottom = MAX(top, c.contentSize.height + c.contentInset.bottom - c.bounds.size.height);
    following = YES;
    [self nameAfter:index];
    [c setContentOffset:CGPointMake(0, MIN(MAX(top, heading.frame.origin.y + top), bottom)) animated:NO];
}

/// A finger on the slides again: they choose their row from now on.
- (void)scrollViewWillBeginDragging:(UIScrollView *)s { following = NO; }

/// The item whose heading has passed under the navigation bar selects its row and names the column, as the Settings
/// app's right column is named after the row chosen.
- (void)scrollViewDidScroll:(UIScrollView *)s {
    // Called while the view is still being set up too, before the layout has its sections (UICollectionView's own
    // asking throws then on iOS 8, and the layout answers every heading at 0): only once it has appeared.
    if (following || !appeared) return;
    CGFloat line = s.contentOffset.y + s.contentInset.top + 1;
    NSInteger shown = 0;   // at the top, the first item, as Settings has a row chosen
    for (NSInteger i = 0; i < (NSInteger)items.count; i++) {
        UICollectionViewLayoutAttributes *a = [self.collectionViewLayout layoutAttributesForSupplementaryViewOfKind:UICollectionElementKindSectionHeader
                                                                                                        atIndexPath:[NSIndexPath indexPathForItem:0 inSection:i]];
        if (a.frame.origin.y > line) break;
        shown = i;
    }
    if (items.count == 0) return;
    [self.runningOrder selectItem:shown];
    [self nameAfter:shown];
}
@end

static UIViewController *nothing(void) {
    UIViewController *empty = [[UIViewController alloc] init];
    empty.view.backgroundColor = rgb(0xEFEFF4);
    return empty;
}

void GPShowNothing(UISplitViewController *split) {
    [(UINavigationController *)split.viewControllers.firstObject popToRootViewControllerAnimated:NO];
    ((UINavigationController *)split.viewControllers.lastObject).viewControllers = @[nothing()];
}

UISplitViewController *GPSplit(UIViewController *list) {
    UISplitViewController *split = [[UISplitViewController alloc] init];
    UINavigationController *left = [[UINavigationController alloc] initWithRootViewController:list];
    UINavigationController *right = [[UINavigationController alloc] initWithRootViewController:nothing()];
    // Opaque bars: a translucent one blurs what scrolls under it anew on every frame, more than the iPad 3's GPU
    // keeps up with.
    left.navigationBar.translucent = NO;
    right.navigationBar.translucent = NO;
    split.viewControllers = @[left, right];
    split.preferredDisplayMode = UISplitViewControllerDisplayModeAllVisible;
    split.maximumPrimaryColumnWidth = 320;
    split.preferredPrimaryColumnWidthFraction = 0.4;
    return split;
}

NSString *GPShownPresentation(UISplitViewController *split) {
    UIViewController *top = [split.viewControllers.firstObject topViewController];
    return [top isKindOfClass:[GPItemsController class]] ? [(GPItemsController *)top presentationId] : nil;
}

void GPShowPage(UISplitViewController *split, NSDictionary *page, id<GPPresentationSource> source, BOOL animated) {
    GPPageModel *model = [[GPPageModel alloc] initWithPage:page live:[source live] source:source];
    GPItemsController *items = [[GPItemsController alloc] initWithModel:model];
    GPSlidesController *slides = [[GPSlidesController alloc] initWithModel:model];
    items.slides = slides;
    slides.runningOrder = items;
    UINavigationController *left = split.viewControllers.firstObject, *right = split.viewControllers.lastObject;
    [left popToRootViewControllerAnimated:NO];
    [left pushViewController:items animated:animated];
    // The slides with the live column beside them while presenting, ▶ or ■ in the bar (LivePanel.m).
    right.viewControllers = @[[[GPDetailController alloc] initWithSlides:slides model:model split:split]];
}

NSString *GPWhen(NSDictionary *presentation) {
    NSDateFormatter *parse = [[NSDateFormatter alloc] init];
    parse.dateFormat = @"yyyy-MM-dd";
    NSDate *day = [presentation[@"eventDate"] isKindOfClass:[NSString class]] ? [parse dateFromString:presentation[@"eventDate"]] : nil;
    if (!day) return @"";
    NSDateFormatter *out = [[NSDateFormatter alloc] init];
    out.locale = [NSLocale localeWithLocaleIdentifier:@"sv_SE"];
    out.dateFormat = @"EEEE d MMMM yyyy";
    NSString *time = [presentation[@"time"] isKindOfClass:[NSString class]] ? presentation[@"time"] : nil;
    return time ? [NSString stringWithFormat:@"%@ · %@", [out stringFromDate:day], time] : [out stringFromDate:day];
}
