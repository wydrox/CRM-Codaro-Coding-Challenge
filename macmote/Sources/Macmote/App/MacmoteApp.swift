import SwiftUI

@main
struct MacmoteApp: App {
    @State private var appState = AppState.shared

    var body: some Scene {
        WindowGroup("Macmote") {
            ContentView()
                .environment(appState)
        }
        .windowStyle(.hiddenTitleBar)

        MenuBarExtra("Macmote", systemImage: "desktopcomputer") {
            MenuBarView()
                .environment(appState)
        }
    }
}
