// A slide drawn with UIKit into a picture: the web's SlideView in miniature, on a 1920 × 1080 canvas scaled to the
// tile (the theme's areas and font sizes are in that canvas's pixels). Not the web's text fitting: the theme's size,
// made smaller in steps of 5 % until the text fits its area.
#import "SlideView.h"
#import <CommonCrypto/CommonDigest.h>

UIColor *GPColor(NSString *css) {
    if (![css isKindOfClass:[NSString class]]) return nil;
    unsigned rgb = 0;
    if ([css hasPrefix:@"#"] && css.length == 7) {
        [[NSScanner scannerWithString:[css substringFromIndex:1]] scanHexInt:&rgb];
        return [UIColor colorWithRed:(rgb >> 16 & 255) / 255.0 green:(rgb >> 8 & 255) / 255.0 blue:(rgb & 255) / 255.0 alpha:1];
    }
    if ([css hasPrefix:@"rgba("]) {
        NSArray *parts = [[css substringWithRange:NSMakeRange(5, css.length - 6)] componentsSeparatedByString:@","];
        if (parts.count == 4) return [UIColor colorWithRed:[parts[0] floatValue] / 255.0 green:[parts[1] floatValue] / 255.0
                                                      blue:[parts[2] floatValue] / 255.0 alpha:[parts[3] floatValue]];
    }
    return nil;
}

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

static void drawSlide(NSDictionary *slide, NSDictionary *theme, NSString *title, CGRect bounds) {
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
    NSDictionary *tag = [slide[@"label"] isKindOfClass:[NSDictionary class]] ? slide[@"label"] : nil;
    if ([tag[@"text"] isKindOfClass:[NSString class]]) {
        NSDictionary *attributes = @{NSFontAttributeName: [UIFont boldSystemFontOfSize:10], NSForegroundColorAttributeName: [UIColor whiteColor]};
        CGSize size = [tag[@"text"] sizeWithAttributes:attributes];
        CGRect chip = CGRectMake(6, 6, ceil(size.width) + 10, 16);
        [(GPColor(tag[@"color"]) ?: [UIColor grayColor]) setFill];
        [[UIBezierPath bezierPathWithRoundedRect:chip cornerRadius:3] fill];
        [tag[@"text"] drawAtPoint:CGPointMake(chip.origin.x + 5, chip.origin.y + (16 - size.height) / 2) withAttributes:attributes];
    }
}

UIImage *GPSlideImage(NSDictionary *slide, NSDictionary *theme, NSString *title, CGSize size, UIColor *ground) {
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
    NSString *key = [NSString stringWithFormat:@"%@ %.0fx%.0f", [[NSData dataWithBytes:digest length:sizeof digest] base64EncodedStringWithOptions:0],
                     size.width, size.height];
    UIImage *made = [pictures objectForKey:key];
    if (made) return made;
    CGRect bounds = CGRectMake(0, 0, size.width, size.height);
    UIGraphicsBeginImageContextWithOptions(size, YES, 0);
    [ground setFill];
    UIRectFill(bounds);
    [[UIBezierPath bezierPathWithRoundedRect:bounds cornerRadius:4] addClip];
    drawSlide(slide, theme, title, bounds);
    made = UIGraphicsGetImageFromCurrentImageContext();
    UIGraphicsEndImageContext();
    [pictures setObject:made forKey:key];
    return made;
}
