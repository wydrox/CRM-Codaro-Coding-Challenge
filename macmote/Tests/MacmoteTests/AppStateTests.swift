import Foundation
import Testing
@testable import Macmote

@Test func appStateDefaultProperties() {
    let state = AppState.shared
    #expect(state.latencyMs == 0)
    #expect(state.connectedClientCount == 0)
    #expect(state.isScreenShareActive == false)
    #expect(state.remoteHostName == nil)
}
