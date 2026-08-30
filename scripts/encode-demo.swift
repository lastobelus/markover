import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

struct DemoEncoderError: Error, CustomStringConvertible {
  let description: String
}

guard CommandLine.arguments.count == 3 else {
  throw DemoEncoderError(description: "usage: encode-demo.swift <frames-directory> <output.mp4>")
}

let framesDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let files = try FileManager.default.contentsOfDirectory(
  at: framesDirectory,
  includingPropertiesForKeys: nil
).filter { $0.pathExtension == "jpg" }.sorted { $0.lastPathComponent < $1.lastPathComponent }

guard !files.isEmpty else {
  throw DemoEncoderError(description: "no JPEG frames found")
}

func image(at url: URL) throws -> CGImage {
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { throw DemoEncoderError(description: "could not decode \(url.lastPathComponent)") }
  return image
}

let first = try image(at: files[0])
let width = 1920
let height = 1080
guard first.width == width && first.height == height else {
  throw DemoEncoderError(description: "frames must be 1920x1080")
}

try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 1_800_000,
    AVVideoExpectedSourceFrameRateKey: 30,
    AVVideoMaxKeyFrameIntervalKey: 60,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
  ]
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height
  ]
)
guard writer.canAdd(input) else {
  throw DemoEncoderError(description: "video input is unsupported")
}
writer.add(input)
guard writer.startWriting() else {
  throw writer.error ?? DemoEncoderError(description: "could not start writer")
}
writer.startSession(atSourceTime: .zero)

func pixelBuffer(for image: CGImage) throws -> CVPixelBuffer {
  var buffer: CVPixelBuffer?
  let status = CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
  guard status == kCVReturnSuccess, let buffer else {
    throw DemoEncoderError(description: "could not allocate video frame")
  }
  CVPixelBufferLockBaseAddress(buffer, [])
  defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
  guard let context = CGContext(
    data: CVPixelBufferGetBaseAddress(buffer),
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue |
      CGBitmapInfo.byteOrder32Little.rawValue
  ) else { throw DemoEncoderError(description: "could not create frame context") }
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return buffer
}

for (index, file) in files.enumerated() {
  while !input.isReadyForMoreMediaData {
    if writer.status == .failed {
      throw writer.error ?? DemoEncoderError(description: "video writer failed")
    }
    usleep(2_000)
  }
  let buffer = try pixelBuffer(for: image(at: file))
  let time = CMTime(value: CMTimeValue(index), timescale: 30)
  guard adaptor.append(buffer, withPresentationTime: time) else {
    throw writer.error ?? DemoEncoderError(description: "could not append frame")
  }
}

input.markAsFinished()
await writer.finishWriting()
guard writer.status == .completed else {
  throw writer.error ?? DemoEncoderError(description: "video did not finish")
}
