// The floating + at a page's bottom right (the web's), with a second action as a pill beside it (Importera): Liquid
// Glass where there is one (iOS 26, macOS 26), tinted in the app's blue for the +, as the system's own floating buttons.
import SwiftUI

extension View {
    /// The floating +: Liquid Glass tinted in the app's blue where there is one; before, a filled blue circle.
    @ViewBuilder
    func floatingGlass() -> some View {
        if #available(iOS 26, macOS 26, *) {
            glassEffect(.regular.tint(Color.sky).interactive(), in: Circle())
        } else {
            background(Color.sky, in: Circle()).shadow(radius: 4, y: 2)
        }
    }

    /// A second floating action beside the +: clear glass in a capsule, its text in the app's blue.
    @ViewBuilder
    fileprivate func floatingPill() -> some View {
        if #available(iOS 26, macOS 26, *) {
            glassEffect(.regular.interactive(), in: Capsule())
        } else {
            background(.regularMaterial, in: Capsule()).shadow(radius: 4, y: 2)
        }
    }

    /// A page's + floating at its bottom right, and its second action beside it; the content scrolls clear of them.
    /// Each named by the core's id where it gives one (`id`, `FloatingAction.id`; docs/view-models.md, "Ids").
    func floatingAdd(_ text: String, id: String? = nil, shown: Bool = true, add: @escaping () -> Void, extra: FloatingAction? = nil) -> some View {
        let size = FloatingSize.current
        return contentMargins(.bottom, shown ? size.plus + 2 * size.margin : 0, for: .scrollContent)
            .overlay(alignment: .bottomTrailing) {
                if shown {
                    HStack(spacing: size.margin * 0.6) {
                        if let extra {
                            // The glass around the button, not inside its label: the whole of it a button, also to
                            // accessibility and the UI tests.
                            Button(action: extra.action) {
                                Label(extra.text, systemImage: extra.icon).font(size.text).foregroundStyle(Color.sky)
                                    .padding(.horizontal, size.pill * 0.42).frame(height: size.pill).contentShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .floatingPill()
                            .accessibilityIdentifier(extra.id ?? "")
                        }
                        Button(action: add) {
                            Image(systemName: "plus").font(size.symbol).foregroundStyle(.white)
                                .frame(width: size.plus, height: size.plus).contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .floatingGlass()
                        .accessibilityLabel(text)
                        .accessibilityIdentifier(id ?? "")
                    }
                    .padding(size.margin)
                }
            }
    }
}

/// The floating buttons' sizes: a finger's on a phone or tablet, a pointer's on a Mac, as each platform's own buttons.
private struct FloatingSize {
    let plus: CGFloat, pill: CGFloat, margin: CGFloat, symbol: Font, text: Font
    #if os(macOS)
    static let current = FloatingSize(plus: 40, pill: 32, margin: 16, symbol: .title3.weight(.semibold), text: .body.weight(.semibold))
    #else
    static let current = FloatingSize(plus: 56, pill: 48, margin: 20, symbol: .title2.weight(.semibold), text: .headline)
    #endif
}

/// The second floating action: its text, its symbol, the core's id where it gives one, and what it does.
struct FloatingAction {
    let text: String, icon: String
    var id: String?
    let action: () -> Void
}
