module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js'
  ],
  testMatch: ['**/test/**/*.test.js'],
  coverageThreshold: {
    global: {
      lines: 85,
      functions: 85,
      branches: 80,
      statements: 85
    }
  }
};
