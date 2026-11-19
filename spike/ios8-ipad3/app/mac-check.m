// Core.m's calls on the Mac, against the host's build of the same core (target/release) and SQLite's amalgamation:
// what the iPad's page would get from a copy of the demo data, the decoding of UniFFI's answers checked where it can
// run (../README.md, "Checked"). Its argument: a copy of demo.sqlite, which it migrates.
#import "Core.h"

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "usage: mac-check <copy of demo.sqlite>\n"); return 2; }
        sqlite3 *db = NULL;
        if (sqlite3_open(argv[1], &db) != SQLITE_OK) { fprintf(stderr, "cannot open %s\n", argv[1]); return 1; }
        NSDate *t = [NSDate date];
        NSString *refusal = nil;
        GPCoreCommand(db, @"migrateOrgSchema", @"{}", &refusal);
        printf("migrateOrgSchema: %s, %.1f ms\n", refusal ? refusal.UTF8String : "ok", -[t timeIntervalSinceNow] * 1000);
        printf("coreInfoView: %s\n", GPCoreCall(db, @"coreInfoView", @"{}", NULL).UTF8String);
        t = [NSDate date];
        NSArray *rows = GPCoreView(db, @"presentationsView", @{});
        printf("presentationsView: %lu, %.1f ms\n", (unsigned long)rows.count, -[t timeIntervalSinceNow] * 1000);
        for (NSDictionary *row in rows) printf("  %s %s\n", [row[@"id"] UTF8String], [row[@"name"] UTF8String]);
        if (rows.count == 0) return 1;
        t = [NSDate date];
        NSString *page = GPCoreCall(db, @"presentationPageView",
                                    [NSString stringWithFormat:@"{\"id\":\"%@\"}", rows[0][@"id"]], &refusal);
        printf("presentationPageView: %.1f ms\n%s\n", -[t timeIntervalSinceNow] * 1000, (page ?: refusal).UTF8String);
        sqlite3_close(db);
    }
    return 0;
}
