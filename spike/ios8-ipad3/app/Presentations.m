// The start page (Presentations.h): a grouped table, a section for each of the core's lists in its order, Senast
// ändrade 20 at a time with Visa fler, an empty page's text and button when there are none.
#import "Presentations.h"
#import "Details.h"
#import "Live.h"
#import "PresentationController.h"
#import "Texts.h"

NSString *GPRefusalText(NSString *code) {
    NSString *key = [@"error." stringByAppendingString:code ?: @""];
    NSString *said = GPText(key, nil);
    return [said isEqual:key] ? code : said;
}

/// Today on this device, YYYY-MM-DD, as event dates are stored.
static NSString *localToday(NSInteger plusDays) {
    NSDateFormatter *iso = [[NSDateFormatter alloc] init];
    iso.dateFormat = @"yyyy-MM-dd";
    iso.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    return [iso stringFromDate:[NSDate dateWithTimeIntervalSinceNow:plusDays * 86400]];
}

/// "Idag", "Imorgon", or "sön 8 november" (and the year when asked): the web's dateLabel (dashboard.ts).
static NSString *dateLabel(NSString *iso, BOOL withYear) {
    if ([iso isEqual:localToday(0)]) return GPText(@"presentations.today", nil);
    if ([iso isEqual:localToday(1)]) return GPText(@"presentations.tomorrow", nil);
    NSDateFormatter *parse = [[NSDateFormatter alloc] init];
    parse.dateFormat = @"yyyy-MM-dd";
    parse.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    NSDate *day = [parse dateFromString:iso];
    if (!day) return iso;
    NSDateFormatter *show = [[NSDateFormatter alloc] init];
    show.locale = [NSLocale localeWithLocaleIdentifier:[GPLanguage() isEqual:@"en"] ? @"en_GB" : @"sv_SE"];
    show.dateFormat = withYear ? @"EEE d MMMM yyyy" : @"EEE d MMMM";
    return [[show stringFromDate:day] stringByReplacingOccurrencesOfString:@"." withString:@""];
}

static NSString *text(id v) { return [v isKindOfClass:[NSString class]] && [v length] ? v : nil; }

/// A row's second line: the date where the list shows it, the time, the place.
static NSString *subtitle(NSDictionary *p, NSDictionary *list) {
    NSMutableArray *parts = [NSMutableArray array];
    if ([list[@"showDate"] boolValue] && text(p[@"eventDate"])) [parts addObject:dateLabel(p[@"eventDate"], [list[@"withYear"] boolValue])];
    if (text(p[@"time"])) [parts addObject:p[@"time"]];
    if (text(p[@"location"])) [parts addObject:p[@"location"]];
    return [parts componentsJoinedByString:@" · "];
}

@implementation GPPresentationsController {
    id<GPPresentationSource> source;
    NSArray *lists;
    NSInteger recentShown;
}

- (instancetype)initWithSource:(id<GPPresentationSource>)s {
    if ((self = [super initWithStyle:UITableViewStyleGrouped])) {
        source = s;
        recentShown = 20;
        self.title = GPText(@"nav.presentations", nil);
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemAdd
                                                                                               target:self action:@selector(create)];
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(liveChanged:) name:GPLiveChanged object:nil];
    }
    return self;
}

/// Presenting started or ended: "Visas just nu" comes or goes.
- (void)liveChanged:(NSNotification *)n {
    NSString *presented = [source live].presentationId;
    if ((presented != nil) != [[lists.firstObject objectForKey:@"id"] isEqual:@"live"] || (presented && ![presented isEqual:lists[0][@"rows"][0][@"id"]])) [self reload];
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.tableView.rowHeight = 56;
    self.refreshControl = [[UIRefreshControl alloc] init];
    [self.refreshControl addTarget:self action:@selector(refresh) forControlEvents:UIControlEventValueChanged];
    [self reload];
}

- (void)reload {
    id answer = [source view:@"startPageView" args:@{@"today": localToday(0)}];
    lists = [answer isKindOfClass:[NSArray class]] ? answer : @[];
    // "Visas just nu" at the top: what this device presents, as StartPage.swift's NowShowing.
    NSString *presented = [source live].presentationId;
    for (NSDictionary *list in lists) for (NSDictionary *row in list[@"rows"]) if (presented && [row[@"id"] isEqual:presented]) {
        lists = [@[@{@"id": @"live", @"rows": @[row]}] arrayByAddingObjectsFromArray:lists];
        presented = nil;
    }
    // The account's button: the member's first name, or Demo.
    NSString *name = [[source accountName] componentsSeparatedByString:@" "].firstObject ?: GPOwnText(@"demo");
    self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:name style:UIBarButtonItemStylePlain
                                                                            target:self action:@selector(account:)];
    // ‹ alone back here, as it was beside a plain title: beside the title's button (the presentation's menu) iOS cuts
    // "Presentationer" to "Tillbaka" and that to "Til…" rather than leave it out (a title of @"" it takes as none).
    self.navigationItem.backBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@" " style:UIBarButtonItemStylePlain target:nil action:NULL];
    self.tableView.backgroundView = lists.count ? nil : [self empty];
    [self.tableView reloadData];
}

/// No presentation yet: what the page is for, and Skapa en presentation.
- (UIView *)empty {
    UIView *v = [[UIView alloc] init];
    UILabel *title = [[UILabel alloc] initWithFrame:CGRectMake(20, 140, 280, 30)];
    title.text = GPText(@"presentations.emptyTitle", nil);
    title.font = [UIFont boldSystemFontOfSize:20];
    title.textAlignment = NSTextAlignmentCenter;
    UILabel *body = [[UILabel alloc] initWithFrame:CGRectMake(20, 176, 280, 80)];
    body.text = GPText(@"presentations.emptyText", nil);
    body.numberOfLines = 0;
    body.textAlignment = NSTextAlignmentCenter;
    body.textColor = [UIColor grayColor];
    UIButton *make = [UIButton buttonWithType:UIButtonTypeSystem];
    make.frame = CGRectMake(20, 262, 280, 44);
    [make setTitle:GPText(@"presentations.emptyNew", nil) forState:UIControlStateNormal];
    [make addTarget:self action:@selector(create) forControlEvents:UIControlEventTouchUpInside];
    for (UIView *s in @[title, body, make]) { s.autoresizingMask = UIViewAutoresizingFlexibleWidth; [v addSubview:s]; }
    return v;
}

- (void)create {
    GPDetailsController *details = [[GPDetailsController alloc] initWithSource:source presentationId:nil done:^(NSString *made) {
        [self reload];
        NSDictionary *page = made ? [self->source page:made] : nil;
        if (page) GPShowPage(self.splitViewController, page, source, YES);
    }];
    [details presentFrom:self];
}

- (void)account:(UIBarButtonItem *)button {
    NSString *name = [source accountName];
    UIAlertController *menu = [UIAlertController alertControllerWithTitle:name ?: GPOwnText(@"demo") message:[source sourceNote]
                                                           preferredStyle:UIAlertControllerStyleActionSheet];
    if (name) [menu addAction:[UIAlertAction actionWithTitle:GPText(@"status.syncNow", nil) style:UIAlertActionStyleDefault
                                                     handler:^(UIAlertAction *a) { [self.refreshControl beginRefreshing]; [self refresh]; }]];
    [menu addAction:[UIAlertAction actionWithTitle:GPOwnText(@"connect") style:UIAlertActionStyleDefault
                                           handler:^(UIAlertAction *a) { [self->source connectFrom:self]; }]];
    if (name) [menu addAction:[UIAlertAction actionWithTitle:GPText(@"auth.signOut", nil) style:UIAlertActionStyleDestructive
                                                     handler:^(UIAlertAction *a) { [self->source signOut]; }]];
    menu.popoverPresentationController.barButtonItem = button;
    [self presentViewController:menu animated:YES completion:nil];
}

- (void)refresh {
    [source refresh:^(NSString *error) {
        [self.refreshControl endRefreshing];
        [self reload];
        if (!error) return;
        UIAlertController *a = [UIAlertController alertControllerWithTitle:GPOwnText(@"syncFailed") message:GPRefusalText(error)
                                                            preferredStyle:UIAlertControllerStyleAlert];
        [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
        [self presentViewController:a animated:YES completion:nil];
    }];
}

#pragma mark - The lists

- (NSArray *)rowsOf:(NSInteger)s {
    NSArray *rows = lists[s][@"rows"];
    if ([lists[s][@"id"] isEqual:@"recent"] && (NSInteger)rows.count > recentShown) rows = [rows subarrayWithRange:NSMakeRange(0, recentShown)];
    return rows;
}

- (BOOL)hasMore:(NSInteger)s { return [lists[s][@"id"] isEqual:@"recent"] && (NSInteger)[lists[s][@"rows"] count] > recentShown; }

- (NSInteger)numberOfSectionsInTableView:(UITableView *)t { return (NSInteger)lists.count; }
- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)[self rowsOf:s].count + ([self hasMore:s] ? 1 : 0); }
- (NSString *)tableView:(UITableView *)t titleForHeaderInSection:(NSInteger)s { return lists[s][@"title"] ? GPText(lists[s][@"title"], nil) : nil; }
- (NSString *)tableView:(UITableView *)t titleForFooterInSection:(NSInteger)s { return s == (NSInteger)lists.count - 1 ? [source sourceNote] : nil; }

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    NSArray *rows = [self rowsOf:at.section];
    if (at.row == (NSInteger)rows.count) {   // Visa fler
        UITableViewCell *more = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleDefault reuseIdentifier:nil];
        more.textLabel.text = GPText(@"common.showMore", nil);
        more.textLabel.textAlignment = NSTextAlignmentCenter;
        more.textLabel.textColor = self.view.tintColor;
        return more;
    }
    UITableViewCell *cell = [t dequeueReusableCellWithIdentifier:@"presentation"]
        ?: [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:@"presentation"];
    NSDictionary *p = rows[at.row];
    BOOL live = [lists[at.section][@"id"] isEqual:@"live"];
    cell.textLabel.text = p[@"name"];
    cell.detailTextLabel.text = live ? [@"● " stringByAppendingString:GPText(@"remote.nowShowing", nil)] : subtitle(p, lists[at.section]);
    cell.detailTextLabel.textColor = live ? [UIColor redColor] : [UIColor grayColor];
    NSInteger n = [p[@"itemCount"] integerValue];
    UILabel *count = [[UILabel alloc] init];
    count.text = n == 1 ? GPText(@"presentations.item", nil) : GPText(@"presentations.items", @{@"n": @(n)});
    count.font = [UIFont systemFontOfSize:13];
    count.textColor = [UIColor grayColor];
    [count sizeToFit];
    cell.accessoryView = count;
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    [t deselectRowAtIndexPath:at animated:YES];
    NSArray *rows = [self rowsOf:at.section];
    if (at.row == (NSInteger)rows.count) { recentShown += 20; [t reloadData]; return; }
    NSDictionary *page = [source page:rows[at.row][@"id"]];
    if (page) GPShowPage(self.splitViewController, page, source, YES);
}
@end
