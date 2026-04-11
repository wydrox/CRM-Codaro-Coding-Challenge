import Testing
@testable import Macmote

@Test @MainActor func inputCapturerInit() {
    let capturer = ClientInputCapturer()
    #expect(!capturer.isCapturing)
}

@Test @MainActor func inputCapturerStartStop() {
    let capturer = ClientInputCapturer()
    capturer.startCapturing()
    #expect(capturer.isCapturing)
    capturer.stopCapturing()
    #expect(!capturer.isCapturing)
}

@Test @MainActor func normalizationWithZeroFrameReturnsInvalid() {
    let capturer = ClientInputCapturer()
    capturer.viewFrame = .zero
    capturer.startCapturing()
    capturer.stopCapturing()
    #expect(!capturer.isCapturing)
}

@Test @MainActor func startCapturingIsIdempotent() {
    let capturer = ClientInputCapturer()
    capturer.startCapturing()
    capturer.startCapturing()
    #expect(capturer.isCapturing)
    capturer.stopCapturing()
    #expect(!capturer.isCapturing)
}

@Test @MainActor func stopCapturingWhenNotStartedIsNoop() {
    let capturer = ClientInputCapturer()
    capturer.stopCapturing()
    #expect(!capturer.isCapturing)
}

@Test @MainActor func targetDisplayDefaultsToNil() {
    let capturer = ClientInputCapturer()
    #expect(capturer.targetDisplay == nil)
}

@Test @MainActor func viewFrameDefaultsToZero() {
    let capturer = ClientInputCapturer()
    #expect(capturer.viewFrame == .zero)
}
