/**
 * Expo config plugin that adds the setPermissionDelegate call to MainActivity.onCreate, which
 * react-native-health-connect needs but never does itself (without it the first requestPermission() crashes).
 * If the Expo template anchors are missing, prebuild fails loudly instead of shipping a crashing build.
 */
const { withMainActivity } = require('@expo/config-plugins');

const IMPORT = 'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';

const DELEGATE_INIT = `
    // @generated begin react-native-health-connect permission delegate (from plugins/with-health-connect-permission-delegate.js)
    // Registers the ActivityResultLaunchers the library's permission flow
    // needs. Must run before the activity is STARTED.
    HealthConnectPermissionDelegate.setPermissionDelegate(this)
    // @generated end react-native-health-connect permission delegate`;

function addImport(src) {
  if (src.includes(IMPORT)) return src;
  // Anchor: the Expo template's own expo.modules import, always present and
  // last in the import block.
  const anchor = /^import expo\.modules\.ReactActivityDelegateWrapper$/m;
  if (!anchor.test(src)) {
    throw new Error(
      'with-health-connect-permission-delegate: could not find the ' +
        '`import expo.modules.ReactActivityDelegateWrapper` line in MainActivity.kt. ' +
        'The Expo template likely changed — add this import manually and update the anchor:\n' +
        `  ${IMPORT}`
    );
  }
  return src.replace(anchor, `${IMPORT}\n$&`);
}

function addDelegateInit(src) {
  if (src.includes('HealthConnectPermissionDelegate.setPermissionDelegate')) return src;
  // Anchor: the template's `super.onCreate(null)` inside onCreate. The
  // delegate must be registered after super.onCreate and before STARTED.
  const anchor = /super\.onCreate\(null\)/;
  if (!anchor.test(src)) {
    throw new Error(
      'with-health-connect-permission-delegate: could not find `super.onCreate(null)` ' +
        'in MainActivity.kt. The Expo template likely changed — add this call manually ' +
        'at the end of onCreate and update the anchor:\n' +
        '  HealthConnectPermissionDelegate.setPermissionDelegate(this)'
    );
  }
  return src.replace(anchor, `$&${DELEGATE_INIT}`);
}

module.exports = function withHealthConnectPermissionDelegate(config) {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(
        'with-health-connect-permission-delegate: expected a Kotlin MainActivity, got ' +
          `"${config.modResults.language}". Update this plugin for the new template.`
      );
    }
    config.modResults.contents = addDelegateInit(addImport(config.modResults.contents));
    return config;
  });
};
