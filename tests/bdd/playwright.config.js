const { defineConfig } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');

const testDir = defineBddConfig({
  paths: ['./features/**/*.feature'],
  require: ['./steps/**/*.js'],
  outputDir: '.features-gen',
});

module.exports = defineConfig({
  testDir,
  // Run serially. Several scenarios race when parallel: they share one
  // backing dev server and FMP rate window, and the financials scenario
  // times out when parallel workers hammer /api/historical/stock and
  // /api/security/.../financials at the same moment. 10 scenarios at
  // ~7s total is fine for a regression net.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
