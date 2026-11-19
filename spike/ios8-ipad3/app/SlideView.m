// A slide drawn into a picture on a 1920 × 1080 stage scaled to the tile (the theme's areas and font sizes are in the
// stage's pixels). A song slide painted from the core's layout (slideLayoutView, docs/native-slide-rendering.md way 3):
// every glyph where the web's SlideView sets it, with the same faces, as the Mac app's SlidePainter.swift paints it.
// The rest, and what the core refuses or this cannot paint, drawn as before: UIKit's text, the theme's size made
// smaller in steps of 5 % until the text fits its area.
#import "SlideView.h"
#import <CommonCrypto/CommonDigest.h>
#import <CoreText/CoreText.h>
#import "Core.h"

/// The CSS colours a theme writes: #rgb, #rrggbb, #rrggbbaa, rgb(…) and rgba(…); nil for any other (CSSColor in
/// SlidePainter.swift).
UIColor *GPColor(NSString *css) {
    if (![css isKindOfClass:[NSString class]]) return nil;
    NSString *s = [[css stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];
    if ([s hasPrefix:@"#"]) {
        NSString *hex = [s substringFromIndex:1];
        if (hex.length == 3) hex = [NSString stringWithFormat:@"%1$@%1$@%2$@%2$@%3$@%3$@", [hex substringWithRange:NSMakeRange(0, 1)],
                                    [hex substringWithRange:NSMakeRange(1, 1)], [hex substringWithRange:NSMakeRange(2, 1)]];
        if (hex.length != 6 && hex.length != 8) return nil;
        unsigned long long v = 0;
        if (![[NSScanner scannerWithString:hex] scanHexLongLong:&v]) return nil;
        if (hex.length == 6) v = v << 8 | 0xff;
        return [UIColor colorWithRed:(v >> 24 & 255) / 255.0 green:(v >> 16 & 255) / 255.0 blue:(v >> 8 & 255) / 255.0 alpha:(v & 255) / 255.0];
    }
    NSRange open = [s rangeOfString:@"("];
    if (![s hasPrefix:@"rgb"] || open.location == NSNotFound || ![s hasSuffix:@")"]) return nil;
    NSString *inside = [s substringWithRange:NSMakeRange(open.location + 1, s.length - open.location - 2)];
    NSMutableArray *parts = [NSMutableArray array];
    for (NSString *p in [inside componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@", /"]])
        if (p.length) [parts addObject:p];
    if (parts.count != 3 && parts.count != 4) return nil;
    CGFloat alpha = parts.count == 4 ? ([parts[3] hasSuffix:@"%"] ? [parts[3] floatValue] / 100 : [parts[3] floatValue]) : 1;
    return [UIColor colorWithRed:[parts[0] floatValue] / 255.0 green:[parts[1] floatValue] / 255.0 blue:[parts[2] floatValue] / 255.0 alpha:alpha];
}

#pragma mark - Painted from the core's layout

/// The system's faces given to the core, each run's name for one its file.
static NSMutableDictionary *systemFaces;

/// Classic's stack after the app's own (themes.ts's FONT_STACKS.tahoma, 'Tahoma', 'Geneva', Verdana): the first of
/// them this system has, every face of it, added to the core so it lays out with them, as the Mac app adds Tahoma.
/// iOS 8 has neither Tahoma nor Geneva but Verdana (/System/Library/Fonts/Core), as Safari on this iPad draws Classic.
static void addSystemFaces(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        systemFaces = [NSMutableDictionary dictionary];
        for (NSString *family in @[@"Tahoma", @"Geneva", @"Verdana"]) {
            CTFontDescriptorRef wanted = CTFontDescriptorCreateWithAttributes((__bridge CFDictionaryRef)@{(__bridge NSString *)kCTFontFamilyNameAttribute: family});
            NSArray *found = CFBridgingRelease(CTFontDescriptorCreateMatchingFontDescriptors(wanted, NULL));
            CFRelease(wanted);
            for (id d in found) {
                NSURL *url = CFBridgingRelease(CTFontDescriptorCopyAttribute((__bridge CTFontDescriptorRef)d, kCTFontURLAttribute));
                NSString *name = CFBridgingRelease(CTFontDescriptorCopyAttribute((__bridge CTFontDescriptorRef)d, kCTFontNameAttribute));
                NSData *bytes = [url.pathExtension.lowercaseString isEqual:@"ttf"] ? [NSData dataWithContentsOfURL:url] : nil;
                if (!bytes || !name) continue;
                GPCoreAddSlideFace(name, family, bytes);
                systemFaces[name] = url.path;
            }
            if (systemFaces.count) {
                NSLog(@"GPCore8: slide faces of the system's: %@ (%@)", family, [systemFaces.allKeys componentsJoinedByString:@", "]);
                return;
            }
        }
    });
}

/// The file a run's face is painted with: the core's own (Lato's, and Inter's and Montserrat's variable faces made
/// static at the weight nearest the text's, 100 to 900, by build-core.sh: iOS 8 draws a variable face at its own
/// weight only), or the system's it was given.
static NSString *faceFile(NSString *name, CGFloat weight) {
    if ([name isEqual:@"Lato"]) return [[NSBundle mainBundle] pathForResource:@"Lato-400" ofType:@"ttf"];
    if ([name isEqual:@"Inter"] || [name isEqual:@"Montserrat"]) {
        int w = (int)MIN(900, MAX(100, round(weight / 100) * 100));
        return [[NSBundle mainBundle] pathForResource:[NSString stringWithFormat:@"%@-%d", name, w] ofType:@"ttf"];
    }
    return systemFaces[name];
}

/// A face the core lays out with at `size` and `weight` (faceFile). Kept; asked from the main thread and the one
/// drawing ahead.
static CTFontRef faceAt(NSString *name, CGFloat size, CGFloat weight) {
    static NSMutableDictionary *graphics, *made;
    @synchronized ([NSNull null]) {
        if (!made) { graphics = [NSMutableDictionary dictionary]; made = [NSMutableDictionary dictionary]; }
        NSString *key = [NSString stringWithFormat:@"%@ %g %g", name, size, weight];
        if (made[key]) return (__bridge CTFontRef)made[key];
        NSString *path = faceFile(name, weight);
        id cg = path ? graphics[path] : nil;
        if (!cg) {
            CGDataProviderRef data = path ? CGDataProviderCreateWithFilename(path.fileSystemRepresentation) : NULL;
            if (!data) return NULL;
            CGFontRef font = CGFontCreateWithDataProvider(data);
            CGDataProviderRelease(data);
            if (!font) return NULL;
            cg = CFBridgingRelease(font);
            graphics[path] = cg;
        }
        CTFontRef font = CTFontCreateWithGraphicsFont((__bridge CGFontRef)cg, size, NULL, NULL);
        made[key] = CFBridgingRelease(font);
        return font;
    }
}

/// slideLayoutView's answer for a song slide, nil where the core refuses it (not a song, a face it lacks) or a colour
/// of it is one this does not read.
static NSDictionary *layoutOf(NSDictionary *slide, NSDictionary *theme) {
    if (![slide[@"kind"] isEqual:@"song"] || !theme) return nil;
    addSystemFaces();
    NSData *args = [NSJSONSerialization dataWithJSONObject:@{@"slide": slide, @"theme": theme} options:0 error:NULL];
    NSString *refusal = nil;
    // No database: the view asks for none.
    NSDate *t = [NSDate date];
    NSString *answer = GPCoreCall(NULL, @"slideLayoutView", [[NSString alloc] initWithData:args encoding:NSUTF8StringEncoding], &refusal);
    NSLog(@"GPCore8: slideLayoutView %@ in %.1f ms", answer ? @"laid out" : refusal, -[t timeIntervalSinceNow] * 1000);
    NSDictionary *l = answer ? [NSJSONSerialization JSONObjectWithData:[answer dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL] : nil;
    if (![l isKindOfClass:[NSDictionary class]]) {
        static dispatch_once_t told;
        dispatch_once(&told, ^{ NSLog(@"GPCore8: slideLayoutView refused %@: drawn as before", refusal); });
        return nil;
    }
    if (!GPColor(l[@"background"][@"color"])) return nil;
    for (NSDictionary *t in l[@"texts"]) {
        if (!GPColor(t[@"paint"][@"color"])) return nil;
        for (NSDictionary *run in t[@"runs"]) if (!faceAt(run[@"face"], [run[@"size"] floatValue], [t[@"weight"] floatValue])) return nil;
    }
    return l;
}

/// A text's glyphs where the core put them, clipped to its box: its outline under its fill, as `paint-order: stroke
/// fill`, and one shadow under both (themes.ts's TEXT_SHADOW, `0 0.06em 0.18em rgba(0, 0, 0, 0.65)`). The context's
/// y runs down from the stage's top.
static void paintText(CGContextRef ctx, NSDictionary *t) {
    CGContextSaveGState(ctx);
    NSDictionary *clip = t[@"clip"], *paint = t[@"paint"];
    CGContextClipToRect(ctx, CGRectMake([clip[@"x"] floatValue], [clip[@"y"] floatValue], [clip[@"w"] floatValue], [clip[@"h"] floatValue]));
    CGContextSetTextMatrix(ctx, CGAffineTransformMakeScale(1, -1));   // glyphs upright where y runs down
    CGFloat size = [t[@"size"] floatValue], weight = [t[@"weight"] floatValue];
    BOOL shadow = [paint[@"shadow"] boolValue];
    if (shadow) {
        // A shadow's offset and blur are in the device's space, not the stage's.
        CGFloat k = CGContextGetCTM(ctx).d;
        CGContextSetShadowWithColor(ctx, CGSizeMake(0, 0.06 * size * k), 0.18 * size * fabs(k), [UIColor colorWithWhite:0 alpha:0.65].CGColor);
        CGContextBeginTransparencyLayer(ctx, NULL);
    }
    CGFloat outline = [paint[@"outline"] isKindOfClass:[NSNumber class]] ? [paint[@"outline"] floatValue] : 0;
    if (outline > 0) {
        // The glyphs' outlines stroked as paths, under the fill.
        CGMutablePathRef path = CGPathCreateMutable();
        for (NSDictionary *run in t[@"runs"]) {
            CTFontRef font = faceAt(run[@"face"], [run[@"size"] floatValue], weight);
            for (NSArray *g in run[@"glyphs"]) {
                CGPathRef glyph = CTFontCreatePathForGlyph(font, (CGGlyph)[g[0] intValue], NULL);
                if (!glyph) continue;
                CGAffineTransform at = CGAffineTransformScale(CGAffineTransformMakeTranslation([g[1] floatValue], round([g[2] floatValue])), 1, -1);
                CGPathAddPath(path, &at, glyph);
                CGPathRelease(glyph);
            }
        }
        CGContextAddPath(ctx, path);
        CGPathRelease(path);
        CGContextSetLineWidth(ctx, outline * 2);
        CGContextSetStrokeColorWithColor(ctx, (GPColor(paint[@"outlineColor"]) ?: [UIColor blackColor]).CGColor);
        CGContextStrokePath(ctx);
    }
    CGContextSetFillColorWithColor(ctx, GPColor(paint[@"color"]).CGColor);
    for (NSDictionary *run in t[@"runs"]) {
        CTFontRef font = faceAt(run[@"face"], [run[@"size"] floatValue], weight);
        NSArray *list = run[@"glyphs"];
        CGGlyph *ids = malloc(sizeof(CGGlyph) * list.count);
        CGPoint *at = malloc(sizeof(CGPoint) * list.count);
        for (NSUInteger i = 0; i < list.count; i++) {
            ids[i] = (CGGlyph)[list[i][0] intValue];
            // Each baseline on a whole pixel of the stage, as WebKit sets a line; y negated for the flipped matrix.
            at[i] = CGPointMake([list[i][1] floatValue], -round([list[i][2] floatValue]));
        }
        CTFontDrawGlyphs(font, ids, at, list.count, ctx);
        free(ids);
        free(at);
    }
    if (shadow) CGContextEndTransparencyLayer(ctx);
    CGContextRestoreGState(ctx);
}

/// The slide from the core's layout in `bounds`: the stage scaled to fit and centred, its ground, its texts (a tile
/// shows its label and no credits, an output the credits: slides/main.tsx).
static void paintLayout(NSDictionary *l, CGRect bounds, BOOL labelled) {
    CGContextRef ctx = UIGraphicsGetCurrentContext();
    CGFloat scale = MIN(bounds.size.width / 1920, bounds.size.height / 1080);
    CGContextSaveGState(ctx);
    CGContextTranslateCTM(ctx, bounds.origin.x + round((bounds.size.width - 1920 * scale) / 2), bounds.origin.y + round((bounds.size.height - 1080 * scale) / 2));
    CGContextScaleCTM(ctx, scale, scale);
    CGRect stage = CGRectMake(0, 0, 1920, 1080);
    CGContextClipToRect(ctx, stage);
    CGContextSetFillColorWithColor(ctx, GPColor(l[@"background"][@"color"]).CGColor);
    CGContextFillRect(ctx, stage);   // a theme's own picture is not on this device: its colour alone
    for (NSDictionary *t in l[@"texts"]) if (!(labelled && [t[@"role"] isEqual:@"credits"])) paintText(ctx, t);
    CGContextRestoreGState(ctx);
}

#pragma mark - Drawn as before

static NSString *kindName(NSString *kind) {
    if ([kind isEqual:@"video"]) return @"Video";
    if ([kind isEqual:@"audio"]) return @"Ljud";
    return @"Bild";
}

/// The text at the theme's size, made 5 % smaller at a time until it fits `box`.
static NSAttributedString *fitted(NSString *words, NSDictionary *main, CGRect box, CGFloat scale) {
    BOOL bold = [main[@"fontWeight"] intValue] >= 600;
    NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
    NSString *align = main[@"align"];
    paragraph.alignment = [align isEqual:@"center"] ? NSTextAlignmentCenter : [align isEqual:@"right"] ? NSTextAlignmentRight : NSTextAlignmentLeft;
    paragraph.lineHeightMultiple = [main[@"lineHeight"] floatValue] ?: 1.2;
    UIColor *color = GPColor(main[@"color"]) ?: [UIColor whiteColor];
    CGFloat points = ([main[@"fontSize"] floatValue] ?: 75) * scale;
    NSAttributedString *text = nil;
    for (int i = 0; i < 40; i++, points *= 0.95) {
        UIFont *font = bold ? [UIFont boldSystemFontOfSize:points] : [UIFont systemFontOfSize:points];
        text = [[NSAttributedString alloc] initWithString:words attributes:@{
            NSFontAttributeName: font, NSParagraphStyleAttributeName: paragraph, NSForegroundColorAttributeName: color}];
        CGRect need = [text boundingRectWithSize:CGSizeMake(box.size.width, CGFLOAT_MAX)
                                         options:NSStringDrawingUsesLineFragmentOrigin context:nil];
        if (need.size.height <= box.size.height) break;
    }
    return text;
}

/// The part's label in the tile's top left corner, small, as this app's tiles have it (VISAS and NÄSTA at the right).
static void drawLabel(NSDictionary *slide) {
    NSDictionary *tag = [slide[@"label"] isKindOfClass:[NSDictionary class]] ? slide[@"label"] : nil;
    if (![tag[@"text"] isKindOfClass:[NSString class]]) return;
    NSDictionary *attributes = @{NSFontAttributeName: [UIFont boldSystemFontOfSize:10], NSForegroundColorAttributeName: [UIColor whiteColor]};
    CGSize size = [tag[@"text"] sizeWithAttributes:attributes];
    CGRect chip = CGRectMake(6, 6, ceil(size.width) + 10, 16);
    [(GPColor(tag[@"color"]) ?: [UIColor grayColor]) setFill];
    [[UIBezierPath bezierPathWithRoundedRect:chip cornerRadius:3] fill];
    [tag[@"text"] drawAtPoint:CGPointMake(chip.origin.x + 5, chip.origin.y + (16 - size.height) / 2) withAttributes:attributes];
}

static void drawSlide(NSDictionary *slide, NSDictionary *theme, NSString *title, CGRect bounds, BOOL labelled) {
    NSDictionary *laidOut = layoutOf(slide, theme);
    if (laidOut) {
        paintLayout(laidOut, bounds, labelled);
        if (labelled) drawLabel(slide);
        return;
    }
    NSDictionary *definition = theme[@"definition"];
    NSString *kind = slide[@"kind"];
    NSDictionary *look = definition[kind] ?: definition[@"song"];
    NSDictionary *background = look[@"background"] ?: look;
    CGFloat scale = bounds.size.width / 1920;
    if ([kind isEqual:@"media"]) {
        // No pictures here: the media's files are not on this device. Its kind and the item's title instead.
        [[UIColor colorWithWhite:0.13 alpha:1] setFill];
        UIRectFill(bounds);
        NSString *what = slide[@"video"] ? @"video" : slide[@"audio"] ? @"audio" : @"image";
        NSMutableParagraphStyle *centred = [[NSMutableParagraphStyle alloc] init];
        centred.alignment = NSTextAlignmentCenter;
        NSAttributedString *text = [[NSAttributedString alloc] initWithString:[NSString stringWithFormat:@"%@\n%@", kindName(what), title ?: @""]
            attributes:@{NSFontAttributeName: [UIFont systemFontOfSize:13], NSParagraphStyleAttributeName: centred,
                         NSForegroundColorAttributeName: [UIColor colorWithWhite:0.6 alpha:1]}];
        CGRect box = CGRectInset(bounds, 8, 8);
        CGFloat h = [text boundingRectWithSize:box.size options:NSStringDrawingUsesLineFragmentOrigin context:nil].size.height;
        [text drawWithRect:CGRectMake(box.origin.x, CGRectGetMidY(box) - h / 2, box.size.width, h) options:NSStringDrawingUsesLineFragmentOrigin context:nil];
        return;
    }
    [(GPColor(background[@"color"]) ?: [UIColor blackColor]) setFill];
    UIRectFill(bounds);
    NSDictionary *main = look[@"main"];
    NSDictionary *area = main[@"area"];
    CGRect box = area ? CGRectMake([area[@"x"] floatValue] * scale, [area[@"y"] floatValue] * scale,
                                   [area[@"w"] floatValue] * scale, [area[@"h"] floatValue] * scale)
                      : CGRectInset(bounds, 80 * scale, 80 * scale);
    NSString *words = [slide[@"text"] isKindOfClass:[NSString class]] ? slide[@"text"] : @"";
    if (words.length) {
        NSAttributedString *text = fitted(words, main, box, scale);
        CGFloat h = [text boundingRectWithSize:CGSizeMake(box.size.width, CGFLOAT_MAX) options:NSStringDrawingUsesLineFragmentOrigin context:nil].size.height;
        NSString *valign = main[@"valign"];
        CGFloat y = [valign isEqual:@"top"] ? box.origin.y : [valign isEqual:@"bottom"] ? CGRectGetMaxY(box) - h : CGRectGetMidY(box) - h / 2;
        [text drawWithRect:CGRectMake(box.origin.x, y, box.size.width, h) options:NSStringDrawingUsesLineFragmentOrigin context:nil];
    }
    if (labelled) drawLabel(slide);
}

UIImage *GPSlideImage(NSDictionary *slide, NSDictionary *theme, NSString *title, CGSize size, UIColor *ground) {
    return GPSlidePicture(slide, theme, title, size, ground, YES, 4);
}

UIImage *GPSlidePicture(NSDictionary *slide, NSDictionary *theme, NSString *title, CGSize size, UIColor *ground, BOOL labelled, CGFloat radius) {
    // Asked on the main thread and on the one drawing ahead (PresentationController.m): NSCache is thread-safe, and
    // UIKit draws into an image context on any thread.
    static NSCache *pictures;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ pictures = [[NSCache alloc] init]; });
    // Kept by everything that changes the picture, as the native app's Thumbnails.swift keeps its by content: the
    // slide as the core gives it (its text, label and kind; its key alone stays the same when a song's text is
    // edited, and the old picture showed), the theme's definition, the title a medium shows, and the size.
    NSData *content = [NSJSONSerialization dataWithJSONObject:@[slide ?: @{}, theme[@"definition"] ?: @{}, title ?: @""] options:0 error:NULL];
    uint8_t digest[CC_SHA1_DIGEST_LENGTH];
    CC_SHA1(content.bytes, (CC_LONG)content.length, digest);
    // "core-1": painted from the core's layout, a new key for every picture drawn before.
    NSString *key = [NSString stringWithFormat:@"core-1 %@ %.0fx%.0f %d %.0f", [[NSData dataWithBytes:digest length:sizeof digest] base64EncodedStringWithOptions:0],
                     size.width, size.height, labelled, radius];
    UIImage *made = [pictures objectForKey:key];
    if (made) return made;
    CGRect bounds = CGRectMake(0, 0, size.width, size.height);
    UIGraphicsBeginImageContextWithOptions(size, YES, 0);
    [ground setFill];
    UIRectFill(bounds);
    if (radius > 0) [[UIBezierPath bezierPathWithRoundedRect:bounds cornerRadius:radius] addClip];
    drawSlide(slide, theme, title, bounds, labelled);
    made = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    [pictures setObject:made forKey:key];
    return made;
}
