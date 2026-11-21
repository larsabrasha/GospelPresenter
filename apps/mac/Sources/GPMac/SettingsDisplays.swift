// Utgångar (the web's Displays.tsx): the organisation's screens and public outputs, each change a mutation through the
// core; whether one is online, what it shows and how many watch are the core's (`displayStatusView`), from the server's
// live status; a display's link as a QR code to show, copy or save.
import CoreImage.CIFilterBuiltins
import ImageIO
import Shell
import SwiftUI
import UniformTypeIdentifiers

struct DisplayRow: Decodable, Identifiable, Hashable { let id: String, name: String, code: String, kind: String }

struct DisplaysPage: View {
    @Environment(Model.self) private var model
    @State private var adding: String?
    @State private var showing: DisplayRow?
    @State private var message: String?
    @State private var live = LiveStatus()

    private struct Status: Decodable { let status: String?, n: Int?, sending: String?, live: Bool }

    var body: some View {
        let displays = model.view("displaysView", ["locale": Texts.language], as: [DisplayRow].self) ?? []
        let status = model.view("displayStatusView", ["displays": displays.map { ["id": $0.id, "kind": $0.kind] }, "sessions": live.sessions,
                                                      "online": live.online, "connected": live.connected], as: [String: Status].self) ?? [:]
        List {
            IntroCard(id: "displays")
            Section(t("screens.title")) {
                ForEach(displays.filter { $0.kind == "screen" }) { d in row(d, status[d.id]) }
                Button(t("screens.addTitle"), systemImage: "plus") { adding = "screen" }
            }
            Section(t("displays.public")) {
                ForEach(displays.filter { $0.kind == "public" }) { d in row(d, status[d.id]) }
                Button(t("displays.create"), systemImage: "plus") { adding = "public" }
            }
        }
        .onAppear { live.start(model.session) }
        .onDisappear { live.stop() }
        .textPrompt(Binding(get: {
            adding.map { kind in
                TextPrompt(title: t(kind == "screen" ? "screens.addTitle" : "displays.create"), label: t("displays.name"), text: "", rule: FieldRule(required: true, max: 200)) { name in
                    let id = UUID().uuidString.lowercased()
                    message = change(model, "createDisplay", ["id": id, "name": name.trimmingCharacters(in: .whitespaces), "code": model.displayCode(), "kind": kind])
                    if message == nil { showing = (model.view("displaysView", ["locale": Texts.language], as: [DisplayRow].self) ?? []).first { $0.id == id } }
                }
            }
        }, set: { if $0 == nil { adding = nil } }))
        .sheet(item: $showing) { d in DisplayLinkSheet(display: d) }
        .refusal($message)
    }

    /// An output: its name, what is sent to it, and whether it is online or how many watch, a green dot while live.
    private func row(_ d: DisplayRow, _ s: Status?) -> some View {
        Button { showing = d } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(d.name)
                    if let sending = s?.sending { Text(t("displays.sending", ["name": sending])).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if s?.live == true { Circle().fill(.green).frame(width: 8, height: 8) }
                if let key = s?.status { Text(t(key, ["n": s?.n ?? 0])).font(.caption).foregroundStyle(key == "screens.online" ? .green : .secondary) }
            }
        }
        .buttonStyle(.plain)
    }
}

extension Model {
    /// A new output code, the core's (`displayCodeView`) from this device's cryptographic random bytes.
    func displayCode() -> String {
        var bytes = [UInt8](repeating: 0, count: 64)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return view("displayCodeView", ["random": bytes.map(Int.init)], as: String.self) ?? ""
    }
}

/// A display's link: its QR code and address to copy, Ny kod (the old link stops working) and Radera.
struct DisplayLinkSheet: View {
    @Environment(Model.self) private var model
    @Environment(\.dismiss) private var dismiss
    let display: DisplayRow
    @State private var renewing = false
    @State private var removing = false
    @State private var message: String?
    @State private var savingQR: FileURLDocument?

    private var current: DisplayRow { (model.view("displaysView", ["locale": Texts.language], as: [DisplayRow].self) ?? []).first { $0.id == display.id } ?? display }
    private var url: String {
        let server = model.session?.server ?? ""
        let name = current.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return current.kind == "screen" ? "\(server)/display/\(current.code)?name=\(name)" : "\(server)/watch/\(current.code)"
    }

    var body: some View {
        Form {
            Section {
                if let qr = qrImage(url) { qr.interpolation(.none).resizable().scaledToFit().frame(width: 200, height: 200).frame(maxWidth: .infinity) }
                Text(url).font(.callout.monospaced()).textSelection(.enabled)
                Button(t("displays.copy"), systemImage: "doc.on.doc") { copyText(url); message = t("displays.copied") }
                // A public output's code to print or show (the web's Ladda ner), as a picture.
                if current.kind == "public", let png = qrPNG(url) {
                    Button(t("displays.download"), systemImage: "square.and.arrow.down") {
                        let file = FileManager.default.temporaryDirectory.appending(path: "\(current.name).png")
                        if (try? png.write(to: file)) != nil { savingQR = FileURLDocument(url: file, name: "\(current.name).png") }
                    }
                }
            }
            Section {
                Button(t("displays.newCode")) { renewing = true }
                Button(t("displays.delete"), role: .destructive) { removing = true }
            }
        }
        .formStyle(.grouped)
        .sheetBar(current.name, confirm: t("common.close")) { true }
        .fileExporter(isPresented: Binding(get: { savingQR != nil }, set: { if !$0 { savingQR = nil } }), document: savingQR, contentType: .png, defaultFilename: savingQR?.name) { _ in }
        .confirmationDialog(t("displays.newCode"), isPresented: $renewing) {
            Button(t("displays.newCode")) { message = change(model, "newDisplayCode", ["id": display.id, "code": model.displayCode()]) ?? t("displays.newCodeDone") }
        } message: { Text(t("displays.newCodeConfirm")) }
        .confirmationDialog(t("displays.delete"), isPresented: $removing) {
            Button(t("displays.delete"), role: .destructive) { if let e = change(model, "deleteDisplay", ["id": display.id]) { message = e } else { dismiss() } }
        } message: { Text(t("displays.deleteConfirm", ["name": current.name])) }
        .refusal($message)
        .sheetSize(420, 460)
    }
}

/// A QR code of `text`, scaled `scale` times by Core Image.
private func qrCode(_ text: String, scale: CGFloat) -> CGImage? {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(text.utf8)
    guard let out = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
    return CIContext().createCGImage(out, from: out.extent)
}

/// A QR code of `text` to show.
func qrImage(_ text: String) -> Image? { qrCode(text, scale: 8).map { Image(decorative: $0, scale: 1) } }

/// A QR code of `text` as a PNG, 16 pixels a module.
func qrPNG(_ text: String) -> Data? {
    guard let cg = qrCode(text, scale: 16) else { return nil }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, cg, nil)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
}

/// `text` on the clipboard.
func copyText(_ text: String) {
    #if os(macOS)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
    #else
    UIPasteboard.general.string = text
    #endif
}
