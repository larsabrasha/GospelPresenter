// The core, run on a SQLite database (Core.m).
#import <Foundation/Foundation.h>
#include "sqlite3.h"

/// One call of the core to its end, each statement it asks for answered from `db`: a view's JSON text (nil for a
/// command, or when refused; then `refusal` is the code). In whatever transaction the caller holds.
NSString *GPCoreCall(sqlite3 *db, NSString *name, NSString *args, NSString **refusal);

/// A command in a transaction of its own, rolled back when the core refuses it.
NSString *GPCoreCommand(sqlite3 *db, NSString *name, NSString *args, NSString **refusal);

/// A view's answer, decoded by NSJSONSerialization; nil when refused.
id GPCoreView(sqlite3 *db, NSString *name, NSDictionary *args);
