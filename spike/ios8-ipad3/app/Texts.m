// Texts.h: the table read once from the bundle.
#import "Texts.h"

NSString *GPLanguage(void) {
    static NSString *language;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSString *preferred = [[NSLocale preferredLanguages].firstObject lowercaseString] ?: @"sv";
        language = [preferred hasPrefix:@"en"] ? @"en" : @"sv";
    });
    return language;
}

static NSString *fill(NSString *text, NSDictionary *vars) {
    for (NSString *name in vars)
        text = [text stringByReplacingOccurrencesOfString:[NSString stringWithFormat:@"{%@}", name] withString:[vars[name] description]];
    return text;
}

NSString *GPText(NSString *key, NSDictionary *vars) {
    static NSDictionary *table;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSData *d = [NSData dataWithContentsOfFile:[[NSBundle mainBundle] pathForResource:@"texts" ofType:@"json"]];
        table = d ? [NSJSONSerialization JSONObjectWithData:d options:0 error:NULL] : @{};
    });
    NSString *text = table[GPLanguage()][key] ?: table[@"sv"][key] ?: key;
    return fill(text, vars);
}

NSString *GPOwnText(NSString *key) {
    NSDictionary *table = @{
        @"connect": @[@"Anslut", @"Connect"],
        @"connectTitle": @[@"Anslut till kyrkans dator", @"Connect to the church's computer"],
        @"connectHint": @[@"Adressen som Gospel Presenter på datorn visar för andra enheter, t.ex. 192.168.1.184:47800.",
                          @"The address Gospel Presenter on the computer shows other devices, e.g. 192.168.1.184:47800."],
        @"code": @[@"Kod", @"Code"],
        @"codeHint": @[@"Den sexsiffriga koden som datorn visar under Enheter.", @"The six-digit code the computer shows under Devices."],
        @"pair": @[@"Para ihop", @"Pair"],
        @"noContact": @[@"Ingen kontakt", @"No contact"],
        @"pairFailed": @[@"Parningen misslyckades", @"Pairing failed"],
        @"syncFailed": @[@"Synken misslyckades", @"Syncing failed"],
        @"notAHost": @[@"Det svarar inte som kyrkans dator.", @"That is not a church's computer."],
        @"demo": @[@"Demo", @"Demo"],
        @"demoNote": @[@"Demodata. Tryck på Anslut för att synka med kyrkans dator.", @"Demo data. Tap Connect to sync with the church's computer."],
        @"syncedNote": @[@"Synkas med %@ som %@. Dra ner för att hämta nytt.", @"Synced with %@ as %@. Pull down to fetch."],
    };
    NSArray *pair = table[key];
    return pair ? pair[[GPLanguage() isEqual:@"en"] ? 1 : 0] : key;
}
