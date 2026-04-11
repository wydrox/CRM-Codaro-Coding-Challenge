import Foundation

// MARK: - Transport Layer
// Wire format: [4 bytes UInt32 big-endian length][N bytes JSON MessageEnvelope]

public struct MessageEnvelope: Codable {
    public enum MessageType: String, Codable {
        case handshakeHello  = "handshake_hello"
        case handshakeAck    = "handshake_ack"
        case tileUpdate      = "tile_update"
        case displayInfo     = "display_info"
        case inputEvent      = "input_event"
        case clipboardUpdate = "clipboard_update"
        case pingPong        = "ping_pong"
        case disconnect      = "disconnect"
    }
    public let type: MessageType
    public let payload: Data   // JSON-encoded inner struct (base64 in JSON)
    public let sequence: UInt64
    public let timestamp: Double  // CFAbsoluteTimeGetCurrent()
}

// MARK: - Handshake

public struct HandshakeHello: Codable {
    public let protocolVersion: Int      // must be MacmoteConstants.protocolVersion
    public let hostName: String
    public let displays: [DisplayDescriptor]
    public let authToken: String?        // nil = no auth in v1
}

public struct HandshakeAck: Codable {
    public let protocolVersion: Int
    public let clientName: String
    public let accepted: Bool
    public let rejectionReason: String?  // nil if accepted
}

// MARK: - Display

public struct DisplayDescriptor: Codable, Identifiable, Hashable {
    public let id: String            // CGDirectDisplayID as String
    public let width: Int
    public let height: Int
    public let scaleFactor: Double   // Retina = 2.0
    public let isPrimary: Bool
    public let localizedName: String

    public init(id: String, width: Int, height: Int, scaleFactor: Double, isPrimary: Bool, localizedName: String) {
        self.id = id
        self.width = width
        self.height = height
        self.scaleFactor = scaleFactor
        self.isPrimary = isPrimary
        self.localizedName = localizedName
    }
}

// MARK: - Tile Updates

public struct TileUpdate: Codable {
    public let displayID: String
    public let frameSequence: UInt64
    public let tiles: [EncodedTile]
    public let displayWidth: Int
    public let displayHeight: Int

    public init(displayID: String, frameSequence: UInt64, tiles: [EncodedTile], displayWidth: Int, displayHeight: Int) {
        self.displayID = displayID
        self.frameSequence = frameSequence
        self.tiles = tiles
        self.displayWidth = displayWidth
        self.displayHeight = displayHeight
    }
}

public struct EncodedTile: Codable {
    public let col: Int
    public let row: Int
    public let tileSize: Int    // always MacmoteConstants.tileSize for v1
    public let jpegData: Data
    public let checksum: UInt32 // CRC32 of raw pixels before compression

    public init(col: Int, row: Int, tileSize: Int, jpegData: Data, checksum: UInt32) {
        self.col = col
        self.row = row
        self.tileSize = tileSize
        self.jpegData = jpegData
        self.checksum = checksum
    }
}

// MARK: - Input Events

public struct InputEvent: Codable {
    public enum EventKind: String, Codable {
        case mouseMove
        case mouseDown
        case mouseUp
        case mouseDragged
        case mouseScrollWheel
        case keyDown
        case keyUp
        case flagsChanged
    }
    public let kind: EventKind
    public let displayID: String
    public let normalizedX: Double   // 0.0–1.0 of display width
    public let normalizedY: Double   // 0.0–1.0 of display height
    public let mouseButton: Int?     // 0=left, 1=right, 2=middle
    public let scrollDeltaX: Double?
    public let scrollDeltaY: Double?
    public let keyCode: UInt16?
    public let modifierFlags: UInt64?
    public let isRepeat: Bool

    public init(kind: EventKind, displayID: String, normalizedX: Double, normalizedY: Double,
                mouseButton: Int? = nil, scrollDeltaX: Double? = nil, scrollDeltaY: Double? = nil,
                keyCode: UInt16? = nil, modifierFlags: UInt64? = nil, isRepeat: Bool = false) {
        self.kind = kind
        self.displayID = displayID
        self.normalizedX = normalizedX
        self.normalizedY = normalizedY
        self.mouseButton = mouseButton
        self.scrollDeltaX = scrollDeltaX
        self.scrollDeltaY = scrollDeltaY
        self.keyCode = keyCode
        self.modifierFlags = modifierFlags
        self.isRepeat = isRepeat
    }
}

// MARK: - Clipboard

public struct ClipboardUpdate: Codable {
    public enum ClipboardContent: Codable {
        case text(String)
        case imageJpeg(Data)
        case unsupported
    }
    public enum Origin: String, Codable {
        case host
        case client
    }
    public let content: ClipboardContent
    public let changeCount: Int
    public let origin: Origin   // prevents clipboard echo loops between host and client

    public init(content: ClipboardContent, changeCount: Int, origin: Origin) {
        self.content = content
        self.changeCount = changeCount
        self.origin = origin
    }
}

// MARK: - Ping/Pong

public struct PingPong: Codable {
    public let isReply: Bool
    public let sentAt: Double

    public init(isReply: Bool, sentAt: Double = CFAbsoluteTimeGetCurrent()) {
        self.isReply = isReply
        self.sentAt = sentAt
    }
}

// MARK: - Disconnect

public struct DisconnectNotice: Codable {
    public let reason: String
    public init(reason: String) { self.reason = reason }
}

// MARK: - Message Coder

// JSONEncoder/JSONDecoder are not thread-safe when shared across concurrent callers;
// create fresh instances per call to avoid data races on the network send path.
public enum MessageCoder {
    public static func encode<T: Codable>(_ value: T, type messageType: MessageEnvelope.MessageType,
                                           sequence: UInt64) throws -> Data {
        let encoder = JSONEncoder()
        let payload = try encoder.encode(value)
        let envelope = MessageEnvelope(
            type: messageType,
            payload: payload,
            sequence: sequence,
            timestamp: CFAbsoluteTimeGetCurrent()
        )
        return try encoder.encode(envelope)
    }

    public static func decode(_ data: Data) throws -> MessageEnvelope {
        try JSONDecoder().decode(MessageEnvelope.self, from: data)
    }

    public static func decodePayload<T: Codable>(_ payloadType: T.Type,
                                                   from envelope: MessageEnvelope) throws -> T {
        try JSONDecoder().decode(payloadType, from: envelope.payload)
    }
}

// MARK: - Constants

public enum MacmoteConstants {
    public static let port: UInt16 = 7900
    public static let bonjourServiceType = "_macmote._tcp"
    public static let bonjourDomain = "local."
    public static let protocolVersion = 1
    public static let tileSize = 64
    public static let targetFPS = 60
    public static let maxTilesPerPacket = 16
}
