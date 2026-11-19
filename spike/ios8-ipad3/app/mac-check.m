// Core.m's calls on the Mac, against the host's build of the same core (target/release): what the iPad's label
// would show, the decoding of UniFFI's answer checked where it can run (../README.md, "Checked").
#import <Foundation/Foundation.h>

NSString *GPCoreView(NSString *name, NSString *args);

int main(void) {
    @autoreleasepool {
        NSDate *t = [NSDate date];
        printf("coreInfoView: %s\n", GPCoreView(@"coreInfoView", @"{}").UTF8String);
        printf("highlightView: %s\n", GPCoreView(@"highlightView", @"{\"text\":\"Härlig är jorden\",\"query\":\"harlig\"}").UTF8String);
        printf("noSuchView: %s\n", GPCoreView(@"noSuchView", @"{}").UTF8String);
        printf("%.1f ms\n", -[t timeIntervalSinceNow] * 1000);
    }
    return 0;
}
