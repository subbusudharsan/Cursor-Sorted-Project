const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Only override what's necessary - keep Expo defaults
// Don't override sourceExts and assetExts unless absolutely needed

// Optimize transformer for better performance
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true,
    },
  }),
};

// Enable symbolicating for better error messages
config.symbolicator = {
  customizeFrame: (frame) => {
    // Filter out node_modules from error stack traces
    if (frame.file && frame.file.includes('node_modules')) {
      return null;
    }
    return frame;
  },
};

module.exports = config;