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

    /// A sheet's bar: its title, Avbryt (`cancel`), and the confirming button (`label`), which closes the sheet when
    /// `confirm` answers true.
    func sheetBar(_ title: String, cancel: String = t("common.cancel"), confirm label: String = t("common.save"), disabled: Bool = false, _ confirm: @escaping () -> Bool) -> some View {
        modifier(SheetBar(title: title, cancel: cancel, label: label, disabled: disabled, confirm: confirm))
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
    let title: String, cancel: String, label: String, disabled: Bool
    let confirm: () -> Bool

    func body(content: Content) -> some View {
        NavigationStack {
            content
                .navigationTitle(title)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { cancelButton.accessibilityIdentifier("sheet-cancel") }
                    ToolbarItem(placement: .confirmationAction) { confirmButton.disabled(disabled).accessibilityIdentifier("sheet-confirm") }
                }
        }
    }

    // On iOS 26 the system's round × and ✓ of the cancel and confirm roles, named by the texts given; on a Mac, buttons
    // with the texts on them, as a Mac's sheet has (the roles alone draw the system's own "Cancel" and "Done").
    @ViewBuilder private var cancelButton: some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            Button(role: .cancel) { dismiss() }.accessibilityLabel(cancel)
        } else {
            Button(cancel, role: .cancel) { dismiss() }
        }
        #else
        Button(cancel, role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        #endif
    }

    @ViewBuilder private var confirmButton: some View {
        #if os(iOS)
        if #available(iOS 26, *) {
            Button(role: .confirm, action: done).accessibilityLabel(label).keyboardShortcut(.defaultAction)
        } else {
            Button(label, action: done).keyboardShortcut(.defaultAction)
        }
        #else
        Button(label, action: done).keyboardShortcut(.defaultAction)
        #endif
    }

    private func done() { if confirm() { dismiss() } }
}

/// The details of a presentation (spec 03): "Redigera detaljer", or with no id "Skapa presentation", blank or from a
/// template, which makes it and opens it. What the fields hold, when Spara may be pressed, what ↵ does and the change
/// to run are the core's (`detailsStepView`); this draws the fields and does what it answers.
struct DetailsSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let presentationId: String?
    /// Skapa presentation from a template: its name, next date, time and place prefilled, its items copied.
    var template: TemplateRow? = nil
    @State private var step: DetailsStep?

    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.dateFormat = format
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }
    /// As the core keeps them: `YYYY-MM-DD` and `HH:MM`.
    private static let day = formatter("yyyy-MM-dd"), clock = formatter("HH:mm")

    var body: some View {
        let view = step?.view
        let confirm = view?.actions.first { $0.role == "confirm" }
        Form {
            // The core's groups in its order; the theme is not chosen in this app yet, so its field is left out.
            ForEach(view?.groups.map { $0.filter { $0 != .themeId } }.filter { !$0.isEmpty } ?? [], id: \.self) { group in
                Section { ForEach(group, id: \.self) { field($0) } }
            }
        }
        .formStyle(.grouped)
        .sheetBar(t(view?.title ?? "presentation.editDetails"), cancel: t(view?.actions.first { $0.role == "cancel" }?.text ?? "common.cancel"),
                  confirm: t(confirm?.text ?? "common.save"), disabled: confirm?.enabled != true) { send(.save(id: model.newId())) }
        .macWidth(440)
        .onAppear(perform: open)
    }

    /// A field's text as the core keeps it, and what is typed sent to it.
    private func text(_ f: DetailsField) -> Binding<String> {
        Binding(get: { value(f) }, set: { _ = send(.set(field: f, value: $0)) })
    }

    private func value(_ f: DetailsField) -> String {
        guard let s = step?.state else { return "" }
        switch f {
        case .name: return s.name
        case .eventDate: return s.eventDate
        case .time: return s.time
        case .location: return s.location
        case .description: return s.description
        case .themeId: return s.themeId
        }
    }

    /// A date or a time: a switch for whether it has one (today, or 11:00, when switched on), and the system's picker.
    private func when(_ f: DetailsField, _ format: DateFormatter, _ fallback: @escaping () -> Date) -> (has: Binding<Bool>, at: Binding<Date>) {
        (Binding(get: { !value(f).isEmpty }, set: { on in _ = send(.set(field: f, value: on ? format.string(from: fallback()) : "")) }),
         Binding(get: { format.date(from: value(f)) ?? fallback() }, set: { _ = send(.set(field: f, value: format.string(from: $0))) }))
    }

    /// A field of the core's groups.
    @ViewBuilder private func field(_ f: DetailsField) -> some View {
        switch f {
        case .name:
            // ↵ in the name saves, as the confirming button (the core's).
            TextField(t("presentation.name"), text: text(.name)).onSubmit { if send(.enter(field: .name, id: model.newId())) { dismiss() } }
        case .location: TextField(t("presentation.location"), text: text(.location))
        case .eventDate:
            let date = when(.eventDate, Self.day) { Date() }
            Toggle(t("presentation.date"), isOn: date.has.animation())
            if date.has.wrappedValue { DatePicker(t("presentation.date"), selection: date.at, displayedComponents: .date).labelsHidden().environment(\.locale, Texts.locale) }
        case .time:
            let time = when(.time, Self.clock) { Calendar.current.date(bySettingHour: 11, minute: 0, second: 0, of: Date())! }
            Toggle(t("presentation.time"), isOn: time.has.animation())
            if time.has.wrappedValue { DatePicker(t("presentation.time"), selection: time.at, displayedComponents: .hourAndMinute).labelsHidden().environment(\.locale, Texts.locale) }
        case .description: TextField(t("presentation.description"), text: text(.description), axis: .vertical).lineLimit(4...8)
        case .themeId: EmptyView()
        }
    }

    /// The dialog's first state: the presentation's, the template's, or a blank one named as the app says it.
    private func open() {
        var initial: [String: Any] = ["defaultName": t("presentations.defaultName")]
        if let presentationId { initial = ["presentationId": presentationId] }
        else if let template { initial = ["templateId": template.id, "today": localToday(), "now": Self.clock.string(from: Date())] }
        step = model.view("detailsStepView", ["init": initial], as: DetailsStep.self)
    }

    /// An event to the core, and what it answers done: a change run (and the core told how it went), the dialog
    /// closed, the presentation made opened. Whether the dialog is to close.
    private func send(_ event: DetailsEvent) -> Bool {
        guard let state = step?.state, let s = JSONValue(encoding: state)?.plain, let e = JSONValue(encoding: event)?.plain,
              let next = model.view("detailsStepView", ["state": s, "event": e, "now": nowMs()], as: DetailsStep.self) else { return false }
        step = next
        var close = false
        for effect in next.effects {
            switch effect {
            case let .run(args, command):
                let ok = model.run(command, args.plain as? [String: Any] ?? [:]) == "ok"
                if send(.done(ok: ok)) { close = true }
            case .close: close = true
            case let .open(id): model.path = [id]
            case .unknown: break
            }
        }
        return close
    }
}
