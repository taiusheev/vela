import ExpoModulesCore
import Foundation

public final class VelaOpusDecoderModule: Module {
  private let decoderQueue = DispatchQueue(label: "family.vela.opus", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("VelaOpusDecoder")
    AsyncFunction("decode") { (sourceUri: String, destinationUri: String) -> String in
      guard let source = URL(string: sourceUri), let destination = URL(string: destinationUri),
        source.isFileURL, destination.isFileURL,
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
        throw DecoderError()
      }
      let allowed = cache.appendingPathComponent("vela-audio", isDirectory: true)
        .standardizedFileURL.resolvingSymlinksInPath().path + "/"
      let sourcePath = source.standardizedFileURL.resolvingSymlinksInPath().path
      let destinationPath = destination.standardizedFileURL.resolvingSymlinksInPath().path
      guard sourcePath.hasPrefix(allowed), destinationPath.hasPrefix(allowed),
        sourcePath != destinationPath else { throw DecoderError() }
      let result = sourcePath.withCString { sourcePointer in
        destinationPath.withCString { destinationPointer in
          vela_decode_opus(sourcePointer, destinationPointer)
        }
      }
      guard result == 0 else { throw DecoderError() }
      return destination.absoluteString
    }.runOnQueue(decoderQueue)
  }
}

private struct DecoderError: Error {}
