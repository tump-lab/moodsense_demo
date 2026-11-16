/**
 * Expo config plugin: lets MoodSense keep running in the background on iOS so the call observer hears every call.
 * Adds the `location` background mode and the location permission strings. Location fixes are dropped on arrival and never stored (see modules/moodsense-ios-usage/ios/CallSensing.swift).
 */
const { withInfoPlist } = require('@expo/config-plugins');

const WHEN_IN_USE_DESCRIPTION =
  'MoodSense uses location only to keep running in the background, so it can record how long your calls last. Where you are is never stored or sent anywhere.';

const ALWAYS_DESCRIPTION =
  'Choose "Always" so MoodSense can keep running after you leave the app and record the length of every call. Where you are is never stored or sent anywhere, and you can turn this off at any time.';

module.exports = function withIosCallKeepAlive(config) {
  return withInfoPlist(config, (config) => {
    const modes = config.modResults.UIBackgroundModes || [];
    if (!modes.includes('location')) modes.push('location');
    config.modResults.UIBackgroundModes = modes;
    config.modResults.NSLocationWhenInUseUsageDescription = WHEN_IN_USE_DESCRIPTION;
    config.modResults.NSLocationAlwaysAndWhenInUseUsageDescription = ALWAYS_DESCRIPTION;
    return config;
  });
};
