// Zip files for an organisation's export and import (the web's media/zipBlob.ts and legacyImport.ts's reader): written
// stored, not compressed (the files are pictures, sounds and videos already), a file at a time, never whole in memory,
// no ZIP64 (past 4 GB or 65 535 entries refused); read from the central directory, stored and DEFLATE entries, an
// entry's bytes taken from the file only when asked for.
import Compression
import Foundation

enum ZipError: Error { case notZip, tooLarge, unreadable }

/// CRC-32 (IEEE), as a zip's headers carry it.
struct CRC32 {
    private static let table: [UInt32] = (0..<256).map { n in
        var c = UInt32(n)
        for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }
    private(set) var value: UInt32 = 0xFFFF_FFFF
    mutating func update(_ data: Data) { for b in data { value = Self.table[Int((value ^ UInt32(b)) & 0xFF)] ^ (value >> 8) } }
    var final: UInt32 { value ^ 0xFFFF_FFFF }
}

/// A zip written to `url`, entry by entry.
final class ZipWriter {
    private let out: FileHandle
    private var central = Data()
    private var count = 0
    private var offset: UInt64 = 0

    init(_ url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        out = try FileHandle(forWritingTo: url)
    }

    private func le16(_ v: Int) -> Data { withUnsafeBytes(of: UInt16(v).littleEndian) { Data($0) } }
    private func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }

    /// An entry of `data`.
    func add(_ name: String, _ data: Data) throws { try add(name, size: UInt64(data.count)) { body in try body(data) } }

    /// An entry of the file at `file`, read a slice at a time twice: for its checksum, then into the zip.
    func add(_ name: String, file: URL) throws {
        let size = UInt64((try file.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0)
        try add(name, size: size) { body in
            let h = try FileHandle(forReadingFrom: file)
            defer { try? h.close() }
            while let chunk = try h.read(upToCount: 8 << 20), !chunk.isEmpty { try body(chunk) }
        }
    }

    /// `read` gives the entry's bytes a slice at a time, twice; an entry whose bytes are not `size` either time (a file
    /// changed or cut short) throws, as the header already written names that size.
    private func add(_ name: String, size: UInt64, read: ((Data) throws -> Void) throws -> Void) throws {
        let n = Data(name.utf8)
        guard count < 0xFFFF, offset + 30 + UInt64(n.count) + size < 0xFFFF_FFFF else { throw ZipError.tooLarge }
        var crc = CRC32()
        var summed: UInt64 = 0
        try read { crc.update($0); summed += UInt64($0.count) }
        guard summed == size else { throw ZipError.unreadable }
        let sum = crc.final
        // Version 2.0, UTF-8 names, stored, a fixed time (1980-01-01, as the web's zipEntry writes).
        let fields: [Data] = [le16(0x0800), le16(0), le16(0), le16(0x21), le32(sum), le32(UInt32(size)), le32(UInt32(size)), le16(n.count)]
        var local = le32(0x0403_4b50)
        local.append(le16(20))
        for f in fields { local.append(f) }
        local.append(le16(0))
        local.append(n)
        var dir = le32(0x0201_4b50)
        dir.append(le16(20))
        dir.append(le16(20))
        for f in fields { dir.append(f) }
        for f in [le16(0), le16(0), le16(0), le16(0), le32(0), le32(UInt32(offset))] { dir.append(f) }
        dir.append(n)
        try out.write(contentsOf: local)
        var written: UInt64 = 0
        try read { try out.write(contentsOf: $0); written += UInt64($0.count) }
        guard written == size else { throw ZipError.unreadable }
        central += dir
        offset += UInt64(local.count) + size
        count += 1
    }

    /// The central directory and its end: the zip finished.
    func finish() throws {
        guard offset + UInt64(central.count) + 22 < 0xFFFF_FFFF else { throw ZipError.tooLarge }
        try out.write(contentsOf: central)
        var end = le32(0x0605_4b50)
        for f in [le16(0), le16(0), le16(count), le16(count), le32(UInt32(central.count)), le32(UInt32(offset)), le16(0)] { end.append(f) }
        try out.write(contentsOf: end)
        try out.close()
    }
}

/// A zip's entries, read from the file `url` when asked for.
struct ZipReader {
    struct Entry { let name: String, method: Int, compressed: Int, size: Int, local: Int }
    let url: URL
    let entries: [String: Entry]

    init(_ url: URL) throws {
        self.url = url
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        let total = Int(try h.seekToEnd())
        let tailStart = max(0, total - 22 - 65_535)
        try h.seek(toOffset: UInt64(tailStart))
        let tail = try h.readToEnd() ?? Data()
        let u16 = { (d: Data, o: Int) in Int(d[d.startIndex + o]) | Int(d[d.startIndex + o + 1]) << 8 }
        let u32 = { (d: Data, o: Int) in u16(d, o) | u16(d, o + 2) << 16 }
        guard let end = stride(from: tail.count - 22, through: 0, by: -1).first(where: { u32(tail, $0) == 0x0605_4b50 }) else { throw ZipError.notZip }
        let count = u16(tail, end + 10), dirSize = u32(tail, end + 12), dirStart = u32(tail, end + 16)
        try h.seek(toOffset: UInt64(dirStart))
        guard let dir = try h.read(upToCount: dirSize) else { throw ZipError.notZip }
        var out: [String: Entry] = [:]
        var p = 0
        for _ in 0..<count {
            guard p + 46 <= dir.count, u32(dir, p) == 0x0201_4b50 else { throw ZipError.notZip }
            let nameLength = u16(dir, p + 28)
            guard p + 46 + nameLength <= dir.count else { throw ZipError.notZip }
            let name = String(decoding: dir[(dir.startIndex + p + 46)..<(dir.startIndex + p + 46 + nameLength)], as: UTF8.self)
            out[name] = Entry(name: name, method: u16(dir, p + 10), compressed: u32(dir, p + 20), size: u32(dir, p + 24), local: u32(dir, p + 42))
            p += 46 + nameLength + u16(dir, p + 30) + u16(dir, p + 32)
        }
        entries = out
    }

    /// Where an entry's bytes start in the file.
    private func start(_ e: Entry, _ h: FileHandle) throws -> UInt64 {
        try h.seek(toOffset: UInt64(e.local))
        guard let head = try h.read(upToCount: 30), head.count == 30 else { throw ZipError.notZip }
        let u16 = { (o: Int) in Int(head[o]) | Int(head[o + 1]) << 8 }
        return UInt64(e.local + 30 + u16(26) + u16(28))
    }

    /// An entry's bytes, inflated where it is DEFLATE.
    func read(_ name: String) throws -> Data {
        guard let e = entries[name] else { throw ZipError.unreadable }
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        try h.seek(toOffset: try start(e, h))
        // All of it, or the zip is cut short: an entry shorter than its header says is no entry.
        // (An empty entry reads as none: read(upToCount: 0) may give nil.)
        guard let raw = e.compressed == 0 ? Data() : try h.read(upToCount: e.compressed), raw.count == e.compressed else { throw ZipError.unreadable }
        switch e.method {
        case 0: return raw
        case 8:
            // An empty entry has no buffer to decode into.
            if e.size == 0 { return Data() }
            guard !raw.isEmpty else { throw ZipError.unreadable }
            var out = Data(count: e.size)
            let n = out.withUnsafeMutableBytes { dst in raw.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, e.size, src.bindMemory(to: UInt8.self).baseAddress!, raw.count, nil, COMPRESSION_ZLIB)
            } }
            guard n == e.size else { throw ZipError.unreadable }
            return out
        default: throw ZipError.notZip
        }
    }

    /// An entry written to a file of its own (a video, never whole in memory where it is stored).
    func extract(_ name: String, to file: URL) throws {
        guard let e = entries[name] else { throw ZipError.unreadable }
        if e.method != 0 { return try read(name).write(to: file) }
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        try h.seek(toOffset: try start(e, h))
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let out = try FileHandle(forWritingTo: file)
        defer { try? out.close() }
        var left = e.compressed
        while left > 0, let chunk = try h.read(upToCount: min(left, 8 << 20)), !chunk.isEmpty {
            try out.write(contentsOf: chunk)
            left -= chunk.count
        }
        guard left == 0 else { throw ZipError.unreadable }
    }
}
