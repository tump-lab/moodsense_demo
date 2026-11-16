// expo-sqlite's web build loads its wa-sqlite engine as a .wasm asset
// (node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm) — Metro's default
// asset extensions list doesn't include wasm, so without this the web
// bundle fails with "Unable to resolve './wa-sqlite/wa-sqlite.wasm'".
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
