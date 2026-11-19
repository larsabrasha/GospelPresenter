// An organisation synced from a desktop host on the LAN, read only: paired as the native shell pairs
// (apps/mac/Sources/Shell/Server.swift's Pairing), its changes pulled into a local SQLite as SyncClient.pull does
// (Sync.swift), the queue, the rebase and the triggers the core's.
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

/// Every page of changes since the last pull, rebased into the database in one transaction; on the main thread.
- (void)pull:(void (^)(BOOL changed, NSString *error))done;

/// Forgets the session (the database stays).
- (void)signOut;
@end
