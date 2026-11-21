// Mina inställningar (the web's Settings.tsx and settings/Profile.tsx), its groups the core's (`mySettingsView`): one's
// name and address, superadminläge for a Superadmin, the colour theme and language of this device, its storage, and
// the ways to sign in and the bug reports one sent. A grouped Form, as System Settings and iOS's Settings draw theirs.
import Shell
import SwiftUI

/// The signed-in user as `GET /api/auth/me` gives them, with what the session does not keep.
struct FullMe: Decodable {
    let userId: String, name: String, email: String?, emailConfirmed: Bool, role: String, superAdmin: Bool, orgId: String, orgName: String
    var me: Me { Me(userId: userId, name: name, role: role, orgId: orgId, orgName: orgName) }
}

/// A row of Mina inställningar as the core gives it.
struct MineRow: Decodable, Identifiable {
    struct Choice: Decodable, Hashable { let id: String, text: String }
    struct Badge: Decodable { let text: String, colour: String }
    let id: String, kind: String, text: String
    let choices: [Choice]?, value: String?, empty: String?, badge: Badge?, description: String?, on: Bool?
}

struct MineGroup: Decodable, Identifiable { let id: String, title: String?, footer: String?, rows: [MineRow] }
struct MineGroups: Decodable { let groups: [MineGroup] }

/// This device's colour theme (`gp.theme`: system, light or dark), as the web keeps its own.
enum AppTheme {
    static let key = "gp.theme"
    static func scheme(_ theme: String) -> ColorScheme? { theme == "light" ? .light : theme == "dark" ? .dark : nil }
}

struct MySettingsPage: View {
    @Environment(Model.self) private var model
    @AppStorage(AppTheme.key) private var theme = "system"
    /// Slå på utgångar automatiskt (AutoOutputs.swift), on at first as on the web.
    @AppStorage("gp.autoOutputs") private var autoOutputs = true
    @State private var me: FullMe?
    @State private var mail = false
    @State private var name = ""
    @FocusState private var naming: Bool
    @State private var changingEmail = false
    @State private var message: String?
    @State private var language = Texts.language
    @State private var unread = 0

    private var groups: [MineGroup] {
        // `desktop`: an output goes to a display of its own here, the Mac's output window or iOS's external display.
        var args: [String: Any] = ["role": model.role, "superAdmin": me?.superAdmin ?? false, "desktop": true, "mail": mail, "emailConfirmed": me?.emailConfirmed ?? false]
        if let email = me?.email { args["email"] = email }
        return model.view("mySettingsView", args, as: MineGroups.self)?.groups ?? []
    }

    var body: some View {
        Form {
            ForEach(groups) { g in
                Section {
                    ForEach(g.rows) { r in row(r) }
                } header: { g.title.map { Text(t($0)) } } footer: { g.footer.map { Text(t($0)) } }
            }
        }
        .formStyle(.grouped)
        .task { await load() }
        .sheet(isPresented: $changingEmail) { EmailSheet { address in await changeEmail(address) } }
        .refusal($message)
    }

    @ViewBuilder private func row(_ r: MineRow) -> some View {
        switch r.kind {
        case "field":
            TextField(t(r.text), text: $name).savedWhenLeft($naming, value: name) { Task { await saveName() } }
                .disabled(model.session == nil)
        case "value":
            LabeledContent(t(r.text)) {
                HStack {
                    Text(r.value ?? t(r.empty ?? "")).foregroundStyle(.secondary)
                    if let b = r.badge { Text(t(b.text)).font(.caption).foregroundStyle(b.colour == "green" ? .green : .orange) }
                }
            }
        case "action":
            Button(t(r.text)) {
                if r.id == "changeEmail" { changingEmail = true } else { Task { await confirmEmail() } }
            }.disabled(model.session == nil)
        case "choice" where r.id == "theme":
            Picker(t(r.text), selection: $theme) { ForEach(r.choices ?? [], id: \.self) { c in Text(t(c.text)).tag(c.id) } }
                .pickerStyle(.segmented)
                #if os(iOS)
                // On the group's ground under its heading, not in a cell of its own: a box in a box otherwise.
                .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                #endif
        case "choice":
            Picker(t(r.text), selection: $language) { ForEach(r.choices ?? [], id: \.self) { c in Text(t(c.text)).tag(c.id) } }
                .onChange(of: language) { _, now in Texts.choose(now); model.app.textsChanged() }
        case "switch" where r.id == "superMode":
            Toggle(t(r.text), isOn: Binding(get: { r.on ?? false }, set: { on in Task { await setSuperMode(on) } }))
        case "switch" where r.id == "autoOutputs":
            VStack(alignment: .leading, spacing: 2) {
                Toggle(t(r.text), isOn: $autoOutputs)
                if let d = r.description { Text(t(d)).font(.caption).foregroundStyle(.secondary) }
            }
        case "link":
            NavigationLink { SettingsDetail(id: r.id) } label: {
                // Mina felrapporter says how many answers wait unread, as the web's row.
                LabeledContent(t(r.text), value: r.id == "myReports" && unread > 0 ? t("reports.unread", ["n": unread]) : "")
            }
        default:
            EmptyView()
        }
    }

    private func load() async {
        name = model.userName
        guard model.session != nil else { return }
        if let m = await model.api("GET", "/api/auth/me", as: FullMe.self).value { me = m; if !naming { name = m.name } }
        struct State: Decodable { let mail: Bool }
        mail = await model.api("GET", "/api/auth/state", as: State.self).value?.mail ?? false
        struct Unread: Decodable { let unread: Int }
        unread = await model.api("GET", "/api/my-reports/unread", as: Unread.self).value?.unread ?? 0
    }

    private func saveName() async {
        let v = name.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty, v != me?.name, let me else { return }
        if let e = await model.api("PATCH", "/api/auth/me", ["name": v]).error { return message = hostRefusal(e) }
        self.me = FullMe(userId: me.userId, name: v, email: me.email, emailConfirmed: me.emailConfirmed, role: me.role, superAdmin: me.superAdmin, orgId: me.orgId, orgName: me.orgName)
        model.app.reopen(me: self.me!.me)
    }

    private func confirmEmail() async {
        guard let email = me?.email else { return }
        let e = await model.api("POST", "/api/auth/email", ["email": email, "language": Texts.language]).error
        message = e.map(refusalText) ?? t("profile.linkSent", ["email": email])
    }

    /// A new address: a link goes to it where the server mails, else it is set at once, unconfirmed.
    private func changeEmail(_ address: String) async -> String? {
        struct Changed: Decodable { let sent: Bool? }
        switch await model.api("POST", "/api/auth/email", ["email": address, "language": Texts.language], as: Changed.self) {
        case let .refused(e): return hostRefusal(e)
        case let .ok(c):
            if c.sent == true { message = t("profile.linkSent", ["email": address]) }
            await load()
            return nil
        }
    }

    /// Superadminläge on (after a recent sign-in of one's own) or off; the database opened again with the new role.
    private func setSuperMode(_ on: Bool) async {
        struct Answer: Decodable { let token: String?; let me: FullMe }
        switch await model.api("POST", "/api/auth/superadmin", ["on": on], as: Answer.self) {
        case let .refused(e): message = hostRefusal(e)
        case let .ok(a): me = a.me; model.app.reopen(token: a.token, me: a.me.me)
        }
    }
}

/// Byt e-postadress: the new address, Avbryt and Spara; a refusal said under the field.
struct EmailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let save: (String) async -> String?
    @State private var email = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                TextField(t("profile.newEmail"), text: $email)
                    #if os(iOS)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    #endif
                if let error { Text(error).foregroundStyle(.red).font(.callout) }
            }
            .formStyle(.grouped)
            .navigationTitle(t("profile.changeEmail"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("common.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("common.save")) {
                        let address = email.trimmingCharacters(in: .whitespaces)
                        guard address.contains("@"), address.contains(".") else { return error = t("error.invalid-email") }
                        saving = true
                        Task {
                            error = await save(address)
                            saving = false
                            if error == nil { dismiss() }
                        }
                    }.disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || saving)
                }
            }
        }
        .sheetSize(380, 200)
    }
}
