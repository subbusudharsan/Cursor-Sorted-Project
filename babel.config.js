module.exports = function (api) {
  api.cache(true);
  const isWeb = process.env.EXPO_OS === 'web' || process.env.EXPO_PLATFORM === 'web';

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // ✅ Only load Reanimated on native (not web)
      !isWeb && require.resolve('react-native-reanimated/plugin'),
    ].filter(Boolean),
  };
};
