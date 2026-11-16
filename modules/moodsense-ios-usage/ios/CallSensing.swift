import CoreLocation
import Foundation

/**
 * Keeps this process alive around the clock so the observers that can only hear live events — CallObserver for
 * call length, UnlockObserver for device lock/unlock — actually hear them. iOS keeps no call log an app can read
 * and posts the data-protection notifications to running processes only, so both are seen only if this process is
 * alive when they happen. Low-accuracy background location keeps it running and significant-change monitoring
 * relaunches it after iOS terminates it; the fixes themselves are dropped on arrival.
 *
 * Two independent consents turn it on and either one is enough to keep it running, so the reasons are tracked
 * separately and the process stops only once both are off. Coverage spans record when we were actually listening,
 * so a gap in either stream can be told apart from a quiet day — one span covers both streams because one process
 * being alive is exactly what both depend on.
 *
 * Main thread only: the location manager delivers to the thread that created it.
 */
final class CallSensing: NSObject, CLLocationManagerDelegate {
  static let shared = CallSensing()

  private static let enabledKey = "moodsense.callSensing.enabled"
  private static let screenEnabledKey = "moodsense.screenSensing.enabled"
  private static let openSpanKey = "moodsense.callSensing.openSpan"
  private static let closedSpansKey = "moodsense.callSensing.closedSpans"
  private static let maxClosedSpans = 500

  private static let heartbeatSeconds: TimeInterval = 60
  /** A heartbeat later than this means the process was suspended in between, so coverage has a gap there. */
  private static let gapSeconds: TimeInterval = 180
  /** iOS silently skips an "Always" prompt it has already shown once, so a request cannot wait for an answer forever. */
  private static let alwaysPromptTimeoutSeconds: TimeInterval = 30

  /** Setting allowsBackgroundLocationUpdates without this background mode crashes, so it is checked first. */
  private static let hasLocationBackgroundMode: Bool =
    (Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String])?.contains("location") == true

  private let locationManager = CLLocationManager()
  private var observer: CallObserver?
  private var unlockObserver: UnlockObserver?
  private var heartbeat: Timer?
  private var spanOwnedByThisProcess = false
  private var waiters: [(String) -> Void] = []
  private var upgradingToAlways = false

  private override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyThreeKilometers
    locationManager.distanceFilter = 1000
    locationManager.activityType = .other
    // Automatic pausing is what would let iOS suspend the process, which is the whole thing this avoids.
    locationManager.pausesLocationUpdatesAutomatically = false
  }

  static var isCallSensingEnabled: Bool { UserDefaults.standard.bool(forKey: enabledKey) }

  static var isScreenSensingEnabled: Bool { UserDefaults.standard.bool(forKey: screenEnabledKey) }

  /** Either reason keeps the process alive; only both being off stops it. */
  static var isEnabled: Bool { isCallSensingEnabled || isScreenSensingEnabled }

  /** True while anything is actually listening, which is what a coverage span is a record of. */
  private var isListening: Bool { observer != nil || unlockObserver != nil }

  /**
   * Nothing enabled means nothing to resume, and returning early matters: `apply()` would otherwise
   * take the stop path on every launch and close a span left open by a process that died at *now*
   * instead of at its last heartbeat, inventing coverage for the time in between.
   */
  func resumeIfEnabled() {
    guard Self.isEnabled else { return }
    apply()
  }

  func setCallSensingEnabled(_ enabled: Bool) {
    UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
    // Consent was withdrawn, so anything recorded but not yet handed to JS is dropped.
    if !enabled { CallObserver.discard() }
    apply()
  }

  func setScreenSensingEnabled(_ enabled: Bool) {
    UserDefaults.standard.set(enabled, forKey: Self.screenEnabledKey)
    if !enabled { UnlockObserver.discard() }
    apply()
  }

  /** Brings the observers and the keep-alive in line with the two consents, in whichever direction either just moved. */
  private func apply() {
    if Self.isCallSensingEnabled {
      if observer == nil { observer = CallObserver() }
    } else {
      observer?.stop()
      observer = nil
    }

    if Self.isScreenSensingEnabled {
      if unlockObserver == nil { unlockObserver = UnlockObserver() }
    } else {
      unlockObserver?.stop()
      unlockObserver = nil
    }

    if Self.isEnabled {
      start()
    } else {
      stop()
      // Coverage describes a process that is no longer running for anyone, so it goes too.
      UserDefaults.standard.removeObject(forKey: Self.closedSpansKey)
    }
  }

  private func start() {
    touchSpan()
    startKeepAlive()
    if heartbeat == nil {
      heartbeat = Timer.scheduledTimer(withTimeInterval: Self.heartbeatSeconds, repeats: true) { _ in
        CallSensing.shared.touchSpan()
      }
    }
  }

  private func stop() {
    if isListening { touchSpan() }
    observer?.stop()
    observer = nil
    unlockObserver?.stop()
    unlockObserver = nil
    heartbeat?.invalidate()
    heartbeat = nil
    locationManager.stopUpdatingLocation()
    locationManager.stopMonitoringSignificantLocationChanges()
    closeOpenSpan(endTs: Self.nowMs())
  }

  /**
   * `showsBackgroundLocationIndicator` is deliberately true, and is what makes this work at all.
   * From iOS 16.4 an app calling both startUpdatingLocation() and startMonitoringSignificantLocationChanges()
   * is suspended anyway if it asks for low accuracy with a distance filter — exactly the cheap settings
   * above. Apple's stated escapes are either an accuracy better than 1km with no distance filter, or
   * showing the indicator. Showing it is the better trade here: the 3km accuracy stays, so no precise
   * fix is ever computed, the battery cost stays low, and the participant can see when MoodSense is
   * running instead of it being invisible.
   */
  private func startKeepAlive() {
    guard Self.hasLocationBackgroundMode else { return }
    switch locationManager.authorizationStatus {
    case .authorizedAlways:
      locationManager.allowsBackgroundLocationUpdates = true
      locationManager.showsBackgroundLocationIndicator = true
      locationManager.startUpdatingLocation()
      locationManager.startMonitoringSignificantLocationChanges()
    case .authorizedWhenInUse:
      // Survives backgrounding only if started while the app was open, and nothing relaunches it after termination.
      locationManager.allowsBackgroundLocationUpdates = true
      locationManager.showsBackgroundLocationIndicator = true
      locationManager.startUpdatingLocation()
    default:
      locationManager.stopUpdatingLocation()
      locationManager.stopMonitoringSignificantLocationChanges()
    }
  }

  // MARK: - Coverage

  private static func nowMs() -> Double {
    Date().timeIntervalSince1970 * 1000
  }

  /**
   * Extends the open span, or starts a new one. A span left by a process that died is closed at its last heartbeat,
   * and so is one whose last heartbeat is too old, because the process was suspended in between.
   */
  private func touchSpan() {
    let now = Self.nowMs()
    if let open = UserDefaults.standard.dictionary(forKey: Self.openSpanKey),
       let startTs = open["startTs"] as? Double,
       let lastAliveTs = open["lastAliveTs"] as? Double {
      if spanOwnedByThisProcess && now - lastAliveTs <= Self.gapSeconds * 1000 {
        UserDefaults.standard.set(["startTs": startTs, "lastAliveTs": now], forKey: Self.openSpanKey)
        return
      }
      appendClosedSpan(startTs: startTs, endTs: lastAliveTs)
    }
    UserDefaults.standard.set(["startTs": now, "lastAliveTs": now], forKey: Self.openSpanKey)
    spanOwnedByThisProcess = true
  }

  private func closeOpenSpan(endTs: Double) {
    if let open = UserDefaults.standard.dictionary(forKey: Self.openSpanKey),
       let startTs = open["startTs"] as? Double {
      appendClosedSpan(startTs: startTs, endTs: endTs)
    }
    UserDefaults.standard.removeObject(forKey: Self.openSpanKey)
    spanOwnedByThisProcess = false
  }

  /**
   * A span that never got a heartbeat is kept, not dropped: `endTs == startTs` says the process was
   * alive for an instant and no longer, which is the honest answer. Dropping it used to strand the
   * `open: true` row JS had already written for that span, so coverage read as still running forever.
   */
  private func appendClosedSpan(startTs: Double, endTs: Double) {
    guard endTs >= startTs else { return }
    var closed = UserDefaults.standard.array(forKey: Self.closedSpansKey) as? [[String: Any]] ?? []
    closed.append(["startTs": startTs, "endTs": endTs])
    if closed.count > Self.maxClosedSpans {
      closed.removeFirst(closed.count - Self.maxClosedSpans)
    }
    UserDefaults.standard.set(closed, forKey: Self.closedSpansKey)
  }

  /** Read-and-clear for closed spans; the open span is reported on every drain, marked open, until it closes. */
  func drainCoverage() -> [[String: Any]] {
    if isListening { touchSpan() }
    var spans = (UserDefaults.standard.array(forKey: Self.closedSpansKey) as? [[String: Any]] ?? []).map {
      span -> [String: Any] in
      var closed = span
      closed["open"] = false
      return closed
    }
    UserDefaults.standard.removeObject(forKey: Self.closedSpansKey)
    if let open = UserDefaults.standard.dictionary(forKey: Self.openSpanKey),
       let startTs = open["startTs"] as? Double,
       let lastAliveTs = open["lastAliveTs"] as? Double {
      spans.append(["startTs": startTs, "endTs": lastAliveTs, "open": true])
    }
    return spans
  }

  // MARK: - Location permission

  func keepAliveStatus() -> String {
    guard Self.hasLocationBackgroundMode else { return "unavailable" }
    switch locationManager.authorizationStatus {
    case .notDetermined: return "notDetermined"
    case .authorizedAlways: return "always"
    case .authorizedWhenInUse: return "whenInUse"
    default: return "denied"
    }
  }

  /** iOS only offers "Always" once "While Using" has been granted, so this asks in two steps. */
  func requestKeepAlive(completion: @escaping (String) -> Void) {
    let status = keepAliveStatus()
    guard status == "notDetermined" || status == "whenInUse" else {
      completion(status)
      return
    }
    waiters.append(completion)
    if status == "notDetermined" {
      locationManager.requestWhenInUseAuthorization()
    } else {
      askForAlways()
    }
  }

  private func askForAlways() {
    upgradingToAlways = true
    locationManager.requestAlwaysAuthorization()
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.alwaysPromptTimeoutSeconds) { [weak self] in
      self?.finishRequest()
    }
  }

  private func finishRequest() {
    upgradingToAlways = false
    let status = keepAliveStatus()
    let pending = waiters
    waiters.removeAll()
    pending.forEach { $0(status) }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if Self.isEnabled { startKeepAlive() }

    guard !waiters.isEmpty else { return }
    let status = keepAliveStatus()
    if upgradingToAlways {
      // "Keep Only While Using" leaves the status unchanged and fires nothing, so that answer arrives via the timeout.
      if status == "always" || status == "denied" { finishRequest() }
    } else if status == "whenInUse" {
      askForAlways()
    } else if status != "notDetermined" {
      finishRequest()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // The fixes are deliberately dropped: they are only the reason iOS keeps the process running.
    if isListening { touchSpan() }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
