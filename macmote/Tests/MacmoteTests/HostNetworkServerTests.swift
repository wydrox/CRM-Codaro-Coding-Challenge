import Testing
@testable import Macmote

@Test func hostNetworkServerCanBeCreated() {
    let server = HostNetworkServer()
    #expect(!server.isRunning)
    #expect(server.connectedClients.isEmpty)
}

@Test func framingErrorDescriptions() {
    let e1 = FramingError.invalidLength(99)
    #expect(e1.errorDescription?.contains("99") == true)
    let e2 = FramingError.connectionClosed
    #expect(e2.errorDescription != nil)
}
