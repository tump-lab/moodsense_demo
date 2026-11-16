import CallKit
import Foundation

/**
 * Call length from CallKit, which only reports while this process is alive (CallSensing keeps it
 * alive). Finished calls are queued in UserDefaults, not pushed as events, because the app is
 * almost always in the background when a call ends.
 */
final class CallObserver: NSObject, CXCallObserverDelegate {
  // Standard defaults, not the App Group, so this works on builds without the Screen Time plugin.
  private static let storageKey = "moodsense.callSessions"
  private static let maxStoredSessions = 500

  /** Below this a "call" is almost always a misdial or an instant decline. */
  private static let minimumDurationMs: Double = 1000

  private let observer = CXCallObserver()

  private struct InFlight {
    let outgoing: Bool
    let observedAtMs: Double
    var connectedAtMs: Double?
    var partial = false
  }

  private var inFlight: [UUID: InFlight] = [:]

  override init() {
    super.init()
    observer.setDelegate(self, queue: nil)
    // A call already connected when observing starts (typically after a relaunch) is kept with a
    // lower-bound length rather than dropped.
    let nowMs = Date().timeIntervalSince1970 * 1000
    for call in observer.calls where call.hasConnected && !call.hasEnded {
      inFlight[call.uuid] = InFlight(
        outgoing: call.isOutgoing, observedAtMs: nowMs, connectedAtMs: nowMs, partial: true)
    }
  }

  func stop() {
    observer.setDelegate(nil, queue: nil)
    inFlight.removeAll()
  }

  func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
    let nowMs = Date().timeIntervalSince1970 * 1000

    if call.hasEnded {
      guard let state = inFlight.removeValue(forKey: call.uuid) else {
        // The call started before we were watching, so its length is unknown; drop it.
        return
      }
      record(state: state, endedAtMs: nowMs)
      return
    }

    if call.hasConnected {
      if inFlight[call.uuid]?.connectedAtMs == nil {
        inFlight[call.uuid, default: InFlight(outgoing: call.isOutgoing, observedAtMs: nowMs)]
          .connectedAtMs = nowMs
      }
      return
    }

    if inFlight[call.uuid] == nil {
      inFlight[call.uuid] = InFlight(outgoing: call.isOutgoing, observedAtMs: nowMs)
    }
  }

  private func record(state: InFlight, endedAtMs: Double) {
    // A call that never connected (missed, declined, unanswered) is dropped, not stored as zero length.
    guard let connectedAtMs = state.connectedAtMs else { return }

    let durationMs = endedAtMs - connectedAtMs
    guard durationMs >= Self.minimumDurationMs else { return }

    let session: [String: Any] = [
      "startTs": connectedAtMs,
      "endTs": endedAtMs,
      "durationMs": durationMs,
      "outgoing": state.outgoing,
      "partial": state.partial,
    ]

    var stored = UserDefaults.standard.array(forKey: Self.storageKey) as? [[String: Any]] ?? []
    stored.append(session)
    if stored.count > Self.maxStoredSessions {
      stored.removeFirst(stored.count - Self.maxStoredSessions)
    }
    UserDefaults.standard.set(stored, forKey: Self.storageKey)
  }

  static func drain() -> [[String: Any]] {
    let stored = UserDefaults.standard.array(forKey: storageKey) as? [[String: Any]] ?? []
    if !stored.isEmpty {
      UserDefaults.standard.removeObject(forKey: storageKey)
    }
    return stored
  }

  static func discard() {
    UserDefaults.standard.removeObject(forKey: storageKey)
  }
}
