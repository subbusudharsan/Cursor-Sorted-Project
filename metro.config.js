// ✅ metro.config.js — fully compatible with Expo SDK 50+ and Node 20+
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// optional: inline requires for faster startup
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: false, inlineRequires: true },
});

module.exports = config;
