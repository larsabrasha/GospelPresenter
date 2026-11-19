// The presentation page with iOS 8's own parts, laid out as the Settings app on an iPad: a UISplitViewController,
// both columns shown, the left one 320 pt; at the left the running order as a grouped UITableView, an item a row with
// a coloured 29 pt icon and its number of slides, the headers (type "header") the groups' titles; at the right a
// UICollectionView of slide tiles 340 to 384 pt wide (SlideGrid.tsx's sizes) on the grouped table's grey, each item
// a section headed as a grouped table heads one. A row scrolls to its item's slides, the slides scrolled to select
// their row, and a tile tapped is outlined, as the web's page picks one. Nothing is presented.
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

@interface GPSlideCell : UICollectionViewCell
@property (nonatomic, readonly) GPSlideView *slide;
@end

@implementation GPSlideCell
- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _slide = [[GPSlideView alloc] initWithFrame:self.contentView.bounds];
        _slide.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        _slide.layer.cornerRadius = 4;
        self.layer.cornerRadius = 6;
        [self.contentView addSubview:_slide];
    }
    return self;
}

// Picked: an outline in the tint, outside the picture.
- (void)setSelected:(BOOL)selected {
    [super setSelected:selected];
    self.layer.borderWidth = selected ? 3 : 0;
    self.layer.borderColor = GPTint().CGColor;
    self.contentView.frame = selected ? CGRectInset(self.bounds, 4, 4) : self.bounds;
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

/// A song's or a medium's heading as a grouped table's (13 pt, capitals, grey); a header item's larger and dark.
- (void)showItem:(NSDictionary *)item problem:(NSString *)problem {
    NSString *text = problem ? [NSString stringWithFormat:@"%@ · %@", item[@"title"], problem] : item[@"title"];
    BOOL header = isHeader(item);
    _title.text = header ? text : text.uppercaseString;
    _title.font = header ? [UIFont boldSystemFontOfSize:22] : [UIFont systemFontOfSize:13];
    _title.textColor = header ? [UIColor blackColor] : rgb(0x6D6D72);
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
@end

@implementation GPItemsController {
    NSDictionary *page;
    NSArray *groups;   // {title, rows: [index into the page's items]}: a header item opens a group
}

- (instancetype)initWithPage:(NSDictionary *)p {
    if ((self = [super initWithStyle:UITableViewStyleGrouped])) {
        page = p;
        NSMutableArray *all = [NSMutableArray array];
        NSMutableDictionary *group = [@{@"title": @"", @"rows": [NSMutableArray array]} mutableCopy];
        NSArray *items = p[@"items"];
        for (NSUInteger i = 0; i < items.count; i++) {
            if (isHeader(items[i])) {
                if ([group[@"rows"] count]) [all addObject:group];
                group = [@{@"title": items[i][@"title"], @"rows": [NSMutableArray array]} mutableCopy];
            } else {
                [group[@"rows"] addObject:@(i)];
            }
        }
        if ([group[@"rows"] count]) [all addObject:group];
        groups = all;
        self.title = p[@"presentation"][@"name"];
    }
    return self;
}

/// The presentation's day and time over the groups, as a grouped table's footnote reads: "söndag 8 november 2026 ·
/// 11:00" (a group's title would be lost when the first item is a header).
- (void)viewDidLoad {
    [super viewDidLoad];
    UILabel *when = [[UILabel alloc] initWithFrame:CGRectMake(0, 0, 320, 44)];
    when.text = [self when];
    when.textAlignment = NSTextAlignmentCenter;
    when.font = [UIFont systemFontOfSize:13];
    when.textColor = rgb(0x6D6D72);
    self.tableView.tableHeaderView = when;
}

/// "söndag 8 november 2026 · 11:00".
- (NSString *)when {
    NSDictionary *p = page[@"presentation"];
    NSDateFormatter *parse = [[NSDateFormatter alloc] init];
    parse.dateFormat = @"yyyy-MM-dd";
    NSDate *day = [p[@"eventDate"] isKindOfClass:[NSString class]] ? [parse dateFromString:p[@"eventDate"]] : nil;
    if (!day) return @"";
    NSDateFormatter *out = [[NSDateFormatter alloc] init];
    out.locale = [NSLocale localeWithLocaleIdentifier:@"sv_SE"];
    out.dateFormat = @"EEEE d MMMM yyyy";
    NSString *time = [p[@"time"] isKindOfClass:[NSString class]] ? p[@"time"] : nil;
    return time ? [NSString stringWithFormat:@"%@ · %@", [out stringFromDate:day], time] : [out stringFromDate:day];
}

- (NSInteger)numberOfSectionsInTableView:(UITableView *)t { return (NSInteger)groups.count; }
- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)[groups[s][@"rows"] count]; }
- (NSString *)tableView:(UITableView *)t titleForHeaderInSection:(NSInteger)s { return groups[s][@"title"]; }

- (NSInteger)itemAt:(NSIndexPath *)at { return [groups[at.section][@"rows"][at.row] integerValue]; }

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    UITableViewCell *cell = [t dequeueReusableCellWithIdentifier:@"item"]
        ?: [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleValue1 reuseIdentifier:@"item"];
    NSDictionary *item = page[@"items"][[self itemAt:at]];
    cell.imageView.image = iconFor(item[@"type"]);
    cell.textLabel.text = item[@"title"];
    NSUInteger n = slidesOf(page, item).count;
    cell.detailTextLabel.text = [item[@"type"] isEqual:@"song"] ? [NSString stringWithFormat:@"%lu", (unsigned long)n] : nil;
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    [self.slides scrollToItem:[self itemAt:at]];
}

- (void)selectItem:(NSInteger)index {
    for (NSUInteger s = 0; s < groups.count; s++) {
        NSUInteger row = [groups[s][@"rows"] indexOfObject:@(index)];
        if (row == NSNotFound) continue;
        NSIndexPath *at = [NSIndexPath indexPathForRow:(NSInteger)row inSection:(NSInteger)s];
        if (![self.tableView.indexPathForSelectedRow isEqual:at])
            [self.tableView selectRowAtIndexPath:at animated:NO scrollPosition:UITableViewScrollPositionNone];
        return;
    }
}
@end

#pragma mark - The slides' column

static NSString *const kSlide = @"slide", *const kHeading = @"heading";

@implementation GPSlidesController {
    NSDictionary *page;
    NSArray *items;
    BOOL following;   // scrolling to a row's item: the selection stays on that row until it ends
    CGFloat laidOutWidth;
    BOOL appeared;
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    appeared = YES;
    [self scrollViewDidScroll:self.collectionView];
}

- (instancetype)initWithPage:(NSDictionary *)p {
    GPLeftFlowLayout *flow = [[GPLeftFlowLayout alloc] init];
    flow.minimumInteritemSpacing = 18;
    flow.minimumLineSpacing = 18;
    flow.sectionInset = UIEdgeInsetsMake(0, 28, 28, 28);
    if ((self = [super initWithCollectionViewLayout:flow])) {
        page = p;
        items = p[@"items"];
        for (NSDictionary *item in items) if (!isHeader(item)) { self.title = item[@"title"]; break; }
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
    [self.collectionViewLayout invalidateLayout];
}

- (NSInteger)numberOfSectionsInCollectionView:(UICollectionView *)c { return (NSInteger)items.count; }
- (NSInteger)collectionView:(UICollectionView *)c numberOfItemsInSection:(NSInteger)s { return (NSInteger)slidesOf(page, items[s]).count; }

- (CGSize)collectionView:(UICollectionView *)c layout:(UICollectionViewLayout *)l sizeForItemAtIndexPath:(NSIndexPath *)at {
    CGFloat available = c.bounds.size.width - 56, spacing = 18;
    NSInteger columns = MAX(1, (NSInteger)((available + spacing) / (340 + spacing)));
    CGFloat width = floor(MIN(384, (available - spacing * (columns - 1)) / columns));
    return CGSizeMake(width, round(width * 9 / 16));
}

/// A header item has no slides: no room under its heading.
- (UIEdgeInsets)collectionView:(UICollectionView *)c layout:(UICollectionViewLayout *)l insetForSectionAtIndex:(NSInteger)s {
    return UIEdgeInsetsMake(0, 28, isHeader(items[s]) ? 0 : 28, 28);
}

- (CGSize)collectionView:(UICollectionView *)c layout:(UICollectionViewLayout *)l referenceSizeForHeaderInSection:(NSInteger)s {
    return CGSizeMake(c.bounds.size.width, isHeader(items[s]) ? 64 : 44);
}

- (UICollectionViewCell *)collectionView:(UICollectionView *)c cellForItemAtIndexPath:(NSIndexPath *)at {
    GPSlideCell *cell = [c dequeueReusableCellWithReuseIdentifier:kSlide forIndexPath:at];
    [cell.slide showSlide:slidesOf(page, items[at.section])[at.item] theme:page[@"theme"] title:items[at.section][@"title"]];
    return cell;
}

- (UICollectionReusableView *)collectionView:(UICollectionView *)c viewForSupplementaryElementOfKind:(NSString *)kind atIndexPath:(NSIndexPath *)at {
    GPHeadingView *h = [c dequeueReusableSupplementaryViewOfKind:kind withReuseIdentifier:kHeading forIndexPath:at];
    NSString *problem = page[@"slides"][items[at.section][@"id"]][@"problem"];
    [h showItem:items[at.section] problem:[problem isKindOfClass:[NSString class]] ? problem : nil];
    return h;
}

- (void)scrollToItem:(NSInteger)index {
    UICollectionView *c = self.collectionView;
    UICollectionViewLayoutAttributes *heading = [self.collectionViewLayout layoutAttributesForSupplementaryViewOfKind:UICollectionElementKindSectionHeader
                                                                                                         atIndexPath:[NSIndexPath indexPathForItem:0 inSection:index]];
    CGFloat top = -c.contentInset.top;
    CGFloat bottom = MAX(top, c.contentSize.height + c.contentInset.bottom - c.bounds.size.height);
    following = YES;
    self.title = items[index][@"title"];
    [c setContentOffset:CGPointMake(0, MIN(MAX(top, heading.frame.origin.y + top), bottom)) animated:YES];
}

- (void)scrollViewDidEndScrollingAnimation:(UIScrollView *)s { following = NO; }

/// The item whose heading has passed under the navigation bar selects its row and names the column, as the Settings
/// app's right column is named after the row chosen.
- (void)scrollViewDidScroll:(UIScrollView *)s {
    // Called while the view is still being set up too, before the layout has its sections (UICollectionView's own
    // asking throws then on iOS 8, and the layout answers every heading at 0): only once it has appeared.
    if (following || !appeared) return;
    CGFloat line = s.contentOffset.y + s.contentInset.top + 1;
    NSInteger shown = -1;
    for (NSInteger i = 0; i < (NSInteger)items.count; i++) {
        UICollectionViewLayoutAttributes *a = [self.collectionViewLayout layoutAttributesForSupplementaryViewOfKind:UICollectionElementKindSectionHeader
                                                                                                        atIndexPath:[NSIndexPath indexPathForItem:0 inSection:i]];
        if (shown < 0 && !isHeader(items[i])) shown = i;   // at the top, the first item, as Settings has a row chosen
        if (a.frame.origin.y > line) break;
        if (!isHeader(items[i])) shown = i;
    }
    if (shown < 0) return;
    [self.runningOrder selectItem:shown];
    self.title = items[shown][@"title"];
}
@end

UISplitViewController *GPPresentationPage(NSDictionary *page) {
    GPItemsController *items = [[GPItemsController alloc] initWithPage:page];
    GPSlidesController *slides = [[GPSlidesController alloc] initWithPage:page];
    items.slides = slides;
    slides.runningOrder = items;
    UISplitViewController *split = [[UISplitViewController alloc] init];
    split.viewControllers = @[[[UINavigationController alloc] initWithRootViewController:items],
                              [[UINavigationController alloc] initWithRootViewController:slides]];
    split.preferredDisplayMode = UISplitViewControllerDisplayModeAllVisible;
    split.maximumPrimaryColumnWidth = 320;
    split.preferredPrimaryColumnWidthFraction = 0.4;
    // iOS 8's button that folds the running order away, and back.
    slides.navigationItem.leftBarButtonItem = split.displayModeButtonItem;
    slides.navigationItem.leftItemsSupplementBackButton = YES;
    return split;
}
