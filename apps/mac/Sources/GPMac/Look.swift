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

    /// The app's accent: a selected row, the + of a list, the app's tint. Gospel Presenter's sky (`lookView`'s
    /// `accent`), unless the user has chosen an accent colour of their own on the Mac, which a native app follows
    /// (System Settings › Appearance; Multicolour, the default, leaves it to the app).
    static var sky: Color { Look.color(Look.table.accent) }
    /// ▶ Starta's emerald.
    static let emerald = Look.color("emerald")
    /// ■ Avsluta's, and what removes something.
    static let danger = Look.color("red")
    /// The page.
    static let ground = Look.color("ground")
    /// On the page: cards, a list's rows.
    static let surface = Look.color("surface")
    /// On a surface: fields, pills, rows inside a card.
    static let raised = Look.color("raised")
    /// The running order's column beside the page, a step darker.
    static let sidebar = Look.color("sidebar")
    /// Secondary text.
    static let quiet = Look.color("quiet")
}

/// The colours and the buttons' roles, the core's (`lookView`, crates/gp-core/src/look.rs), one table for every shell;
/// written into LookTable.swift by apps/mac/texts.mjs.
enum Look {
    struct Shade: Decodable { let name: String, hex: String }
    struct Colour: Decodable { let light: Shade, dark: Shade, system: String? }
    struct Role: Decodable { let color: String?, weight: String }
    struct Table: Decodable { let accent: String, accentFollowsUser: Bool, colors: [String: Colour], roles: [String: Role] }

    static let table = (try? JSONDecoder().decode(Table.self, from: Data(lookTable.utf8)))
        ?? Table(accent: "sky", accentFollowsUser: true, colors: [:], roles: [:])

    /// A colour of the table, light and dark; the accent the user's where they chose one (`Color.sky`); black for a
    /// name it does not have.
    static func color(_ name: String) -> Color {
        if name == table.accent, table.accentFollowsUser, accentChosen { return .accentColor }
        guard let c = table.colors[name] else { return .black }
        if let own = c.system.flatMap(system) { return own }
        return Color(light: hex(c.light.hex), dark: hex(c.dark.hex))
    }

    /// The platform's own colour for a role the core names (`lookView`'s `system`), light and dark as the platform has
    /// them; nil for one it has none for.
    private static func system(_ role: String) -> Color? {
        #if os(macOS)
        switch role {
        case "groupedBackground": Color(nsColor: .windowBackgroundColor)
        case "secondaryGroupedBackground": Color(nsColor: .controlBackgroundColor)
        case "fill": Color(nsColor: .quaternarySystemFill)
        case "sidebar": Color(nsColor: .underPageBackgroundColor)
        case "secondaryLabel": Color(nsColor: .secondaryLabelColor)
        default: nil
        }
        #else
        switch role {
        case "groupedBackground": Color(uiColor: .systemGroupedBackground)
        case "secondaryGroupedBackground": Color(uiColor: .secondarySystemGroupedBackground)
        case "fill": Color(uiColor: .tertiarySystemFill)
        case "sidebar": Color(uiColor: .systemGroupedBackground)
        case "secondaryLabel": Color(uiColor: .secondaryLabel)
        default: nil
        }
        #endif
    }

    private static func hex(_ css: String) -> UInt32 { UInt32(css.dropFirst(), radix: 16) ?? 0 }

    /// A colour the core gives as hex (`#rrggbb`), the same light and dark: a settings row's square.
    static func hexColor(_ css: String) -> Color { Color(light: hex(css), dark: hex(css)) }

    /// Whether the user chose an accent colour of their own (a Mac; iOS has none to choose).
    private static var accentChosen: Bool {
        #if os(macOS)
        UserDefaults.standard.object(forKey: "AppleAccentColor") != nil
        #else
        false
        #endif
    }
}

private struct FilledCapsule: ViewModifier {
    #if os(macOS)
    @Environment(\.appearsActive) private var active
    #else
    // iOS 17 has no `appearsActive` (iOS 18 has), and an iPhone's window is always the active one.
    private let active = true
    #endif
    let color: Color

    func body(content: Content) -> some View {
        let filled = content.foregroundStyle(active ? Color.white : Color.primary)
        if #available(iOS 26, macOS 26, *) {
            filled.glassEffect(active ? .regular.tint(color).interactive() : .regular.interactive(), in: .capsule)
        } else {
            filled.background(active ? color : Color.secondary.opacity(0.2), in: Capsule())
        }
    }
}

/// A button of a page as the core gives it (`pageButtonsView`): its id, its text's key, its role, whether it may be
/// pressed.
struct PageButton: Decodable, Hashable {
    let id: String, text: String, icon: String?, role: String, enabled: Bool
    /// Lägg till's kinds.
    let choices: [MenuAction.Choice]?
}

extension Look {
    /// The SF Symbol of an icon the core names (page_models.rs `icon_of`), as near the web's Heroicon as Apple has one.
    static func symbol(_ icon: String?) -> String {
        switch icon {
        case "edit": "pencil"
        case "comment": "text.bubble"
        case "arrangement": "list.bullet.rectangle"
        case "overlay": "square.on.square"
        case "add": "plus"
        case "tick": "checkmark.square"
        case "delete": "trash"
        case "duplicate": "doc.on.doc"
        case "song": "music.note"
        case "bible": "book"
        case "image": "photo"
        case "audio": "speaker.wave.2"
        case "video": "video"
        case "slides": "play.rectangle"
        case "header": "text.alignleft"
        case "back": "chevron.left"
        case "play": "play.fill"
        case "stop": "stop.fill"
        case "sidebar": "sidebar.left"
        case "display": "display"
        default: "circle"
        }
    }
}

struct PageButtons: Decodable { let buttons: [PageButton] }

extension View {
    /// Liquid Glass in its colour where there is one (iOS 26, macOS 26), filled before: what a page is for, as the web
    /// fills it (the + of a list and Lägg till in sky, ▶ Starta in green, ■ Avsluta in red).
    @ViewBuilder
    func prominentGlass() -> some View {
        if #available(iOS 26, macOS 26, *) { buttonStyle(.glassProminent) } else { buttonStyle(.borderedProminent) }
    }

    /// Clear Liquid Glass, bordered before: a quiet button beside the page (fold or show a column).
    @ViewBuilder
    func quietGlass() -> some View {
        if #available(iOS 26, macOS 26, *) { buttonStyle(.glass) } else { buttonStyle(.bordered) }
    }

    /// A circle of clear glass, untinted whatever the accent around it (macOS 26, iOS 26); a bordered circle before.
    @ViewBuilder
    func clearGlassCircle() -> some View {
        if #available(iOS 26, macOS 26, *) { glassEffect(.regular.interactive(), in: .circle) } else { background(.regularMaterial, in: Circle()) }
    }

    /// A capsule of clear glass, untinted (macOS 26, iOS 26); of a material before: a quiet button lifted off its column.
    @ViewBuilder
    func clearGlassCapsule() -> some View {
        if #available(iOS 26, macOS 26, *) { glassEffect(.regular.interactive(), in: .capsule) } else { background(.regularMaterial, in: Capsule()) }
    }

    /// A capsule of filled glass in `color` (macOS 26, iOS 26), a filled capsule before: for what takes no button style.
    /// White words on the colour while the window is the active one; else, as a Mac's own prominent button, no colour
    /// and the words in the text's.
    func filledCapsule(_ color: Color) -> some View { modifier(FilledCapsule(color: color)) }

    /// A firm line between the toolbar and what scrolls under it (macOS 26's hard scroll edge): the soft one let the page
    /// show through the toolbar as the pointer came over it (Lars, 2026-11-21).
    @ViewBuilder
    func hardTopEdge() -> some View {
        if #available(iOS 26, macOS 26, *) { scrollEdgeEffectStyle(.hard, for: .top) } else { self }
    }

    /// A button drawn as its role says (`lookView`'s roles): `filled` in its colour, white on it; `tinted` glass in its
    /// colour; `plain` in its colour, if it has one; `glass` clear. How each weight looks is this platform's own.
    @ViewBuilder
    func role(_ name: String) -> some View {
        let role = Look.table.roles[name] ?? Look.Role(color: nil, weight: "plain")
        let tint = role.color.map(Look.color) ?? .primary
        switch role.weight {
        // The style picks its words' colour: white on the colour, and grey with the button when the window is not the
        // active one, as a Mac's own buttons go.
        case "filled": prominentGlass().tint(tint)
        case "tinted": quietGlass().tint(tint)
        case "glass": quietGlass()
        // The platform's own push button, in no colour: the accent around it is let go.
        case "standard": buttonStyle(.automatic).tint(.primary)
        default: buttonStyle(.borderless).foregroundStyle(tint)
        }
    }
}

enum Size {
    /// A list's row (docs/layout-2-0.md, "One rule across the app").
    static let row: CGFloat = 52
    /// From this width the app has columns; narrower, one column with sheets ("The layout follows the width").
    static let columns: CGFloat = 1000
    /// A page's readable column on a wide screen, as the web's PageContainer (`sm:w-180`, 720 px), centred.
    static let page: CGFloat = 720
}
