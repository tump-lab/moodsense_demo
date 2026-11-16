import Foundation
import UIKit

/**
 * Real device lock and unlock, from the only iOS signal that reports it: file data protection
 * becoming available or unavailable. The notifications are delivered to this process alone and only
 * while it is alive — CallSensing's keep-alive is what turns that into "around the clock" instead of
 * "while the app is open", and its coverage spans are what tell a quiet stretch from a blind one.
 *
 * Two things this deliberately is not.
 *
 * It is an *unlock* signal, not a screen-on one. Waking the screen to read the time and putting the
 * phone down again never engages data protection, so it is invisible here. Android's
 * SCREEN_INTERACTIVE catches those; iOS has nothing that does. Pick-up counts from this source are
 * therefore a lower bound, and the glance/use split that `screenSessions.ts` computes from
 * SCREEN_INTERACTIVE cannot be computed from it at all — see `lockLagMs`.
 *
 * And it is a passcode signal. A device with no passcode never engages data protection, so neither
 * notification ever fires and the day reads as zero unlocks rather than as an error. `armedAtMs` and
 * `observedCount` in the diagnostics are the only things that separate "no passcode set" from "the
 * phone genuinely sat untouched", so both are reported even though neither is study data.
 */
final class UnlockObserver {
  // Standard defaults, not the App Group: this must work on builds made without the Screen Time plugin.
  private static let storageKey = "moodsense.screenEvents"
  private static let armedAtKey = "moodsense.screenEvents.armedAt"
  private static let observedCountKey = "moodsense.screenEvents.observedCount"
  private static let maxStoredEvents = 1000

  /** iOS delivers the availability notification more than once for a single unlock; a repeat this close is that, not a second pick-up. */
  private static let debounceMs: Double = 2000

  /**
   * iOS evicts the data protection keys a short while after the screen locks, not at the moment of
   * locking, so a `screen_lock` timestamp runs late by roughly this much and every session derived
   * from these events is that much too long. Reported to JS with the events so no caller mistakes
   * these durations for the real thing; nothing is silently subtracted here.
   */
  static let lockLagMs: Double = 10_000

  private var tokens: [NSObjectProtocol] = []
  private var lastTsByType: [String: Double] = [:]

  init() {
    let center = NotificationCenter.default
    tokens.append(
      center.addObserver(
        forName: UIApplication.protectedDataDidBecomeAvailableNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.record("screen_unlock") })
    tokens.append(
      center.addObserver(
        forName: UIApplication.protectedDataWillBecomeUnavailableNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in self?.record("screen_lock") })

    // Set once and kept across relaunches: how long we have been listening is what makes a zero count readable.
    if UserDefaults.standard.double(forKey: Self.armedAtKey) <= 0 {
      UserDefaults.standard.set(Date().timeIntervalSince1970 * 1000, forKey: Self.armedAtKey)
    }
  }

  func stop() {
    tokens.forEach(NotificationCenter.default.removeObserver)
    tokens.removeAll()
  }

  deinit {
    stop()
  }

  private func record(_ type: String) {
    let nowMs = Date().timeIntervalSince1970 * 1000
    if let last = lastTsByType[type], nowMs - last < Self.debounceMs { return }
    lastTsByType[type] = nowMs

    let defaults = UserDefaults.standard
    defaults.set(defaults.integer(forKey: Self.observedCountKey) + 1, forKey: Self.observedCountKey)

    var stored = defaults.array(forKey: Self.storageKey) as? [[String: Any]] ?? []
    stored.append(["type": type, "ts": nowMs])
    if stored.count > Self.maxStoredEvents {
      stored.removeFirst(stored.count - Self.maxStoredEvents)
    }
    defaults.set(stored, forKey: Self.storageKey)
  }

  /** Read-and-clear, so a pick-up is handed to JS exactly once. */
  static func drain() -> [[String: Any]] {
    let stored = UserDefaults.standard.array(forKey: storageKey) as? [[String: Any]] ?? []
    if !stored.isEmpty {
      UserDefaults.standard.removeObject(forKey: storageKey)
    }
    return stored
  }

  /** Consent withdrawn: anything recorded but not yet handed over goes, along with the "how long have we listened" record. */
  static func discard() {
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: storageKey)
    defaults.removeObject(forKey: armedAtKey)
    defaults.removeObject(forKey: observedCountKey)
  }

  /** `armedAtMs` of 0 means never armed. Long-armed with `observedCount` 0 is the no-passcode device. */
  static func diagnostics() -> [String: Any] {
    let defaults = UserDefaults.standard
    return [
      "armedAtMs": defaults.double(forKey: armedAtKey),
      "observedCount": defaults.integer(forKey: observedCountKey),
      "pendingEvents": (defaults.array(forKey: storageKey) as? [[String: Any]] ?? []).count,
      "protectedDataAvailable": UIApplication.shared.isProtectedDataAvailable,
      "lockLagMs": lockLagMs,
    ]
  }
}
