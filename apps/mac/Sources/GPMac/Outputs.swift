// Utgångar while presenting (spec 04 §1; the web's OutputsPanel.tsx and useOutputs.ts): the saved screens and the
// public outputs, each switched on or off for this session, a screen with no page open offline and not switchable
// (LIVE-A21), one another presentation sends to named and taken over only after a question (LIVE-R23), a public output
// with how many watch; and "Tillåt fjärrstyrning" (LIVE-R39). What each row says and the question are the core's
// (`outputRowsView`); the session is this device's (Shell's LiveOwner). Only while signed in to a host: the demo has none.
import Shell
import SwiftUI

private struct OutputRows: Decodable {
    struct Ask: Decodable { let title: String, text: String, args: [String: String], confirm: String }
    struct Row: Decodable, Identifiable { let id: String, name: String, kind: String, chosen: Bool, sending: Bool, offline: Bool, elsewhere: String?, viewers: Int?, takeOver: Ask? }
    let rows: [Row]
}

struct OutputsGroup: View {
    @Environment(Model.self) private var model
    @State private var asking: OutputRows.Row?

    var body: some View {
        if let owner = model.app.liveOwner {
            let displays = model.view("displaysView", ["locale": Texts.language], as: [JSONValue].self)?.map(\.any) ?? []
            let args: [String: Any] = ["displays": displays, "sessions": owner.link.sessions, "online": owner.link.online, "chosen": owner.chosen, "sessionId": owner.sessionId]
            let rows = model.view("outputRowsView", args, as: OutputRows.self)?.rows ?? []
            VStack(alignment: .leading, spacing: 8) {
                Text(t("live.outputs")).font(.subheadline.weight(.semibold)).foregroundStyle(Color.quiet)
                ForEach(rows) { r in
                    Toggle(isOn: Binding(get: { r.sending }, set: { on in
                        if on, r.takeOver != nil { asking = r } else { owner.setOutput(r.id, on: on) }
                    })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Label(r.name, systemImage: r.kind == "public" ? "qrcode" : "tv")
                            if let line = line(r) { Text(line).font(.caption).foregroundStyle(r.offline && r.chosen ? .orange : .secondary) }
                        }
                    }
                    .disabled(r.offline)
                    .accessibilityIdentifier("output-\(r.id)")
                }
                Toggle(t("remote.allow"), isOn: Binding(get: { owner.remote }, set: { owner.remote = $0 }))
                    .accessibilityIdentifier("remote-allow")
                Text(t("live.remoteHint")).font(.caption).foregroundStyle(.secondary)
            }
            .confirmationDialog(asking.map { t($0.takeOver!.title) } ?? "", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), titleVisibility: .visible, presenting: asking) { r in
                Button(t(r.takeOver!.confirm)) { owner.setOutput(r.id, on: true, take: true) }
            } message: { r in Text(t(r.takeOver!.text, r.takeOver!.args)) }
        }
    }

    /// Under a row: offline, another presentation's, or how many watch.
    private func line(_ r: OutputRows.Row) -> String? {
        if r.offline { return t("screens.offline") }
        if let other = r.elsewhere { return t("displays.sending", ["name": other]) }
        if r.kind == "public", r.sending, let n = r.viewers { return "\(n) 👁" }
        return nil
    }
}
