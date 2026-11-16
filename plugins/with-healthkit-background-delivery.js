/**
 * Adds the HealthKit background-delivery entitlement and an initializeBackgroundObservers call
 * in AppDelegate.swift, so react-native-health re-registers its observers on every launch. If the
 * AppDelegate anchor line is missing, prebuild fails loudly instead of building without observers.
 */
const { withAppDelegate, withDangerousMod, withEntitlementsPlist } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const OBSERVER_INIT = `
    // @generated begin react-native-health background observers (from plugins/with-healthkit-background-delivery.js)
    if let bridge = factory.bridge {
      RCTAppleHealthKit().initializeBackgroundObservers(bridge)
    }
    // @generated end react-native-health background observers`;

const BRIDGING_IMPORT = '#import "RCTAppleHealthKit.h"';

function addObserverInit(appDelegate) {
  if (appDelegate.includes('initializeBackgroundObservers')) return appDelegate;
  // Insert right after React Native starts, while factory and bridge are in scope.
  const anchor = /(factory\.startReactNative\([\s\S]*?\))/;
  if (!anchor.test(appDelegate)) {
    throw new Error(
      'with-healthkit-background-delivery: could not find factory.startReactNative(...) in AppDelegate.swift — ' +
        'the Expo template changed. Update the plugin, or add the initializeBackgroundObservers call manually ' +
        'in AppDelegate.swift, right after factory.startReactNative(...).'
    );
  }
  return appDelegate.replace(anchor, `$1${OBSERVER_INIT}`);
}

module.exports = function withHealthKitBackgroundDelivery(config) {
  config = withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.healthkit.background-delivery'] = true;
    return config;
  });

  config = withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error(
        'with-healthkit-background-delivery: expected a Swift AppDelegate; found ' + config.modResults.language
      );
    }
    config.modResults.contents = addObserverInit(config.modResults.contents);
    return config;
  });

  // config-plugins has no bridging-header mod, so edit the file directly.
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const iosRoot = config.modRequest.platformProjectRoot;
      const projectName = config.modRequest.projectName;
      const header = path.join(iosRoot, projectName, `${projectName}-Bridging-Header.h`);
      if (fs.existsSync(header)) {
        const contents = fs.readFileSync(header, 'utf8');
        if (!contents.includes(BRIDGING_IMPORT)) {
          fs.writeFileSync(header, `${contents.trimEnd()}\n${BRIDGING_IMPORT}\n`);
        }
      } else {
        console.warn(
          `with-healthkit-background-delivery: bridging header not found at ${header}; ` +
            `add ${BRIDGING_IMPORT} to your bridging header manually.`
        );
      }
      return config;
    },
  ]);

  return config;
};
