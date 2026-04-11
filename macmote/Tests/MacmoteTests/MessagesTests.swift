import Foundation
import Testing
@testable import Macmote

@Test func messageEnvelopeRoundTrip() throws {
    let hello = HandshakeHello(protocolVersion: 1, hostName: "Test Mac",
                               displays: [], authToken: nil)
    let data = try MessageCoder.encode(hello, type: .handshakeHello, sequence: 1)
    let envelope = try MessageCoder.decode(data)
    #expect(envelope.type == .handshakeHello)
    #expect(envelope.sequence == 1)
    let decoded = try MessageCoder.decodePayload(HandshakeHello.self, from: envelope)
    #expect(decoded.hostName == "Test Mac")
    #expect(decoded.protocolVersion == 1)
}

@Test func tileUpdateCodable() throws {
    let tile = EncodedTile(col: 0, row: 0, tileSize: 64, jpegData: Data([0xFF, 0xD8]), checksum: 12345)
    let update = TileUpdate(displayID: "1", frameSequence: 42, tiles: [tile], displayWidth: 1920, displayHeight: 1080)
    let data = try MessageCoder.encode(update, type: .tileUpdate, sequence: 2)
    let env = try MessageCoder.decode(data)
    let decoded = try MessageCoder.decodePayload(TileUpdate.self, from: env)
    #expect(decoded.tiles.count == 1)
    #expect(decoded.tiles[0].checksum == 12345)
}

@Test func inputEventCodable() throws {
    let event = InputEvent(kind: .mouseDown, displayID: "1", normalizedX: 0.5, normalizedY: 0.5, mouseButton: 0)
    let data = try MessageCoder.encode(event, type: .inputEvent, sequence: 3)
    let env = try MessageCoder.decode(data)
    let decoded = try MessageCoder.decodePayload(InputEvent.self, from: env)
    #expect(decoded.kind == .mouseDown)
    #expect(decoded.normalizedX == 0.5)
}

@Test func clipboardUpdateTextCodable() throws {
    let clip = ClipboardUpdate(content: .text("Hello, World!"), changeCount: 5, origin: "host")
    let data = try MessageCoder.encode(clip, type: .clipboardUpdate, sequence: 4)
    let env = try MessageCoder.decode(data)
    let decoded = try MessageCoder.decodePayload(ClipboardUpdate.self, from: env)
    if case .text(let str) = decoded.content {
        #expect(str == "Hello, World!")
    }
    #expect(decoded.origin == "host")
}
