// Lagring (the web's Storage.tsx: this device's files), Inloggningsmetoder (Logins.tsx), Mina felrapporter and
// Felrapporter (MyBugReports.tsx, BugReports.tsx, BugReportDetail.tsx), and Alla organisationer (Orgs.tsx): what is
// this device's own, and what is the server's, read and changed through its endpoints.
import Shell
import SwiftUI

// MARK: Lagring

struct StoragePage: View {
    @Environment(Model.self) private var model
    @AppStorage("gp.mediaBudget") private var budget = 0
    @AppStorage("gp.keepComing") private var keepComing = false
    @State private var message: String?
    private struct Limits: Decodable { let limits: [Int], `default`: Int }

    var body: some View {
        let limits = model.view("storageLimitsView", as: Limits.self)
        let pinned = Set(model.view("pinnedView", as: [String].self) ?? [])
        let rows = Dictionary((model.view("presentationsView", as: [PresentationRow].self) ?? []).map { ($0.id, $0) }) { a, _ in a }
        let bytes = { (n: Int) in ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file) }
        let report = model.app.storage
        Form {
            Section {
                Toggle(t("settings.keepComing"), isOn: $keepComing).onChange(of: keepComing) { model.app.syncMedia() }
            }
            // Each presentation kept offline, by hand or as a coming one, with the bytes its files take, as the web's.
            Section(t("storage.offline")) {
                if report.offline.isEmpty { Text(t("storage.offlineNone")).foregroundStyle(.secondary) }
                else { LabeledContent(t("storage.offlineTotal"), value: bytes(report.offlineTotal)) }
                ForEach(report.offline, id: \.self) { o in
                    let byHand = pinned.contains(o.presentationId)
                    HStack {
                        VStack(alignment: .leading) {
                            Text(rows[o.presentationId]?.name ?? o.presentationId).lineLimit(1)
                            Text([rows[o.presentationId]?.eventDate, bytes(o.bytes)].compactMap { $0 }.joined(separator: " · ") + (byHand ? "" : " · \(t("storage.byComing"))"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if byHand {
                            Button(t("storage.stopKeeping")) {
                                model.app.localWrite("DELETE FROM pinned_presentations WHERE id = ?", [.text(value: o.presentationId)])
                                model.app.syncMedia()
                            }.buttonStyle(.borderless)
                        }
                    }
                }
            }
            Section {
                LabeledContent(t("storage.cacheUsed"), value: bytes(model.app.storage.cache))
                Picker(t("storage.limit"), selection: Binding(get: { budget > 0 ? budget : limits?.default ?? 0 }, set: { budget = $0; model.app.syncMedia() })) {
                    ForEach(limits?.limits ?? [], id: \.self) { l in
                        Text(l == limits?.default ? t("storage.limitDefault", ["size": bytes(l)]) : bytes(l)).tag(l)
                    }
                }
                Button(t("storage.clear")) {
                    model.app.clearCache = true
                    model.app.syncMedia()
                    message = t("storage.cleared")
                }
            } header: { Text(t("storage.cache")) } footer: { Text(t("storage.cacheText")) }
        }
        .formStyle(.grouped)
        .refusal($message)
    }
}

extension AppState {
    /// A statement on this device's own tables (pinned presentations, kept Bibles), which do not sync.
    func localWrite(_ sql: String, _ params: [SqlValue]) {
        switch store {
        case let .synced(client): _ = try? client.core.db.query(sql, params)
        case let .demo(core): _ = try? core.db.query(sql, params)
        case nil: break
        }
        changed()
    }
}

// MARK: Inloggningsmetoder

struct LoginsPage: View {
    @Environment(Model.self) private var model
    @State private var logins: [LoginEntry] = []
    @State private var methods: Methods?
    @State private var waiting = false
    @State private var browser = BrowserSignIn()
    private struct Methods: Decodable { let passkeys: Bool, google: Bool }
    @State private var prompt: TextPrompt?
    @State private var removing: LoginEntry?
    @State private var message: String?

    var body: some View {
        Form {
            Section {
                ForEach(logins) { l in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.name ?? t(l.provider == "google" ? "logins.google" : "logins.passkey"))
                            Text(t("logins.dates", ["created": relative(l.createdAt), "used": relative(l.lastUsedAt)])).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if l.provider == "passkey" {
                            Button(t("logins.rename")) {
                                prompt = TextPrompt(title: t("logins.renameTitle"), label: t("logins.name"), text: l.name ?? "", rule: FieldRule(required: true, max: 100)) { name in
                                    Task { message = await model.api("PATCH", "/api/auth/logins/passkey/\(l.id)", ["name": name.trimmingCharacters(in: .whitespaces)]).error.map(hostRefusal); await load() }
                                }
                            }.buttonStyle(.borderless)
                        }
                        Button(t("logins.remove"), role: .destructive) { removing = l }.buttonStyle(.borderless).disabled(logins.count == 1)
                    }
                }
            } footer: { Text(logins.count == 1 ? t("logins.last") : t("logins.text")) }
            Section {
                if waiting {
                    HStack { ProgressView(); Text(t("logins.waiting")).font(.callout) }
                } else {
                    if methods?.passkeys == true {
                        Button(t("logins.addPasskey")) {
                            prompt = TextPrompt(title: t("logins.addPasskey"), label: t("logins.name"), text: BrowserSignIn.deviceName, rule: FieldRule(required: true, max: 100)) { name in
                                Task { await ceremony("/api/auth/passkey/begin", ["mode": "register", "name": name.trimmingCharacters(in: .whitespaces)]) }
                            }
                        }
                    }
                    if methods?.google == true, !logins.contains(where: { $0.provider == "google" }) {
                        Button(t("logins.linkGoogle")) { Task { await ceremony("/api/auth/google/begin", ["link": true]) } }
                    }
                }
            } footer: { if methods?.passkeys == true { Text(t("logins.addText")) } }
        }
        .formStyle(.grouped)
        .task {
            await load()
            methods = await model.api("GET", "/api/auth/state", as: Methods.self).value
        }
        .textPrompt($prompt)
        .confirmationDialog(t("logins.removeTitle"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { l in
            Button(t("logins.remove"), role: .destructive) { Task { message = await model.api("DELETE", "/api/auth/logins/\(l.provider)/\(l.id)").error.map(hostRefusal); await load() } }
        } message: { l in Text(t("logins.removeConfirm", ["name": l.name ?? t("logins.\(l.provider)")])) }
        .refusal($message)
    }

    private func load() async {
        switch await model.api("GET", "/api/auth/logins", as: [LoginEntry].self) {
        case let .ok(l): logins = l
        case let .refused(e): message = hostRefusal(e)
        }
    }

    /// The server's ceremony for an app opened in the system's sign-in window, then the new login watched for, at most
    /// five minutes as the web's.
    private func ceremony(_ path: String, _ body: [String: Any]) async {
        struct Begun: Decodable { let url: String }
        let app: [String: Any] = ["deviceName": BrowserSignIn.deviceName, "callbackScheme": BrowserSignIn.scheme]
        // On a desktop host only the host computer itself adds a login (the server's rule): a paired device is refused.
        let begun = await model.api("POST", path, body.merging(["app": app]) { a, _ in a }, as: Begun.self)
        guard case let .ok(b) = begun else { return message = hostRefusal(begun.error ?? "unknown") }
        guard let url = URL(string: b.url, relativeTo: URL(string: model.session?.server ?? "")) else { return message = t("auth.failed") }
        let before = Set(logins.map { "\($0.provider):\($0.id)" })
        waiting = true
        defer { waiting = false }
        await browser.open(url.absoluteURL)
        for _ in 0..<300 {
            await load()
            if let added = logins.first(where: { !before.contains("\($0.provider):\($0.id)") }) {
                return message = t(added.provider == "google" ? "logins.linked" : "logins.added")
            }
            try? await Task.sleep(for: .seconds(1))
            if !waiting { return }
        }
    }
}

// MARK: Felrapporter

struct ReportEntry: Decodable, Identifiable, Hashable {
    let id: String, createdAt: Double, text: String, done: Bool, unread: Int
    let userName: String?, orgName: String?
}

struct ReportMessage: Decodable, Identifiable, Hashable { let id: String, createdAt: Double, fromAdmin: Bool, userName: String, text: String }

struct BugReportsPage: View {
    @Environment(Model.self) private var model
    let mine: Bool
    @State private var reports: [ReportEntry] = []
    @State private var query = ""
    @State private var message: String?

    private var base: String { mine ? "/api/my-reports" : "/api/reports" }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = q.isEmpty ? reports : reports.filter { [$0.text, $0.userName ?? "", $0.orgName ?? ""].joined(separator: " ").lowercased().contains(q) }
        List(shown) { r in
            NavigationLink { BugReportPage(id: r.id, mine: mine) } label: {
                HStack(alignment: .top) {
                    Circle().fill(!r.done || r.unread > 0 ? Color.sky : .clear).frame(width: 8, height: 8).padding(.top, 6)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.text).lineLimit(2)
                        let facts = [relative(r.createdAt), r.userName, r.orgName, r.unread > 0 ? t("reports.unread", ["n": r.unread]) : nil, mine && r.done ? t("myReports.done") : nil]
                        Text(facts.compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .overlay { if reports.isEmpty { ContentUnavailableView(message ?? t(mine ? "myReports.empty" : "reports.empty"), systemImage: "ladybug") } }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .task { await load() }
    }

    private func load() async {
        switch await model.api("GET", base, as: [ReportEntry].self) {
        case let .ok(r): reports = r
        case let .refused(e): message = hostRefusal(e)
        }
    }
}

struct BugReportPage: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String, mine: Bool
    @State private var report: Report?
    @State private var reply = ""
    @State private var deleting = false
    @State private var message: String?
    struct Report: Decodable { let id: String, createdAt: Double, text: String, done: Bool, userName: String?, userEmail: String?, orgName: String?, messages: [ReportMessage], shot: String?, state: JSONValue? }
    /// A step before the report, as the web's SentStep.
    private struct Step: Decodable, Hashable { let secondsBefore: Double, kind: String, what: String, times: Int? }

    private var base: String { mine ? "/api/my-reports/\(id)" : "/api/reports/\(id)" }

    var body: some View {
        Form {
            if let r = report {
                Section {
                    Text(r.text)
                    LabeledContent(t("reports.when"), value: relative(r.createdAt))
                    if let who = r.userName { LabeledContent(t("reports.who"), value: [who, r.userEmail].compactMap { $0 }.joined(separator: " · ")) }
                    if let org = r.orgName { LabeledContent(t("reports.org"), value: org) }
                    if !mine {
                        LabeledContent(t("reports.page"), value: r.state?["page"]?.string ?? "")
                        LabeledContent(t("reports.app"), value: r.state?["app"]?.string ?? "")
                        LabeledContent(t("about.version"), value: r.state?["version"]?.string ?? "")
                    }
                }
                if let image = shot(r.shot) {
                    Section(t("reports.screenshot")) { image.resizable().scaledToFit() }
                }
                let steps = (r.state?["steps"]).flatMap { try? JSONDecoder().decode([Step].self, from: JSONEncoder().encode($0)) } ?? []
                if !mine, !steps.isEmpty {
                    Section(t("reports.steps")) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { _, s in
                            HStack(alignment: .firstTextBaseline) {
                                Text(t("reports.secondsBefore", ["n": Int(s.secondsBefore)])).font(.caption).monospacedDigit().foregroundStyle(.secondary).frame(width: 56, alignment: .leading)
                                Text(t("reports.step.\(s.kind)")).font(.caption).foregroundStyle(.secondary).frame(width: 72, alignment: .leading)
                                Text(s.what).foregroundStyle(s.kind == "error" ? .red : .primary).textSelection(.enabled)
                                if let n = s.times, n > 0 { Text("×\(n)").font(.caption).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
                if !mine, let state = r.state {
                    Section {
                        DisclosureGroup(t("reports.state")) {
                            Text(pretty(state)).font(.caption.monospaced()).textSelection(.enabled)
                        }
                    }
                }
                Section(t("reports.thread")) {
                    if r.messages.isEmpty { Text(t(mine ? "myReports.noAnswer" : "reports.noMessages")).foregroundStyle(.secondary) }
                    ForEach(r.messages) { m in
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(m.userName) · \(relative(m.createdAt))").font(.caption).foregroundStyle(.secondary)
                            Text(m.text)
                        }
                    }
                    TextField(t("reports.write"), text: $reply, axis: .vertical).lineLimit(2...6)
                    Button(t("common.save")) { Task { await send() } }.disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                if !mine {
                    Section {
                        Button(t(r.done ? "reports.markNew" : "reports.markDone")) { Task { message = await model.api("PATCH", base, ["done": !r.done]).error.map(hostRefusal); await load() } }
                        Button(t("common.delete"), role: .destructive) { deleting = true }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .task { await load() }
        .confirmationDialog(t("common.delete"), isPresented: $deleting) {
            Button(t("common.delete"), role: .destructive) { Task { if let e = await model.api("DELETE", base).error { message = hostRefusal(e) } else { dismiss() } } }
        } message: { Text(t("reports.deleteText")) }
        .refusal($message)
    }

    private func load() async { report = await model.api("GET", base, as: Report.self).value }

    /// The screenshot the report carries as a data address (`data:image/…;base64,…`).
    private func shot(_ data: String?) -> Image? {
        guard let data, let comma = data.firstIndex(of: ","), let bytes = Data(base64Encoded: String(data[data.index(after: comma)...])) else { return nil }
        #if os(macOS)
        return NSImage(data: bytes).map { Image(nsImage: $0) }
        #else
        return UIImage(data: bytes).map { Image(uiImage: $0) }
        #endif
    }

    /// The whole state as the web shows it, indented.
    private func pretty(_ v: JSONValue) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: v.any, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]) else { return "" }
        return String(decoding: d, as: UTF8.self)
    }

    private func send() async {
        struct Answer: Decodable { let mailed: Bool? }
        switch await model.api("POST", "\(base)/messages", ["text": reply.trimmingCharacters(in: .whitespacesAndNewlines)], as: Answer.self) {
        case let .refused(e): message = hostRefusal(e)
        case let .ok(a):
            reply = ""
            if a.mailed == true, let e = report?.userEmail { message = t("reports.mailed", ["email": e]) }
            await load()
        }
    }
}

// MARK: Alla organisationer

struct OrgEntry: Decodable, Identifiable, Hashable { let id: String, name: String, members: Int }

struct OrgsPage: View {
    @Environment(Model.self) private var model
    @State private var orgs: [OrgEntry] = []
    @State private var prompt: TextPrompt?
    @State private var message: String?
    @State private var refusal: String?
    @State private var query = ""

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        List(q.isEmpty ? orgs : orgs.filter { $0.name.lowercased().contains(q) }) { o in
            NavigationLink { OrgDetailPage(id: o.id) } label: {
                LabeledContent(o.name, value: t("orgs.members", ["n": o.members]))
            }
        }
        .overlay { if orgs.isEmpty { ContentUnavailableView(message ?? t("orgs.empty"), systemImage: "square.grid.2x2") } }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .floatingAdd(model.libraryPage("orgs")) {
            prompt = TextPrompt(title: t("orgs.createTitle"), label: t("orgs.name"), text: "", rule: FieldRule(required: true, max: 200)) { name in
                Task {
                    struct Made: Decodable { let id: String }
                    switch await model.api("POST", "/api/orgs", ["name": name.trimmingCharacters(in: .whitespaces)], as: Made.self) {
                    case let .refused(e): refusal = hostRefusal(e)
                    // Into the new organisation, as the web's switchOrg, its users the next thing to set up.
                    case let .ok(m): if let e = await model.app.switchOrg(m.id) { refusal = hostRefusal(e) }
                    }
                    await load()
                }
            }
        }
        .textPrompt($prompt)
        .task { await load() }
        // A refused new organisation or switch said in an alert, as the web's dialog says it; `message` is the list's
        // load failure, in its place.
        .refusal($refusal)
    }

    private func load() async {
        switch await model.api("GET", "/api/orgs", as: [OrgEntry].self) {
        case let .ok(o): orgs = o
        case let .refused(e): message = hostRefusal(e)
        }
    }
}

struct OrgDetailPage: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var org: Detail?
    @State private var name = ""
    @FocusState private var naming: Bool
    @State private var typed = ""
    @State private var message: String?
    struct Detail: Decodable { struct Member: Decodable, Identifiable { let id: String, name: String, role: String }; let name: String, users: [Member] }

    var body: some View {
        Form {
            if let org {
                TextField(t("org.name"), text: $name).savedWhenLeft($naming, value: name) {
                    let v = name.trimmingCharacters(in: .whitespaces)
                    guard !v.isEmpty, v != org.name else { return }
                    Task {
                        if let e = await model.api("PATCH", "/api/orgs/\(id)", ["name": v]).error { return message = hostRefusal(e) }
                        // The new name read back, so Radera asks for it and says it.
                        self.org = await model.api("GET", "/api/orgs/\(id)", as: Detail.self).value ?? self.org
                    }
                }
                Section(t("org.membersTitle", ["n": org.users.count])) {
                    if org.users.isEmpty { Text(t("org.noMembers")).foregroundStyle(.secondary) }
                    ForEach(org.users) { u in LabeledContent(u.name, value: t("role.\(u.role)")) }
                }
                Section {
                    Text(t("org.deleteConfirm", ["name": org.name]))
                    TextField(t("org.typeToConfirm", ["name": org.name]), text: $typed)
                    // The organisation one is in is left first, into another, as the web's: then it is deleted.
                    Button(t("org.delete"), role: .destructive) {
                        Task {
                            if id == model.session?.me.orgId {
                                struct Org: Decodable { let id: String }
                                let others = (await model.api("GET", "/api/auth/orgs", as: [Org].self).value ?? []).filter { $0.id != id }
                                guard let other = others.first else { return message = hostRefusal("not-found") }
                                if let e = await model.app.switchOrg(other.id) { return message = hostRefusal(e) }
                            }
                            if let e = await model.api("DELETE", "/api/orgs/\(id)").error { message = hostRefusal(e) } else { message = t("org.deleted", ["name": org.name]); dismiss() }
                        }
                    }.disabled(typed != org.name)
                }
            }
        }
        .formStyle(.grouped)
        .task {
            org = await model.api("GET", "/api/orgs/\(id)", as: Detail.self).value
            name = org?.name ?? ""
        }
        .refusal($message)
    }
}
