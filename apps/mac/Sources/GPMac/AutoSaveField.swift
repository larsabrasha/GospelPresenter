// A field saved as it is typed (the web's AutoSaveField): when it writes, what it does not write, what it shows while
// the stored value changes, and the clash with another device's change are the core's (`autoSaveStepView`); this
// draws a text field or a text editor, tells the core of its focus, each key and the stored value, and does what it
// answers: the change run, the half second's timer, "Kunde inte spara" through `failed`.
import SwiftUI

struct AutoSaveField: View {
    @Environment(Model.self) private var model
    /// The change that writes it and its fixed arguments (the row's id), the argument the value goes in.
    let command: String, args: [String: Any], field: String
    var kind: AutoSaveKind = .text
    var max: Int = 200
    /// Another device's change while typing asks first (a song part's text).
    var warnOnClash = false
    /// Several lines (a part's text), else one.
    var multiline = false
    let label: String
    /// The value as stored now (the page's read): followed while the user is not typing.
    let stored: String
    /// A refused write's text, said by the page.
    var failed: (String) -> Void = { _ in }

    @State private var step: AutoSaveStep?
    @State private var timer: Task<Void, Never>?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            input
            if let theirs = step?.clash {
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("autosave.clash")).font(.footnote.weight(.semibold))
                    Text(theirs).font(.footnote).foregroundStyle(.secondary).lineLimit(6)
                    HStack {
                        Button(t("autosave.keepMine")) { send(.keepMine) }.accessibilityIdentifier("autosave-keep")
                        Button(t("autosave.takeTheirs")) { send(.takeTheirs) }.accessibilityIdentifier("autosave-take")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(10).background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .onAppear(perform: open)
        .onChange(of: stored) { _, v in send(.stored(value: v)) }
        .onChange(of: focused) { _, on in send(on ? .focus : .blur) }
        // The page closing writes what waits, as leaving the field does.
        .onDisappear { if step?.state.pending != nil { send(.blur) } }
    }

    @ViewBuilder private var input: some View {
        let text = Binding(get: { step?.shown ?? stored }, set: { send(.input(value: $0)) })
        if multiline {
            TextEditor(text: text).frame(minHeight: 90).font(.body).focused($focused).accessibilityLabel(label)
        } else {
            // Its name beside it, as a grouped form's row, so a filled field still says what it is.
            LabeledContent(label) { TextField(label, text: text).labelsHidden().multilineTextAlignment(.trailing).focused($focused) }
                .onSubmit { send(.blur) }
        }
    }

    private func open() {
        let initial: [String: Any] = ["command": command, "args": args, "field": field, "kind": kind.rawValue, "max": max, "warnOnClash": warnOnClash, "stored": stored]
        step = model.view("autoSaveStepView", ["init": initial], as: AutoSaveStep.self)
    }

    /// An event to the core, and what it answers done.
    private func send(_ event: AutoSaveEvent) {
        guard let state = step?.state, let s = JSONValue(encoding: state)?.plain, let e = JSONValue(encoding: event)?.plain,
              let next = model.view("autoSaveStepView", ["state": s, "event": e], as: AutoSaveStep.self) else { return }
        step = next
        for effect in next.effects {
            switch effect {
            case let .run(args, command):
                let outcome = model.app.mutate(command, args.plain as? [String: Any] ?? [:])
                send(.done(ok: outcome == "ok"))
            case let .timer(ms):
                timer?.cancel()
                timer = Task { try? await Task.sleep(for: .milliseconds(ms)); if !Task.isCancelled { send(.timer) } }
            case .cancelTimer: timer?.cancel()
            case .failed: failed(t("common.saveFailed"))
            case .saved, .unknown: break
            }
        }
    }
}
