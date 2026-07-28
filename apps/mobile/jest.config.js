/** Jest config for the Expo mobile app. */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@speed-enterprises/shared$': '<rootDir>/../../packages/shared/dist/index.js',
    '^@speed-enterprises/shared/(.*)$': '<rootDir>/../../packages/shared/dist/$1',
    // react-native-svg-transformer only runs under Metro; stub SVG imports for Jest.
    '\\.svg$': '<rootDir>/__mocks__/svgMock.tsx',
  },
  // Don't try to run the native module's TS or the build folders as tests.
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/', '/.expo/', '/modules/'],
  // pnpm hoists deps under node_modules/.pnpm/<pkg>@<ver>/..., so anchor the
  // allowlist there (the default node_modules/<pkg> anchor never matches and RN's
  // ESM jest/setup.js fails to transpile). Transpile RN/Expo/svg/safe-area/etc.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!((jest-)?react-native|@react-native|@react-native-community|@react-navigation|expo|@expo|expo-modules-core|expo-.*|react-native-.*|@testing-library))',
  ],
};
