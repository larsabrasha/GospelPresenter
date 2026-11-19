// A WebSocket client of our own (RFC 6455) over NSStream, for iOS 8, whose NSURLSession has none (iOS 13): enough
// for the host's poke socket (/api/sync/poke), which sends short text messages and needs nothing sent back. ws:// on
// the LAN; wss:// through the streams' TLS, with the system's trust (a self-signed host is refused).
#import <Foundation/Foundation.h>

@interface GPWebSocket : NSObject
/// Opened at once. `headers` go into the upgrade request beside the WebSocket's own (a native client can send the
/// credentials as headers, where a browser offers them as subprotocols); `protocol` is offered as the subprotocol.
- (instancetype)initWithURL:(NSURL *)url protocol:(NSString *)protocol headers:(NSDictionary *)headers;
/// The upgrade answered (101, the accept key right): the socket is open.
@property (nonatomic, copy) void (^onOpen)(void);
/// A text message.
@property (nonatomic, copy) void (^onMessage)(NSString *text);
/// Closed, by either side or by the network; once, and nothing more comes after it.
@property (nonatomic, copy) void (^onClose)(NSString *why);
/// Ends it (a close frame, then the streams).
- (void)close;
@end
