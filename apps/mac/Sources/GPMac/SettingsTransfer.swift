// Organisation's Exportera and Importera (the web's OrgExport.tsx with media/orgExport.ts, LegacyImport.tsx with
// media/legacyImport.ts): an export only from a device in step with the server (synced, nothing waiting), its zip's
// entries the core's (`exportPlanView`), the files fetched from the server and the zip written here; an import's
// manifest and rows checked by the core (`importManifestView`, `importPlanView`), the users sent first, then the files
// (a video in parts), then the rows in one go, so a failed one can be run again.
import Shell
import SwiftUI
import UniformTypeIdentifiers

struct OrgExportSection: View {
    @Environment(Model.self) private var model
    @State private var line: String?
    @State private var saving: FileURLDocument?

    private struct Plan: Decodable {
        struct Entry: Decodable { let name: String, text: String }
        struct File: Decodable { let name: String, path: String, row: String }
        let problem: String?, entries: [Entry]?, files: [File]?, name: String?
    }

    var body: some View {
        Section {
            if let line { Text(line).font(.callout).foregroundStyle(.secondary) }
            Button(t("orgExport.start")) { Task { await run() } }.disabled(model.session == nil)
        } header: { Text(t("orgExport.title")) } footer: { Text(t("orgExport.text")) }
        .fileExporter(isPresented: Binding(get: { saving != nil }, set: { if !$0 { saving = nil } }), document: saving, contentType: .zip, defaultFilename: saving?.name) { result in
            if case .success = result { line = t("orgExport.done") }
        }
    }

    private func failed(_ reason: String) { line = t("orgExport.failed", ["error": t("orgExport.error.\(reason)")]) }

    private func run() async {
        guard case let .synced(client) = model.store, let session = model.session, let server = try? Server(session.server) else { return failed("not-synced") }
        // In step with the server first, as the web's export: what this device has may not be what the server has.
        client.requestSync()
        for _ in 0..<40 where client.busy || client.pendingCount > 0 { try? await Task.sleep(for: .milliseconds(250)) }
        guard client.pendingCount == 0, client.stopped == nil else { return failed("not-synced") }
        guard let rows = model.view("exportRowsView", as: String.self),
              let users = await model.api("GET", "/api/users", as: [JSONValue].self).value else { return failed("download") }
        guard let plan = model.view("exportPlanView", ["orgName": session.me.orgName, "today": localToday(), "now": Int(nowMs()), "rows": rows, "users": users.map(\.any)], as: Plan.self) else { return failed("rows") }
        if plan.problem != nil { return failed("rows") }
        let dir = FileManager.default.temporaryDirectory.appending(path: "gp-export-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let files = plan.files ?? []
        var fetched: [(String, URL)] = []
        for (n, f) in files.enumerated() {
            line = t("orgExport.files", ["done": n, "total": files.count])
            let target = dir.appending(path: "\(n)")
            guard (try? await server.download(f.path, as: session, to: target)) == true else { return failed("download") }
            fetched.append((f.name, target))
        }
        let zip = dir.appending(path: plan.name ?? "export.zip")
        do {
            let w = try ZipWriter(zip)
            let entries = plan.entries ?? []
            for (n, e) in entries.enumerated() { line = t("orgExport.zip", ["done": n, "total": entries.count + fetched.count]); try w.add(e.name, Data(e.text.utf8)) }
            for (n, f) in fetched.enumerated() { line = t("orgExport.zip", ["done": entries.count + n, "total": entries.count + fetched.count]); try w.add(f.0, file: f.1) }
            try w.finish()
        } catch ZipError.tooLarge { return failed("too-large") } catch { return failed("download") }
        line = nil
        saving = FileURLDocument(url: zip, name: plan.name ?? "export.zip")
    }
}

struct LegacyImportSection: View {
    @Environment(Model.self) private var model
    @State private var picking = false
    @State private var chosen: (url: URL, zip: ZipReader, manifest: Manifest, rows: [Row])?
    @State private var line: String?
    @State private var busy = false

    struct Manifest: Decodable { let format: Int, orgName: String, counts: [String: Int] }
    struct Row: Decodable { let table: String, name: String }
    private struct Read: Decodable { let manifest: Manifest, rows: [Row] }
    private struct Plan: Decodable { let rows: String, users: JSONValue, videos: [String] }
    private struct Users: Decodable { let created: Int, member: Int, invited: Int, limit: Int }

    var body: some View {
        Section {
            if let line { Text(line).font(.callout).foregroundStyle(.secondary) }
            if let c = chosen {
                Text(t("legacy.summary", ["name": c.manifest.orgName, "songs": c.manifest.counts["songs"] ?? 0, "presentations": c.manifest.counts["presentations"] ?? 0,
                                          "users": c.manifest.counts["users"] ?? 0, "files": c.manifest.counts["blobs"] ?? 0]))
                HStack {
                    Button(t("common.cancel")) { close() }
                    Button(t("legacy.start")) { Task { await run(c) } }.disabled(busy)
                }
            } else {
                Button(t("legacy.pick")) { picking = true }.disabled(model.session == nil || busy)
            }
        } header: { Text(t("legacy.title")) } footer: { Text(t("legacy.text")) }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.zip]) { result in
            guard case let .success(url) = result else { return }
            open(url)
        }
    }

    private func failed(_ reason: String, _ detail: String = "") {
        busy = false
        line = t("legacy.failed", ["error": t("legacy.error.\(reason)") + (detail.isEmpty ? "" : " (\(detail))")])
    }

    /// The chosen zip let go, and the sandbox's access to it with it.
    private func close() {
        chosen?.url.stopAccessingSecurityScopedResource()
        chosen = nil
    }

    /// The zip read and its manifest checked; kept open while the person decides.
    private func open(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        let refuse = { (reason: String) in
            if scoped { url.stopAccessingSecurityScopedResource() }
            failed(reason)
        }
        guard let zip = try? ZipReader(url) else { return refuse("not-zip") }
        guard let text = try? zip.read("manifest.json") else { return refuse("not-export") }
        switch model.app.call("importManifestView", ["text": String(decoding: text, as: UTF8.self)], as: Read.self) {
        case let .refused(code): refuse(code == "format" ? "format" : "not-export")
        case let .ok(r): line = nil; chosen = (url, zip, r.manifest, r.rows)
        }
    }

    private func run(_ c: (url: URL, zip: ZipReader, manifest: Manifest, rows: [Row])) async {
        busy = true
        var rows: [String: Any] = [:]
        for r in c.rows {
            guard let d = try? c.zip.read(r.name), let v = try? JSONSerialization.jsonObject(with: d) else { return failed("not-export") }
            rows[r.table] = v
        }
        guard let users = try? c.zip.read("users.json") else { return failed("not-export") }
        let plan: Plan
        switch model.app.call("importPlanView", ["format": c.manifest.format, "rows": rows, "users": String(decoding: users, as: UTF8.self)], as: Plan.self) {
        case let .refused(code): return failed(code == "invalid-rows" ? "refused" : "not-export", code)
        case let .ok(p): plan = p
        }
        line = t("legacy.users")
        let added: Users
        switch await model.api("POST", "/api/import/users", plan.users.any, as: Users.self) {
        case let .refused(e): return failed("refused", e)
        case let .ok(u): added = u
        }
        guard let session = model.session, let server = try? Server(session.server) else { return failed("upload") }
        let files = c.zip.entries.keys.filter { $0.hasPrefix("blobs/") || $0.hasPrefix("bibles/") }.sorted()
        for (n, name) in files.enumerated() {
            line = t("legacy.files", ["done": n, "total": files.count])
            if name.hasPrefix("blobs/") {
                let hash = String(name.dropFirst("blobs/".count))
                if plan.videos.contains(hash) {
                    let tmp = FileManager.default.temporaryDirectory.appending(path: hash)
                    defer { try? FileManager.default.removeItem(at: tmp) }
                    guard (try? c.zip.extract(name, to: tmp)) != nil else { return failed("upload", name) }
                    let size = (try? tmp.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                    guard case let .synced(client) = model.store else { return failed("upload", name) }
                    if case .failure = await client.uploadVideo(tmp, hash: hash, size: size, partBytes: 8 << 20) { return failed("upload", name) }
                } else {
                    guard let d = try? c.zip.read(name), let a = try? await server.put("/api/media/\(hash)", data: d, as: session), (200..<300).contains(a.status) else { return failed("upload", name) }
                }
            } else {
                let hash = String(name.dropFirst("bibles/".count).dropLast(".json".count))
                guard let d = try? c.zip.read(name), let a = try? await server.put("/api/bibles/\(hash)", data: d, contentType: "application/json", as: session), (200..<300).contains(a.status) else { return failed("upload", name) }
            }
        }
        line = t("legacy.rows")
        guard let a = try? await server.request("POST", "/api/import/legacy", json: plan.rows, as: session) else { return failed("refused") }
        guard (200..<300).contains(a.status) else { return failed("refused", a.error ?? "") }
        busy = false
        close()
        model.app.syncNow()
        line = [t("legacy.done", ["name": c.manifest.orgName]), t("legacy.usersDone", ["created": added.created, "member": added.member, "invited": added.invited]),
                added.limit > 0 ? t("legacy.usersLimit", ["n": added.limit]) : ""].filter { !$0.isEmpty }.joined(separator: "\n")
    }
}
