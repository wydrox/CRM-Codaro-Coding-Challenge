import Foundation
import AppKit

/// Captures local mouse and keyboard events and emits them as InputEvents
/// for forwarding to the remote host Mac.
///
/// Coordinate normalization: mouse positions are normalized relative to the
/// MTKView/display frame so they map correctly to the host's display space.
@MainActor
final class ClientInputCapturer {
    private var monitors: [Any] = []
    private var continuation: AsyncStream<InputEvent>.Continuation?
    private(set) var events: AsyncStream<InputEvent> = AsyncStream { _ in }

    /// The target display being shown (used for coordinate normalization).
    var targetDisplay: DisplayDescriptor?

    /// The frame of the view in which the remote screen is shown.
    /// Mouse positions are normalized relative to this frame.
    var viewFrame: CGRect = .zero

    /// Whether capturing is active.
    private(set) var isCapturing: Bool = false

    private var displayID: String { targetDisplay?.id ?? "primary" }

    /// Starts capturing mouse and keyboard events.
    func startCapturing() {
        guard !isCapturing else { return }
        let (stream, cont) = AsyncStream<InputEvent>.makeStream()
        self.events = stream
        self.continuation = cont
        isCapturing = true
        installMonitors()
    }

    /// Stops capturing events.
    func stopCapturing() {
        guard isCapturing else { return }
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors.removeAll()
        continuation?.finish()
        continuation = nil
        isCapturing = false
    }

    // MARK: - Private

    private func installMonitors() {
        let mouseMask: NSEvent.EventTypeMask = [
            .mouseMoved, .leftMouseDown, .leftMouseUp, .leftMouseDragged,
            .rightMouseDown, .rightMouseUp, .rightMouseDragged,
            .otherMouseDown, .otherMouseUp, .otherMouseDragged,
            .scrollWheel
        ]
        let keyMask: NSEvent.EventTypeMask = [.keyDown, .keyUp, .flagsChanged]

        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: mouseMask, handler: { [weak self] event in
            self?.handleMouseEvent(event)
        }) { monitors.append(monitor) }

        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: keyMask, handler: { [weak self] event in
            self?.handleKeyEvent(event)
        }) { monitors.append(monitor) }
    }

    private func handleMouseEvent(_ nsEvent: NSEvent) {
        let (normX, normY) = normalizeMousePosition(NSEvent.mouseLocation)
        guard normX >= 0, normX <= 1, normY >= 0, normY <= 1 else { return }

        switch nsEvent.type {
        case .mouseMoved:
            emit(InputEvent(kind: .mouseMove, displayID: displayID, normalizedX: normX, normalizedY: normY))
        case .leftMouseDown:
            emit(InputEvent(kind: .mouseDown, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 0))
        case .leftMouseUp:
            emit(InputEvent(kind: .mouseUp, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 0))
        case .leftMouseDragged:
            emit(InputEvent(kind: .mouseDragged, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 0))
        case .rightMouseDown:
            emit(InputEvent(kind: .mouseDown, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 1))
        case .rightMouseUp:
            emit(InputEvent(kind: .mouseUp, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 1))
        case .rightMouseDragged:
            emit(InputEvent(kind: .mouseDragged, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 1))
        case .otherMouseDown:
            emit(InputEvent(kind: .mouseDown, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 2))
        case .otherMouseUp:
            emit(InputEvent(kind: .mouseUp, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 2))
        case .otherMouseDragged:
            emit(InputEvent(kind: .mouseDragged, displayID: displayID, normalizedX: normX, normalizedY: normY, mouseButton: 2))
        case .scrollWheel:
            emit(InputEvent(kind: .mouseScrollWheel, displayID: displayID, normalizedX: normX, normalizedY: normY,
                            scrollDeltaX: Double(nsEvent.scrollingDeltaX),
                            scrollDeltaY: Double(nsEvent.scrollingDeltaY)))
        default:
            break
        }
    }

    private func handleKeyEvent(_ nsEvent: NSEvent) {
        switch nsEvent.type {
        case .keyDown:
            emit(InputEvent(kind: .keyDown, displayID: displayID, normalizedX: 0, normalizedY: 0,
                            keyCode: nsEvent.keyCode,
                            modifierFlags: UInt64(nsEvent.modifierFlags.rawValue),
                            isRepeat: nsEvent.isARepeat))
        case .keyUp:
            emit(InputEvent(kind: .keyUp, displayID: displayID, normalizedX: 0, normalizedY: 0,
                            keyCode: nsEvent.keyCode,
                            modifierFlags: UInt64(nsEvent.modifierFlags.rawValue)))
        case .flagsChanged:
            emit(InputEvent(kind: .flagsChanged, displayID: displayID, normalizedX: 0, normalizedY: 0,
                            modifierFlags: UInt64(nsEvent.modifierFlags.rawValue)))
        default:
            break
        }
    }

    /// Normalizes NSEvent mouse location (bottom-left origin) to 0–1 relative to viewFrame.
    /// viewFrame uses top-left origin (flipped), so Y must be inverted via screen height.
    private func normalizeMousePosition(_ location: NSPoint) -> (Double, Double) {
        guard viewFrame.width > 0, viewFrame.height > 0 else { return (-1, -1) }
        let screenHeight = NSScreen.main?.frame.height ?? 0
        let flippedY = screenHeight - location.y
        let normX = (location.x - viewFrame.minX) / viewFrame.width
        let normY = (flippedY - viewFrame.minY) / viewFrame.height
        return (normX, normY)
    }

    private func emit(_ event: InputEvent) {
        continuation?.yield(event)
    }
}
