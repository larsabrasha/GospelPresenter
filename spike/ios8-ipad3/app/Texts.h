// The app's texts: the web's (apps/web/src/i18n.ts, through ../texts.mjs's Resources/texts.json), in the device's
// language when it is English, else Swedish, as the native app's Texts.swift. Keys as the web's.
#import <Foundation/Foundation.h>

/// "sv" or "en".
NSString *GPLanguage(void);

/// The text for `key`, its `{name}` placeholders filled from `vars`; the key itself when there is none.
NSString *GPText(NSString *key, NSDictionary *vars);

/// The few texts only this app has (pairing by address, the demo), Swedish and English.
NSString *GPOwnText(NSString *key);
