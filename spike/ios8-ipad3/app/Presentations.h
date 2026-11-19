// The start page at the root of the left column, as the native app's StartPage.swift and the web's Presentations.tsx
// have it, in iOS 8's parts: Idag, Kommande and Senast ändrade from the core (`startPageView`), each row its name,
// when and where under it and its number of items at the right; + makes a presentation (Details.m); the account's
// button at the left holds Synka nu, Anslut and Logga ut. Pulled down, it syncs.
#import <UIKit/UIKit.h>

/// Where the data is: the demo, or an organisation synced from a host (AppDelegate.m).
@protocol GPPresentationSource <NSObject>
/// A view of the core, decoded.
- (id)view:(NSString *)name args:(NSDictionary *)args;
/// presentationPageView's answer for one, nil when there is none.
- (NSDictionary *)page:(NSString *)presentationId;
/// A change run through the core (queued for the host when synced): nil, or the refusal's code.
- (NSString *)mutate:(NSString *)name args:(NSDictionary *)args;
/// The signed-in member's name, nil in the demo.
- (NSString *)accountName;
/// Under the lists: what it is synced with, or that it is the demo.
- (NSString *)sourceNote;
/// A sync with the host; `done` with an error's text or nil.
- (void)refresh:(void (^)(NSString *error))done;
/// Pairs with a host, asking for its address (and its code) from `controller`.
- (void)connectFrom:(UIViewController *)controller;
/// Forgets the session and goes back to the demo.
- (void)signOut;
@end

@interface GPPresentationsController : UITableViewController
- (instancetype)initWithSource:(id<GPPresentationSource>)source;
/// Reads the lists again.
- (void)reload;
@end

/// The text of a refusal's code: the web's `error.<code>` where it has one, else the code.
NSString *GPRefusalText(NSString *code);
