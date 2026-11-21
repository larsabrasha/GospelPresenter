// Inställningar (docs/layout-2-0.md), as the core lays it out for every shell (`settingsListView`,
// `settingsSearchView`; crates/gp-core/src/settings_models.rs): on a Mac a window of its own as System Settings, the
// list at the left and the page at the right; on an iPhone the list alone and a row's page pushed over it, as iOS's
// Settings (NavigationSplitView collapses so by itself). Each row's page is in Settings*.swift.
import SwiftUI

/// A row of the list as the core gives it: the page it opens, its keys, its icon's name and its square's colour.
struct SettingsRow: Decodable, Hashable, Identifiable {
    struct Shade: Decodable, Hashable { let name: String, hex: String }
    let id: String, text: String, icon: String, colour: Shade, keywords: String, intro: String?
    let `where`: String?
    /// Search results from Mina inställningar share an id ("settings"); its name tells them apart.
    var key: String { "\(id)/\(text)" }
}

struct SettingsGroup: Decodable, Hashable {
    let id: String, title: String?, rows: [SettingsRow]
}

extension Look {
    /// The SF Symbol of a settings row's icon (settings_models.rs), as near the web's Heroicon as Apple has one.
    static func settingsSymbol(_ icon: String) -> String {
        switch icon {
        case "label": "tag"
        case "theme": "textformat"
        case "ccli": "doc.text.magnifyingglass"
        case "users": "person.2"
        case "devices": "ipad.and.iphone"
        case "settings": "gearshape"
        case "orgs": "square.grid.2x2"
        case "bug": "ladybug"
        case "trash": "trash"
        case "about": "info.circle"
        case "appearance": "circle.lefthalf.filled"
        case "language": "globe"
        case "storage": "externaldrive"
        case "user": "person.crop.circle"
        default: symbol(icon)
        }
    }
}

/// A row's icon in its coloured square, as System Settings and iOS's Settings draw theirs.
struct SettingsIcon: View {
    let row: SettingsRow
    var size: CGFloat = 26

    var body: some View {
        Image(systemName: Look.settingsSymbol(row.icon))
            .font(.system(size: size * 0.55, weight: .medium)).foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Look.hexColor(row.colour.hex), in: RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
    }
}

/// The page a settings id opens; "settings" is Mina inställningar.
enum SettingsPage: Hashable { case page(String) }

/// The settings: the list from the core (search above it, Mina inställningar as a profile cell at the top), and the
/// page chosen beside it, or pushed over it on a phone.
struct SettingsView: View {
    @Environment(Model.self) private var model
    /// The page to open first (GP_MAC_SETTINGS), else Mina inställningar.
    static var launchPage = "settings"
    @State private var chosen: String? = SettingsView.launchPage
    @State private var query = ""
    @State private var visibility = NavigationSplitViewVisibility.all

    private var host: Bool { model.session?.device != nil }
    private var groups: [SettingsGroup] { model.view("settingsListView", ["role": model.role, "host": host], as: [SettingsGroup].self) ?? [] }

    /// What the search finds, the core's: it is given the words of each key it reads, in this device's language.
    private var found: [SettingsRow] {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty, let keys = model.view("settingsSearchKeysView", as: [String].self) else { return [] }
        let texts = Dictionary(keys.map { ($0, t($0)) }) { a, _ in a }
        return model.view("settingsSearchView", ["role": model.role, "host": host, "query": query, "texts": texts], as: [SettingsRow].self) ?? []
    }

    var body: some View {
        NavigationSplitView(columnVisibility: $visibility) {
            List(selection: $chosen) {
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Section { ProfileCell().tag("settings") }
                    ForEach(groups, id: \.id) { g in
                        Section(g.title.map { t($0) } ?? "") {
                            ForEach(g.rows) { r in SettingsRowLabel(row: r).tag(r.id) }
                        }
                    }
                } else if found.isEmpty {
                    Text(t("search.none", ["query": query.trimmingCharacters(in: .whitespaces)])).foregroundStyle(.secondary)
                } else {
                    ForEach(found, id: \.key) { r in SettingsRowLabel(row: r).tag(r.id) }
                }
            }
            .searchable(text: $query, placement: .sidebar, prompt: t("search.field"))
            .navigationTitle(t("nav.admin"))
            #if os(iOS)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close"), systemImage: "xmark") { model.settingsOpen = false } } }
            #endif
            #if os(macOS)
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 320)
            #endif
        } detail: {
            NavigationStack {
                if let chosen { SettingsDetail(id: chosen).id(chosen) }
            }
        }
        #if os(iOS)
        // A phone starts at the list, as iOS's Settings; a computer with Mina inställningar beside it.
        .onAppear { if UIDevice.current.userInterfaceIdiom == .phone, SettingsView.launchPage == "settings" { chosen = nil } }
        #endif
    }
}

/// A row: its icon square and its name, under it where a search result from Mina inställningar lives.
struct SettingsRowLabel: View {
    let row: SettingsRow

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 1) {
                Text(t(row.text))
                if let w = row.where { Text(t(w)).font(.caption).foregroundStyle(.secondary) }
            }
        } icon: { SettingsIcon(row: row, size: 22) }
    }
}

/// Mina inställningar as the list's top cell: the user's initial in a circle, their name and "Mina inställningar".
struct ProfileCell: View {
    @Environment(Model.self) private var model

    var body: some View {
        HStack(spacing: 10) {
            Text(String(model.userName.prefix(1)).uppercased())
                .font(.headline).foregroundStyle(.white)
                .frame(width: 36, height: 36).background(Color.indigo, in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(model.userName).font(.headline)
                Text(t("nav.settings")).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityLabel(t("nav.settings"))    }
}

/// A settings page by its id, with its intro card where the core gives one.
struct SettingsDetail: View {
    @Environment(Model.self) private var model
    let id: String

    var body: some View {
        page.navigationTitle(title)
    }

    private var title: String {
        switch id {
        case "settings": t("nav.settings")
        case "trash": t("trash.title")
        case "storage": t("storage.title")
        case "logins": t("logins.title")
        case "myReports": t("myReports.title")
        // A page's name is the same whoever reads it: looked up in the whole list (a superadmin's on a host), so a page
        // this role's list leaves out (Enheter off a host, Felrapporter for an admin) is still named by its own name.
        default: (model.view("settingsListView", ["role": "superAdmin", "host": true], as: [SettingsGroup].self) ?? [])
            .flatMap(\.rows).first { $0.id == id }.map { t($0.text) } ?? t("nav.admin")
        }
    }

    @ViewBuilder private var page: some View {
        switch id {
        case "settings": MySettingsPage()
        case "storage": StoragePage()
        case "logins": LoginsPage()
        case "myReports": BugReportsPage(mine: true)
        case "reports": BugReportsPage(mine: false)
        case "songs": SongsPage()
        case "bibles": BiblesPage()
        case "images": MediaLibraryPage(kind: .image)
        case "audios": MediaLibraryPage(kind: .audio)
        case "videos": MediaLibraryPage(kind: .video)
        case "customSlides": CustomSlidesPage()
        case "overlays": OverlaysPage()
        case "labels": LabelsPage()
        case "displays": DisplaysPage()
        case "themes": ThemesPage()
        case "ccliReport": CcliReportPage()
        case "users": UsersPage()
        case "devices": DevicesPage()
        case "orgSettings": OrgSettingsPage()
        case "orgs": OrgsPage()
        case "trash": TrashPage()
        case "about": AboutPage()
        default: ContentUnavailableView(t("nav.admin"), systemImage: "gearshape")
        }
    }
}

extension View {
    /// A sheet's least size on a Mac, where a sheet is as small as its content; iOS sizes its own sheets.
    @ViewBuilder func sheetSize(_ width: CGFloat, _ height: CGFloat) -> some View {
        #if os(macOS)
        frame(minWidth: width, minHeight: height)
        #else
        self
        #endif
    }
}

/// What a page is for, in a card at its top as iOS's Settings has it: the row's icon, its name and the core's intro.
struct IntroCard: View {
    @Environment(Model.self) private var model
    let id: String

    var body: some View {
        if let row = (model.view("settingsListView", ["role": model.role, "host": model.session?.device != nil], as: [SettingsGroup].self) ?? [])
            .flatMap(\.rows).first(where: { $0.id == id }), let intro = row.intro {
            Section {
                VStack(spacing: 8) {
                    SettingsIcon(row: row, size: 44)
                    Text(t(row.text)).font(.title3.weight(.semibold))
                    Text(t(intro)).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 8)
            }
        }
    }
}
