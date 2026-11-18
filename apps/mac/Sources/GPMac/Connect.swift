// Connecting a device to a church's desktop host (docs/sign-in-and-pairing.md, pairing): its address, then the
// six-digit code the host shows under Enheter → Anslut enhet, or no code on a host that lets devices in for
// development (GP_DEV_PAIR=1). A host's self-signed certificate is shown once, to accept, as a browser's warning is.
import Shell
import SwiftUI
#if os(iOS)
import UIKit
#endif

struct ConnectView: View {
    @Environment(Model.self) private var model
    @AppStorage("gp.lastServer") private var address = ""
    @State private var code = ""
    @State private var askCode = false
    @State private var busy = false
    @State private var problem: String?
    @State private var certificate: UntrustedCertificate?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(t("server.address"), text: $address, prompt: Text("192.168.1.59:47843"))
                        .textContentType(.URL).autocorrectionDisabled()
                        #if os(iOS)
                        .keyboardType(.URL).textInputAutocapitalization(.never)
                        #endif
                    if askCode {
                        TextField(t("pair.code"), text: $code)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                    }
                } header: {
                    Text(t("pair.title"))
                } footer: {
                    Text(askCode ? t("pair.text") : n("addressHint"))
                }
                if let problem { Section { Text(problem).foregroundStyle(.red) } }
                Section {
                    Button(t("pair.submit")) { Task { await connect() } }
                        .disabled(busy || address.isEmpty || (askCode && code.count != 6))
                    Button(n("demo")) { model.openDemo() }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Gospel Presenter")
            .disabled(busy)
            .overlay { if busy { ProgressView() } }
            .alert(n("certificate"), isPresented: Binding(get: { certificate != nil }, set: { if !$0 { certificate = nil } }), presenting: certificate) { c in
                Button(n("trust")) {
                    PinnedCertificates.trust(c)
                    Task { await connect() }
                }
                Button(t("common.cancel"), role: .cancel) {}
            } message: { c in
                Text(n("certificateText", ["host": c.host, "fingerprint": c.fingerprint]))
            }
        }
        .macWidth(480)
    }

    private func connect() async {
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let server = try Server(address)
            switch try await Pairing.status(server) {
            case .notAHost:
                problem = n("notAHost")
            case .dev:
                model.open(try await Pairing.claim(server, code: nil, name: deviceName))
            case .code where !askCode:
                askCode = true
            case .code:
                model.open(try await Pairing.claim(server, code: code, name: deviceName))
            }
        } catch let c as UntrustedCertificate {
            certificate = c
        } catch let r as Pairing.Refused {
            problem = r.code == "pair-code-invalid" ? t("error.pair-code-invalid") : n("refused", ["code": r.code])
        } catch {
            problem = t("server.unreachable")
        }
    }

    private var deviceName: String {
        #if os(iOS)
        UIDevice.current.name
        #else
        Host.current().localizedName ?? "Mac"
        #endif
    }
}

/// The user's picture and its menu (docs/layout-2-0.md, "The start page and the bar"): the name, the sync's state only
/// while it has a problem (with a dot on the picture, and Synka nu), and Logga ut. In the demo, the role its changes run
/// with, to try what each may do.
struct AccountMenu: View {
    @Environment(Model.self) private var model

    var body: some View {
        @Bindable var model = model
        Menu {
            Section(model.userName) {
                if let problem = model.syncProblem {
                    Text(problem)
                    Button(t("status.syncNow"), systemImage: "arrow.triangle.2.circlepath") { model.syncNow() }
                }
                if model.session == nil {
                    Picker(t("users.role"), selection: $model.role) {
                        Text(t("role.user")).tag("user")
                        Text(t("role.admin")).tag("admin")
                    }
                }
                Button(t("auth.signOut"), systemImage: "rectangle.portrait.and.arrow.right") { model.signOut() }
            }
        } label: {
            Text(String(model.userName.prefix(1)).uppercased())
                .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                .frame(width: 30, height: 30).background(Color.indigo, in: Circle())
                .overlay(alignment: .topTrailing) {
                    if model.syncProblem != nil { Circle().fill(.orange).frame(width: 9, height: 9).offset(x: 2, y: -2) }
                }
        }
        // On a Mac the picture itself, not the toolbar's grey menu button with a faint letter in it.
        #if os(macOS)
        .menuStyle(.button).buttonStyle(.plain).menuIndicator(.hidden).fixedSize()
        #endif
        .accessibilityLabel(model.userName)
    }
}
