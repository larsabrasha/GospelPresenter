// Användare and Enheter (the web's Users.tsx, UserDetail.tsx and Devices.tsx): the server's, not the synced data's,
// so each is read and changed through its endpoints (HostAPI.swift) while connected. What is offered for whom before
// anything is pressed is the core's (`userRulesView`, packages/core's accountRefusal, roleChangeRefusal and
// removeUserRefusal as the web asks them); what only the server knows (the last Admin) is its refusal, said.
import SwiftUI

struct UserEntry: Decodable, Identifiable, Hashable {
    struct Invite: Decodable, Hashable { let expiresAt: Double, expired: Bool }
    let id: String, name: String, email: String?, role: String, active: Bool, invite: Invite?
    var onlyHere: Bool? = nil, superAdmin: Bool? = nil
}

/// What Användare and Enheter offer for a member (`userRulesView`).
struct UserRules: Decodable {
    let id: String, canEdit: Bool, roles: [String], roleLocked: Bool, canAccount: Bool, canRemove: Bool, pairAs: Bool
}

extension Model {
    /// The core's rules for `users`, as this signed-in person sees them.
    func userRules(_ users: [UserEntry]) -> [String: UserRules] {
        struct Answer: Decodable { let users: [UserRules] }
        let args: [String: Any] = [
            "actor": ["id": session?.me.userId ?? "", "role": role],
            "users": users.map { ["id": $0.id, "role": $0.role, "superAdmin": $0.superAdmin ?? false, "onlyHere": $0.onlyHere ?? false] as [String: Any] },
            "host": session?.device != nil,
        ]
        return Dictionary((view("userRulesView", args, as: Answer.self)?.users ?? []).map { ($0.id, $0) }) { a, _ in a }
    }
}
struct InvitationEntry: Decodable, Identifiable, Hashable { let id: String, email: String, role: String, expiresAt: Double, expired: Bool }

/// "om 3 dagar", in the device's language, as the web's relative times.
func relative(_ ms: Double) -> String {
    let f = RelativeDateTimeFormatter()
    f.locale = Texts.locale
    return f.localizedString(for: Date(timeIntervalSince1970: ms / 1000), relativeTo: Date())
}

struct UsersPage: View {
    @Environment(Model.self) private var model
    @State private var users: [UserEntry] = []
    @State private var invitations: [InvitationEntry] = []
    @State private var query = ""
    @State private var adding = false
    /// The new user's invite link, shown when the add sheet has closed.
    @State private var madeLink: String?
    @State private var withdrawing: InvitationEntry?
    @State private var link: String?
    @State private var message: String?
    @State private var refusal: String?
    /// The add sheet up, from + until its onDismiss (`adding` turns false when it starts closing).
    @State private var addOpen = false

    private var host: Bool { model.session?.device != nil }

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = q.isEmpty ? users : users.filter { $0.name.lowercased().contains(q) || ($0.email ?? "").lowercased().contains(q) }
        List {
            Section {
                ForEach(shown) { u in
                    NavigationLink { UserDetailPage(id: u.id) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(u.name)
                                Text([u.email, status(u)].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(t("role.\(u.role)")).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if !invitations.isEmpty {
                Section(t("users.invited")) {
                    ForEach(invitations) { i in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(i.email)
                                Text(i.expired ? t("users.inviteExpired") : t("users.inviteActive", ["days": relative(i.expiresAt)])).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(t("users.withdraw")) { withdrawing = i }.buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
        .overlay { if users.isEmpty, let message { ContentUnavailableView(message, systemImage: "person.2") } }
        .searchable(text: $query, prompt: t("images.searchPlaceholder"))
        .toolbar {
            if model.can("ManageUsers") {
                ToolbarItem(placement: .primaryAction) { Button(t(host ? "users.create" : "users.invite"), systemImage: "plus") { adding = true } }
            }
        }
        .task { await load() }
        // The link shown once the add sheet has closed: a second sheet asked for while the first is up is never shown,
        // and the link is shown only once.
        .onChange(of: adding) { _, up in if up { addOpen = true } }
        .sheet(isPresented: $adding, onDismiss: { addOpen = false; link = madeLink; madeLink = nil }) { NewUserSheet(host: host) { token in
            // Still up or closing: shown when it has closed; closed already (cancelled while it saved): shown now.
            if addOpen { madeLink = token } else { link = token }
            Task { await load() }
        } }
        .sheet(item: Binding(get: { link.map { LinkBox(url: $0) } }, set: { link = $0?.url })) { box in InviteLinkSheet(url: box.url) }
        .confirmationDialog(t("users.withdraw"), isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }), presenting: withdrawing) { i in
            Button(t("users.withdraw"), role: .destructive) { Task { refusal = await model.api("DELETE", "/api/invitations/\(i.id)").error.map(hostRefusal); await load() } }
        } message: { i in Text(t("users.withdrawConfirm", ["email": i.email])) }
        // A refused action said in an alert; `message` is the list's own load failure, shown in place of the list.
        .refusal($refusal)
    }

    private func status(_ u: UserEntry) -> String {
        if u.active { return t("users.active") }
        guard let i = u.invite else { return t("users.noLogin") }
        return i.expired ? t("users.inviteExpired") : t("users.inviteActive", ["days": relative(i.expiresAt)])
    }

    private func load() async {
        switch await model.api("GET", "/api/users", as: [UserEntry].self) {
        case let .ok(u): users = u; message = nil
        case let .refused(e): message = hostRefusal(e)
        }
        invitations = await model.api("GET", "/api/invitations", as: [InvitationEntry].self).value ?? []
    }
}

struct LinkBox: Identifiable { let url: String; var id: String { url } }

/// Bjud in (a server that mails, or gives a link) or, on a desktop host, Skapa användare: a name, an address and a role.
struct NewUserSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let host: Bool
    let done: (String?) -> Void
    @State private var name = ""
    @State private var email = ""
    @State private var role = "user"
    @State private var error: String?

    var body: some View {
        Form {
            if host { TextField(t("users.name"), text: $name).limited($name, to: 200) }
            TextField(t("users.email"), text: $email)
            Picker(t("users.role"), selection: $role) {
                ForEach(["user", "admin"], id: \.self) { r in Text(t("role.\(r)")).tag(r) }
            }
            Text(t("role.\(role).description")).font(.caption).foregroundStyle(.secondary)
            if let error { Text(error).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .sheetBar(t(host ? "users.createTitle" : "users.inviteTitle"), confirm: t(host ? "users.create" : "users.invite"),
                  disabled: host ? name.trimmingCharacters(in: .whitespaces).isEmpty : email.trimmingCharacters(in: .whitespaces).isEmpty) {
            Task { await save() }
            return false
        }
        .sheetSize(380, 300)
    }

    private func save() async {
        let address = email.trimmingCharacters(in: .whitespaces)
        if host {
            let body: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces), "role": role, "email": address.isEmpty ? NSNull() : address]
            if let e = await model.api("POST", "/api/users", body).error { return error = hostRefusal(e) }
            done(nil)
        } else {
            struct Answer: Decodable { let mailed: Bool, inviteToken: String? }
            switch await model.api("POST", "/api/invitations", ["email": address, "role": role, "language": Texts.language], as: Answer.self) {
            case let .refused(e): return error = e == "email-taken" ? t("users.alreadyMember") : hostRefusal(e)
            case let .ok(a): done(a.inviteToken.map { "\(model.session?.server ?? "")/invite#\($0)" })
            }
        }
        dismiss()
    }
}

/// An invitation's link, shown once: to copy or share.
struct InviteLinkSheet: View {
    let url: String
    var body: some View {
        Form {
            Text(t("userDetail.linkShownOnce")).font(.callout).foregroundStyle(.secondary)
            Text(url).font(.callout.monospaced()).textSelection(.enabled)
            Button(t("userDetail.copy"), systemImage: "doc.on.doc") { copyText(url) }
            if let u = URL(string: url) { ShareLink(t("userDetail.share"), item: u) }
        }
        .formStyle(.grouped)
        .sheetBar(t("userDetail.inviteLink"), confirm: t("common.close")) { true }
        .sheetSize(420, 240)
    }
}

struct UserDetailPage: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var user: UserEntry?
    @State private var logins: [LoginEntry] = []
    @State private var mail = false
    @State private var name = ""
    @State private var email = ""
    @FocusState private var naming: Bool
    @FocusState private var addressing: Bool
    @State private var link: String?
    @State private var removing = false
    @State private var deletingLogin: LoginEntry?
    @State private var deletingInvite = false
    @State private var message: String?

    private var me: Bool { model.session?.me.userId == id }

    var body: some View {
        Form {
            if let user, let rules = model.userRules([user])[user.id] {
                Section {
                    if rules.canEdit {
                        TextField(t("users.name"), text: $name).savedWhenLeft($naming, value: name) {
                            let v = name.trimmingCharacters(in: .whitespaces)
                            if v != user.name { patch(["name": v]) }
                        }
                        TextField(t("users.email"), text: $email).savedWhenLeft($addressing, value: email) {
                            let e = email.trimmingCharacters(in: .whitespaces)
                            if e != (user.email ?? "") { patch(["email": e.isEmpty ? NSNull() : e]) }
                        }
                    } else {
                        LabeledContent(t("users.name"), value: user.name)
                        LabeledContent(t("users.email"), value: user.email ?? "–")
                    }
                } footer: { if !rules.canEdit { Text(t(me ? "userDetail.ownAccountHere" : "userDetail.theirAccount")) } }
                Section {
                    Picker(t("users.role"), selection: Binding(get: { user.role }, set: { patch(["role": $0]) })) {
                        ForEach(rules.roles, id: \.self) { r in Text(t("role.\(r)")).tag(r) }
                    }
                    .disabled(rules.roleLocked)
                } footer: { if me { Text(t("users.ownRole")) } }
                Section(t("userDetail.login")) {
                    if logins.isEmpty { Text(t("userDetail.noLogins")).foregroundStyle(.secondary) }
                    ForEach(logins) { l in
                        HStack {
                            Text(l.name ?? t("userDetail.provider.\(l.provider)"))
                            Spacer()
                            if rules.canAccount {
                                Button(t("userDetail.deleteLogin"), role: .destructive) { deletingLogin = l }.buttonStyle(.borderless)
                            }
                        }
                    }
                }
                Section(t("userDetail.inviteLink")) {
                    if let i = user.invite {
                        LabeledContent(i.expired ? t("userDetail.expired") : t("userDetail.active"), value: i.expired ? "" : t("userDetail.expiresIn", ["time": relative(i.expiresAt)]))
                        if rules.canAccount { Button(t("userDetail.deleteInvite"), role: .destructive) { deletingInvite = true } }
                    }
                    if rules.canAccount { Button(t(user.invite == nil ? "userDetail.createInvite" : "userDetail.newLink")) { Task { await createInvite(replacing: user.invite != nil) } } }
                    if mail, rules.canAccount, let e = user.email {
                        Button(t("userDetail.mailInvite", ["email": e])) {
                            Task { message = await model.api("POST", "/api/users/\(id)/invites/email", ["language": Texts.language]).error.map(hostRefusal) ?? t("userDetail.mailSent", ["email": e]) }
                        }
                    }
                }
                if rules.canRemove { Section { Button(t("users.remove"), role: .destructive) { removing = true } } }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(user?.name ?? "")
        .task { await load() }
        .sheet(item: Binding(get: { link.map { LinkBox(url: $0) } }, set: { link = $0?.url })) { box in InviteLinkSheet(url: box.url) }
        .confirmationDialog(t("users.remove"), isPresented: $removing) {
            Button(t("users.remove"), role: .destructive) {
                Task { if let e = await model.api("DELETE", "/api/users/\(id)").error { message = hostRefusal(e) } else { dismiss() } }
            }
        } message: { Text(t("users.removeConfirm", ["name": user?.name ?? ""])) }
        // A login and the invite link are removed only once asked, as the web asks: a passkey or Google login removed
        // cannot be had back.
        .confirmationDialog(t("userDetail.deleteLogin"), isPresented: Binding(get: { deletingLogin != nil }, set: { if !$0 { deletingLogin = nil } }), presenting: deletingLogin) { l in
            Button(t("common.delete"), role: .destructive) {
                Task { message = await model.api("DELETE", "/api/users/\(id)/logins/\(l.provider)/\(l.id)").error.map(hostRefusal); await load() }
            }
        } message: { l in Text(t("userDetail.confirmDeleteLogin", ["provider": l.name ?? t("userDetail.provider.\(l.provider)")])) }
        .confirmationDialog(t("userDetail.deleteInvite"), isPresented: $deletingInvite) {
            Button(t("common.delete"), role: .destructive) {
                Task { message = await model.api("DELETE", "/api/users/\(id)/invites").error.map(hostRefusal); await load() }
            }
        } message: { Text(t("userDetail.confirmDeleteInvite")) }
        .refusal($message)
    }

    private func load() async {
        user = await model.api("GET", "/api/users/\(id)", as: UserEntry.self).value
        // Not over a field being typed in (a save of the other field reloads while one types here).
        if !naming { name = user?.name ?? "" }
        if !addressing { email = user?.email ?? "" }
        logins = await model.api("GET", "/api/users/\(id)/logins", as: [LoginEntry].self).value ?? []
        struct State: Decodable { let mail: Bool }
        mail = await model.api("GET", "/api/auth/state", as: State.self).value?.mail ?? false
    }

    private func patch(_ body: [String: Any]) {
        Task {
            if let e = await model.api("PATCH", "/api/users/\(id)", body).error { message = e == "email-taken" ? t("error.email-taken") : hostRefusal(e) }
            await load()
        }
    }

    /// A new link: the old ones first removed, as the web's Skapa ny länk does.
    private func createInvite(replacing: Bool) async {
        // The old link not removed (refused, offline): said, and no new one, as the web's: it is made to kill the old.
        if replacing, let e = await model.api("DELETE", "/api/users/\(id)/invites").error { return message = hostRefusal(e) }
        struct Answer: Decodable { let inviteToken: String }
        switch await model.api("POST", "/api/users/\(id)/invites", as: Answer.self) {
        case let .ok(a): link = "\(model.session?.server ?? "")/invite#\(a.inviteToken)"
        case let .refused(e): message = hostRefusal(e)
        }
        await load()
    }
}

struct LoginEntry: Decodable, Identifiable, Hashable { let provider: String, id: String, name: String?, createdAt: Double, lastUsedAt: Double }

// MARK: Enheter

struct DeviceEntry: Decodable, Identifiable, Hashable { let id: String, name: String, createdAt: Double, lastUsedAt: Double, revokedAt: Double? }

struct DevicesPage: View {
    @Environment(Model.self) private var model
    @State private var devices: [DeviceEntry] = []
    @State private var pairing = false
    @State private var disconnecting: DeviceEntry?
    @State private var message: String?
    @State private var refusal: String?

    var body: some View {
        List {
            IntroCard(id: "devices")
            ForEach(devices) { d in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.name)
                        Text(t("devices.paired", ["date": date(d.createdAt)]) + " · " + (d.revokedAt != nil ? t("devices.disconnected") : t("devices.lastSeen", ["date": relative(d.lastUsedAt)])))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if d.revokedAt == nil { Button(t("devices.disconnect"), role: .destructive) { disconnecting = d }.buttonStyle(.borderless) }
                }
            }
        }
        .overlay { if devices.isEmpty { ContentUnavailableView(message ?? t("devices.empty"), systemImage: "ipad.and.iphone") } }
        .toolbar { ToolbarItem(placement: .primaryAction) { Button(t("devices.pair"), systemImage: "plus") { pairing = true } } }
        .task { await load() }
        .sheet(isPresented: $pairing) { PairSheet() }
        .confirmationDialog(t("devices.disconnect"), isPresented: Binding(get: { disconnecting != nil }, set: { if !$0 { disconnecting = nil } }), presenting: disconnecting) { d in
            Button(t("devices.disconnect"), role: .destructive) { Task { refusal = await model.api("DELETE", "/api/pair/devices/\(d.id)").error.map(hostRefusal); await load() } }
        } message: { d in Text(t("devices.disconnectConfirm", ["name": d.name])) }
        // A refused disconnect said in an alert, as the web's toast; `message` is the list's load failure, in its place.
        .refusal($refusal)
    }

    private func load() async {
        switch await model.api("GET", "/api/pair/devices", as: [DeviceEntry].self) {
        case let .ok(d): devices = d
        case let .refused(e): message = hostRefusal(e)
        }
    }

    private func date(_ ms: Double) -> String { Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.locale(Texts.locale).day().month().year()) }
}

/// Anslut enhet: who the device signs in as, then the six-digit code (and its QR) for it, valid ten minutes.
struct PairSheet: View {
    @Environment(Model.self) private var model
    @State private var users: [UserEntry] = []
    @State private var as_ = ""
    @State private var code: String?
    @State private var error: String?

    var body: some View {
        Form {
            if let code {
                Text(code).font(.system(size: 44, weight: .semibold, design: .monospaced)).frame(maxWidth: .infinity)
                let url = "\(model.session?.server ?? "")/#pair=\(code)"
                if let qr = qrImage(url) { qr.interpolation(.none).resizable().scaledToFit().frame(width: 180, height: 180).frame(maxWidth: .infinity) }
                Text(t("devices.codeText", ["name": users.first { $0.id == as_ }?.name ?? ""])).font(.callout)
                Text(t("devices.openOn", ["url": url])).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            } else {
                Picker(t("devices.as"), selection: $as_) { ForEach(users) { u in Text(u.name).tag(u.id) } }
                Button(t("devices.showCode")) { Task { await show() } }.disabled(as_.isEmpty)
            }
            if let error { Text(error).foregroundStyle(.red) }
        }
        .formStyle(.grouped)
        .sheetBar(t("devices.codeTitle"), confirm: t("common.close")) { true }
        .sheetSize(400, 360)
        .task {
            // The caller, or a member whose account they may reset (`pairAs`), as the web's PairAsDialog.
            let all = await model.api("GET", "/api/users", as: [UserEntry].self).value ?? []
            let rules = model.userRules(all)
            users = all.filter { rules[$0.id]?.pairAs == true }
            as_ = model.session?.me.userId ?? users.first?.id ?? ""
        }
    }

    private func show() async {
        struct Answer: Decodable { let code: String }
        switch await model.api("POST", "/api/pair/code", ["userId": as_], as: Answer.self) {
        case let .ok(a): code = a.code
        case let .refused(e): error = hostRefusal(e)
        }
    }
}
