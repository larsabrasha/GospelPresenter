// The sync's network and its calls into the core (Sync.h). HTTP with NSURLSession (iOS 7); the poke socket with a
// WebSocket client of our own (WebSocket.m), as NSURLSession has one from iOS 13 only. The session (the host's address, its bearer token, the paired device's token and who) is
// kept in a file in Library, readable by this app alone: on a jailbroken iPad, not the Keychain the native shell
// uses, which an app signed by ldid without entitlements may not reach.
#import "Sync.h"
#import "Core.h"
#import "WebSocket.h"
#import <UIKit/UIKit.h>

static const int kProtocol = 1;   // packages/core/src/protocol.ts, as Sync.swift speaks it

static NSString *library(NSString *name) {
    NSString *dir = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES)[0]
                     stringByAppendingPathComponent:@"GospelPresenter"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:NULL];
    return [dir stringByAppendingPathComponent:name];
}

static NSString *json(id value) {
    NSData *d = [NSJSONSerialization dataWithJSONObject:@[value ?: [NSNull null]] options:0 error:NULL];
    NSString *s = [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding];
    return [s substringWithRange:NSMakeRange(1, s.length - 2)];   // the value alone, out of its array
}

static NSURL *base(NSString *address) {
    NSString *text = [address stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([text rangeOfString:@"://"].location == NSNotFound) text = [@"http://" stringByAppendingString:text];
    while ([text hasSuffix:@"/"]) text = [text substringToIndex:text.length - 1];
    return [NSURL URLWithString:text];
}

/// One request; `done` on the main thread with the status (0: no answer), the body's JSON, and the body's text.
static void request(NSURL *server, NSString *method, NSString *path, NSString *body, NSDictionary *session,
                    void (^done)(NSInteger status, id answer, NSString *text)) {
    NSMutableURLRequest *r = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:[server.absoluteString stringByAppendingString:path]]];
    r.HTTPMethod = method;
    r.timeoutInterval = 20;
    if ([session[@"token"] isKindOfClass:[NSString class]]) [r setValue:[@"Bearer " stringByAppendingString:session[@"token"]] forHTTPHeaderField:@"authorization"];
    if ([session[@"device"] isKindOfClass:[NSString class]]) [r setValue:session[@"device"] forHTTPHeaderField:@"x-gp-device"];
    if (body) {
        [r setValue:@"application/json" forHTTPHeaderField:@"content-type"];
        r.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
    }
    [[[NSURLSession sharedSession] dataTaskWithRequest:r completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)response).statusCode : 0;
        id answer = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
        NSString *text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : error.localizedDescription;
        dispatch_async(dispatch_get_main_queue(), ^{ done(status, answer, text); });
    }] resume];
}

static NSString *refusal(NSInteger status, id answer, NSString *text) {
    if (status == 0) return text ?: @"ingen kontakt";
    NSString *error = [answer isKindOfClass:[NSDictionary class]] ? answer[@"error"] : nil;
    return [NSString stringWithFormat:@"%ld %@", (long)status, error ?: @""];
}

@implementation GPSync {
    NSDictionary *session;   // {server, token, device, me}
    NSURL *url;
    NSString *clientId;
    BOOL running, again;     // a sync running, and another asked for meanwhile
    NSMutableArray *waiting; // the `done`s of the syncs asked for while one ran
    BOOL changedMeanwhile;
    GPWebSocket *socket;
    NSTimer *poll;
    BOOL listening;
}

#pragma mark - The poke socket

- (void)start {
    if (listening) return;
    listening = YES;
    [self listen];
    poll = [NSTimer scheduledTimerWithTimeInterval:300 target:self selector:@selector(syncNotifying) userInfo:nil repeats:YES];
}

- (void)stopListening {
    listening = NO;
    [poll invalidate];
    poll = nil;
    [socket close];
    socket = nil;
    _connected = NO;
}

/// One connection of /api/sync/poke, until it closes; then another after 3 s while listening.
- (void)listen {
    if (!listening || _stopped) return;
    NSString *scheme = [url.scheme isEqual:@"https"] ? @"wss" : @"ws";
    NSString *address = [NSString stringWithFormat:@"%@://%@:%@/api/sync/poke?clientId=%@", scheme, url.host,
                         url.port ?: ([scheme isEqual:@"wss"] ? @443 : @80), clientId];
    NSMutableDictionary *headers = [NSMutableDictionary dictionary];
    if ([session[@"token"] isKindOfClass:[NSString class]]) headers[@"Authorization"] = [@"Bearer " stringByAppendingString:session[@"token"]];
    if ([session[@"device"] isKindOfClass:[NSString class]]) headers[@"x-gp-device"] = session[@"device"];
    GPWebSocket *ws = [[GPWebSocket alloc] initWithURL:[NSURL URLWithString:address] protocol:@"gp.v1" headers:headers];
    socket = ws;
    __weak GPSync *me = self;
    ws.onOpen = ^{
        GPSync *s = me;
        s->_connected = YES;
        NSLog(@"GPCore8: poke socket open");
        [s syncNotifying];   // catch up on what happened while disconnected
    };
    ws.onMessage = ^(NSString *text) {
        NSLog(@"GPCore8: poke %@", text);
        [me syncNotifying];
    };
    ws.onClose = ^(NSString *why) {
        GPSync *s = me;
        if (!s) return;
        BOOL was = s->_connected;
        s->_connected = NO;
        if (s->socket == ws) s->socket = nil;
        NSLog(@"GPCore8: poke socket closed: %@", why);
        // A refused socket says nothing of why: a sync tells offline from refused credentials.
        if (!was) [s syncNotifying];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            GPSync *later = me;
            if (later && !later->socket) [later listen];
        });
    };
}

- (void)syncNotifying {
    [self sync:^(BOOL changed, NSString *error) {
        if (error) NSLog(@"GPCore8: sync: %@", error);
        if (changed && self.onChange) self.onChange();
    }];
}

- (instancetype)initWithSession:(NSDictionary *)s error:(NSString **)error {
    if (!(self = [super init])) return nil;
    session = s;
    url = base(s[@"server"]);
    _me = s[@"me"];
    _server = s[@"server"];
    _caller = @{@"userId": _me[@"userId"] ?: @"", @"role": _me[@"role"] ?: @""};
    NSString *path = library([NSString stringWithFormat:@"org-%@.sqlite", _me[@"orgId"]]);
    if (sqlite3_open(path.UTF8String, &_db) != SQLITE_OK) { *error = @"databasen öppnas inte"; return nil; }
    // Foreign keys on before the transaction (SQLite ignores the PRAGMA inside one), then the schema and the sync's
    // tables and triggers in one, as SyncClient's init.
    sqlite3_exec(_db, "PRAGMA journal_mode = WAL", NULL, NULL, NULL);
    sqlite3_exec(_db, "PRAGMA foreign_keys = ON", NULL, NULL, NULL);
    sqlite3_exec(_db, "BEGIN", NULL, NULL, NULL);
    NSString *refused = nil;
    GPCoreCallAs(_db, @"migrateOrgSchema", @"{}", nil, &refused);
    NSString *opened = refused ? nil : GPCoreCallAs(_db, @"syncOpen", [NSString stringWithFormat:@"{\"clientId\":%@}",
                                                    json([[NSUUID UUID].UUIDString lowercaseString])], _caller, &refused);
    sqlite3_exec(_db, refused ? "ROLLBACK" : "COMMIT", NULL, NULL, NULL);
    if (refused) { *error = refused; return nil; }
    clientId = [NSJSONSerialization JSONObjectWithData:[opened dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL][@"clientId"];
    return self;
}

+ (instancetype)saved {
    NSData *d = [NSData dataWithContentsOfFile:library(@"session.json")];
    NSDictionary *s = d ? [NSJSONSerialization JSONObjectWithData:d options:0 error:NULL] : nil;
    if (![s isKindOfClass:[NSDictionary class]]) return nil;
    NSString *error = nil;
    GPSync *sync = [[GPSync alloc] initWithSession:s error:&error];
    if (!sync) NSLog(@"GPCore8: the saved session does not open: %@", error);
    return sync;
}

+ (void)askHost:(NSString *)address done:(void (^)(NSString *, NSString *))done {
    NSURL *server = base(address);
    if (!server.host) { done(nil, @"ogiltig adress"); return; }
    request(server, @"GET", @"/api/pair/status", nil, nil, ^(NSInteger status, id answer, NSString *text) {
        if (status != 200 || ![answer isKindOfClass:[NSDictionary class]] || ![answer[@"required"] boolValue]) {
            done(nil, status == 200 ? @"ingen skrivbordsvärd som parar enheter" : refusal(status, answer, text));
            return;
        }
        done([answer[@"dev"] boolValue] ? @"dev" : @"code", nil);
    });
}

+ (void)pair:(NSString *)address code:(NSString *)code done:(void (^)(GPSync *, NSString *))done {
    NSURL *server = base(address);
    NSString *name = [UIDevice currentDevice].name;
    NSString *body = code ? [NSString stringWithFormat:@"{\"code\":%@,\"name\":%@}", json(code), json(name)]
                          : [NSString stringWithFormat:@"{\"name\":%@}", json(name)];
    request(server, @"POST", code ? @"/api/pair/claim" : @"/api/pair/dev", body, nil, ^(NSInteger status, id answer, NSString *text) {
        NSDictionary *signedIn = [answer isKindOfClass:[NSDictionary class]] ? answer[@"session"] : nil;
        if (status != 200 || !signedIn[@"token"] || !signedIn[@"me"]) { done(nil, refusal(status, answer, text)); return; }
        NSDictionary *s = @{@"server": server.absoluteString, @"token": signedIn[@"token"],
                            @"device": answer[@"device"] ?: [NSNull null], @"me": signedIn[@"me"]};
        NSString *error = nil;
        GPSync *sync = [[GPSync alloc] initWithSession:s error:&error];
        if (sync) {
            NSData *d = [NSJSONSerialization dataWithJSONObject:s options:0 error:NULL];
            [d writeToFile:library(@"session.json") options:NSDataWritingAtomic | NSDataWritingFileProtectionComplete error:NULL];
        }
        done(sync, error);
    });
}

- (void)signOut {
    [self stopListening];
    [[NSFileManager defaultManager] removeItemAtPath:library(@"session.json") error:NULL];
}

/// A request's common fields, before its own (Sync.swift's head()).
- (NSString *)head {
    sqlite3_stmt *st = NULL;
    sqlite3_int64 version = 0;
    if (sqlite3_prepare_v2(_db, "SELECT version FROM _schema WHERE one = 1", -1, &st, NULL) == SQLITE_OK && sqlite3_step(st) == SQLITE_ROW)
        version = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return [NSString stringWithFormat:@"\"protocol\":%d,\"schemaVersion\":%lld,\"clientId\":%@", kProtocol, version, json(clientId)];
}

/// An answer that stops syncing: "update required", or credentials the host no longer takes (SYNC-A15).
- (BOOL)refused:(NSInteger)status answer:(id)answer {
    NSString *error = [answer isKindOfClass:[NSDictionary class]] ? answer[@"error"] : nil;
    BOOL stops = (status == 426 && [error isEqual:@"update-required"]) ||
                 ((status == 401 || status == 403) && [@[@"unauthenticated", @"not-a-member", @"device-not-paired"] containsObject:error ?: @""]);
    if (stops) _stopped = error;
    return stops;
}

- (NSString *)mutate:(NSString *)name args:(NSDictionary *)args {
    NSString *refused = nil;
    GPCoreCommandAs(_db, @"syncMutate", [NSString stringWithFormat:@"{\"mutator\":%@,\"args\":%@}", json(name), json(json(args))], _caller, &refused);
    NSLog(@"GPCore8: %@ %@", name, refused ?: @"ok");
    if (!refused) [self sync:^(BOOL changed, NSString *error) { if (error) NSLog(@"GPCore8: sync after %@: %@", name, error); }];
    return refused;
}

- (NSArray *)pending {
    NSString *text = GPCoreCallAs(_db, @"syncPending", @"{}", _caller, NULL);
    id queue = text ? [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL] : nil;
    return [queue isKindOfClass:[NSArray class]] ? queue : @[];
}

- (NSUInteger)pendingCount { return [self pending].count; }

/// Sends the queue: each change's arguments as the core queued them, their JSON text unchanged. A network failure
/// leaves it as it is; the host confirms through the next pull.
- (void)push:(void (^)(NSString *error))done {
    NSArray *queue = [self pending];
    if (_stopped || queue.count == 0) { done(nil); return; }
    NSMutableArray *changes = [NSMutableArray array];
    for (NSDictionary *q in queue)
        [changes addObject:[NSString stringWithFormat:@"{\"id\":%@,\"name\":%@,\"v\":%@,\"args\":%@}", q[@"id"], json(q[@"name"]), q[@"v"], q[@"args"]]];
    NSString *body = [NSString stringWithFormat:@"{%@,\"mutations\":[%@]}", [self head], [changes componentsJoinedByString:@","]];
    request(url, @"POST", @"/api/sync/push", body, session, ^(NSInteger status, id answer, NSString *text) {
        if ([self refused:status answer:answer]) { done(self->_stopped); return; }
        NSLog(@"GPCore8: pushed %lu changes: %ld", (unsigned long)queue.count, (long)status);
        done(status == 200 ? nil : refusal(status, answer, text));
    });
}

- (void)sync:(void (^)(BOOL, NSString *))done {
    if (!waiting) waiting = [NSMutableArray array];
    if (done) [waiting addObject:done];
    if (running) { again = YES; return; }
    running = YES;
    again = NO;
    [self push:^(NSString *pushError) {
        [self pull:^(BOOL changed, NSString *pullError) {
            self->changedMeanwhile |= changed;
            if (self->again) { self->running = NO; [self sync:nil]; return; }
            NSArray *callers = self->waiting;
            BOOL any = self->changedMeanwhile;
            self->waiting = [NSMutableArray array];
            self->changedMeanwhile = NO;
            self->running = NO;
            for (void (^d)(BOOL, NSString *) in callers) d(any, pushError ?: pullError);
        }];
    }];
}

- (void)pull:(void (^)(BOOL, NSString *))done {
    if (_stopped) { done(NO, _stopped); return; }
    sqlite3_stmt *st = NULL;
    NSString *cookie = nil;
    sqlite3_int64 last = 0;
    if (sqlite3_prepare_v2(_db, "SELECT cookie, last_mutation_id FROM _sync_meta", -1, &st, NULL) == SQLITE_OK && sqlite3_step(st) == SQLITE_ROW) {
        if (sqlite3_column_type(st, 0) == SQLITE_TEXT) cookie = @((const char *)sqlite3_column_text(st, 0));
        last = sqlite3_column_int64(st, 1);
    }
    sqlite3_finalize(st);
    [self pullFrom:cookie last:last pages:[NSMutableArray array] done:done];
}

/// One page, then the next while there are more; then the rebase.
- (void)pullFrom:(NSString *)cookie last:(sqlite3_int64)last pages:(NSMutableArray *)pages done:(void (^)(BOOL, NSString *))done {
    NSString *body = [NSString stringWithFormat:@"{%@,\"cookie\":%@,\"lastMutationId\":%lld}", [self head], json(cookie), last];
    request(url, @"POST", @"/api/sync/pull", body, session, ^(NSInteger status, id answer, NSString *text) {
        if ([self refused:status answer:answer]) { done(NO, self->_stopped); return; }
        if (status != 200 || ![answer isKindOfClass:[NSDictionary class]]) { done(NO, refusal(status, answer, text)); return; }
        [pages addObject:text];
        if ([answer[@"more"] boolValue]) { [self pullFrom:answer[@"cookie"] last:last pages:pages done:done]; return; }
        NSDate *t = [NSDate date];
        NSString *refused = nil;
        NSString *rebased = GPCoreCommandAs(self->_db, @"syncRebase", [NSString stringWithFormat:@"{\"pages\":[%@]}",
                                            [pages componentsJoinedByString:@","]], self->_caller, &refused);
        NSLog(@"GPCore8: pulled %lu pages, rebased in %.0f ms%@", (unsigned long)pages.count, -[t timeIntervalSinceNow] * 1000,
              refused ? [@", refused: " stringByAppendingString:refused] : @"");
        if (refused) { done(NO, refused); return; }
        id result = [NSJSONSerialization JSONObjectWithData:[rebased dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
        done([result[@"changed"] boolValue], nil);
    });
}
@end
