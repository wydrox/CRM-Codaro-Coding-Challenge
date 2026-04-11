import SwiftUI

struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        switch appState.mode {
        case .none:
            RolePickerView()
        case .host:
            HostManagerView()
        case .client:
            Text("Client mode active")
        }
    }
}

struct RolePickerView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "desktopcomputer.and.arrow.down")
                .font(.system(size: 64))
                .foregroundStyle(Color.accentColor)
            Text("Macmote")
                .font(.largeTitle.bold())
            Text("Mac-to-Mac remote control")
                .foregroundStyle(.secondary)
            HStack(spacing: 16) {
                Button("Host this Mac") {
                    appState.mode = .host
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button("Connect to Mac") {
                    appState.mode = .client
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
        }
        .padding(48)
        .frame(minWidth: 400, minHeight: 320)
    }
}

struct MenuBarView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if appState.mode == .host {
                Text("\(appState.connectedClientCount) client(s) connected")
                Divider()
                Button("Stop Hosting") { appState.mode = .none; appState.isScreenShareActive = false }
            } else {
                Button("Host this Mac") { appState.mode = .host }
                Button("Connect to Mac") { appState.mode = .client }
            }
            Divider()
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
    }
}
