import Foundation
import Network
import Observation

/// Information about a connected client.
struct ConnectedClient: Identifiable {
    let id: ObjectIdentifier
    let name: String
    let address: String
    let connectedAt: Date
    var latencyMs: Double = 0
}

/// TCP server that listens for macmote client connections.
/// Advertises via Bonjour so clients can discover it automatically.
@Observable
final class HostNetworkServer {
    private var listener: NWListener?
    private var sessions: [ObjectIdentifier: ClientSession] = [:]

    private(set) var connectedClients: [ConnectedClient] = []
    private(set) var isRunning: Bool = false

    /// Handler called when a message arrives from a client. (sessionID, envelope)
    var onMessageReceived: ((ObjectIdentifier, MessageEnvelope) -> Void)?

    /// Starts the server on port 7900 and advertises via Bonjour.
    func start(hostName: String) throws {
        let params = NWParameters.tcp
        params.includePeerToPeer = true
        listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: MacmoteConstants.port)!)
        listener?.service = NWListener.Service(name: hostName, type: MacmoteConstants.bonjourServiceType)
        listener?.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                self?.isRunning = (state == .ready)
            }
        }
        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleNewConnection(connection)
        }
        listener?.start(queue: .global(qos: .userInitiated))
    }

    func stop() {
        listener?.cancel()
        listener = nil
        sessions.values.forEach { $0.disconnect() }
        sessions.removeAll()
        connectedClients.removeAll()
        isRunning = false
    }

    func broadcast(_ data: Data) {
        sessions.values.forEach { $0.send(data) }
    }

    func send(_ data: Data, to clientID: ObjectIdentifier) {
        sessions[clientID]?.send(data)
    }

    func disconnect(clientID: ObjectIdentifier) {
        sessions[clientID]?.disconnect()
        sessions.removeValue(forKey: clientID)
        DispatchQueue.main.async {
            self.connectedClients.removeAll { $0.id == clientID }
        }
    }

    // MARK: - Private

    private func handleNewConnection(_ connection: NWConnection) {
        let session = ClientSession(connection: connection)
        let id = ObjectIdentifier(session)
        sessions[id] = session

        session.onMessage = { [weak self] envelope in
            self?.onMessageReceived?(id, envelope)
        }
        session.onDisconnect = { [weak self] in
            self?.sessions.removeValue(forKey: id)
            DispatchQueue.main.async {
                self?.connectedClients.removeAll { $0.id == id }
            }
        }
        session.onClientInfo = { [weak self] name, address in
            let client = ConnectedClient(id: id, name: name, address: address, connectedAt: Date())
            DispatchQueue.main.async {
                self?.connectedClients.append(client)
            }
        }
        session.start()
        connection.start(queue: .global(qos: .userInitiated))
    }
}

// MARK: - ClientSession

private final class ClientSession {
    private let connection: NWConnection
    var onMessage: ((MessageEnvelope) -> Void)?
    var onDisconnect: (() -> Void)?
    var onClientInfo: ((String, String) -> Void)?

    private let decoder = JSONDecoder()

    init(connection: NWConnection) {
        self.connection = connection
    }

    func start() {
        Task { await readLoop() }
    }

    func send(_ data: Data) {
        Task { try? await sendLengthPrefixedMessage(data, on: connection) }
    }

    func disconnect() {
        connection.cancel()
    }

    private func readLoop() async {
        let address: String
        if case .hostPort(let host, _) = connection.endpoint {
            address = "\(host)"
        } else {
            address = "unknown"
        }

        do {
            while true {
                let data = try await readLengthPrefixedMessage(from: connection)
                let envelope = try decoder.decode(MessageEnvelope.self, from: data)
                if envelope.type == .handshakeAck {
                    let ack = try decoder.decode(HandshakeAck.self, from: envelope.payload)
                    onClientInfo?(ack.clientName, address)
                }
                onMessage?(envelope)
            }
        } catch {
            onDisconnect?()
        }
    }
}
