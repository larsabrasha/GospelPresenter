// Live.h: the live state and a page's events, every decision the core's.
#import "Live.h"

NSString *const GPLiveChanged = @"GPLiveChanged";
NSString *const GPPageChanged = @"GPPageChanged";

NSArray *GPOrder(NSDictionary *page) {
    NSMutableArray *order = [NSMutableArray array];
    for (NSDictionary *item in page[@"items"]) {
        NSArray *slides = page[@"slides"][item[@"id"]][@"slides"];
        [order addObject:@[item[@"id"], @([slides isKindOfClass:[NSArray class]] ? slides.count : 0)]];
    }
    return order;
}

NSString *GPSlideKey(NSString *itemId, NSInteger partIndex) { return [NSString stringWithFormat:@"%@/%ld", itemId, (long)partIndex]; }

static id orNull(id v) { return v ?: [NSNull null]; }
static BOOL isText(id v) { return [v isKindOfClass:[NSString class]]; }

/// The slide at "itemId/partIndex" of a page, and its item's title.
static NSDictionary *slideAt(NSDictionary *page, NSString *key, NSString **title) {
    if (!key) return nil;
    for (NSDictionary *item in page[@"items"]) {
        NSArray *slides = page[@"slides"][item[@"id"]][@"slides"];
        if (![slides isKindOfClass:[NSArray class]]) continue;
        for (NSUInteger n = 0; n < slides.count; n++) {
            if (![GPSlideKey(item[@"id"], (NSInteger)n) isEqual:key]) continue;
            if (title) *title = item[@"title"];
            return slides[n];
        }
    }
    return nil;
}

@implementation GPLive {
    id<GPPresentationSource> source;
}

- (instancetype)initWithSource:(id<GPPresentationSource>)s {
    if ((self = [super init])) {
        source = s;
        _state = @{@"presentationId": [NSNull null], @"itemId": [NSNull null], @"partIndex": @0, @"black": @NO,
                   @"overlayId": [NSNull null], @"rev": @0};
    }
    return self;
}

- (NSString *)presentationId { return isText(_state[@"presentationId"]) ? _state[@"presentationId"] : nil; }
- (BOOL)black { return [_state[@"black"] boolValue]; }

- (BOOL)change:(NSDictionary *)change {
    // The overlay each item of the presentation carries, for the overlays' rules.
    NSString *target = isText(change[@"presentationId"]) ? change[@"presentationId"] : self.presentationId;
    NSDictionary *page = target ? ([target isEqual:self.presentationId] && _page ? _page : [source page:target]) : nil;
    NSMutableDictionary *overlays = [NSMutableDictionary dictionary];
    for (NSDictionary *item in page[@"items"]) overlays[item[@"id"]] = orNull(isText(item[@"overlayId"]) ? item[@"overlayId"] : nil);
    NSDictionary *answer = [source view:@"liveChangeView" args:@{@"pointer": _state, @"change": change, @"overlays": overlays}];
    NSDictionary *next = [answer isKindOfClass:[NSDictionary class]] ? answer[@"pointer"] : nil;
    if (![next isKindOfClass:[NSDictionary class]]) return NO;
    BOOL other = ![orNull(next[@"presentationId"]) isEqual:orNull(_state[@"presentationId"])];
    _state = next;
    if (other) _page = self.presentationId ? [source page:self.presentationId] : nil;
    [self marks];
    return YES;
}

- (void)end {
    [self change:@{@"presentationId": [NSNull null], @"itemId": [NSNull null], @"partIndex": @0, @"black": @NO}];
}

- (void)reload {
    if (!self.presentationId) return;
    _page = [source page:self.presentationId];
    if (!_page) [self end]; else [self marks];
    [[NSNotificationCenter defaultCenter] postNotificationName:GPLiveChanged object:self];
}

/// The marks, the slide shown and the next, from the core.
- (void)marks {
    _shownKey = _nextKey = nil;
    _slide = _nextSlide = nil;
    _slideTitle = _nextTitle = nil;
    if (self.presentationId && _page) {
        NSDictionary *at = @{@"itemId": orNull(isText(_state[@"itemId"]) ? _state[@"itemId"] : nil),
                             @"partIndex": _state[@"partIndex"] ?: @0, @"black": _state[@"black"] ?: @NO};
        NSDictionary *marks = [source view:@"slideMarksView" args:@{@"order": GPOrder(_page), @"shown": at}];
        NSDictionary *shown = marks[@"shown"], *next = marks[@"next"];
        if ([shown isKindOfClass:[NSDictionary class]] && isText(shown[@"itemId"])) _shownKey = GPSlideKey(shown[@"itemId"], [shown[@"partIndex"] integerValue]);
        if ([next isKindOfClass:[NSDictionary class]] && isText(next[@"itemId"])) _nextKey = GPSlideKey(next[@"itemId"], [next[@"partIndex"] integerValue]);
        NSString *title = nil;
        if (isText(_state[@"itemId"]) && !self.black)
            _slide = slideAt(_page, GPSlideKey(_state[@"itemId"], [_state[@"partIndex"] integerValue]), &title);
        _slideTitle = title;
        title = nil;
        _nextSlide = slideAt(_page, _nextKey, &title);
        _nextTitle = title;
    }
}
@end

@implementation GPPageModel {
    GPLive *live;
    id<GPPresentationSource> source;
}

- (GPLive *)live { return live; }
- (id<GPPresentationSource>)source { return source; }
- (NSString *)liveItemId { return self.isLive && isText(live.state[@"itemId"]) ? live.state[@"itemId"] : nil; }

- (instancetype)initWithPage:(NSDictionary *)page live:(GPLive *)l source:(id<GPPresentationSource>)s {
    if ((self = [super init])) {
        _page = page;
        live = l;
        source = s;
        // Another presentation opened: its state afresh, the item shown selected if it is the one presented.
        NSString *shown = self.isLive && isText(l.state[@"itemId"]) ? l.state[@"itemId"] : nil;
        NSMutableDictionary *state = [NSMutableDictionary dictionaryWithDictionary:@{@"presenting": @(self.isLive ? YES : NO)}];
        if (shown) { state[@"selectedId"] = shown; state[@"followed"] = shown; }
        _state = state;
    }
    return self;
}

- (NSString *)presentationId { return _page[@"presentation"][@"id"]; }
- (BOOL)isLive { return live.presentationId && [live.presentationId isEqual:[self presentationId]]; }

- (NSDictionary *)context {
    return @{@"presentationId": [self presentationId], @"isTemplate": @NO, @"presenting": self.isLive ? @YES : @NO, @"live": live.state};
}

- (BOOL)canStart {
    BOOL anything = NO;
    for (NSArray *entry in GPOrder(_page)) if ([entry[1] integerValue] > 0) anything = YES;
    NSDictionary *model = [source view:@"pageModelView" args:@{@"state": _state, @"context": [self context], @"order": GPOrder(_page)}];
    return anything && [model[@"canStart"] boolValue];
}

- (NSString *)pickedKey {
    NSDictionary *picked = _state[@"picked"];
    return [picked isKindOfClass:[NSDictionary class]] && isText(picked[@"itemId"]) ? GPSlideKey(picked[@"itemId"], [picked[@"partIndex"] integerValue]) : nil;
}

- (NSDictionary *)send:(NSDictionary *)event {
    NSDictionary *answer = [source view:@"pageEventView" args:@{@"state": _state, @"context": [self context], @"order": GPOrder(_page), @"event": event}];
    if (![answer isKindOfClass:[NSDictionary class]]) return nil;
    if ([answer[@"state"] isKindOfClass:[NSDictionary class]]) _state = answer[@"state"];
    // A change to the live state, then what it leaves the page in, as AppState.liveChanged sends every window `sync`.
    if ([answer[@"live"] isKindOfClass:[NSDictionary class]] && [live change:answer[@"live"]]) [self send:@{@"type": @"sync"}];
    else [[NSNotificationCenter defaultCenter] postNotificationName:GPLiveChanged object:self];
    return answer;
}

- (void)liveEnded {
    [live end];
    [self send:@{@"type": @"sync"}];
}

- (void)reloadPage:(NSDictionary *)page {
    if (!page) return;
    NSArray *onScreen = self.onScreen ? self.onScreen() : @[];
    _page = page;
    [live reload];
    // Not through send: `changed` changes no live state, and the views are to hear of the page before its marks.
    NSDictionary *answer = [source view:@"pageEventView" args:@{@"state": _state, @"context": [self context], @"order": GPOrder(_page),
                                                                @"event": @{@"type": @"changed", @"itemIds": onScreen ?: @[]}}];
    if ([answer isKindOfClass:[NSDictionary class]] && [answer[@"state"] isKindOfClass:[NSDictionary class]]) _state = answer[@"state"];
    id stay = [answer isKindOfClass:[NSDictionary class]] ? answer[@"command"][@"itemId"] : nil;
    [[NSNotificationCenter defaultCenter] postNotificationName:GPPageChanged object:self
                                                      userInfo:isText(stay) ? @{@"stay": stay} : nil];
    [[NSNotificationCenter defaultCenter] postNotificationName:GPLiveChanged object:self];
}

- (NSString *)run:(NSString *)name args:(NSDictionary *)args {
    NSString *refused = [source mutate:name args:args];
    [self reloadPage:[source page:[self presentationId]]];
    return refused;
}
@end
