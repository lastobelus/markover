import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct DemoInspectionError: Error, CustomStringConvertible {
  let description: String
}

guard CommandLine.arguments.count == 3 else {
  throw DemoInspectionError(description: "usage: inspect-demo.swift <movie.mp4> <frames-directory>")
}

let movieURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(
  at: outputDirectory,
  withIntermediateDirectories: true
)
let asset = AVURLAsset(url: movieURL)
let videoTracks = try await asset.loadTracks(withMediaType: .video)
let audioTracks = try await asset.loadTracks(withMediaType: .audio)
guard let track = videoTracks.first else {
  throw DemoInspectionError(description: "movie has no video track")
}
let naturalSize = try await track.load(.naturalSize)
let preferredTransform = try await track.load(.preferredTransform)
let transformedSize = naturalSize.applying(preferredTransform)
let durationSeconds = try await asset.load(.duration).seconds
let nominalFrameRate = try await track.load(.nominalFrameRate)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero

let checkpoints = [0.5, 6.5, 14.5, 23.5, 31.5, 39.5, 43.0]
for seconds in checkpoints where seconds < durationSeconds {
  let image = try generator.copyCGImage(
    at: CMTime(seconds: seconds, preferredTimescale: 600),
    actualTime: nil
  )
  let name = String(format: "checkpoint-%05.1f.png", seconds).replacingOccurrences(of: ".", with: "-")
  let url = outputDirectory.appendingPathComponent(name)
  guard let destination = CGImageDestinationCreateWithURL(
    url as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else { throw DemoInspectionError(description: "could not create \(name)") }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw DemoInspectionError(description: "could not write \(name)")
  }
}

let receipt: [String: Any] = [
  "audioTracks": audioTracks.count,
  "durationSeconds": durationSeconds,
  "framesPerSecond": nominalFrameRate,
  "height": abs(Int(transformedSize.height.rounded())),
  "videoTracks": videoTracks.count,
  "width": abs(Int(transformedSize.width.rounded()))
]
let encoded = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
FileHandle.standardOutput.write(encoded)
FileHandle.standardOutput.write(Data("\n".utf8))
