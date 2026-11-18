// What differs between the Mac and iOS under the shared views, in one place: pictures, colours, menus, widths.
import SwiftUI
#if os(macOS)
import AppKit

typealias PlatformImage = NSImage

extension Image {
    init(platform image: NSImage) { self.init(nsImage: image) }
}

extension ImageRenderer {
    @MainActor var platformImage: NSImage? { nsImage }
}

extension Color {
    static let window = Color(nsColor: .windowBackgroundColor)
}

typealias PlatformWindow = NSWindow

extension View {
    /// The window keeps its name, but its toolbar does not show it, where the page says it itself (from macOS 15).
    @ViewBuilder func titleOnlyInWindow() -> some View {
        if #available(macOS 15, *) { toolbar(removing: .title) } else { self }
    }
}

/// The system's window a view is drawn in, handed to `found` once it is in one (to bring it forward, Model.window).
struct WindowReader: NSViewRepresentable {
    let found: (NSWindow) -> Void
    func makeNSView(context: Context) -> NSView { Probe(found: found) }
    func updateNSView(_ view: NSView, context: Context) {}
    final class Probe: NSView {
        let found: (NSWindow) -> Void
        init(found: @escaping (NSWindow) -> Void) { self.found = found; super.init(frame: .zero) }
        required init?(coder: NSCoder) { nil }
        override func viewDidMoveToWindow() { if let window { found(window) } }
    }
}
#else
import UIKit

typealias PlatformImage = UIImage

extension Image {
    init(platform image: UIImage) { self.init(uiImage: image) }
}

extension ImageRenderer {
    @MainActor var platformImage: UIImage? { uiImage }
}

extension Color {
    static let window = Color(uiColor: .secondarySystemBackground)
}

typealias PlatformWindow = UIWindow

/// The system's window a view is drawn in, handed to `found` once it is in one (to bring it forward, Model.window).
struct WindowReader: UIViewRepresentable {
    let found: (UIWindow) -> Void
    func makeUIView(context: Context) -> UIView { Probe(found: found) }
    func updateUIView(_ view: UIView, context: Context) {}
    final class Probe: UIView {
        let found: (UIWindow) -> Void
        init(found: @escaping (UIWindow) -> Void) { self.found = found; super.init(frame: .zero) }
        required init?(coder: NSCoder) { nil }
        override func didMoveToWindow() { if let window { found(window) } }
    }
}
#endif

extension View {
    /// A menu drawn as its label only; on iOS a menu is that already.
    @ViewBuilder func plainMenu() -> some View {
        #if os(macOS)
        menuStyle(.borderlessButton)
        #else
        self
        #endif
    }

    /// A fixed width on the Mac, where a sheet is as wide as its content; on iOS the screen decides.
    @ViewBuilder func macWidth(_ width: CGFloat) -> some View {
        #if os(macOS)
        frame(width: width)
        #else
        self
        #endif
    }

    /// A column's title on iOS, where each column of the stack has its own bar; the Mac's window has one title.
    @ViewBuilder func columnTitle(_ title: String) -> some View {
        #if os(iOS)
        navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
}
