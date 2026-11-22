// "Anslut tillfällig skärm" (the web's PairScreenDialog, LIVE-R28): the QR code a TV scans, the display page's address,
// and the four digits a TV shows typed instead. The token's making, renewing and letting go, the asking every two
// seconds, the claim and what a wrong code does are the core's (`pairScreenStepView`); the QR code's modules too
// (`qrView`). This draws them, does the requests as the signed-in device and the timers, and switches a screen paired
// on through `paired`.
import SwiftUI

struct PairScreenSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let sessionId: String
    /// A screen the server took in: switched on for the session.
    let paired: (String) -> Void
    @State private var step: PairStep?
    @State private var timers: [String: Task<Void, Never>] = [:]
    @State private var code = ""

    var body: some View {
        NavigationStack {
            Form {
                if let screen = step?.state.paired {
                    Section {
                        VStack(spacing: 10) {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 56)).foregroundStyle(.green)
                            Text(t("pairScreen.done")).font(.headline).accessibilityIdentifier("pair-done")
                            Text(t("pairScreen.doneText")).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            Text(t("screens.temporary", ["n": screen.n])).font(.footnote)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                } else {
                    Section {
                        VStack(spacing: 10) {
                            QRView(value: step?.link).frame(width: 190, height: 190)
                            Text(t("pairScreen.scanHint")).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                    Section {
                        LabeledContent(t("pairScreen.step1")) { Text(step?.address ?? "").textSelection(.enabled).font(.callout.monospaced()) }
                        TextField(t("pairScreen.code"), text: $code)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .onChange(of: code) { _, v in
                                let digits = String(v.filter(\.isNumber).prefix(4))
                                if digits != v { code = digits }
                                if digits.count == 4 { send(.submit(pin: digits)) }
                            }
                            .accessibilityIdentifier("pair-code")
                    } header: { Text(t("pairScreen.step2")) } footer: {
                        if (step?.state.wrong ?? 0) > 0 { Text(t("pairScreen.wrong")).foregroundStyle(.red) }
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(t("pairScreen.title"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(t("common.close")) { dismiss() } } }
        }
        .macWidth(420)
        .onAppear {
            step = model.view("pairScreenStepView", ["init": ["sessionId": sessionId, "base": model.session?.server ?? ""]], as: PairStep.self)
            send(.open)
        }
        .onDisappear { send(.close) }
        // A wrong code empties the boxes (LIVE-A19).
        .onChange(of: step?.state.wrong) { _, _ in code = "" }
    }

    /// An event to the core, and what it answers done.
    private func send(_ event: PairEvent) {
        guard let state = step?.state, let s = JSONValue(encoding: state)?.plain, let e = JSONValue(encoding: event)?.plain,
              let next = model.view("pairScreenStepView", ["state": s, "event": e], as: PairStep.self) else { return }
        step = next
        for effect in next.effects {
            switch effect {
            case let .request(body, method, path, request, token):
                Task {
                    let answer = await model.api(method, path, body?.plain, as: JSONValue.self)
                    let said: JSONValue = answer.value ?? .object(["error": .string(answer.error ?? "offline")])
                    send(.answer(body: said, request: request, token: token))
                }
            case let .timer(ms, name):
                timers[name]?.cancel()
                timers[name] = Task { try? await Task.sleep(for: .milliseconds(ms)); if !Task.isCancelled { send(.timer(name: name)) } }
            case .cancelTimers:
                timers.values.forEach { $0.cancel() }
                timers = [:]
            case let .output(id): paired(id)
            case .unknown: break
            }
        }
    }
}

/// A QR code of `value`, its modules the core's (`qrView`), drawn dark on white; blank until there is a value.
struct QRView: View {
    @Environment(Model.self) private var model
    let value: String?

    var body: some View {
        let code = value.flatMap { model.view("qrView", ["value": $0], as: QrCode.self) }
        Canvas { g, size in
            g.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.white))
            guard let code else { return }
            let unit = min(size.width, size.height) / CGFloat(code.size)
            for (y, row) in code.rows.enumerated() {
                for (x, c) in row.enumerated() where c == "1" {
                    g.fill(Path(CGRect(x: CGFloat(x) * unit, y: CGFloat(y) * unit, width: unit, height: unit)), with: .color(.black))
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel(t("pairScreen.qr"))
        .accessibilityIdentifier("pair-qr")
    }
}
