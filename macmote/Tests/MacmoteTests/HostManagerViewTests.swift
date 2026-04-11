import Testing
import Foundation
@testable import Macmote

@Test func appStateHostMode() {
    let state = AppState.shared
    state.mode = .host
    if case .host = state.mode { } else { Issue.record("Expected host mode") }
    state.mode = .none
}

@Test func connectedClientHasRequiredFields() {
    let client = ConnectedClient(
        id: ObjectIdentifier(NSObject()),
        name: "Test Client",
        address: "192.168.1.5",
        connectedAt: Date(),
        latencyMs: 15
    )
    #expect(client.name == "Test Client")
    #expect(client.latencyMs == 15)
}
