// The 2.0 look (docs/layout-2-0.md, "Colours"): the warm grey `stone` named by role, as apps/web/src/app.css names it,
// light and dark; the app's sky blue; and the sizes a list keeps. SwiftUI's own components carry them.
import SwiftUI

extension Color {
    /// `#rrggbb`, or a light and a dark one that follow the system's appearance.
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }

    init(light: UInt32, dark: UInt32) {
        #if os(iOS)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
        #else
        self.init(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(Color(hex: dark)) : NSColor(Color(hex: light)) })
        #endif
    }

    /// Tailwind's `sky-500`: a selected row, the + of a list, the app's tint.
    static let sky = Color(hex: 0x0ea5e9)
    /// The page: stone-100 light, stone-950 dark.
    static let ground = Color(light: 0xf5f5f4, dark: 0x0c0a09)
    /// On the page: cards, a list's rows. White light, stone-900 dark.
    static let surface = Color(light: 0xffffff, dark: 0x1c1917)
    /// On a surface: fields, pills, rows inside a card. stone-100 light, stone-800 dark.
    static let raised = Color(light: 0xf5f5f4, dark: 0x292524)
    /// The running order's column beside the page, a step darker.
    static let sidebar = Color(light: 0xeeedec, dark: 0x090807)
    /// Secondary text: stone-500 light, stone-400 dark.
    static let quiet = Color(light: 0x78716c, dark: 0xa8a29e)
}

enum Size {
    /// A list's row (docs/layout-2-0.md, "One rule across the app").
    static let row: CGFloat = 52
    /// From this width the app has columns; narrower, one column with sheets ("The layout follows the width").
    static let columns: CGFloat = 1000
    /// A page's readable column on a wide screen, as the web's PageContainer (`sm:w-180`, 720 px), centred.
    static let page: CGFloat = 720
}
