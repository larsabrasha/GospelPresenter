// Utgångar while presenting (spec 04 §1; the web's OutputsPanel.tsx and useOutputs.ts): the saved screens and the
// public outputs, each switched on or off for this session, a screen with no page open offline and not switchable
// (LIVE-A21), one another presentation sends to named and taken over only after a question (LIVE-R23), a public output
// with how many watch; and "Tillåt fjärrstyrning" (LIVE-R39). What each row says and the question are the core's
// (`outputRowsView`); the session is this device's (Shell's LiveStatus). Only while signed in to a host: the demo has none.
import Shell
import SwiftUI

private struct OutputRows: Decodable {
    struct Ask: Decodable { let title: String, text: String, args: [String: String], confirm: String }
    /// What is written under a row: a text (a warning in orange), or how many watch.
    struct Line: Decodable { let text: String?, args: [String: String]?, warn: Bool?, viewers: Int? }
    struct Row: Decodable, Identifiable { let id: String, name: String, kind: String, chosen: Bool, sending: Bool, offline: Bool, line: Line?, takeOver: Ask? }
    let rows: [Row]
    /// The temporary screens paired from here, each let go with ✕.
    let temporary: [LiveScreen]?
}

struct OutputsGroup: View {
    @Environment(Model.self) private var model
    @State private var asking: OutputRows.Row?

    var body: some View {
        if let owner = model.app.liveLink {
            let displays = model.view("displaysView", ["locale": Texts.language], as: [JSONValue].self)?.map(\.any) ?? []
            let args: [String: Any] = ["displays": displays, "sessions": owner.sessions, "online": owner.online, "chosen": owner.chosen, "sessionId": owner.sessionId, "screens": owner.screens]
            let answer = model.view("outputRowsView", args, as: OutputRows.self)
            let rows = answer?.rows ?? []
            VStack(alignment: .leading, spacing: 8) {
                Text(t("live.outputs")).font(.subheadline.weight(.semibold)).foregroundStyle(Color.quiet)
                ForEach(rows) { r in
                    Toggle(isOn: Binding(get: { r.sending }, set: { on in
                        if on, r.takeOver != nil { asking = r } else { owner.setOutput(r.id, on: on) }
                    })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Label(r.name, systemImage: r.kind == "public" ? "qrcode" : "tv")
                            if let line = r.line {
                                Text(line.viewers.map { "\($0) 👁" } ?? t(line.text ?? "", line.args ?? [:]))
                                    .font(.caption).foregroundStyle(line.warn == true ? .orange : .secondary)
                            }
                        }
                    }
                    .disabled(r.offline)
                    .accessibilityIdentifier("output-\(r.id)")
                }
                ForEach(answer?.temporary ?? [], id: \.id) { screen in
                    HStack {
                        Label(t("screens.temporary", ["n": screen.n]), systemImage: "tv.badge.wifi")
                        Spacer()
                        Button(t("screens.disconnect", ["n": screen.n]), systemImage: "xmark.circle.fill") { owner.setOutput(screen.id, on: false) }
                            .labelStyle(.iconOnly).buttonStyle(.plain).foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier("temporary-\(screen.n)")
                }
                Button(t("pairScreen.title"), systemImage: "plus.viewfinder") { model.pairingScreen = true }.accessibilityIdentifier("pair-screen")
                Toggle(t("remote.allow"), isOn: Binding(get: { owner.remote }, set: { owner.remote = $0 }))
                    .accessibilityIdentifier("remote-allow")
                Text(t("live.remoteHint")).font(.caption).foregroundStyle(.secondary)
            }
            .confirmationDialog(asking.map { t($0.takeOver!.title) } ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), titleVisibility: .visible, presenting: asking) { r in
                Button(t(r.takeOver!.confirm)) { owner.setOutput(r.id, on: true, take: true) }
            } message: { r in Text(t(r.takeOver!.text, r.takeOver!.args)) }
        }
    }
}

extension View {
    /// Anslut tillfällig skärm's sheet, while `model.pairingScreen`, for this device's live session.
    func pairingSheet(_ model: Model) -> some View {
        sheet(isPresented: Bindable(model).pairingScreen) {
            if let owner = model.app.liveLink { PairScreenSheet(sessionId: owner.sessionId) { owner.setOutput($0, on: true) } }
        }
    }
}
