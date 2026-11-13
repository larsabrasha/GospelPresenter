// "Redigera detaljer", and a one-line question (a heading, a new name, a comment).
import SwiftUI

struct TextPrompt: Identifiable {
    let id = UUID()
    let title: String, label: String
    var text: String
    let done: (String) -> Void
}

extension View {
    func textPrompt(_ prompt: Binding<TextPrompt?>) -> some View {
        sheet(item: prompt) { p in TextPromptSheet(prompt: p) }
    }
}

struct TextPromptSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var prompt: TextPrompt

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(prompt.title).font(.title3.bold())
            TextField(prompt.label, text: $prompt.text).textFieldStyle(.roundedBorder).frame(width: 340)
            HStack {
                Spacer()
                Button("Avbryt", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Spara") { prompt.done(prompt.text); dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
    }
}

/// The details of a presentation (spec 03, "Redigera detaljer"): every field sent, the core checks them.
struct DetailsSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let presentationId: String
    @State private var name = ""
    @State private var hasDate = false
    @State private var date = Date()
    @State private var time = ""
    @State private var location = ""
    @State private var description = ""

    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    var body: some View {
        Form {
            TextField("Namn", text: $name)
            Toggle("Datum", isOn: $hasDate)
            if hasDate { DatePicker("Dag", selection: $date, displayedComponents: .date).environment(\.locale, Locale(identifier: "sv_SE")) }
            TextField("Tid (HH:MM)", text: $time)
            TextField("Plats", text: $location)
            TextField("Beskrivning", text: $description, axis: .vertical).lineLimit(4...8)
            HStack {
                Spacer()
                Button("Avbryt", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Spara", action: save).keyboardShortcut(.defaultAction)
            }
        }
        .formStyle(.grouped)
        .frame(width: 440)
        .onAppear(perform: fill)
    }

    private func fill() {
        guard let p = model.core.view("presentationView", ["id": presentationId], as: PresentationView.self) else { return }
        name = p.name
        if let d = p.eventDate.flatMap(Self.day.date(from:)) { hasDate = true; date = d }
        time = p.time ?? ""
        location = p.location ?? ""
        description = p.description ?? ""
    }

    private func save() {
        let args: [String: Any] = [
            "id": presentationId, "name": name,
            "eventDate": hasDate ? Self.day.string(from: date) : NSNull(),
            "time": time.isEmpty ? NSNull() : time, "location": location, "description": description,
        ]
        if model.run("updatePresentation", args) == "ok" { dismiss() }
    }
}
