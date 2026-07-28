// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Route SVG imports through react-native-svg-transformer so they become
// React components (keeps platform-icon.svg as a single source of truth).
config.transformer.babelTransformerPath = require.resolve(
  'react-native-svg-transformer/expo'
);
config.resolver.assetExts = config.resolver.assetExts.filter((ext) => ext !== 'svg');
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

module.exports = config;
