// The app's icon: Gospel Presenter's logo (website/public/logo.svg, the play button with the cross) on white, as the
// desktop app's icon has it (apps/desktop/build/icon.png: the logo's box 72 % of the icon, centred), drawn on the Mac
// into Resources/ at the sizes an iPad of iOS 8 asks for (76 and 152 px for the home screen, 80 for Spotlight, 58 for
// Settings); iOS rounds the corners. NSImage reads the SVG. Run by ../build-core.sh: icon <logo.svg> <Resources>.
#import <AppKit/AppKit.h>
#import <ImageIO/ImageIO.h>

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 3) { fprintf(stderr, "usage: icon <logo.svg> <Resources folder>\n"); return 2; }
        NSImage *logo = [[NSImage alloc] initWithContentsOfFile:@(argv[1])];
        if (!logo) { fprintf(stderr, "cannot read %s\n", argv[1]); return 1; }
        NSDictionary *sizes = @{@"Icon-76.png": @76, @"Icon-76@2x.png": @152, @"Icon-Small-40@2x.png": @80, @"Icon-Small@2x.png": @58};
        for (NSString *name in sizes) {
            CGFloat s = [sizes[name] doubleValue];
            // Drawn with alpha (AppKit draws nothing into a bitmap without), written without: an icon is opaque.
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:(NSInteger)s
                pixelsHigh:(NSInteger)s bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
                colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
            [NSGraphicsContext saveGraphicsState];
            NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
            NSGraphicsContext.currentContext.imageInterpolation = NSImageInterpolationHigh;
            [[NSColor whiteColor] setFill];
            NSRectFill(NSMakeRect(0, 0, s, s));
            CGFloat box = s * 0.72;
            [logo drawInRect:NSMakeRect((s - box) / 2, (s - box) / 2, box, box)];
            [NSGraphicsContext restoreGraphicsState];
            CGColorSpaceRef rgb = CGColorSpaceCreateDeviceRGB();
            CGContextRef opaque = CGBitmapContextCreate(NULL, (size_t)s, (size_t)s, 8, 0, rgb, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
            CGContextDrawImage(opaque, CGRectMake(0, 0, s, s), bitmap.CGImage);
            CGImageRef image = CGBitmapContextCreateImage(opaque);
            NSURL *url = [NSURL fileURLWithPath:[@(argv[2]) stringByAppendingPathComponent:name]];
            CGImageDestinationRef out = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL);
            CGImageDestinationAddImage(out, image, NULL);
            BOOL written = CGImageDestinationFinalize(out);
            CFRelease(out);
            CGImageRelease(image);
            CGContextRelease(opaque);
            CGColorSpaceRelease(rgb);
            if (!written) { fprintf(stderr, "cannot write %s\n", name.UTF8String); return 1; }
        }
    }
    return 0;
}
