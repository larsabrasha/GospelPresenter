// Presenting, as the native app's Live.swift and Model.swift have it, the core deciding everything: the app's live
// state (which presentation is presented, its slide, black, the overlay), changed only by `liveChangeView`; the marks
// VISAS and NÄSTA (`slideMarksView`); and a page's own state (the item selected, the slide made ready), every event
// of the page (a tap on a slide, ▶, Släck, a key) answered by `pageEventView`, its change to the live state made.
#import <Foundation/Foundation.h>
#import "Presentations.h"

/// Sent after every change of the live state: what shows it reads it again.
extern NSString *const GPLiveChanged;
/// Sent by a page model whose page was read again (a change here, or one the sync brought): its views reload in place,
/// the slides with the item the core keeps at the top of the screen as userInfo's "stay" (none: where they stand).
extern NSString *const GPPageChanged;

@interface GPLive : NSObject
- (instancetype)initWithSource:(id<GPPresentationSource>)source;
/// The live state as the core left it ({presentationId, itemId, partIndex, black, overlayId, rev}).
@property (nonatomic, readonly) NSDictionary *state;
/// The presentation presented, nil before Starta and after Avsluta; its page, read again with every change.
@property (nonatomic, readonly) NSString *presentationId;
@property (nonatomic, readonly) NSDictionary *page;
/// "itemId/partIndex" of the slide marked VISAS and the one marked NÄSTA.
@property (nonatomic, readonly) NSString *shownKey, *nextKey;
/// What the outputs show: nil before the first slide, after Släck and before presenting.
@property (nonatomic, readonly) NSDictionary *slide;
/// The slide NÄSTA marks, and the item each is in.
@property (nonatomic, readonly) NSDictionary *nextSlide;
@property (nonatomic, readonly) NSString *slideTitle, *nextTitle;
@property (nonatomic, readonly) BOOL black;
/// A change as the core makes it: NO when it refused (another presentation is presented).
- (BOOL)change:(NSDictionary *)change;
/// Avsluta: nothing presented.
- (void)end;
/// After a sync: the presented page read again; a presentation gone ends it.
- (void)reload;
@end

/// The running order as the core takes it: each item's id and how many slides it has.
NSArray *GPOrder(NSDictionary *page);

/// "itemId/partIndex".
NSString *GPSlideKey(NSString *itemId, NSInteger partIndex);

@interface GPPageModel : NSObject
- (instancetype)initWithPage:(NSDictionary *)page live:(GPLive *)live source:(id<GPPresentationSource>)source;
@property (nonatomic, readonly) NSDictionary *page;
@property (nonatomic, readonly) GPLive *live;
@property (nonatomic, readonly) id<GPPresentationSource> source;
/// The item shown, while this page's presentation is presented.
@property (nonatomic, readonly) NSString *liveItemId;
/// The page's own state as the core keeps it (selectedId, picked {itemId, partIndex}, presenting, followed, ...).
@property (nonatomic, readonly) NSDictionary *state;
/// This page's presentation is the one presented.
@property (nonatomic, readonly) BOOL isLive;
/// Whether ▶ may start (`pageModelView`), and there is something to show.
@property (nonatomic, readonly) BOOL canStart;
/// "itemId/partIndex" of the slide made ready, nil when none.
@property (nonatomic, readonly) NSString *pickedKey;
/// An event of the page ({"type": "show", "itemId", "partIndex"}, {"type": "start"}, {"type": "black"}, a key's):
/// its answer's state kept and its change to the live state made; the answer, nil when the core gave none.
- (NSDictionary *)send:(NSDictionary *)event;
/// Avsluta (■, asked first): nothing presented, and the page as that leaves it.
- (void)liveEnded;
/// The items on the screen, the top first: what the slides tell the core when the page is read again.
@property (nonatomic, copy) NSArray *(^onScreen)(void);
/// The page read again: the core's `changed` event says which item stays at the top (GPPageChanged's "stay"), and
/// what of the state the page no longer has is let go of; its views reload in place.
- (void)reloadPage:(NSDictionary *)page;
/// A change of the data from this page (renameItem, addSongToPresentation, ...): nil, or the refusal's code; the page
/// read again after it.
- (NSString *)run:(NSString *)name args:(NSDictionary *)args;
@end
