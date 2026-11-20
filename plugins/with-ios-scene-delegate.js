/**
 * Adopts the UIScene lifecycle on iOS.
 *
 * Apps linked against the iOS 27 SDK that still use the app-delegate-only lifecycle are killed at
 * launch on iOS 27 (SIGTRAP in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
 * The Expo template does not declare a scene yet, so this plugin adds one.
 *
 * React Native still starts in application(_:didFinishLaunchingWithOptions:), exactly as before, so
 * background launches (HealthKit delivery, background tasks), which never connect a scene, keep
 * booting JS. The SceneDelegate only attaches that already-running window to the scene when one
 * connects, and forwards URLs / user activities to the app delegate, where Expo's subscribers
 * (Google Sign-In etc.) and RCTLinkingManager already handle them.
 */
const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

const MARKER = '// @generated begin scene delegate (from plugins/with-ios-scene-delegate.js)';

const SCENE_DELEGATE = `
${MARKER}
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
    let window = appDelegate.window ?? UIWindow(windowScene: windowScene)
    window.windowScene = windowScene
    window.frame = windowScene.coordinateSpace.bounds
    appDelegate.window = window
    self.window = window
    window.makeKeyAndVisible()

    for context in connectionOptions.urlContexts {
      openURL(context)
    }
    for activity in connectionOptions.userActivities {
      continueActivity(activity)
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      openURL(context)
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    continueActivity(userActivity)
  }

  private func openURL(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    options[.sourceApplication] = context.options.sourceApplication
    options[.annotation] = context.options.annotation
    _ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: context.url, options: options)
  }

  private func continueActivity(_ activity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared,
      continue: activity,
      restorationHandler: { _ in }
    )
  }
}
// @generated end scene delegate
`;

function addSceneDelegate(src) {
  if (src.includes(MARKER)) return src;
  return src.trimEnd() + '\n' + SCENE_DELEGATE;
}

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

module.exports = function withIosSceneDelegate(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return config;
  });
  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('with-ios-scene-delegate: expected a Swift AppDelegate');
    }
    config.modResults.contents = addSceneDelegate(config.modResults.contents);
    return config;
  });
  return config;
};

module.exports.addSceneDelegate = addSceneDelegate;
module.exports.SCENE_MANIFEST = SCENE_MANIFEST;
