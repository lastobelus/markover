import AppKit
import CoreServices
import Foundation

private struct Binding: Codable {
  let version: Int
  let scheme: String
  let identity: String
  let displayName: String
  let instanceName: String
  let checkoutPath: String?
  let endpointPath: String
  let credentialPath: String
  let diagnosticsPath: String
}

private struct Endpoint: Decodable {
  let version: Int
  let port: Int
  let instanceId: String
}

private struct Credential: Decodable {
  let version: Int
  let instanceId: String
  let token: String
}

private struct Health: Decodable {
  let status: String
  let version: Int
  let instanceId: String
}

private struct Activation: Decodable {
  let reviewId: String
  let outcome: String
}

private struct Diagnostic: Codable {
  let timestamp: String
  let scheme: String
  let identity: String
  let category: String
}

private struct HandlerFailure: Error {
  let category: String
  let title: String
  let detail: String
}

private func decodeFile<T: Decodable>(
  _ type: T.Type,
  at path: String,
  instanceName: String
) throws -> T {
  let data: Data
  do {
    data = try Data(contentsOf: URL(fileURLWithPath: path))
  } catch {
    throw HandlerFailure(
      category: "service-missing",
      title: "\(instanceName) isn’t running",
      detail: "Start the matching development instance, then open this link again."
    )
  }
  do {
    return try JSONDecoder().decode(type, from: data)
  } catch {
    throw HandlerFailure(
      category: "service-incompatible",
      title: "Markover needs to be rebuilt",
      detail: "The matching instance has incompatible service metadata. Rebuild or restart it, then try again."
    )
  }
}

private func loadBinding() throws -> Binding {
  guard let url = Bundle.main.url(forResource: "binding", withExtension: "json") else {
    throw HandlerFailure(
      category: "handler-damaged",
      title: "Markover link handler needs repair",
      detail: "Its instance binding is missing. Repair or reinstall this link handler."
    )
  }
  let binding: Binding
  do {
    binding = try JSONDecoder().decode(Binding.self, from: Data(contentsOf: url))
  } catch {
    throw HandlerFailure(
      category: "handler-damaged",
      title: "Markover link handler needs repair",
      detail: "Its instance binding is invalid. Repair or reinstall this link handler."
    )
  }
  let expectedIdentity = binding.scheme == "markover"
    ? "canonical"
    : binding.scheme.replacingOccurrences(of: "markover-", with: "pr-")
  guard
    binding.version == 1,
    binding.identity == expectedIdentity,
    binding.scheme.range(
      of: #"^markover(?:-[1-9][0-9]*)?$"#,
      options: .regularExpression
    ) != nil
  else {
    throw HandlerFailure(
      category: "handler-damaged",
      title: "Markover link handler needs repair",
      detail: "Its instance binding is invalid. Repair or reinstall this link handler."
    )
  }
  return binding
}

private func reviewId(from value: String, scheme: String) throws -> String {
  let escaped = NSRegularExpression.escapedPattern(for: scheme)
  let pattern = "^\(escaped)://review/(mko_[a-zA-Z0-9]{6,32})$"
  let expression = try NSRegularExpression(pattern: pattern)
  let range = NSRange(value.startIndex..<value.endIndex, in: value)
  guard
    let match = expression.firstMatch(in: value, range: range),
    match.range == range,
    let idRange = Range(match.range(at: 1), in: value)
  else {
    throw HandlerFailure(
      category: "invalid-link",
      title: "Invalid Markover link",
      detail: "This link does not address one review in the expected Markover instance."
    )
  }
  return String(value[idRange])
}

private func request(
  _ url: URL,
  method: String,
  instanceName: String,
  token: String? = nil,
  timeoutInterval: TimeInterval = 5
) async throws -> (Data, HTTPURLResponse) {
  var request = URLRequest(url: url)
  request.httpMethod = method
  request.timeoutInterval = timeoutInterval
  request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
  if let token {
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
  }
  let configuration = URLSessionConfiguration.ephemeral
  configuration.timeoutIntervalForRequest = timeoutInterval
  configuration.timeoutIntervalForResource = timeoutInterval + 2
  let session = URLSession(configuration: configuration)
  do {
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else {
      throw HandlerFailure(
        category: "service-incompatible",
        title: "Markover needs to be rebuilt",
        detail: "The matching instance returned an incompatible response. Rebuild or restart it, then try again."
      )
    }
    return (data, http)
  } catch let failure as HandlerFailure {
    throw failure
  } catch {
    throw HandlerFailure(
      category: "service-unavailable",
      title: "\(instanceName) isn’t running",
      detail: "Start the matching development instance, then open this link again."
    )
  }
}

private func forward(_ value: String, binding: Binding) async throws {
  let id = try reviewId(from: value, scheme: binding.scheme)
  let endpoint: Endpoint = try decodeFile(
    Endpoint.self,
    at: binding.endpointPath,
    instanceName: binding.instanceName
  )
  let credential: Credential = try decodeFile(
    Credential.self,
    at: binding.credentialPath,
    instanceName: binding.instanceName
  )
  guard
    endpoint.version == 2,
    (1...65535).contains(endpoint.port),
    UUID(uuidString: endpoint.instanceId) != nil,
    credential.version == 1,
    credential.instanceId == endpoint.instanceId,
    credential.token.range(
      of: #"^[A-Za-z0-9_-]{43}$"#,
      options: .regularExpression
    ) != nil
  else {
    throw HandlerFailure(
      category: "service-incompatible",
      title: "Markover needs to be rebuilt",
      detail: "The matching instance has incompatible service metadata. Rebuild or restart it, then try again."
    )
  }

  let base = "http://127.0.0.1:\(endpoint.port)"
  guard
    let healthUrl = URL(string: "\(base)/health"),
    let activationUrl = URL(string: "\(base)/reviews/\(id)/activate")
  else {
    throw HandlerFailure(
      category: "service-incompatible",
      title: "Markover needs to be rebuilt",
      detail: "The matching instance has invalid service metadata."
    )
  }

  let (healthData, healthResponse) = try await request(
    healthUrl,
    method: "GET",
    instanceName: binding.instanceName
  )
  guard
    healthResponse.statusCode == 200,
    let health = try? JSONDecoder().decode(Health.self, from: healthData),
    health.status == "ok",
    health.version == 2,
    health.instanceId == endpoint.instanceId
  else {
    throw HandlerFailure(
      category: "service-incompatible",
      title: "Markover needs to be rebuilt",
      detail: "The matching instance did not confirm its identity. Rebuild or restart it, then try again."
    )
  }

  let (data, response) = try await request(
    activationUrl,
    method: "POST",
    instanceName: binding.instanceName,
    token: credential.token,
    timeoutInterval: 12
  )
  if response.statusCode == 401 {
    throw HandlerFailure(
      category: "service-unauthorized",
      title: "Markover link handler needs repair",
      detail: "The matching instance rejected this handler. Restart Markover or repair the handler, then try again."
    )
  }
  if response.statusCode == 404 {
    throw HandlerFailure(
      category: "service-incompatible",
      title: "Markover needs to be rebuilt",
      detail: "The matching instance does not support review links. Rebuild or restart it, then try again."
    )
  }
  guard
    response.statusCode == 200,
    let activation = try? JSONDecoder().decode(Activation.self, from: data),
    activation.reviewId == id,
    ["activated", "already-active", "blocked", "deferred", "missing"].contains(
      activation.outcome
    )
  else {
    throw HandlerFailure(
      category: "activation-failed",
      title: "Markover couldn’t open this review",
      detail: "The matching instance reported an internal activation error. Rebuild or restart it, then try again."
    )
  }
}

private func record(_ failure: HandlerFailure, binding: Binding) {
  let url = URL(fileURLWithPath: binding.diagnosticsPath)
  var diagnostics: [Diagnostic] = []
  if
    let data = try? Data(contentsOf: url),
    let existing = try? JSONDecoder().decode([Diagnostic].self, from: data)
  {
    diagnostics = existing
  }
  diagnostics.append(Diagnostic(
    timestamp: ISO8601DateFormatter().string(from: Date()),
    scheme: binding.scheme,
    identity: binding.identity,
    category: failure.category
  ))
  diagnostics = Array(diagnostics.suffix(50))
  do {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let data = try JSONEncoder().encode(diagnostics)
    try data.write(to: url, options: .atomic)
  } catch {
    // Diagnostics must never replace the user-facing result.
  }
}

private func show(_ failure: HandlerFailure, binding: Binding?) {
  if let binding { record(failure, binding: binding) }
  NSApp.activate(ignoringOtherApps: true)
  let alert = NSAlert()
  alert.alertStyle = .informational
  alert.messageText = failure.title
  alert.informativeText = failure.detail
  alert.addButton(withTitle: "OK")
  alert.runModal()
}

private func claim(binding: Binding) -> Never {
  guard let bundleId = Bundle.main.bundleIdentifier else { exit(2) }
  let status = LSSetDefaultHandlerForURLScheme(
    binding.scheme as NSString,
    bundleId as NSString
  )
  exit(status == noErr ? 0 : 1)
}

private final class HandlerDelegate: NSObject, NSApplicationDelegate {
  private var binding: Binding?
  private var inputReceived = false
  private var pendingValues: [String?] = []
  private var processing = false

  func applicationWillFinishLaunching(_ notification: Notification) {
    NSAppleEventManager.shared().setEventHandler(
      self,
      andSelector: #selector(handleUrlEvent(_:withReplyEvent:)),
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    if CommandLine.arguments.count > 1 {
      handle(CommandLine.arguments[1])
    } else {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
        guard self?.inputReceived == false else { return }
        self?.fail(HandlerFailure(
          category: "invalid-link",
          title: "Invalid Markover link",
          detail: "No review link was supplied."
        ))
      }
    }
  }

  @objc private func handleUrlEvent(
    _ event: NSAppleEventDescriptor,
    withReplyEvent reply: NSAppleEventDescriptor
  ) {
    handle(event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue)
  }

  private func handle(_ value: String?) {
    inputReceived = true
    pendingValues.append(value)
    processNext()
  }

  private func processNext() {
    guard !processing, !pendingValues.isEmpty else { return }
    processing = true
    let value = pendingValues.removeFirst()
    do {
      let loaded = try binding ?? loadBinding()
      binding = loaded
      guard let value else {
        throw HandlerFailure(
          category: "invalid-link",
          title: "Invalid Markover link",
          detail: "No review link was supplied."
        )
      }
      Task { @MainActor in
        do {
          try await forward(value, binding: loaded)
        } catch let failure as HandlerFailure {
          show(failure, binding: loaded)
        } catch {
          show(HandlerFailure(
            category: "activation-failed",
            title: "Markover couldn’t open this review",
            detail: "The handler encountered an internal error. Repair it, then try again."
          ), binding: loaded)
        }
        self.finishCurrent()
      }
    } catch let failure as HandlerFailure {
      show(failure, binding: binding)
      finishCurrent()
    } catch {
      show(HandlerFailure(
        category: "handler-damaged",
        title: "Markover link handler needs repair",
        detail: "Its instance binding could not be loaded."
      ), binding: binding)
      finishCurrent()
    }
  }

  private func finishCurrent() {
    processing = false
    if pendingValues.isEmpty {
      NSApp.terminate(nil)
    } else {
      processNext()
    }
  }

  private func fail(_ failure: HandlerFailure) {
    show(failure, binding: binding)
    NSApp.terminate(nil)
  }
}

if CommandLine.arguments.dropFirst().first == "--claim" {
  do {
    claim(binding: try loadBinding())
  } catch {
    exit(2)
  }
}

private let application = NSApplication.shared
private let delegate = HandlerDelegate()
application.delegate = delegate
application.run()
