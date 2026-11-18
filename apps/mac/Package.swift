// swift-tools-version:5.10
import Foundation
import PackageDescription

let rustLib = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../target/release").standardized.path

let package = Package(
    name: "GPMac",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .executable(name: "GPMac", targets: ["GPMac"]),
        .executable(name: "parity", targets: ["parity"]),
        // The iOS app (ios/GPiOS.xcodeproj) takes the shell from here and the core from build/GPCore.xcframework.
        .library(name: "Shell", targets: ["Shell"]),
    ],
    targets: [
        .systemLibrary(name: "GPCoreFFI", path: "Sources/GPCoreFFI"),
        // On the Mac the core is crates/gp-core/build.sh's static library in target/release; elsewhere the app links it.
        .target(name: "Shell", dependencies: ["GPCoreFFI"],
                linkerSettings: [.unsafeFlags(["-L", rustLib], .when(platforms: [.macOS])), .linkedLibrary("sqlite3")]),
        .executableTarget(name: "GPMac", dependencies: ["Shell"]),
        .executableTarget(name: "parity", dependencies: ["Shell"]),
    ]
)
