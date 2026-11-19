// The app's pictures, drawn on the Mac into Resources/ (run by ../build-core.sh: art <logo.svg> <Resources folder>):
// - the icon: Gospel Presenter's logo (website/public/logo.svg, the play button with the cross; NSImage reads the SVG)
//   on white, as the desktop app's icon has it (apps/desktop/build/icon.png: the logo's box 72 % of the icon,
//   centred), at the sizes an iPad of iOS 8 asks for (76 and 152 px for the home screen, 80 for Spotlight, 58 for
//   Settings); iOS rounds the corners;
// - the launch images, upright and lying down, 1x and 2x: the page's empty frame, as Apple asks a launch image to be
//   (the navigation bars over both columns, the grouped tables' grey, the line between), so that the app opens into
//   what it shows and not into a blank screen first (on launch Lars saw the view come in from the left once more).
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>

/// A picture `w` × `h` points at `scale`, drawn by `draw` in points from the top left, written opaque as a PNG.
static BOOL picture(NSString *path, CGFloat w, CGFloat h, CGFloat scale, void (^draw)(void)) {
    size_t pw = (size_t)(w * scale), ph = (size_t)(h * scale);
    // Drawn with alpha (AppKit draws nothing into a bitmap without), written without: these are opaque.
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)pw
        pixelsHigh:(NSInteger)ph bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
        colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    [NSGraphicsContext saveGraphicsState];
    CGContextRef cg = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap].CGContext;
    CGContextTranslateCTM(cg, 0, ph);
    CGContextScaleCTM(cg, scale, -scale);
    // Said to be flipped, as the CTM now is: else an image drawn with respectFlipped:YES comes out upside down (the
    // logo's cross stood on its head, 2026-11-19, until Lars saw it).
    NSGraphicsContext *c = [NSGraphicsContext graphicsContextWithCGContext:cg flipped:YES];
    NSGraphicsContext.currentContext = c;
    c.imageInterpolation = NSImageInterpolationHigh;
    draw();
    [NSGraphicsContext restoreGraphicsState];
    CGColorSpaceRef rgb = CGColorSpaceCreateDeviceRGB();
    CGContextRef opaque = CGBitmapContextCreate(NULL, pw, ph, 8, 0, rgb, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
    CGContextDrawImage(opaque, CGRectMake(0, 0, pw, ph), bitmap.CGImage);
    CGImageRef image = CGBitmapContextCreateImage(opaque);
    CGImageDestinationRef out = CGImageDestinationCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], CFSTR("public.png"), 1, NULL);
    CGImageDestinationAddImage(out, image, NULL);
    BOOL written = CGImageDestinationFinalize(out);
    CFRelease(out);
    CGImageRelease(image);
    CGContextRelease(opaque);
    CGColorSpaceRelease(rgb);
    if (!written) fprintf(stderr, "cannot write %s\n", path.UTF8String);
    return written;
}

static NSColor *rgb(unsigned hex) {
    return [NSColor colorWithDeviceRed:(hex >> 16 & 255) / 255.0 green:(hex >> 8 & 255) / 255.0 blue:(hex & 255) / 255.0 alpha:1];
}

/// The page's frame, `w` × `h` points: PresentationController.m's split view with nothing in it yet.
static void frame(CGFloat w, CGFloat h) {
    [rgb(0xEFEFF4) setFill];   // the grouped tables' grey
    NSRectFill(NSMakeRect(0, 0, w, h));
    [rgb(0xF7F7F7) setFill];   // the opaque navigation bars, the status bar's 20 pt in them
    NSRectFill(NSMakeRect(0, 0, w, 64));
    [rgb(0xB2B2B2) setFill];   // the bars' bottom line, and the line between the columns
    NSRectFill(NSMakeRect(0, 64, w, 0.5));
    NSRectFill(NSMakeRect(320, 0, 0.5, h));
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 3) { fprintf(stderr, "usage: art <logo.svg> <Resources folder>\n"); return 2; }
        NSImage *logo = [[NSImage alloc] initWithContentsOfFile:@(argv[1])];
        if (!logo) { fprintf(stderr, "cannot read %s\n", argv[1]); return 1; }
        NSString *dir = @(argv[2]);
        NSDictionary *icons = @{@"Icon-76.png": @76, @"Icon-76@2x.png": @152, @"Icon-Small-40@2x.png": @80, @"Icon-Small@2x.png": @58};
        for (NSString *name in icons) {
            CGFloat s = [icons[name] doubleValue];
            BOOL ok = picture([dir stringByAppendingPathComponent:name], s, s, 1, ^{
                [[NSColor whiteColor] setFill];
                NSRectFill(NSMakeRect(0, 0, s, s));
                CGFloat box = s * 0.72;
                [logo drawInRect:NSMakeRect((s - box) / 2, (s - box) / 2, box, box) fromRect:NSZeroRect
                       operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
            });
            if (!ok) return 1;
        }
        // Info.plist's UILaunchImages names Default-Portrait and Default-Landscape; iOS adds @2x and ~ipad.
        for (NSNumber *scale in @[@1, @2]) {
            NSString *at = scale.intValue == 2 ? @"@2x" : @"";
            if (!picture([dir stringByAppendingFormat:@"/Default-Portrait%@~ipad.png", at], 768, 1024, scale.doubleValue, ^{ frame(768, 1024); })) return 1;
            if (!picture([dir stringByAppendingFormat:@"/Default-Landscape%@~ipad.png", at], 1024, 768, scale.doubleValue, ^{ frame(1024, 768); })) return 1;
        }
    }
    return 0;
}
