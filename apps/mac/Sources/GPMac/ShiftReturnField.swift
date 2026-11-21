// A one-line text field that also takes Shift+Return from a keyboard, on iOS: a SwiftUI TextField hands Return to its
// text input, never to onKeyPress or a keyboard shortcut, so the key command is the UITextField's own, with priority
// over the system's handling of Return. On a Mac, onKeyPress gets it.
#if os(iOS)
import SwiftUI
import UIKit

struct ShiftReturnField: UIViewRepresentable {
    let placeholder: String
    @Binding var text: String
    let shiftReturn: () -> Void

    func makeUIView(context: Context) -> Field {
        let field = Field()
        field.placeholder = placeholder
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return field
    }

    func updateUIView(_ field: Field, context: Context) {
        if field.text != text { field.text = text }
        field.shiftReturn = shiftReturn
        context.coordinator.text = $text
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    final class Coordinator: NSObject {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        @objc func changed(_ field: UITextField) { text.wrappedValue = field.text ?? "" }
    }

    final class Field: UITextField {
        var shiftReturn: () -> Void = {}

        override var keyCommands: [UIKeyCommand]? {
            let command = UIKeyCommand(input: "\r", modifierFlags: .shift, action: #selector(pressed))
            command.wantsPriorityOverSystemBehavior = true
            return [command]
        }

        @objc private func pressed() { shiftReturn() }
    }
}
#endif
