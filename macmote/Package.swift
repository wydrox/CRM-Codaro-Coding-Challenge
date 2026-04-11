// swift-tools-version: 5.9
import PackageDescription

let frameworksPath = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"

let package = Package(
    name: "Macmote",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Macmote",
            path: "Sources/Macmote",
            resources: [.process("Rendering/Shaders.metal")]
        ),
        .testTarget(
            name: "MacmoteTests",
            dependencies: ["Macmote"],
            path: "Tests/MacmoteTests",
            swiftSettings: [
                .unsafeFlags([
                    "-F", frameworksPath,
                    "-Xfrontend", "-disable-cross-import-overlays"
                ])
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-F", frameworksPath,
                    "-framework", "Testing",
                    "-framework", "_Testing_Foundation",
                    "-Xlinker", "-rpath",
                    "-Xlinker", frameworksPath
                ])
            ]
        )
    ]
)
