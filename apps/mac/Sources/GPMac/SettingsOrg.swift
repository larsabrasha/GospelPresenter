// Three short pages of Inställningar: Om Gospel Presenter (the web's About.tsx), Organisation (OrgSettings.tsx: remote
// control; the export and the import from 1.x below it) and CCLI-rapport (CcliReport.tsx, as `ccliPageView` lays it out).
import SwiftUI

struct AboutPage: View {
    @Environment(Model.self) private var model
    private struct CoreInfo: Decodable { let name: String, version: String }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    Image(systemName: "music.note.list").font(.system(size: 44)).foregroundStyle(Color.sky)
                    Text("Gospel Presenter").font(.title2.weight(.semibold))
                    Text(t("about.tagline")).multilineTextAlignment(.center).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).padding(.vertical, 8)
            }
            Section {
                // The commit built, as a link to it on GitHub (the web's Commit); a debug build marked as a development one.
                LabeledContent(t("about.version")) {
                    if let commit = Bundle.main.object(forInfoDictionaryKey: "GPCommit") as? String, commit.count == 7, let url = URL(string: "https://github.com/larsabrasha/GospelPresenter/commit/\(commit)") {
                        HStack(spacing: 6) {
                            Link(commit, destination: url).font(.body.monospaced()).help(t("about.commitOnGitHub"))
                            #if DEBUG
                            Text(t("about.devBuild")).foregroundStyle(.secondary)
                            #endif
                        }
                    } else {
                        Text(t("about.unknown"))
                    }
                }
                LabeledContent(t("about.core"), value: model.view("coreInfoView", as: CoreInfo.self).map { t("about.coreValue", ["name": $0.name, "version": $0.version]) } ?? t("about.unknown"))
            }
            Section {
                Text(t("about.credits")).font(.callout)
                Text(t("about.creditsCode")).font(.callout).foregroundStyle(.secondary)
            }
            Section(t("about.links")) {
                Link(t("about.website"), destination: URL(string: "https://www.gospelpresenter.com")!)
                Link("GitHub", destination: URL(string: "https://github.com/larsabrasha/GospelPresenter")!)
            }
        }
        .formStyle(.grouped)
    }
}

struct OrgSettingsPage: View {
    @Environment(Model.self) private var model
    @State private var message: String?
    private let policies = [("never", "orgSettings.remoteNever"), ("presenter", "orgSettings.remotePresenter"), ("always", "orgSettings.remoteAlways")]

    var body: some View {
        let current = model.view("remoteControlView", as: String.self) ?? "presenter"
        Form {
            IntroCard(id: "orgSettings")
            Section {
                Picker(t("orgSettings.remote"), selection: Binding(get: { current }, set: { message = change(model, "setRemoteControl", ["policy": $0]) })) {
                    ForEach(policies, id: \.0) { p in Text(t(p.1)).tag(p.0) }
                }
            } footer: { Text(t("orgSettings.remote\(current.prefix(1).uppercased())\(current.dropFirst())Description")) }
            OrgExportSection()
            LegacyImportSection()
        }
        .formStyle(.grouped)
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button(t("common.close")) {} }
    }
}

struct CcliPage: Decodable {
    struct Entry: Decodable, Identifiable { let id: String, songName: String, ccli: String, reportedAt: Double? }
    struct Card: Decodable, Identifiable { let key: String, date: String, presentationName: String, entries: [Entry], reported: Bool; var id: String { key } }
    let on: Bool, cards: [Card]
}

struct CcliReportPage: View {
    @Environment(Model.self) private var model
    @State private var filter = "all"
    /// The entries switched while this filter was chosen: they stay until it changes.
    @State private var keep: [String] = []
    @State private var shown = 50
    @State private var message: String?

    var body: some View {
        let page = model.view("ccliPageView", ["locale": Texts.language, "filter": filter, "keep": keep], as: CcliPage.self)
        let manage = can("ManageCcliReport")
        Form {
            IntroCard(id: "ccliReport")
            Section {
                Toggle(t("ccli.collection"), isOn: Binding(get: { page?.on ?? false }, set: { message = change(model, "setCcliCollection", ["on": $0]) }))
                    .disabled(!can("ManageOrganizationSettings"))
            } footer: { Text(t("ccli.collectionText")) }
            Picker(t("ccli.filter"), selection: $filter) {
                Text(t("ccli.all")).tag("all")
                Text(t("ccli.unreported")).tag("unreported")
                Text(t("ccli.reportedFilter")).tag("reported")
            }
            .pickerStyle(.segmented).labelsHidden()
            .onChange(of: filter) { keep = []; shown = 50 }
            if let page, page.cards.isEmpty { Text(t("ccli.empty")).foregroundStyle(.secondary) }
            ForEach(cards(page), id: \.key) { c in
                let name = c.presentationName.isEmpty ? t("ccli.other") : c.presentationName
                Section {
                    ForEach(c.entries) { e in LabeledContent(e.songName, value: e.ccli) }
                } header: {
                    HStack {
                        Text("\(c.date) · \(name)")
                        Spacer()
                        Toggle(t("ccli.reported"), isOn: Binding(get: { c.reported }, set: { on in
                            keep += c.entries.map(\.id)
                            message = change(model, "setCcliReported", ["ids": c.entries.map(\.id), "reported": on, "at": nowMs()])
                        }))
                        .disabled(!manage).accessibilityLabel(t("ccli.reportedFor", ["name": name, "date": c.date]))
                        #if os(macOS)
                        .toggleStyle(.switch).controlSize(.mini)
                        #endif
                    }
                }
            }
            if (page?.cards.flatMap(\.entries).count ?? 0) > shown {
                Button(t("common.showMore")) { shown += 50 }
            }
        }
        .formStyle(.grouped)
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) { Button(t("common.close")) {} }
    }

    /// The cards holding the first `shown` entries, 50 at a time as the web's.
    private func cards(_ page: CcliPage?) -> [CcliPage.Card] {
        var left = shown
        return (page?.cards ?? []).compactMap { c in
            guard left > 0 else { return nil }
            let entries = Array(c.entries.prefix(left))
            left -= entries.count
            return CcliPage.Card(key: c.key, date: c.date, presentationName: c.presentationName, entries: entries, reported: c.reported)
        }
    }

    private func can(_ permission: String) -> Bool { model.can(permission) }
}

struct RulesPermissions: Decodable { let permissions: [String: [String]] }

extension Model {
    /// Whether the user's role may do `permission`, as the core's mutators decide it (`rulesView`).
    func can(_ permission: String) -> Bool {
        view("rulesView", as: RulesPermissions.self)?.permissions[role]?.contains(permission) ?? false
    }
}
