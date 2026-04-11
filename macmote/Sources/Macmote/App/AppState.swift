import Foundation
import Observation

enum AppMode {
    case none
    case host
    case client
}

@Observable
final class AppState {
    static let shared = AppState()
    var mode: AppMode = .none
    var isScreenShareActive: Bool = false
    var latencyMs: Double = 0
    var connectedClientCount: Int = 0
    var remoteHostName: String?
    private init() {}
}
