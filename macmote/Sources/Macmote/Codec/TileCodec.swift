import Foundation
import CoreVideo
import CoreGraphics
import AppKit
import zlib

/// Converts captured frames into tile-based TileUpdate messages.
/// Only tiles that changed since the last frame are included.
final class TileCodec {
    private let displayID: String
    private let tileSize: Int
    private var previousChecksums: [UInt32]
    private var frameSequence: UInt64 = 0
    private var cols: Int = 0
    private var rows: Int = 0

    /// JPEG compression quality (0.0–1.0)
    var jpegQuality: CGFloat = 0.75

    init(displayID: String, tileSize: Int = MacmoteConstants.tileSize) {
        self.displayID = displayID
        self.tileSize = tileSize
        self.previousChecksums = []
    }

    /// Process a pixel buffer and return a TileUpdate with only changed tiles.
    /// Returns nil if nothing changed (identical frame).
    func encode(pixelBuffer: CVPixelBuffer) -> TileUpdate? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        let newCols = Int(ceil(Double(width) / Double(tileSize)))
        let newRows = Int(ceil(Double(height) / Double(tileSize)))
        let tileCount = newCols * newRows

        // Reset checksums if display size changed
        if cols != newCols || rows != newRows {
            cols = newCols
            rows = newRows
            previousChecksums = [UInt32](repeating: 0, count: tileCount)
        }

        frameSequence += 1
        var changedTiles: [EncodedTile] = []

        // Process tiles concurrently
        let lock = NSLock()
        DispatchQueue.concurrentPerform(iterations: tileCount) { idx in
            let col = idx % newCols
            let row = idx / newCols
            let tileX = col * self.tileSize
            let tileY = row * self.tileSize
            let tileW = min(self.tileSize, width - tileX)
            let tileH = min(self.tileSize, height - tileY)

            // Compute CRC32 of raw pixel bytes for this tile
            let checksum = self.crc32ForTile(
                baseAddress: baseAddress,
                bytesPerRow: bytesPerRow,
                tileX: tileX, tileY: tileY,
                tileW: tileW, tileH: tileH
            )

            if checksum == self.previousChecksums[idx] { return }  // no change

            // Encode changed tile to JPEG
            guard let jpegData = self.encodeTileToJpeg(
                baseAddress: baseAddress,
                bytesPerRow: bytesPerRow,
                tileX: tileX, tileY: tileY,
                tileW: tileW, tileH: tileH
            ) else { return }

            let encoded = EncodedTile(col: col, row: row, tileSize: self.tileSize,
                                      jpegData: jpegData, checksum: checksum)
            lock.lock()
            changedTiles.append(encoded)
            self.previousChecksums[idx] = checksum
            lock.unlock()
        }

        guard !changedTiles.isEmpty else { return nil }
        return TileUpdate(displayID: displayID, frameSequence: frameSequence,
                          tiles: changedTiles, displayWidth: width, displayHeight: height)
    }

    /// Resets the codec state (forces full frame on next encode).
    func reset() {
        for i in previousChecksums.indices { previousChecksums[i] = 0 }
        frameSequence = 0
    }

    // MARK: - Private helpers

    private func crc32ForTile(baseAddress: UnsafeMutableRawPointer, bytesPerRow: Int,
                               tileX: Int, tileY: Int, tileW: Int, tileH: Int) -> UInt32 {
        var crc: uLong = zlib.crc32(0, nil, 0)
        for row in 0..<tileH {
            let rowPtr = baseAddress.advanced(by: (tileY + row) * bytesPerRow + tileX * 4)
            crc = zlib.crc32(crc, rowPtr.assumingMemoryBound(to: Bytef.self), uInt(tileW * 4))
        }
        return UInt32(crc)
    }

    private func encodeTileToJpeg(baseAddress: UnsafeMutableRawPointer, bytesPerRow: Int,
                                   tileX: Int, tileY: Int,
                                   tileW: Int, tileH: Int) -> Data? {
        // Create CGImage for this tile region
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: tileW, height: tileH,
            bitsPerComponent: 8,
            bytesPerRow: tileW * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return nil }

        // Copy tile pixels into context
        guard let ctxData = context.data else { return nil }
        for row in 0..<tileH {
            let src = baseAddress.advanced(by: (tileY + row) * bytesPerRow + tileX * 4)
            let dst = ctxData.advanced(by: row * tileW * 4)
            memcpy(dst, src, tileW * 4)
        }

        guard let cgImage = context.makeImage() else { return nil }
        let nsImage = NSBitmapImageRep(cgImage: cgImage)
        return nsImage.representation(using: .jpeg, properties: [.compressionFactor: jpegQuality])
    }
}
