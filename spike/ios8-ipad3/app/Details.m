// The details form (Details.h). Each field's cell is made once and kept, so its text field keeps what was typed while
// the table reloads; a date or time picker row is there while its switch is on. The theme's group is left out, as the
// native app leaves it: no theme is chosen in this app yet.
#import "Details.h"
#import "Texts.h"

static NSString *text(id v) { return [v isKindOfClass:[NSString class]] ? v : @""; }

static NSDateFormatter *format(NSString *f) {
    NSDateFormatter *d = [[NSDateFormatter alloc] init];
    d.dateFormat = f;
    d.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    return d;
}

@implementation GPDetailsController {
    id<GPPresentationSource> source;
    NSString *presentationId;
    void (^done)(NSString *);
    NSDictionary *dialog;             // detailsDialogView
    NSArray *groups;                  // its groups, the theme's left out
    NSMutableDictionary *cells;       // field → its cell, made once
    UITextField *name, *location;
    UITextView *about;
    UISwitch *hasDate, *hasTime;
    UIDatePicker *date, *time;
}

- (instancetype)initWithSource:(id<GPPresentationSource>)s presentationId:(NSString *)pid done:(void (^)(NSString *))d {
    if ((self = [super initWithStyle:UITableViewStyleGrouped])) {
        source = s;
        presentationId = pid;
        done = d;
        cells = [NSMutableDictionary dictionary];
        // @YES or @NO, a JSON boolean: @(pid == nil) is the number 1, which the core refuses.
        dialog = [s view:@"detailsDialogView" args:@{@"isNew": pid ? @NO : @YES}];
        NSMutableArray *kept = [NSMutableArray array];
        for (NSArray *g in dialog[@"groups"]) if (![g isEqual:@[@"theme"]]) [kept addObject:g];
        groups = kept;
        self.title = GPText(dialog[@"title"] ?: @"presentation.editDetails", nil);
        NSString *cancel = @"common.cancel", *confirm = @"common.save";
        for (NSDictionary *a in dialog[@"actions"]) {
            if ([a[@"role"] isEqual:@"cancel"]) cancel = a[@"text"];
            if ([a[@"role"] isEqual:@"confirm"]) confirm = a[@"text"];
        }
        self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:GPText(cancel, nil) style:UIBarButtonItemStylePlain
                                                                                target:self action:@selector(cancel)];
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:GPText(confirm, nil) style:UIBarButtonItemStyleDone
                                                                                 target:self action:@selector(save)];
        [self makeFields];
        [self fill];
    }
    return self;
}

- (void)presentFrom:(UIViewController *)controller {
    UINavigationController *sheet = [[UINavigationController alloc] initWithRootViewController:self];
    sheet.modalPresentationStyle = UIModalPresentationFormSheet;
    [controller presentViewController:sheet animated:YES completion:nil];
}

- (UITextField *)field:(NSString *)placeholder {
    UITextField *f = [[UITextField alloc] initWithFrame:CGRectMake(15, 0, 480, 44)];
    f.autoresizingMask = UIViewAutoresizingFlexibleWidth;
    f.placeholder = placeholder;
    f.clearButtonMode = UITextFieldViewModeWhileEditing;
    [f addTarget:self action:@selector(edited) forControlEvents:UIControlEventEditingChanged];
    return f;
}

- (void)makeFields {
    name = [self field:GPText(@"presentation.name", nil)];
    name.text = GPText(@"presentations.defaultName", nil);
    location = [self field:GPText(@"presentation.location", nil)];
    about = [[UITextView alloc] initWithFrame:CGRectMake(10, 4, 480, 112)];
    about.autoresizingMask = UIViewAutoresizingFlexibleWidth;
    about.font = [UIFont systemFontOfSize:17];
    hasDate = [[UISwitch alloc] init];
    hasTime = [[UISwitch alloc] init];
    for (UISwitch *s in @[hasDate, hasTime]) [s addTarget:self action:@selector(switched) forControlEvents:UIControlEventValueChanged];
    date = [[UIDatePicker alloc] init];
    date.datePickerMode = UIDatePickerModeDate;
    time = [[UIDatePicker alloc] init];
    time.datePickerMode = UIDatePickerModeTime;
    time.date = [format(@"HH:mm") dateFromString:@"11:00"];
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:[GPLanguage() isEqual:@"en"] ? @"en_GB" : @"sv_SE"];
    date.locale = locale;
    time.locale = locale;
}

/// Editing: the presentation as it is.
- (void)fill {
    if (!presentationId) return;
    NSDictionary *p = [source page:presentationId][@"presentation"];
    name.text = text(p[@"name"]);
    location.text = text(p[@"location"]);
    about.text = text(p[@"description"]);
    NSDate *d = [format(@"yyyy-MM-dd") dateFromString:text(p[@"eventDate"])];
    if (d) { hasDate.on = YES; date.date = d; }
    NSDate *c = [format(@"HH:mm") dateFromString:text(p[@"time"])];
    if (c) { hasTime.on = YES; time.date = c; }
}

- (void)edited { self.navigationItem.rightBarButtonItem.enabled = [name.text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]].length > 0; }
- (void)switched { [self.tableView reloadData]; }

#pragma mark - The table

/// The rows of a group: a field each, and a picker under a switch that is on.
- (NSArray *)rowsOf:(NSInteger)s {
    NSMutableArray *rows = [NSMutableArray array];
    for (NSString *f in groups[s]) {
        [rows addObject:f];
        if ([f isEqual:@"date"] && hasDate.on) [rows addObject:@"datePicker"];
        if ([f isEqual:@"time"] && hasTime.on) [rows addObject:@"timePicker"];
    }
    return rows;
}

- (NSInteger)numberOfSectionsInTableView:(UITableView *)t { return (NSInteger)groups.count; }

/// The description's group says what it is: a text view has no placeholder on iOS 8.
- (NSString *)tableView:(UITableView *)t titleForHeaderInSection:(NSInteger)s {
    return [groups[s] isEqual:@[@"description"]] ? GPText(@"presentation.description", nil) : nil;
}
- (NSInteger)tableView:(UITableView *)t numberOfRowsInSection:(NSInteger)s { return (NSInteger)[self rowsOf:s].count; }

- (CGFloat)tableView:(UITableView *)t heightForRowAtIndexPath:(NSIndexPath *)at {
    NSString *row = [self rowsOf:at.section][at.row];
    if ([row hasSuffix:@"Picker"]) return 216;
    return [row isEqual:@"description"] ? 120 : 44;
}

- (UITableViewCell *)tableView:(UITableView *)t cellForRowAtIndexPath:(NSIndexPath *)at {
    NSString *row = [self rowsOf:at.section][at.row];
    UITableViewCell *cell = cells[row];
    if (cell) return cell;
    cell = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleDefault reuseIdentifier:nil];
    cell.selectionStyle = UITableViewCellSelectionStyleNone;
    NSDictionary *views = @{@"name": name, @"location": location, @"description": about, @"datePicker": date, @"timePicker": time};
    if (views[row]) {
        UIView *v = views[row];
        v.frame = [row hasSuffix:@"Picker"] ? cell.contentView.bounds : v.frame;
        v.autoresizingMask = UIViewAutoresizingFlexibleWidth | ([row hasSuffix:@"Picker"] ? UIViewAutoresizingFlexibleHeight : 0);
        [cell.contentView addSubview:v];
    } else if ([row isEqual:@"date"] || [row isEqual:@"time"]) {
        cell.textLabel.text = GPText([@"presentation." stringByAppendingString:row], nil);
        cell.accessoryView = [row isEqual:@"date"] ? hasDate : hasTime;
    }
    cells[row] = cell;
    return cell;
}

#pragma mark - The buttons

- (void)cancel {
    [self dismissViewControllerAnimated:YES completion:^{ if (self->done) self->done(nil); }];
}

- (void)save {
    NSString *pid = presentationId ?: [[NSUUID UUID].UUIDString lowercaseString];
    NSDictionary *args = @{@"id": pid, @"name": name.text ?: @"",
                           @"eventDate": hasDate.on ? [format(@"yyyy-MM-dd") stringFromDate:date.date] : [NSNull null],
                           @"time": hasTime.on ? [format(@"HH:mm") stringFromDate:time.date] : [NSNull null],
                           @"location": location.text ?: @"", @"description": about.text ?: @""};
    NSString *refused = [source mutate:presentationId ? @"updatePresentation" : @"createPresentation" args:args];
    if (refused) {
        UIAlertController *a = [UIAlertController alertControllerWithTitle:self.title message:GPRefusalText(refused)
                                                            preferredStyle:UIAlertControllerStyleAlert];
        [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
        [self presentViewController:a animated:YES completion:nil];
        return;
    }
    [self dismissViewControllerAnimated:YES completion:^{ if (self->done) self->done(pid); }];
}
@end
