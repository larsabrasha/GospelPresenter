// A slide drawn with UIKit: the web's SlideView in miniature, on a 1920 × 1080 canvas scaled to the tile (the theme's
// areas and font sizes are in that canvas's pixels). Not the web's text fitting: the theme's size, made smaller in
// steps of 5 % until the text fits its area.
#import "SlideView.h"

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
    if ([kind isEqual:@"image"]) return @"Bild";
    return kind;
}

@implementation GPSlideView {
    UILabel *text, *label, *media;
    NSDictionary *look;   // the theme's definition for the slide's kind: background, main
}

- (instancetype)initWithFrame:(CGRect)frame {
    if ((self = [super initWithFrame:frame])) {
        self.clipsToBounds = YES;
        text = [[UILabel alloc] init];
        text.numberOfLines = 0;
        label = [[UILabel alloc] init];
        label.font = [UIFont boldSystemFontOfSize:10];
        label.textColor = [UIColor whiteColor];
        label.textAlignment = NSTextAlignmentCenter;
        label.layer.cornerRadius = 3;
        label.layer.masksToBounds = YES;
        media = [[UILabel alloc] init];
        media.textColor = [UIColor colorWithWhite:0.6 alpha:1];
        media.textAlignment = NSTextAlignmentCenter;
        media.numberOfLines = 2;
        media.font = [UIFont systemFontOfSize:13];
        for (UIView *v in @[text, media, label]) [self addSubview:v];
    }
    return self;
}

- (void)showSlide:(NSDictionary *)slide theme:(NSDictionary *)theme title:(NSString *)title {
    NSDictionary *definition = theme[@"definition"];
    NSString *kind = slide[@"kind"];
    look = definition[kind] ?: definition[@"song"];
    NSDictionary *background = look[@"background"] ?: look;
    self.backgroundColor = GPColor(background[@"color"]) ?: [UIColor blackColor];
    NSString *words = [slide[@"text"] isKindOfClass:[NSString class]] ? slide[@"text"] : @"";
    BOOL isMedia = [kind isEqual:@"media"];
    text.hidden = isMedia;
    media.hidden = !isMedia;
    if (isMedia) {
        self.backgroundColor = [UIColor colorWithWhite:0.13 alpha:1];
        // No pictures here: the media's files are not on this device. Its kind and the item's title instead.
        NSString *what = slide[@"video"] ? @"video" : slide[@"audio"] ? @"audio" : @"image";
        media.text = [NSString stringWithFormat:@"%@\n%@", kindName(what), title ?: @""];
    }
    text.text = words;
    NSDictionary *tag = [slide[@"label"] isKindOfClass:[NSDictionary class]] ? slide[@"label"] : nil;
    label.hidden = tag == nil;
    label.text = tag[@"text"];
    label.backgroundColor = GPColor(tag[@"color"]) ?: [UIColor grayColor];
    [self setNeedsLayout];
}

- (void)layoutSubviews {
    [super layoutSubviews];
    CGFloat scale = self.bounds.size.width / 1920;
    media.frame = CGRectInset(self.bounds, 8, 8);
    CGSize size = [label sizeThatFits:CGSizeMake(200, 16)];
    label.frame = CGRectMake(6, 6, size.width + 10, 16);
    NSDictionary *main = look[@"main"];
    NSDictionary *area = main[@"area"];
    CGRect box = area ? CGRectMake([area[@"x"] floatValue] * scale, [area[@"y"] floatValue] * scale,
                                   [area[@"w"] floatValue] * scale, [area[@"h"] floatValue] * scale)
                      : CGRectInset(self.bounds, 80 * scale, 80 * scale);
    text.frame = box;
    if (text.hidden || text.text.length == 0) return;
    BOOL bold = [main[@"fontWeight"] intValue] >= 600;
    CGFloat lineHeight = [main[@"lineHeight"] floatValue] ?: 1.2;
    NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
    NSString *align = main[@"align"];
    paragraph.alignment = [align isEqual:@"center"] ? NSTextAlignmentCenter : [align isEqual:@"right"] ? NSTextAlignmentRight : NSTextAlignmentLeft;
    paragraph.lineHeightMultiple = lineHeight;
    CGFloat points = ([main[@"fontSize"] floatValue] ?: 75) * scale;
    NSAttributedString *fitted = nil;
    for (int i = 0; i < 40; i++, points *= 0.95) {
        UIFont *font = bold ? [UIFont boldSystemFontOfSize:points] : [UIFont systemFontOfSize:points];
        fitted = [[NSAttributedString alloc] initWithString:text.text attributes:@{
            NSFontAttributeName: font, NSParagraphStyleAttributeName: paragraph,
            NSForegroundColorAttributeName: GPColor(main[@"color"]) ?: [UIColor whiteColor]}];
        CGRect need = [fitted boundingRectWithSize:CGSizeMake(box.size.width, CGFLOAT_MAX)
                                           options:NSStringDrawingUsesLineFragmentOrigin context:nil];
        if (need.size.height <= box.size.height) break;
    }
    text.attributedText = fitted;
}
@end
