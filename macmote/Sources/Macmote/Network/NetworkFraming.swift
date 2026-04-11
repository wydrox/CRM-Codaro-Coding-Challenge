import Foundation
import Network

/// Reads a length-prefixed message from an NWConnection.
/// Wire format: [4 bytes UInt32 big-endian length][N bytes data]
func readLengthPrefixedMessage(from connection: NWConnection) async throws -> Data {
    let lengthData = try await receiveExact(4, from: connection)
    let length = lengthData.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
    guard length > 0, length < 64 * 1024 * 1024 else {
        throw FramingError.invalidLength(length)
    }
    return try await receiveExact(Int(length), from: connection)
}

func sendLengthPrefixedMessage(_ data: Data, on connection: NWConnection) async throws {
    var length = UInt32(data.count).bigEndian
    var combined = Data(bytes: &length, count: 4)
    combined.append(data)
    return try await withCheckedThrowingContinuation { continuation in
        connection.send(content: combined, completion: .contentProcessed { error in
            if let error { continuation.resume(throwing: error) }
            else { continuation.resume() }
        })
    }
}

private func receiveExact(_ count: Int, from connection: NWConnection) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
        connection.receive(minimumIncompleteLength: count, maximumLength: count) { data, _, isComplete, error in
            if let error {
                continuation.resume(throwing: error)
            } else if let data, data.count == count {
                continuation.resume(returning: data)
            } else if isComplete {
                continuation.resume(throwing: FramingError.connectionClosed)
            } else {
                continuation.resume(throwing: FramingError.incompleteRead(expected: count, got: data?.count ?? 0))
            }
        }
    }
}

enum FramingError: Error, LocalizedError {
    case invalidLength(UInt32)
    case connectionClosed
    case incompleteRead(expected: Int, got: Int)

    var errorDescription: String? {
        switch self {
        case .invalidLength(let l): return "Invalid message length: \(l)"
        case .connectionClosed: return "Connection closed unexpectedly"
        case .incompleteRead(let e, let g): return "Incomplete read: expected \(e) bytes, got \(g)"
        }
    }
}
