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
