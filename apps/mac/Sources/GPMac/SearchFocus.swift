// Whether the settings window's search field is being typed in, for the editors in its detail column: their toolbar
// keys (⌘X, ⌘C, ⌘V, ⌘Z) go before a text field's own, so they are without them while any field has focus, the
// sidebar's search field too.
import SwiftUI

extension EnvironmentValues {
    /// The settings sidebar's search field has focus.
    @Entry var settingsSearching = false
}

/// Binds a `.searchable` field's focus to `searching`, where the system can tell it (macOS 15, iOS 18).
struct SearchFocus: ViewModifier {
    var searching: FocusState<Bool>.Binding

    func body(content: Content) -> some View {
        if #available(macOS 15, iOS 18, *) { content.searchFocused(searching) } else { content }
    }
}
