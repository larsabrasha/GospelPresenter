// The core's `start` through UniFFI's C functions, without the generated Swift: a view that asks no SQL, its answer
// read from UniFFI's serialized Step (big-endian i32 variant from 1, i8 option tag, i32 length then UTF-8).
#import <Foundation/Foundation.h>
#include "gp_core_ffi.h"

static RustBuffer bufferOf(NSString *text) {
    NSData *bytes = [text dataUsingEncoding:NSUTF8StringEncoding];
    RustCallStatus status = {0};
    ForeignBytes foreign = { (int32_t)bytes.length, bytes.bytes };
    return ffi_gp_core_ffi_rustbuffer_from_bytes(foreign, &status);
}

static int32_t readI32(const uint8_t *p) { return (int32_t)((uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]); }

static NSString *readString(const uint8_t *p, size_t *at) {
    int32_t n = readI32(p + *at);
    *at += 4;
    NSString *s = [[NSString alloc] initWithBytes:p + *at length:(NSUInteger)n encoding:NSUTF8StringEncoding];
    *at += (size_t)n;
    return s;
}

/// A view's answer as JSON text, "refused: <code>", or what else came back.
NSString *GPCoreView(NSString *name, NSString *args) {
    RustCallStatus status = {0};
    uint8_t none = 0;
    RustCallStatus allocStatus = {0};
    RustBuffer caller = ffi_gp_core_ffi_rustbuffer_from_bytes((ForeignBytes){ 1, &none }, &allocStatus);
    RustBuffer out = uniffi_gp_core_ffi_fn_func_start(bufferOf(name), bufferOf(args), caller, &status);
    if (status.code != 0) return [NSString stringWithFormat:@"call failed: %d", status.code];
    const uint8_t *p = out.data;
    size_t at = 4;
    NSString *answer;
    switch (readI32(p)) {
    case 1: answer = p[at++] ? readString(p, &at) : @"(none)"; break;
    case 2: answer = [@"refused: " stringByAppendingString:readString(p, &at)]; break;
    default: answer = @"asked for SQL"; break;
    }
    RustCallStatus freeStatus = {0};
    ffi_gp_core_ffi_rustbuffer_free(out, &freeStatus);
    return answer;
}
