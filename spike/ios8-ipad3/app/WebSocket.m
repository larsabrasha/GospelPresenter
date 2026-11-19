// GPWebSocket (WebSocket.h): the HTTP upgrade, then frames. Everything on the main run loop, as the rest of the app.
// The frames read: text (1), binary (2, ignored), continuation (0, joined to what it continues), close (8, answered),
// ping (9, answered with a pong) and pong (10); a frame from the server is never masked, one from a client always is.
#import "WebSocket.h"
#import <CommonCrypto/CommonDigest.h>
#include <Security/SecRandom.h>

@interface GPWebSocket () <NSStreamDelegate>
@end

@implementation GPWebSocket {
    NSInputStream *input;
    NSOutputStream *output;
    NSMutableData *received;    // bytes read and not yet taken
    NSMutableData *unsent;      // bytes waiting for room in the output stream
    NSData *request;            // the upgrade, sent once the output stream opens
    NSString *key;              // Sec-WebSocket-Key
    BOOL upgraded, closed;
    NSMutableData *message;     // a fragmented message's parts so far
    uint8_t messageKind;
}

- (instancetype)initWithURL:(NSURL *)url protocol:(NSString *)protocol headers:(NSDictionary *)headers {
    if (!(self = [super init])) return nil;
    received = [NSMutableData data];
    unsent = [NSMutableData data];
    uint8_t nonce[16];
    SecRandomCopyBytes(kSecRandomDefault, sizeof nonce, nonce);
    key = [[NSData dataWithBytes:nonce length:sizeof nonce] base64EncodedStringWithOptions:0];
    BOOL secure = [url.scheme isEqual:@"wss"] || [url.scheme isEqual:@"https"];
    NSInteger port = url.port ? url.port.integerValue : (secure ? 443 : 80);
    NSString *path = url.path.length ? url.path : @"/";
    if (url.query) path = [path stringByAppendingFormat:@"?%@", url.query];
    NSMutableString *r = [NSMutableString stringWithFormat:@"GET %@ HTTP/1.1\r\nHost: %@:%ld\r\nUpgrade: websocket\r\n"
                          "Connection: Upgrade\r\nSec-WebSocket-Key: %@\r\nSec-WebSocket-Version: 13\r\n", path, url.host, (long)port, key];
    if (protocol) [r appendFormat:@"Sec-WebSocket-Protocol: %@\r\n", protocol];
    for (NSString *name in headers) [r appendFormat:@"%@: %@\r\n", name, headers[name]];
    [r appendString:@"\r\n"];
    request = [r dataUsingEncoding:NSUTF8StringEncoding];
    CFReadStreamRef readStream;
    CFWriteStreamRef writeStream;
    CFStreamCreatePairWithSocketToHost(NULL, (__bridge CFStringRef)url.host, (UInt32)port, &readStream, &writeStream);
    input = (__bridge_transfer NSInputStream *)readStream;
    output = (__bridge_transfer NSOutputStream *)writeStream;
    if (secure) {
        [input setProperty:NSStreamSocketSecurityLevelNegotiatedSSL forKey:NSStreamSocketSecurityLevelKey];
        [output setProperty:NSStreamSocketSecurityLevelNegotiatedSSL forKey:NSStreamSocketSecurityLevelKey];
    }
    for (NSStream *s in @[input, output]) {
        s.delegate = self;
        [s scheduleInRunLoop:[NSRunLoop mainRunLoop] forMode:NSDefaultRunLoopMode];
        [s open];
    }
    return self;
}

#pragma mark - Writing

- (void)write:(NSData *)bytes {
    [unsent appendData:bytes];
    [self flush];
}

- (void)flush {
    while (unsent.length && output.hasSpaceAvailable) {
        NSInteger n = [output write:unsent.bytes maxLength:unsent.length];
        if (n <= 0) return;
        [unsent replaceBytesInRange:NSMakeRange(0, (NSUInteger)n) withBytes:NULL length:0];
    }
}

/// A frame from the client: FIN, the opcode, the length, a mask and the payload masked with it.
- (void)send:(uint8_t)opcode payload:(NSData *)payload {
    NSMutableData *f = [NSMutableData data];
    uint8_t head[2] = {(uint8_t)(0x80 | opcode), 0x80};
    if (payload.length < 126) {
        head[1] |= (uint8_t)payload.length;
        [f appendBytes:head length:2];
    } else {
        head[1] |= 126;
        uint16_t n = CFSwapInt16HostToBig((uint16_t)payload.length);   // a pong or a close is never longer
        [f appendBytes:head length:2];
        [f appendBytes:&n length:2];
    }
    uint8_t mask[4];
    SecRandomCopyBytes(kSecRandomDefault, 4, mask);
    [f appendBytes:mask length:4];
    const uint8_t *p = payload.bytes;
    for (NSUInteger i = 0; i < payload.length; i++) {
        uint8_t b = p[i] ^ mask[i % 4];
        [f appendBytes:&b length:1];
    }
    [self write:f];
}

#pragma mark - Reading

- (void)stream:(NSStream *)s handleEvent:(NSStreamEvent)event {
    switch (event) {
    case NSStreamEventOpenCompleted:
        if (s == output) [self write:request];
        break;
    case NSStreamEventHasSpaceAvailable:
        [self flush];
        break;
    case NSStreamEventHasBytesAvailable: {
        uint8_t buffer[4096];
        NSInteger n;
        while (input.hasBytesAvailable && (n = [input read:buffer maxLength:sizeof buffer]) > 0) [received appendBytes:buffer length:(NSUInteger)n];
        if (!upgraded) [self readUpgrade];
        if (upgraded) [self readFrames];
        break;
    }
    case NSStreamEventErrorOccurred:
        [self end:s.streamError.localizedDescription ?: @"error"];
        break;
    case NSStreamEventEndEncountered:
        [self end:@"closed by the host"];
        break;
    default:
        break;
    }
}

/// The upgrade's answer: 101, and Sec-WebSocket-Accept the key's SHA-1 with RFC 6455's GUID.
- (void)readUpgrade {
    NSData *gap = [@"\r\n\r\n" dataUsingEncoding:NSUTF8StringEncoding];
    NSRange end = [received rangeOfData:gap options:0 range:NSMakeRange(0, received.length)];
    if (end.location == NSNotFound) return;
    NSString *answer = [[NSString alloc] initWithData:[received subdataWithRange:NSMakeRange(0, end.location)] encoding:NSUTF8StringEncoding];
    [received replaceBytesInRange:NSMakeRange(0, NSMaxRange(end)) withBytes:NULL length:0];
    NSArray *lines = [answer componentsSeparatedByString:@"\r\n"];
    if (![lines.firstObject hasPrefix:@"HTTP/1.1 101"]) { [self end:lines.firstObject ?: @"no answer"]; return; }
    NSData *seed = [[key stringByAppendingString:@"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"] dataUsingEncoding:NSUTF8StringEncoding];
    uint8_t digest[CC_SHA1_DIGEST_LENGTH];
    CC_SHA1(seed.bytes, (CC_LONG)seed.length, digest);
    NSString *expected = [[NSData dataWithBytes:digest length:sizeof digest] base64EncodedStringWithOptions:0];
    BOOL accepted = NO;
    for (NSString *line in lines) {
        NSRange colon = [line rangeOfString:@":"];
        if (colon.location == NSNotFound) continue;
        NSString *name = [[line substringToIndex:colon.location] lowercaseString];
        NSString *value = [[line substringFromIndex:colon.location + 1] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if ([name isEqual:@"sec-websocket-accept"]) accepted = [value isEqual:expected];
    }
    if (!accepted) { [self end:@"the accept key is wrong"]; return; }
    upgraded = YES;
    if (self.onOpen) self.onOpen();
}

/// Every whole frame read so far; a part of one waits for the rest.
- (void)readFrames {
    while (!closed && received.length >= 2) {
        const uint8_t *p = received.bytes;
        BOOL fin = p[0] & 0x80, masked = p[1] & 0x80;
        uint8_t opcode = p[0] & 0x0F;
        uint64_t length = p[1] & 0x7F;
        NSUInteger at = 2;
        if (length == 126) {
            if (received.length < 4) return;
            length = (uint64_t)p[2] << 8 | p[3];
            at = 4;
        } else if (length == 127) {
            if (received.length < 10) return;
            length = 0;
            for (int i = 0; i < 8; i++) length = length << 8 | p[2 + i];
            at = 10;
        }
        uint8_t mask[4] = {0};
        if (masked) {
            if (received.length < at + 4) return;
            memcpy(mask, p + at, 4);
            at += 4;
        }
        if (received.length < at + length) return;
        NSMutableData *payload = [[received subdataWithRange:NSMakeRange(at, (NSUInteger)length)] mutableCopy];
        if (masked) { uint8_t *q = payload.mutableBytes; for (NSUInteger i = 0; i < payload.length; i++) q[i] ^= mask[i % 4]; }
        [received replaceBytesInRange:NSMakeRange(0, at + (NSUInteger)length) withBytes:NULL length:0];
        [self took:opcode fin:fin payload:payload];
    }
}

- (void)took:(uint8_t)opcode fin:(BOOL)fin payload:(NSData *)payload {
    switch (opcode) {
    case 0x9: [self send:0xA payload:payload]; return;                      // ping → pong
    case 0xA: return;                                                       // pong
    case 0x8: [self send:0x8 payload:[NSData data]]; [self end:@"closed by the host"]; return;
    case 0x0: if (message) [message appendData:payload]; break;            // a continuation
    default: messageKind = opcode; message = [payload mutableCopy]; break;  // text or binary
    }
    if (!fin || !message) return;
    if (messageKind == 0x1 && self.onMessage) self.onMessage([[NSString alloc] initWithData:message encoding:NSUTF8StringEncoding]);
    message = nil;
}

#pragma mark - Ending

- (void)close {
    if (closed) return;
    if (upgraded) { [self send:0x8 payload:[NSData data]]; [self flush]; }
    [self end:@"closed here"];
}

- (void)end:(NSString *)why {
    if (closed) return;
    closed = YES;
    for (NSStream *s in @[input, output]) { s.delegate = nil; [s close]; [s removeFromRunLoop:[NSRunLoop mainRunLoop] forMode:NSDefaultRunLoopMode]; }
    void (^done)(NSString *) = self.onClose;
    self.onClose = nil;
    self.onOpen = nil;
    self.onMessage = nil;
    if (done) done(why);
}
@end
