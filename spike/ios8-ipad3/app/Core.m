// The core's `start` and `resume` through UniFFI's C functions, without the generated Swift, run on a SQLite database
// as the native shell's Core.call does (apps/mac/Sources/Shell/Shell.swift): the core asks for each statement, and
// gets its rows. UniFFI's serialized values: big-endian integers, an enum as an i32 variant from 1, an Option as an
// i8 tag, a String or a Vec as an i32 length then its bytes or items.
#import "Core.h"
#include "gp_core_ffi.h"

// Writing UniFFI's values.

static void putI32(NSMutableData *d, int32_t v) {
    uint32_t b = CFSwapInt32HostToBig((uint32_t)v);
    [d appendBytes:&b length:4];
}

static void putI64(NSMutableData *d, int64_t v) {
    uint64_t b = CFSwapInt64HostToBig((uint64_t)v);
    [d appendBytes:&b length:8];
}

static void putString(NSMutableData *d, const char *s, size_t n) {
    putI32(d, (int32_t)n);
    [d appendBytes:s length:n];
}

static RustBuffer bufferOf(NSData *bytes) {
    RustCallStatus status = {0};
    ForeignBytes foreign = { (int32_t)bytes.length, bytes.bytes };
    return ffi_gp_core_ffi_rustbuffer_from_bytes(foreign, &status);
}

static RustBuffer bufferOfString(NSString *text) {
    return bufferOf([text dataUsingEncoding:NSUTF8StringEncoding]);
}

// Reading them.

typedef struct { const uint8_t *p; size_t at; } Reader;

static int32_t readI32(Reader *r) {
    const uint8_t *p = r->p + r->at;
    r->at += 4;
    return (int32_t)((uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]);
}

static uint64_t readU64(Reader *r) {
    uint64_t v = 0;
    for (int i = 0; i < 8; i++) v = v << 8 | r->p[r->at + i];
    r->at += 8;
    return v;
}

static NSString *readString(Reader *r) {
    int32_t n = readI32(r);
    NSString *s = [[NSString alloc] initWithBytes:r->p + r->at length:(NSUInteger)n encoding:NSUTF8StringEncoding];
    r->at += (size_t)n;
    return s;
}

/// A SqlValue, bound to the statement's parameter `at` (1 = Null, 2 = Integer, 3 = Real, 4 = Text).
static void bindValue(Reader *r, sqlite3_stmt *st, int at) {
    switch (readI32(r)) {
    case 2: sqlite3_bind_int64(st, at, (int64_t)readU64(r)); break;
    case 3: { uint64_t bits = readU64(r); double x; memcpy(&x, &bits, 8); sqlite3_bind_double(st, at, x); break; }
    case 4: { int32_t n = readI32(r); sqlite3_bind_text(st, at, (const char *)r->p + r->at, n, SQLITE_TRANSIENT); r->at += (size_t)n; break; }
    default: sqlite3_bind_null(st, at); break;
    }
}

/// The rows of the statement as a serialized SqlAnswer: Rows (1) with every value, or Failed (2) with SQLite's message.
static NSData *answer(sqlite3 *db, NSString *sql, Reader *params) {
    NSMutableData *rows = [NSMutableData data];
    sqlite3_stmt *st = NULL;
    int32_t count = 0;
    int rc = sqlite3_prepare_v2(db, sql.UTF8String, -1, &st, NULL);
    if (rc == SQLITE_OK) {
        int32_t n = readI32(params);
        for (int32_t i = 0; i < n; i++) bindValue(params, st, i + 1);
        while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
            int columns = sqlite3_column_count(st);
            putI32(rows, columns);
            for (int c = 0; c < columns; c++) {
                switch (sqlite3_column_type(st, c)) {
                case SQLITE_INTEGER: putI32(rows, 2); putI64(rows, sqlite3_column_int64(st, c)); break;
                case SQLITE_FLOAT: { double x = sqlite3_column_double(st, c); uint64_t bits; memcpy(&bits, &x, 8); putI32(rows, 3); putI64(rows, (int64_t)bits); break; }
                case SQLITE_TEXT: putI32(rows, 4); putString(rows, (const char *)sqlite3_column_text(st, c), (size_t)sqlite3_column_bytes(st, c)); break;
                default: putI32(rows, 1); break;  // null, and a blob: the core reads no bytes
                }
            }
            count++;
        }
    }
    NSMutableData *out = [NSMutableData data];
    if (rc != SQLITE_DONE) {
        const char *message = sqlite3_errmsg(db);
        putI32(out, 2);
        putString(out, message, strlen(message));
    } else {
        putI32(out, 1);
        putI32(out, count);
        [out appendData:rows];
    }
    sqlite3_finalize(st);
    return out;
}

/// UniFFI's Option<Caller>: none (0), or some (1) and the record's fields in order: user_id, role, now (none).
static NSData *callerOf(NSDictionary *caller) {
    NSMutableData *d = [NSMutableData data];
    uint8_t tag = caller ? 1 : 0, none = 0;
    [d appendBytes:&tag length:1];
    if (!caller) return d;
    for (NSString *field in @[@"userId", @"role"]) {
        NSData *text = [[caller[field] description] dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
        putString(d, text.bytes, text.length);
    }
    [d appendBytes:&none length:1];
    return d;
}

NSString *GPCoreCall(sqlite3 *db, NSString *name, NSString *args, NSString **refusal) {
    return GPCoreCallAs(db, name, args, nil, refusal);
}

NSString *GPCoreCallAs(sqlite3 *db, NSString *name, NSString *args, NSDictionary *caller, NSString **refusal) {
    RustCallStatus status = {0};
    RustBuffer step = uniffi_gp_core_ffi_fn_func_start(bufferOfString(name), bufferOfString(args),
                                                       bufferOf(callerOf(caller)), &status);
    while (status.code == 0) {
        Reader r = { step.data, 0 };
        int32_t kind = readI32(&r);
        if (kind != 3) {
            NSString *json = nil;
            if (kind == 1 && r.p[r.at++]) json = readString(&r);
            if (kind == 2 && refusal) *refusal = readString(&r);
            RustCallStatus freeStatus = {0};
            ffi_gp_core_ffi_rustbuffer_free(step, &freeStatus);
            return json;
        }
        NSString *sql = readString(&r);
        NSData *rows = answer(db, sql, &r);
        RustCallStatus freeStatus = {0};
        ffi_gp_core_ffi_rustbuffer_free(step, &freeStatus);
        step = uniffi_gp_core_ffi_fn_func_resume(bufferOf(rows), &status);
    }
    if (refusal) *refusal = [NSString stringWithFormat:@"call failed: %d", status.code];
    return nil;
}

NSString *GPCoreCommand(sqlite3 *db, NSString *name, NSString *args, NSString **refusal) {
    return GPCoreCommandAs(db, name, args, nil, refusal);
}

NSString *GPCoreCommandAs(sqlite3 *db, NSString *name, NSString *args, NSDictionary *caller, NSString **refusal) {
    sqlite3_exec(db, "BEGIN", NULL, NULL, NULL);
    NSString *gone = nil;
    NSString *json = GPCoreCallAs(db, name, args, caller, &gone);
    sqlite3_exec(db, gone ? "ROLLBACK" : "COMMIT", NULL, NULL, NULL);
    if (refusal) *refusal = gone;
    return json;
}

id GPCoreView(sqlite3 *db, NSString *name, NSDictionary *args) {
    NSData *text = [NSJSONSerialization dataWithJSONObject:args ?: @{} options:0 error:NULL];
    NSString *json = GPCoreCall(db, name, [[NSString alloc] initWithData:text encoding:NSUTF8StringEncoding], NULL);
    if (!json) return nil;
    return [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
}
