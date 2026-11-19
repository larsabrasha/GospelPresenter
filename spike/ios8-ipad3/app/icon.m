// The app's icon, drawn on the Mac with CoreGraphics into Resources/ at the sizes an iPad of iOS 8 asks for (76 and
// 152 pt for the home screen, 80 for Spotlight, 58 for Settings): a white slide with three lines of text on the web's
// sky, iOS rounding the corners. Run by ../build-core.sh: icon <Resources folder>.
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

static void draw(CGContextRef c, CGFloat s) {
    CGColorSpaceRef rgb = CGColorSpaceCreateDeviceRGB();
    CGFloat stops[] = {0.22, 0.74, 0.97, 1, 0.01, 0.52, 0.78, 1};   // sky-400 to sky-600, from the top
    CGGradientRef sky = CGGradientCreateWithColorComponents(rgb, stops, NULL, 2);
    CGContextDrawLinearGradient(c, sky, CGPointMake(0, s), CGPointMake(0, 0), 0);
    CGRect slide = CGRectMake(s * 0.14, s * 0.27, s * 0.72, s * 0.72 * 9 / 16);
    CGContextSetRGBFillColor(c, 1, 1, 1, 1);
    CGPathRef box = CGPathCreateWithRoundedRect(slide, s * 0.04, s * 0.04, NULL);
    CGContextAddPath(c, box);
    CGContextFillPath(c);
    CGContextSetRGBFillColor(c, 0.03, 0.35, 0.52, 1);   // sky-800, the text
    CGFloat widths[] = {0.50, 0.26, 0.40};   // lines of a song, centred
    for (int i = 0; i < 3; i++) {
        CGFloat w = s * widths[i], h = s * 0.03, y = slide.origin.y + slide.size.height * (0.72 - i * 0.22);
        CGPathRef line = CGPathCreateWithRoundedRect(CGRectMake(s / 2 - w / 2, y - h / 2, w, h), h / 2, h / 2, NULL);
        CGContextAddPath(c, line);
        CGContextFillPath(c);
        CGPathRelease(line);
    }
    CGPathRelease(box);
    CGGradientRelease(sky);
    CGColorSpaceRelease(rgb);
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 2) { fprintf(stderr, "usage: icon <Resources folder>\n"); return 2; }
        NSDictionary *sizes = @{@"Icon-76.png": @76, @"Icon-76@2x.png": @152, @"Icon-Small-40@2x.png": @80, @"Icon-Small@2x.png": @58};
        for (NSString *name in sizes) {
            size_t s = [sizes[name] unsignedIntValue];
            CGColorSpaceRef rgb = CGColorSpaceCreateDeviceRGB();
            CGContextRef c = CGBitmapContextCreate(NULL, s, s, 8, 0, rgb, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
            draw(c, s);
            CGImageRef image = CGBitmapContextCreateImage(c);
            NSURL *url = [NSURL fileURLWithPath:[@(argv[1]) stringByAppendingPathComponent:name]];
            CGImageDestinationRef out = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL);
            CGImageDestinationAddImage(out, image, NULL);
            if (!CGImageDestinationFinalize(out)) { fprintf(stderr, "cannot write %s\n", name.UTF8String); return 1; }
            CFRelease(out);
            CGImageRelease(image);
            CGContextRelease(c);
            CGColorSpaceRelease(rgb);
        }
    }
    return 0;
}
