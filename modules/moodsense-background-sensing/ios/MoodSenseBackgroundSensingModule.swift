import CoreMotion
import ExpoModulesCore

/**
 * Reads CoreMotion's activity history. iOS records it whether or not MoodSense is running
 * — suspended, evicted or swiped away — and keeps about seven days, so one query after
 * any gap recovers the whole gap. It is the only round-the-clock motion source iOS gives a
 * third-party app; nothing lets the app itself sample sensors while it is not running.
 */
public class MoodSenseBackgroundSensingModule: Module {
  private let activityManager = CMMotionActivityManager()
  private let queryQueue = OperationQueue()

  public func definition() -> ModuleDefinition {
    Name("MoodSenseBackgroundSensing")

    /**
     * One row per CMMotionActivity: its start and raw flags. Labelling and where each one
     * ends are decided in JS (motionHistory.ts), where the self-check covers them.
     */
    AsyncFunction("queryMotionActivity") { (startMs: Double, endMs: Double, promise: Promise) in
      guard CMMotionActivityManager.isActivityAvailable() else {
        promise.resolve([])
        return
      }
      self.activityManager.queryActivityStarting(
        from: Date(timeIntervalSince1970: startMs / 1000),
        to: Date(timeIntervalSince1970: endMs / 1000),
        to: self.queryQueue
      ) { activities, error in
        if let error = error {
          promise.reject("ERR_MOTION_ACTIVITY", error.localizedDescription)
          return
        }
        let rows: [[String: Any]] = (activities ?? []).map { activity in
          [
            "ts": activity.startDate.timeIntervalSince1970 * 1000,
            "stationary": activity.stationary,
            "walking": activity.walking,
            "running": activity.running,
            "automotive": activity.automotive,
            "cycling": activity.cycling,
            "unknown": activity.unknown,
            "confidence": activity.confidence.rawValue,
          ]
        }
        promise.resolve(rows)
      }
    }
  }
}
