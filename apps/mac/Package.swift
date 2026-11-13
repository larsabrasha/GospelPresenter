// swift-tools-version:5.10
import Foundation
import PackageDescription

let rustLib = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../target/release").standardized.path

let package = Package(
    name: "GPMac",
    platforms: [.macOS(.v14)],
    targets: [
        .systemLibrary(name: "GPCoreFFI", path: "Sources/GPCoreFFI"),
        .target(name: "Shell", dependencies: ["GPCoreFFI"], linkerSettings: [.unsafeFlags(["-L", rustLib]), .linkedLibrary("sqlite3")]),
        .executableTarget(name: "GPMac", dependencies: ["Shell"]),
        .executableTarget(name: "parity", dependencies: ["Shell"]),
    ]
)
