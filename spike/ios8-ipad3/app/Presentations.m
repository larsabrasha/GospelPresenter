// The presentations' list (Presentations.h): a grouped table of one group, a subtitle cell per presentation, a
// UIRefreshControl (iOS 6) to sync, and "Anslut" in the bar.
#import "Presentations.h"
#import "PresentationController.h"

@implementation GPPresentationsController {
    id<GPPresentationSource> source;
    NSArray *rows;
}

- (instancetype)initWithSource:(id<GPPresentationSource>)s {
    if ((self = [super initWithStyle:UITableViewStyleGrouped])) {
        source = s;
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@"Anslut" style:UIBarButtonItemStylePlain
                                                                                 target:self action:@selector(connect)];
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.refreshControl = [[UIRefreshControl alloc] init];
    [self.refreshControl addTarget:self action:@selector(refresh) forControlEvents:UIControlEventValueChanged];
    [self reload];
}

- (void)reload {
    rows = [source presentations] ?: @[];
    self.title = [source sourceName];
    // The back button over a page says where it goes back to.
    self.navigationItem.backBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@"Presentationer" style:UIBarButtonItemStylePlain target:nil action:NULL];
    [self.tableView reloadData];
}

- (void)connect { [source connectFrom:self]; }

- (void)refresh {
    [source refresh:^(NSString *error) {
        [self.refreshControl endRefreshing];
        [self reload];
        if (error) {
            UIAlertController *a = [UIAlertController alertControllerWithTitle:@"Synken misslyckades" message:error preferredStyle:UIAlertControllerStyleAlert];
            [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
            [self presentViewController:a animated:YES completion:nil];
        }
    }];
}

- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)rows.count; }

- (NSString *)tableView:(UITableView *)t titleForFooterInSection:(NSInteger)s { return [source sourceNote]; }

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    UITableViewCell *cell = [t dequeueReusableCellWithIdentifier:@"presentation"]
        ?: [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:@"presentation"];
    NSDictionary *p = rows[at.row];
    cell.textLabel.text = p[@"name"];
    cell.detailTextLabel.text = GPWhen(p);
    cell.detailTextLabel.textColor = [UIColor grayColor];
    cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    NSDictionary *page = [source page:rows[at.row][@"id"]];
    [t deselectRowAtIndexPath:at animated:YES];
    if (page) GPShowPage(self.splitViewController, page, YES);
}
@end
