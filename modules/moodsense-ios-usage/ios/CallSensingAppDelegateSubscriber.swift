import ExpoModulesCore
import UIKit

/**
 * Resumes call sensing on every launch, including the background relaunches iOS does for location events, where
 * waiting for JS would leave calls unobserved until the app is next opened.
 */
public class CallSensingAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    CallSensing.shared.resumeIfEnabled()
    return true
  }
}
