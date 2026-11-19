// The presentation page with UIKit as iOS 8 has it (UITableView, UICollectionView): the running order at the left,
// 300 pt as WideLayout's, and the slides at the right, each item a section headed by its title, the slides 340 to
// 384 pt wide as SlideGrid.tsx sizes them. A tap on an item scrolls to its slides. Nothing is presented.
#import "PresentationController.h"
#import "SlideView.h"

static NSString *const kSlide = @"slide", *const kHeading = @"heading";

static NSString *icon(NSString *type) {
    // Text glyphs, not emoji (U+FE0E): iOS 8 has no SF Symbols.
    NSDictionary *icons = @{@"song": @"♪", @"header": @"¶", @"video": @"▶︎", @"audio": @"◉", @"image": @"▣", @"bible": @"✚"};
    return icons[type] ?: @"▢";
}

@interface GPSlideCell : UICollectionViewCell
@property (nonatomic, readonly) GPSlideView *slide;
@end

@implementation GPSlideCell
- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _slide = [[GPSlideView alloc] initWithFrame:self.contentView.bounds];
        _slide.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        _slide.layer.cornerRadius = 4;
        [self.contentView addSubview:_slide];
    }
    return self;
}
@end

@interface GPHeadingView : UICollectionReusableView
@property (nonatomic, readonly) UILabel *title;
@end

@implementation GPHeadingView
- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        _title = [[UILabel alloc] initWithFrame:CGRectMake(28, 4, frame.size.width - 56, frame.size.height - 8)];
        _title.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        _title.font = [UIFont boldSystemFontOfSize:14];
        _title.textColor = [UIColor colorWithRed:0.39 green:0.45 blue:0.55 alpha:1];
        [self addSubview:_title];
    }
    return self;
}
@end

/// A flow layout whose rows stand at the left, 18 pt apart: a plain one spreads a row that is not full over the width.
@interface GPLeftFlowLayout : UICollectionViewFlowLayout
@end

@implementation GPLeftFlowLayout
- (NSArray *)layoutAttributesForElementsInRect:(CGRect)rect {
    NSMutableArray *out = [NSMutableArray array];
    CGFloat rowY = -1, x = 0;
    for (UICollectionViewLayoutAttributes *a in [super layoutAttributesForElementsInRect:rect]) {
        UICollectionViewLayoutAttributes *b = [a copy];
        if (b.representedElementCategory == UICollectionElementCategoryCell) {
            if (b.frame.origin.y != rowY) { rowY = b.frame.origin.y; x = 28; }
            b.frame = CGRectMake(x, b.frame.origin.y, b.frame.size.width, b.frame.size.height);
            x += b.frame.size.width + self.minimumInteritemSpacing;
        }
        [out addObject:b];
    }
    return out;
}
@end

@interface GPPresentationController () <UITableViewDataSource, UITableViewDelegate, UICollectionViewDataSource,
                                        UICollectionViewDelegateFlowLayout>
@end

@implementation GPPresentationController {
    NSDictionary *page;
    NSArray *items;
    UITableView *list;
    UICollectionView *grid;
}

- (instancetype)initWithPage:(NSDictionary *)p {
    if ((self = [super initWithNibName:nil bundle:nil])) {
        page = p;
        items = p[@"items"];
    }
    return self;
}

- (NSArray *)slidesOf:(NSInteger)section {
    NSArray *slides = page[@"slides"][items[section][@"id"]][@"slides"];
    return [slides isKindOfClass:[NSArray class]] ? slides : @[];
}

- (void)loadView {
    UIView *root = [[UIView alloc] initWithFrame:[UIScreen mainScreen].bounds];
    root.backgroundColor = [UIColor whiteColor];
    list = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStylePlain];
    list.dataSource = self;
    list.delegate = self;
    list.backgroundColor = [UIColor colorWithRed:0.965 green:0.969 blue:0.976 alpha:1];
    list.rowHeight = 40;
    list.tableFooterView = [[UIView alloc] init];   // no empty rows under the last item
    UICollectionViewFlowLayout *flow = [[GPLeftFlowLayout alloc] init];
    flow.minimumInteritemSpacing = 18;
    flow.minimumLineSpacing = 18;
    flow.sectionInset = UIEdgeInsetsMake(4, 28, 24, 28);
    flow.headerReferenceSize = CGSizeMake(100, 34);
    grid = [[UICollectionView alloc] initWithFrame:CGRectZero collectionViewLayout:flow];
    grid.backgroundColor = [UIColor whiteColor];
    grid.dataSource = self;
    grid.delegate = self;
    [grid registerClass:[GPSlideCell class] forCellWithReuseIdentifier:kSlide];
    [grid registerClass:[GPHeadingView class] forSupplementaryViewOfKind:UICollectionElementKindSectionHeader withReuseIdentifier:kHeading];
    [root addSubview:list];
    [root addSubview:grid];
    self.view = root;
}

- (void)viewWillLayoutSubviews {
    [super viewWillLayoutSubviews];
    CGRect b = self.view.bounds;
    CGFloat top = 20;   // the status bar
    list.frame = CGRectMake(0, top, 300, b.size.height - top);
    grid.frame = CGRectMake(301, top, b.size.width - 301, b.size.height - top);
    [grid.collectionViewLayout invalidateLayout];
}

- (BOOL)prefersStatusBarHidden { return NO; }

// The running order.

- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)items.count; }

- (UIView *)tableView:(UITableView *)t viewForHeaderInSection:(NSInteger)s {
    NSDictionary *p = page[@"presentation"];
    UILabel *h = [[UILabel alloc] init];
    h.numberOfLines = 2;
    h.backgroundColor = t.backgroundColor;
    NSString *when = [@[p[@"eventDate"] ?: @"", p[@"time"] ?: @""] componentsJoinedByString:@" "];
    h.text = [NSString stringWithFormat:@"  %@\n  %@", p[@"name"] ?: @"", when];
    h.font = [UIFont boldSystemFontOfSize:17];
    return h;
}

- (CGFloat)tableView:(UITableView *)t heightForHeaderInSection:(NSInteger)s { return 64; }

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    UITableViewCell *cell = [t dequeueReusableCellWithIdentifier:@"item"]
        ?: [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleDefault reuseIdentifier:@"item"];
    NSDictionary *item = items[at.row];
    BOOL header = [item[@"type"] isEqual:@"header"];
    cell.backgroundColor = [UIColor clearColor];
    cell.textLabel.text = [NSString stringWithFormat:@"%@   %@", icon(item[@"type"]), item[@"title"]];
    cell.textLabel.font = header ? [UIFont boldSystemFontOfSize:13] : [UIFont systemFontOfSize:15];
    cell.textLabel.textColor = header ? [UIColor colorWithWhite:0.45 alpha:1] : [UIColor colorWithWhite:0.1 alpha:1];
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    UICollectionViewLayoutAttributes *heading = [grid layoutAttributesForSupplementaryElementOfKind:UICollectionElementKindSectionHeader
                                                                                        atIndexPath:[NSIndexPath indexPathForItem:0 inSection:at.row]];
    [grid setContentOffset:CGPointMake(0, MIN(heading.frame.origin.y, MAX(0, grid.contentSize.height - grid.bounds.size.height))) animated:YES];
}

// The slides.

- (NSInteger)numberOfSectionsInCollectionView:(UICollectionView *)c { return (NSInteger)items.count; }

- (NSInteger)collectionView:(UICollectionView *)c numberOfItemsInSection:(NSInteger)s { return (NSInteger)[self slidesOf:s].count; }

/// The columns and the tiles' width: 384 pt, shrunk to no less than 340 where that fits one more to a row.
- (CGSize)tile:(NSInteger *)columns {
    CGFloat available = grid.bounds.size.width - 56, spacing = 18;
    *columns = MAX(1, (NSInteger)((available + spacing) / (340 + spacing)));
    CGFloat width = floor(MIN(384, (available - spacing * (*columns - 1)) / *columns));
    return CGSizeMake(width, round(width * 9 / 16));
}

- (CGSize)collectionView:(UICollectionView *)c layout:(UICollectionViewLayout *)l sizeForItemAtIndexPath:(NSIndexPath *)at {
    NSInteger columns;
    return [self tile:&columns];
}


- (UICollectionViewCell *)collectionView:(UICollectionView *)c cellForItemAtIndexPath:(NSIndexPath *)at {
    GPSlideCell *cell = [c dequeueReusableCellWithReuseIdentifier:kSlide forIndexPath:at];
    [cell.slide showSlide:[self slidesOf:at.section][at.item] theme:page[@"theme"] title:items[at.section][@"title"]];
    return cell;
}

- (UICollectionReusableView *)collectionView:(UICollectionView *)c viewForSupplementaryElementOfKind:(NSString *)kind atIndexPath:(NSIndexPath *)at {
    GPHeadingView *h = [c dequeueReusableSupplementaryViewOfKind:kind withReuseIdentifier:kHeading forIndexPath:at];
    NSDictionary *item = items[at.section];
    NSString *problem = page[@"slides"][item[@"id"]][@"problem"];
    h.title.text = [problem isKindOfClass:[NSString class]] ? [NSString stringWithFormat:@"%@  (%@)", item[@"title"], problem] : item[@"title"];
    return h;
}
@end
