import Foundation

/**
 * Storage shared by the app and the DeviceActivityMonitor extension through an App Group.
 * The group id comes from Info.plist; when it is absent, `defaults` is nil and every call is a no-op.
 */
enum SharedStore {
  static let infoPlistKey = "MoodSenseAppGroup"

  enum Key {
    static let thresholdEvents = "moodsense.thresholdEvents"
    static let selectionPrefix = "moodsense.selection."
    static let monitoredThresholds = "moodsense.monitoredThresholds"
    static let monitoringFingerprint = "moodsense.monitoringFingerprint"
    static let appLabels = "moodsense.appLabels"
  }

  static var appGroupId: String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: infoPlistKey) as? String,
          !value.isEmpty else {
      return nil
    }
    return value
  }

  static var defaults: UserDefaults? {
    guard let appGroupId else { return nil }
    return UserDefaults(suiteName: appGroupId)
  }

  // MARK: - Threshold events

  /** Cap the queue so weeks of unread crossings cannot grow without bound; 500 is far above one day's worth. */
  static let maxStoredEvents = 500

  static func appendThresholdEvent(_ event: [String: Any]) {
    guard let defaults else { return }
    var events = defaults.array(forKey: Key.thresholdEvents) as? [[String: Any]] ?? []
    events.append(event)
    if events.count > maxStoredEvents {
      events.removeFirst(events.count - maxStoredEvents)
    }
    defaults.set(events, forKey: Key.thresholdEvents)
  }

  /** Reads and clears the queue in one step, so a crossing is never handed to JS twice. */
  static func drainThresholdEvents() -> [[String: Any]] {
    guard let defaults else { return [] }
    let events = defaults.array(forKey: Key.thresholdEvents) as? [[String: Any]] ?? []
    if !events.isEmpty {
      defaults.removeObject(forKey: Key.thresholdEvents)
    }
    return events
  }

  // MARK: - Participant-supplied app names

  /**
   * `appId` -> the name the participant typed for it. iOS never tells the app which app a token is,
   * so this is the only way a per-app row can carry a name, and it is the participant's own word for
   * it rather than anything the system reported.
   */
  static func appLabels() -> [String: String] {
    (defaults?.dictionary(forKey: Key.appLabels) as? [String: String]) ?? [:]
  }

  static func setAppLabels(_ labels: [String: String]) {
    guard let defaults else { return }
    if labels.isEmpty {
      defaults.removeObject(forKey: Key.appLabels)
    } else {
      defaults.set(labels, forKey: Key.appLabels)
    }
  }

  // MARK: - Participant app selections

  static func selectionData(for category: String) -> Data? {
    defaults?.data(forKey: Key.selectionPrefix + category)
  }

  static func setSelectionData(_ data: Data?, for category: String) {
    guard let defaults else { return }
    let key = Key.selectionPrefix + category
    if let data {
      defaults.set(data, forKey: key)
    } else {
      defaults.removeObject(forKey: key)
    }
  }
}
