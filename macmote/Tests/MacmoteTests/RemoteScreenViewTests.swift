import Testing
@testable import Macmote

@Test func comparableClamping() {
    #expect(0.1.clamped(to: 0.25...4.0) == 0.25)
    #expect(5.0.clamped(to: 0.25...4.0) == 4.0)
    #expect(1.5.clamped(to: 0.25...4.0) == 1.5)
}
