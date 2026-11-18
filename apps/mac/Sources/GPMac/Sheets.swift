// "Redigera detaljer", a one-line question (a heading, a new name, a comment), and what every sheet shares: the
// system's own layout, a title in the bar, Avbryt at the leading edge and Spara at the trailing one (on iOS 26 and
// macOS 26 the system's × and ✓ of the cancel and confirm roles).
import SwiftUI

struct TextPrompt: Identifiable {
    let id = UUID()
    let title: String, label: String
    var text: String
    /// The field's rule, the core's: when it is required Spara waits for a word, as Apple's "Ny mapp" does; else an
    /// empty answer is one too (a comment taken away).
    let rule: FieldRule
    let done: (String) -> Void
}

/// A field's rule as the core's mutators check it (`rulesView`'s fields, docs/view-models.md): whether it may be left
/// empty, and its most characters.
struct FieldRule: Decodable {
    let required: Bool, max: Int
    /// Whether Spara waits: a required field with only spaces in it.
    func blocks(_ text: String) -> Bool { required && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

extension Model {
    /// The rule of a field (presentationName, itemTitle, itemNote, location, description), the core's.
    func rule(_ field: String) -> FieldRule {
        struct Rules: Decodable { let fields: [String: FieldRule] }
        // Without a store no field is shown; the core checks what is sent in any case.
        return view("rulesView", as: Rules.self)?.fields[field] ?? FieldRule(required: false, max: .max)
    }
}

extension View {
    /// A field cut at `max` characters, as the web's `maxLength` cuts it; counted as the core counts them, in Unicode
    /// scalars, so what is typed is what the core takes.
    func limited(_ text: Binding<String>, to max: Int) -> some View {
        onChange(of: text.wrappedValue) { _, new in
            if new.unicodeScalars.count > max { text.wrappedValue = String(String.UnicodeScalarView(new.unicodeScalars.prefix(max))) }
        }
    }
    /// A one-line question as the system asks one: an alert with a text field, Avbryt and Spara.
    func textPrompt(_ prompt: Binding<TextPrompt?>) -> some View {
        modifier(TextPromptAlert(prompt: prompt))
    }

    /// A sheet's bar: its title, Avbryt, and the confirming button, which closes the sheet when `confirm` answers true.
    func sheetBar(_ title: String, confirm label: String = t("common.save"), disabled: Bool = false, _ confirm: @escaping () -> Bool) -> some View {
        modifier(SheetBar(title: title, label: label, disabled: disabled, confirm: confirm))
    }
}

private struct TextPromptAlert: ViewModifier {
    @Binding var prompt: TextPrompt?
    @State private var text = ""

    func body(content: Content) -> some View {
        content
            .alert(prompt?.title ?? "", isPresented: Binding(get: { prompt != nil }, set: { if !$0 { prompt = nil } }), presenting: prompt) { p in
                TextField(p.label, text: $text).limited($text, to: p.rule.max)
                Button(t("common.cancel"), role: .cancel) {}
                // The alert's preferred action: drawn filled in the app's colour on iOS 26, Return presses it.
                Button(t("common.save")) { p.done(text) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(p.rule.blocks(text))
            }
            .onChange(of: prompt?.id) { _, _ in text = prompt?.text ?? "" }
    }
}

private struct SheetBar: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    let title: String, label: String, disabled: Bool
    let confirm: () -> Bool

    func body(content: Content) -> some View {
        NavigationStack {
            content
                .navigationTitle(title)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { cancelButton }
                    ToolbarItem(placement: .confirmationAction) { confirmButton.disabled(disabled) }
                }
        }
    }

    @ViewBuilder private var cancelButton: some View {
        if #available(iOS 26, macOS 26, *) {
            Button(role: .cancel) { dismiss() }.accessibilityLabel(t("common.cancel"))
        } else {
            Button(t("common.cancel"), role: .cancel) { dismiss() }
        }
    }

    @ViewBuilder private var confirmButton: some View {
        if #available(iOS 26, macOS 26, *) {
            Button(role: .confirm, action: done).accessibilityLabel(label).keyboardShortcut(.defaultAction)
        } else {
            Button(label, action: done).keyboardShortcut(.defaultAction)
        }
    }

    private func done() { if confirm() { dismiss() } }
}

/// The details of a presentation (spec 03): "Redigera detaljer", or with no id "Skapa presentation", which makes it and
/// opens it (as the web's CreatePresentationDialog). Every field sent; the core checks them.
struct DetailsSheet: View {
    @Environment(Model.self) private var model
    let presentationId: String?
    @State private var name = t("presentations.defaultName")
    @State private var hasDate = false
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Calendar.current.date(bySettingHour: 11, minute: 0, second: 0, of: Date())!
    @State private var location = ""
    @State private var description = ""

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.dateFormat = format
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }
    /// As the core stores them: `YYYY-MM-DD` and `HH:MM`.
    private static let day = formatter("yyyy-MM-dd"), clock = formatter("HH:mm")

    var body: some View {
        Form {
            Section { TextField(t("presentation.name"), text: $name).limited($name, to: model.rule("presentationName").max) }
            Section {
                Toggle(t("presentation.date"), isOn: $hasDate.animation())
                if hasDate { DatePicker(t("presentation.date"), selection: $date, displayedComponents: .date).labelsHidden() }
                Toggle(t("presentation.time"), isOn: $hasTime.animation())
                if hasTime { DatePicker(t("presentation.time"), selection: $time, displayedComponents: .hourAndMinute).labelsHidden() }
            }
            .environment(\.locale, Texts.locale)
            Section {
                TextField(t("presentation.location"), text: $location).limited($location, to: model.rule("location").max)
                TextField(t("presentation.description"), text: $description, axis: .vertical).lineLimit(4...8)
                    .limited($description, to: model.rule("description").max)
            }
        }
        .formStyle(.grouped)
        .sheetBar(t(presentationId == nil ? "presentations.createTitle" : "presentation.editDetails"), confirm: t(presentationId == nil ? "common.create" : "common.save"),
                  disabled: model.rule("presentationName").blocks(name), save)
        .macWidth(440)
        .onAppear(perform: fill)
    }

    private func fill() {
        guard let presentationId, let p = model.view("presentationPageView", ["id": presentationId], as: PresentationPage.self)?.presentation else { return }
        name = p.name
        if let d = p.eventDate.flatMap(Self.day.date(from:)) { hasDate = true; date = d }
        if let t = p.time.flatMap(Self.clock.date(from:)) {
            hasTime = true
            let c = Calendar.current.dateComponents([.hour, .minute], from: t)
            time = Calendar.current.date(bySettingHour: c.hour ?? 0, minute: c.minute ?? 0, second: 0, of: Date()) ?? time
        }
        location = p.location ?? ""
        description = p.description ?? ""
    }

    private func save() -> Bool {
        let id = presentationId ?? model.newId()
        let args: [String: Any] = [
            "id": id, "name": name,
            "eventDate": hasDate ? Self.day.string(from: date) : NSNull(),
            "time": hasTime ? Self.clock.string(from: time) : NSNull(), "location": location, "description": description,
        ]
        guard model.run(presentationId == nil ? "createPresentation" : "updatePresentation", args) == "ok" else { return false }
        if presentationId == nil { model.path = [id] }
        return true
    }
}
