// Native modules that have no implementation under Jest.
// https://react-native-async-storage.github.io/async-storage/docs/advanced/jest
// jest.mock factories are hoisted above imports, so they must use require().
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Keep native Worklets out of JS rendering tests. Individual animation tests can override this.
jest.mock('react-native-reanimated', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));

// Reanimated's bundled mock still imports Worklets internally in this SDK.
jest.mock('react-native-worklets', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-worklets/src/mock'),
);
