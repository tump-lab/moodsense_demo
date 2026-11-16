import ExpoModulesCore

/**
 * Bridge for the iOS-only signals: call length (CallKit), device lock/unlock (data protection) and Screen Time buckets.
 * Every entry point is safe on any build: without the Family Controls entitlement the Screen Time functions report `unavailable`, and the JS wrapper decides whether any of this runs.
 */
public class MoodSenseIosUsageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MoodSenseIosUsage")

    Constants([
      // False on any build made without the config plugin; the JS side uses it to avoid offering setup UI that cannot work.
      "screenTimeConfigured": SharedStore.appGroupId != nil
    ])

    /** Persisted, so native code resumes call sensing on launch before any JS runs (see CallSensing). */
    AsyncFunction("setCallSensingEnabled") { (enabled: Bool, promise: Promise) in
      Task { @MainActor in
        CallSensing.shared.setCallSensingEnabled(enabled)
        promise.resolve(true)
      }
    }

    /** Same deal for lock/unlock: persisted natively, and it shares the one keep-alive with call sensing. */
    AsyncFunction("setScreenSensingEnabled") { (enabled: Bool, promise: Promise) in
      Task { @MainActor in
        CallSensing.shared.setScreenSensingEnabled(enabled)
        promise.resolve(true)
      }
    }

    /** Read-and-clear: each lock/unlock is handed over exactly once. */
    AsyncFunction("drainScreenEvents") { () -> [[String: Any]] in
      return UnlockObserver.drain()
    }

    AsyncFunction("callKeepAliveStatus") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(CallSensing.shared.keepAliveStatus())
      }
    }

    AsyncFunction("requestCallKeepAlive") { (promise: Promise) in
      Task { @MainActor in
        CallSensing.shared.requestKeepAlive { status in
          promise.resolve(status)
        }
      }
    }

    AsyncFunction("drainCallCoverage") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(CallSensing.shared.drainCoverage())
      }
    }

    /** Read-and-clear: each session is handed over exactly once. */
    AsyncFunction("drainCallSessions") { () -> [[String: Any]] in
      return CallObserver.drain()
    }

    AsyncFunction("screenTimeAuthorizationStatus") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(ScreenTimeController.shared.authorizationStatus())
      }
    }

    AsyncFunction("requestScreenTimeAuthorization") { (promise: Promise) in
      Task { @MainActor in
        ScreenTimeController.shared.requestAuthorization { status in
          promise.resolve(status)
        }
      }
    }

    /** Resolves rather than rejects on cancel, since backing out of a picker is a normal outcome. */
    AsyncFunction("presentActivityPicker") { (category: String, promise: Promise) in
      Task { @MainActor in
        ScreenTimeController.shared.presentPicker(category: category) { result in
          promise.resolve(result)
        }
      }
    }

    /** Resolves rather than rejects when there is nothing to name; backing out is a normal outcome. */
    AsyncFunction("presentAppLabeler") { (promise: Promise) in
      Task { @MainActor in
        ScreenTimeController.shared.presentAppLabeler { result in
          promise.resolve(result)
        }
      }
    }

    AsyncFunction("appLabels") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(ScreenTimeController.shared.appLabels())
      }
    }

    /** The apps that have their own event ladder, so JS can say how many are still unnamed. */
    AsyncFunction("trackedAppIds") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(ScreenTimeController.shared.trackedApps().map { $0.id })
      }
    }

    AsyncFunction("selectionSummary") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(ScreenTimeController.shared.selectionSummary())
      }
    }

    AsyncFunction("startUsageMonitoring") {
      (thresholdsByCategory: [String: [Int]], appThresholds: [Int], probeMinutes: Int, promise: Promise) in
      Task { @MainActor in
        do {
          promise.resolve(
            try ScreenTimeController.shared.startMonitoring(
              thresholdsByCategory: thresholdsByCategory,
              appThresholds: appThresholds,
              probeMinutes: probeMinutes))
        } catch {
          // The thrown value carries the useful part (e.g. excessiveActivities); localizedDescription
          // alone reduces every DeviceActivity failure to the same unhelpful sentence.
          promise.reject("ERR_DEVICE_ACTIVITY", "\(error)")
        }
      }
    }

    /** Everything needed to tell the failure modes of this chain apart; see ScreenTimeController.diagnostics. */
    AsyncFunction("usageDiagnostics") { (promise: Promise) in
      Task { @MainActor in
        var result = ScreenTimeController.shared.diagnostics()
        result["callSensingEnabled"] = CallSensing.isCallSensingEnabled
        result["callKeepAlive"] = CallSensing.shared.keepAliveStatus()
        result["screenSensingEnabled"] = CallSensing.isScreenSensingEnabled
        result["unlockObserver"] = UnlockObserver.diagnostics()
        promise.resolve(result)
      }
    }

    AsyncFunction("stopUsageMonitoring") { (clearSelections: Bool, promise: Promise) in
      Task { @MainActor in
        ScreenTimeController.shared.stopMonitoring()
        if clearSelections {
          ScreenTimeController.shared.clearSelections()
        }
        promise.resolve(true)
      }
    }

    AsyncFunction("monitoredThresholds") { (promise: Promise) in
      Task { @MainActor in
        promise.resolve(ScreenTimeController.shared.monitoredThresholds)
      }
    }

    AsyncFunction("drainUsageThresholdEvents") { () -> [[String: Any]] in
      return SharedStore.drainThresholdEvents()
    }
  }
}
