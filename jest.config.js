// Minimal config for the pure-TS domain tests. When the Expo skeleton lands,
// merge this into the jest-expo config (keep the testMatch for tests/domain).
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '\\.ts$': [
      'babel-jest',
      { presets: [['@babel/preset-env', { targets: { node: 'current' } }], '@babel/preset-typescript'] },
    ],
  },
};
