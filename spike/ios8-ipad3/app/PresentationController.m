// The presentation page with iOS 8's own parts, laid out as the Settings app on an iPad: a UISplitViewController,
// both columns shown, the left one 320 pt; at the left the running order as a grouped UITableView, every item a row
// with a coloured 29 pt icon and a song's number of slides; at the right a UICollectionView of slide tiles 300 to 384
// pt wide on the grouped table's grey, each item a section headed as a grouped table heads one. A row brings its
// item's slides to the top, the slides scrolled choose their row, and a tile tapped is outlined, as the web's page
// picks one. Nothing is presented.
#import "PresentationController.h"
#import "SlideView.h"

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

/// A tile: the slide's picture (GPSlideImage, drawn once), and an outline around it when picked.
@interface GPSlideCell : UICollectionViewCell
@property (nonatomic, readonly) UIImageView *picture;
@end

@implementation GPSlideCell {
    UIView *outline;
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _picture = [[UIImageView alloc] initWithFrame:self.contentView.bounds];
        _picture.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        _picture.opaque = YES;
        [self.contentView addSubview:_picture];
        // A border with rounded corners and no clip: drawn by the GPU without an offscreen pass.
        outline = [[UIView alloc] initWithFrame:CGRectInset(self.bounds, -5, -5)];
        outline.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        outline.layer.borderWidth = 3;
        outline.layer.cornerRadius = 8;
        outline.layer.borderColor = GPTint().CGColor;
        outline.userInteractionEnabled = NO;
        outline.hidden = YES;
        [self addSubview:outline];
    }
    return self;
}

// Picked: an outline in the tint, outside the picture.
- (void)setSelected:(BOOL)selected {
    [super setSelected:selected];
    outline.hidden = !selected;
}
@end

@interface GPHeadingView : UICollectionReusableView
@property (nonatomic, readonly) UILabel *title;
@end

@implementation GPHeadingView
- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _title = [[UILabel alloc] initWithFrame:CGRectMake(28, 0, frame.size.width - 56, frame.size.height - 6)];
        _title.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        [self addSubview:_title];
    }
    return self;
}

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
- (instancetype)initWithPage:(NSDictionary *)page;
- (void)scrollToItem:(NSInteger)index;
@end

#pragma mark - The running order

@interface GPItemsController : UITableViewController
@property (nonatomic, weak) GPSlidesController *slides;
- (instancetype)initWithPage:(NSDictionary *)page;
- (void)selectItem:(NSInteger)index;
/// The presentation it shows.
- (NSString *)presentationId;
@end

@implementation GPItemsController {
    NSDictionary *page;
    NSArray *items;
}

- (instancetype)initWithPage:(NSDictionary *)p {
    if ((self = [super initWithStyle:UITableViewStyleGrouped])) {
        page = p;
        items = p[@"items"];
        self.title = p[@"presentation"][@"name"];
    }
    return self;
}

/// The presentation's day and time over its one group, as a grouped table's note reads: "söndag 8 november 2026 ·
/// 11:00".
- (void)viewDidLoad {
    [super viewDidLoad];
    UILabel *when = [[UILabel alloc] initWithFrame:CGRectMake(0, 0, 320, 44)];
    when.text = GPWhen(page[@"presentation"]);
    when.textAlignment = NSTextAlignmentCenter;
    when.font = [UIFont systemFontOfSize:13];
    when.textColor = rgb(0x6D6D72);
    self.tableView.tableHeaderView = when;
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
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
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
    NSDictionary *page;
    NSArray *items;
    BOOL following;   // jumped to a row's item: the row stays chosen until the slides are dragged
    CGFloat laidOutWidth;
    BOOL appeared;
    NSInteger drawingRound;   // drawAhead's: a round whose number is no longer this stops
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

- (instancetype)initWithPage:(NSDictionary *)p {
    GPLeftFlowLayout *flow = [[GPLeftFlowLayout alloc] init];
    flow.minimumInteritemSpacing = 18;
    flow.minimumLineSpacing = 18;
    flow.sectionInset = UIEdgeInsetsMake(0, 28, 28, 28);
    flow.headerReferenceSize = CGSizeMake(100, 44);
    if ((self = [super initWithCollectionViewLayout:flow])) {
        page = p;
        items = p[@"items"];
        self.title = [items.firstObject objectForKey:@"title"];
    }
    return self;
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
    return cell;
}

- (UICollectionReusableView *)collectionView:(UICollectionView *)c viewForSupplementaryElementOfKind:(NSString *)kind atIndexPath:(NSIndexPath *)at {
    GPHeadingView *h = [c dequeueReusableSupplementaryViewOfKind:kind withReuseIdentifier:kHeading forIndexPath:at];
    NSString *problem = page[@"slides"][items[at.section][@"id"]][@"problem"];
    [h showItem:items[at.section] problem:[problem isKindOfClass:[NSString class]] ? problem : nil];
    return h;
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
    self.title = items[index][@"title"];
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
    self.title = items[shown][@"title"];
}
@end

UISplitViewController *GPSplit(UIViewController *list) {
    UISplitViewController *split = [[UISplitViewController alloc] init];
    UINavigationController *left = [[UINavigationController alloc] initWithRootViewController:list];
    UIViewController *empty = [[UIViewController alloc] init];
    empty.view.backgroundColor = rgb(0xEFEFF4);
    UINavigationController *right = [[UINavigationController alloc] initWithRootViewController:empty];
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

void GPShowPage(UISplitViewController *split, NSDictionary *page, BOOL animated) {
    GPItemsController *items = [[GPItemsController alloc] initWithPage:page];
    GPSlidesController *slides = [[GPSlidesController alloc] initWithPage:page];
    items.slides = slides;
    slides.runningOrder = items;
    UINavigationController *left = split.viewControllers.firstObject, *right = split.viewControllers.lastObject;
    [left popToRootViewControllerAnimated:NO];
    [left pushViewController:items animated:animated];
    // iOS 8's button that folds the running order away, and back.
    slides.navigationItem.leftBarButtonItem = split.displayModeButtonItem;
    slides.navigationItem.leftItemsSupplementBackButton = YES;
    right.viewControllers = @[slides];
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
