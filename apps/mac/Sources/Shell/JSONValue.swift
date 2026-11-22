// Any JSON, kept as the core gave it (moved from GPMac/Views.swift, 2026-11-22, so the generated view types in this
// module can hold it).
import Foundation

/// Any JSON, kept as the core gave it: a slide, a theme and an overlay go on to the web's `SlideView` unchanged.
public enum JSONValue: Codable, Hashable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(b): try c.encode(b)
        case let .number(n): try c.encode(n)
        case let .string(s): try c.encode(s)
        case let .array(a): try c.encode(a)
        case let .object(o): try c.encode(o)
        }
    }

    public subscript(_ key: String) -> JSONValue? { if case let .object(o) = self { o[key] } else { nil } }
    public var string: String? { if case let .string(s) = self { s } else { nil } }
    public var number: Double? { if case let .number(n) = self { n } else { nil } }

    /// As JSONSerialization takes it: the value handed back to the core in a view's arguments.
    public var any: Any {
        switch self {
        case .null: NSNull()
        case let .bool(b): b
        case let .number(n): n
        case let .string(s): s
        case let .array(a): a.map(\.any)
        case let .object(o): o.mapValues(\.any)
        }
    }

    /// Its JSON text, keys sorted, so the same value is the same text (a cache key).
    public var text: String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return (try? e.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "null"
    }

    /// A value as JSONSerialization gives it (NSNumber's booleans kept as booleans).
    public init(any: Any) {
        switch any {
        // A number first, as one: an Int in an `Any` also casts to Bool on Apple's platforms (1 as? Bool is true).
        case let n as NSNumber: self = CFGetTypeID(n) == CFBooleanGetTypeID() ? .bool(n.boolValue) : .number(n.doubleValue)
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(a.map(JSONValue.init(any:)))
        case let o as [String: Any]: self = .object(o.mapValues(JSONValue.init(any:)))
        default: self = .null
        }
    }

    /// A Codable value as JSON (a generated type handed back to the core); none when it does not encode.
    public init?(encoding value: some Encodable) {
        guard let data = try? JSONEncoder().encode(value), let v = try? JSONDecoder().decode(JSONValue.self, from: data) else { return nil }
        self = v
    }

    /// As JSONSerialization gives it, a whole number an Int (a pointer's partIndex, a count), as the app's code reads it.
    public var plain: Any {
        switch self {
        case let .number(n): n == n.rounded() && abs(n) < 1e15 ? Int(n) : n
        case let .array(a): a.map(\.plain)
        case let .object(o): o.mapValues(\.plain)
        default: any
        }
    }
}
