// Templates (spec 03 "Template"; the web's Templates.tsx, Presentations.tsx's TemplatePicker, SaveAsTemplateDialog.tsx):
// Skapa presentation offers a blank one or one of the templates last used (`templatesView` with `recent`), and from
// one its name, the next date of its weekday, its time and place (`templateView`) and a copy of its items
// (`createFromTemplate`); Mallar lists them all with their slot, makes one, and opens one as a presentation's page
// is opened (its menu then Redigera detaljer of the template and Radera mall); a presentation's menu has Spara som mall.
import SwiftUI

/// A template as `templatesView` gives it.
struct TemplateRow: Decodable, Identifiable, Hashable {
    let id: String, name: String, weekday: Int?, time: String?, location: String?
}

/// A template's slot as the core says it (`templateView`): its day's text key and time, its place, its next date.
private struct Slot: Decodable {
    struct Schedule: Decodable { let day: String?, time: String? }
    let schedule: Schedule, location: String?, nextDate: String
}

extension Model {
    /// The templates, every one or the picker's last used (`templatesView`).
    func templates(recent: Bool = false) -> [TemplateRow] {
        view("templatesView", ["locale": Texts.language, "recent": recent], as: [TemplateRow].self) ?? []
    }

    fileprivate func slot(_ tp: TemplateRow) -> Slot? {
        let now = Date()
        let clock = DateFormatter()
        (clock.dateFormat, clock.locale) = ("HH:mm", Locale(identifier: "en_US_POSIX"))
        let template: [String: Any] = ["weekday": tp.weekday ?? NSNull(), "time": tp.time ?? NSNull(), "location": tp.location ?? NSNull()]
        return view("templateView", ["template": template, "today": localToday(), "now": clock.string(from: now)], as: Slot.self)
    }

    /// "Söndag 11:00 · Kyrkan": the line under a template's name; empty when it has neither day, time nor place.
    func templateLine(_ tp: TemplateRow) -> String {
        guard let s = slot(tp) else { return "" }
        let schedule = [s.schedule.day.map { t($0) }, s.schedule.time].compactMap { $0 }.joined(separator: " ")
        return [schedule, s.location ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The date a presentation from the template is prefilled with, `YYYY-MM-DD`, or nil without a weekday.
    func nextDate(_ tp: TemplateRow) -> String? { slot(tp).map(\.nextDate).flatMap { $0.isEmpty ? nil : $0 } }

    /// Spara som mall: the open presentation's items copied, each with an id of its own, into a template named so.
    func saveAsTemplate(_ name: String) -> Bool {
        guard let p = current else { return false }
        let items = p.items.map { ["from": $0.id, "id": newId()] }
        return run("saveAsTemplate", ["id": newId(), "presentationId": p.id, "name": name, "items": items]) == "ok"
    }
}

/// Skapa presentation: the templates last used to start from, or a blank one; the details then, filled from the one
/// picked. Without templates, the details at once.
struct CreateSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    /// Whether one was picked, and which (nil: blank).
    @State private var picked: TemplateRow??
    @State private var managing = false

    var body: some View {
        let templates = model.templates(recent: true)
        if let picked { DetailsSheet(presentationId: nil, template: picked) }
        else if templates.isEmpty { DetailsSheet(presentationId: nil) }
        else {
            NavigationStack {
                List {
                    Button { picked = .some(nil) } label: { Label(t("templates.blank"), systemImage: "doc") }
                        .accessibilityIdentifier("template-blank")
                    Section {
                        ForEach(templates) { tp in
                            Button { picked = .some(tp) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(tp.name).foregroundStyle(.primary)
                                    let line = model.templateLine(tp)
                                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                            .accessibilityIdentifier("template-\(tp.id)")
                        }
                    } header: {
                        HStack {
                            Text(t("templates.pickerTitle"))
                            Spacer()
                            if model.can("ManageTemplates") { Button(t("templates.manage")) { managing = true }.font(.caption) }
                        }
                    }
                }
                .navigationTitle(t("presentations.createTitle"))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close"), systemImage: "xmark") { dismiss() } } }
                .sheet(isPresented: $managing) { TemplatesPage(onOpen: { dismiss() }) }
            }
            .macWidth(440)
        }
    }
}

/// Mallar: every template with its slot, one made, one opened as a presentation's page.
struct TemplatesPage: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    /// Done when a template is opened: the sheets over the page it opens on close.
    var onOpen: () -> Void = {}
    @State private var creating = false

    var body: some View {
        let templates = model.templates()
        NavigationStack {
            List(templates) { tp in
                Button { open(tp.id) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(tp.name).foregroundStyle(.primary)
                        let line = model.templateLine(tp)
                        if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary) }
                    }
                }
                .accessibilityIdentifier("template-\(tp.id)")
            }
            .overlay { if templates.isEmpty { ContentUnavailableView(t("templates.empty"), systemImage: "doc.on.doc") } }
            .navigationTitle(t("nav.templates"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.close"), systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(t("common.create"), systemImage: "plus") { creating = true }.accessibilityIdentifier("template-create")
                }
            }
            .sheet(isPresented: $creating) { TemplateDetailsSheet(templateId: nil) { open($0) } }
        }
        .macWidth(480)
    }

    private func open(_ id: String) {
        dismiss()
        onOpen()
        model.path = [id]
    }
}

/// A template's details (TemplateDetailsDialog.razor): its name, its day of the week, its time and place; with no id
/// "Skapa mall", which makes it and opens it.
struct TemplateDetailsSheet: View {
    @Environment(Model.self) private var model
    let templateId: String?
    var opened: (String) -> Void = { _ in }
    @State private var name = ""
    @State private var weekday: Int = -1
    @State private var hasTime = false
    @State private var time = Calendar.current.date(bySettingHour: 11, minute: 0, second: 0, of: Date())!
    @State private var location = ""

    /// The days from Monday, as the web's select lists them (WEEKDAYS).
    private static let days = [1, 2, 3, 4, 5, 6, 0]
    private static let clock: DateFormatter = { let f = DateFormatter(); (f.dateFormat, f.locale) = ("HH:mm", Locale(identifier: "en_US_POSIX")); return f }()

    var body: some View {
        Form {
            TextField(t("presentation.name"), text: $name).limited($name, to: model.rule("presentationName").max)
                .accessibilityIdentifier("template-name")
            Picker(t("schedule.day"), selection: $weekday) {
                Text(t("schedule.noDay")).tag(-1)
                ForEach(Self.days, id: \.self) { Text(t("weekday.\($0)")).tag($0) }
            }
            Toggle(t("schedule.time"), isOn: $hasTime.animation())
            if hasTime { DatePicker(t("schedule.time"), selection: $time, displayedComponents: .hourAndMinute).labelsHidden().environment(\.locale, Texts.locale) }
            TextField(t("schedule.location"), text: $location).limited($location, to: 100)
        }
        .formStyle(.grouped)
        .sheetBar(t(templateId == nil ? "templates.createTitle" : "presentation.editDetails"), confirm: t(templateId == nil ? "common.create" : "common.save"),
                  disabled: model.rule("presentationName").blocks(name), save)
        .macWidth(440)
        .onAppear(perform: fill)
    }

    private func fill() {
        guard let templateId, let tp = model.templates().first(where: { $0.id == templateId }) else { return }
        (name, weekday, location) = (tp.name, tp.weekday ?? -1, tp.location ?? "")
        if let t = tp.time.flatMap(Self.clock.date(from:)) {
            hasTime = true
            let c = Calendar.current.dateComponents([.hour, .minute], from: t)
            time = Calendar.current.date(bySettingHour: c.hour ?? 0, minute: c.minute ?? 0, second: 0, of: Date()) ?? time
        }
    }

    private func save() -> Bool {
        let id = templateId ?? model.newId()
        let args: [String: Any] = ["id": id, "name": name, "weekday": weekday < 0 ? NSNull() : weekday,
                                   "time": hasTime ? Self.clock.string(from: time) : NSNull(), "location": location]
        guard model.run(templateId == nil ? "createTemplate" : "updateTemplate", args) == "ok" else { return false }
        if templateId == nil { opened(id) }
        return true
    }
}
