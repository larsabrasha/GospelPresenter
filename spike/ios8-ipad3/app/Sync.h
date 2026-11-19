// An organisation synced from a desktop host on the LAN: paired as the native shell pairs
// (apps/mac/Sources/Shell/Server.swift's Pairing); a change run at once and queued, the queue pushed and the server's
// changes pulled into a local SQLite as SyncClient does (Sync.swift); the queue, the rebase and the triggers the core's.
#import <Foundation/Foundation.h>
#include "sqlite3.h"

@interface GPSync : NSObject
/// The organisation's database, open; the caller the sync's commands need ({userId, role}); who signed in.
@property (nonatomic, readonly) sqlite3 *db;
@property (nonatomic, readonly) NSDictionary *caller;
@property (nonatomic, readonly) NSDictionary *me;
@property (nonatomic, readonly) NSString *server;

/// The session this device paired with last, its database opened; nil when it has none (or it does not open).
+ (instancetype)saved;

/// How the host at `address` lets a device in: "dev" (no code, GP_DEV_PAIR=1), "code" (the six digits it shows), or
/// an error's text.
+ (void)askHost:(NSString *)address done:(void (^)(NSString *how, NSString *error))done;

/// Pairs with the host (`code` nil: the development route), keeps the session, opens its database.
+ (void)pair:(NSString *)address code:(NSString *)code done:(void (^)(GPSync *sync, NSString *error))done;

/// Why syncing stopped until the person acts ("update-required", "unauthenticated", "not-a-member",
/// "device-not-paired"); nil while it goes on.
@property (nonatomic, readonly) NSString *stopped;

/// A change run at once and queued for the host (`syncMutate`), in one transaction; refused, nothing is written or
/// queued and the refusal's code comes back. Then a sync.
- (NSString *)mutate:(NSString *)name args:(NSDictionary *)args;

/// How many changes wait for the host.
- (NSUInteger)pendingCount;

/// The queue pushed, then every page of changes since the last pull rebased into the database in one transaction;
/// `done` on the main thread. Runs are coalesced: at most one running and one waiting, as Sync.swift's requestSync.
- (void)sync:(void (^)(BOOL changed, NSString *error))done;

/// After a sync of its own (a poke, a reconnection, the backstop poll) that changed rows.
@property (nonatomic, copy) void (^onChange)(void);
/// The poke socket is open.
@property (nonatomic, readonly) BOOL connected;

/// Keeps the poke socket open and syncs on every poke and every (re)connection, and every 5 minutes as a backstop,
/// as Sync.swift's start; until `stopListening` or the host refuses the credentials.
- (void)start;
/// Ends the socket and the poll (the app going to the background, or signing out).
- (void)stopListening;

/// Forgets the session (the database stays).
- (void)signOut;
@end
