// AddSong.h: a UISearchBar over the table (iOS 8 has no searchable list of SwiftUI's); every keystroke asks the core,
// which answers from SQLite in a few milliseconds.
#import "AddSong.h"
#import "Texts.h"

@interface GPAddSongController () <UISearchBarDelegate>
@end

@implementation GPAddSongController {
    GPPageModel *model;
    NSString *after;
    NSArray *hits;
    NSString *chosen;
    UISearchBar *search;
}

- (instancetype)initWithModel:(GPPageModel *)m after:(NSString *)a {
    if ((self = [super initWithStyle:UITableViewStylePlain])) {
        model = m;
        after = a;
        self.title = GPText(@"presentation.addKind", @{@"kind": [GPText(@"add.song", nil) lowercaseString]});
        self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:GPText(@"common.cancel", nil) style:UIBarButtonItemStylePlain
                                                                                target:self action:@selector(cancel)];
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:GPText(@"presentation.add", nil) style:UIBarButtonItemStyleDone
                                                                                 target:self action:@selector(add)];
        self.navigationItem.rightBarButtonItem.enabled = NO;
    }
    return self;
}

- (void)presentFrom:(UIViewController *)controller {
    UINavigationController *sheet = [[UINavigationController alloc] initWithRootViewController:self];
    sheet.modalPresentationStyle = UIModalPresentationFormSheet;
    [controller presentViewController:sheet animated:YES completion:nil];
}

- (void)viewDidLoad {
    [super viewDidLoad];
    search = [[UISearchBar alloc] initWithFrame:CGRectMake(0, 0, 320, 44)];
    search.placeholder = GPText(@"presentation.searchSongs", nil);
    search.delegate = self;
    search.autocorrectionType = UITextAutocorrectionTypeNo;
    self.tableView.tableHeaderView = search;
    self.tableView.rowHeight = 44;
    [self find:@""];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [search becomeFirstResponder];
}

- (void)searchBar:(UISearchBar *)bar textDidChange:(NSString *)text { [self find:text]; }

- (void)find:(NSString *)query {
    id answer = [model.source view:@"searchSongsView" args:@{@"query": query ?: @"", @"locale": GPLanguage()}];
    hits = [answer isKindOfClass:[NSArray class]] ? answer : @[];
    [self.tableView reloadData];
}

- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)hits.count; }

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    UITableViewCell *cell = [t dequeueReusableCellWithIdentifier:@"song"] ?: [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleDefault reuseIdentifier:@"song"];
    NSDictionary *hit = hits[at.row];
    cell.textLabel.text = hit[@"name"];
    cell.accessoryType = [hit[@"id"] isEqual:chosen] ? UITableViewCellAccessoryCheckmark : UITableViewCellAccessoryNone;
    return cell;
}

- (void)tableView:(UITableView *)t didSelectRowAtIndexPath:(NSIndexPath *)at {
    [t deselectRowAtIndexPath:at animated:YES];
    chosen = hits[at.row][@"id"];
    self.navigationItem.rightBarButtonItem.enabled = YES;
    [t reloadData];
}

- (void)cancel { [self dismissViewControllerAnimated:YES completion:nil]; }

- (void)add {
    NSString *itemId = [[NSUUID UUID].UUIDString lowercaseString];
    NSMutableDictionary *args = [@{@"itemId": itemId, @"presentationId": model.page[@"presentation"][@"id"], @"songId": chosen} mutableCopy];
    if (after) args[@"afterItemId"] = after;
    NSString *refused = [model run:@"addSongToPresentation" args:args];
    if (refused) {
        UIAlertController *a = [UIAlertController alertControllerWithTitle:self.title message:GPRefusalText(refused) preferredStyle:UIAlertControllerStyleAlert];
        [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
        [self presentViewController:a animated:YES completion:nil];
        return;
    }
    [model send:@{@"type": @"added", @"itemId": itemId}];
    [self dismissViewControllerAnimated:YES completion:nil];
}
@end
