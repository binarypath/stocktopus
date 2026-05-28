const { defineConfig } = require('@playwright/test');
const { defineBddConfig } = require('playwright-bdd');

const testDir = defineBddConfig({
  paths: ['./features/**/*.feature'],
  require: ['./steps/**/*.js'],
  outputDir: '.features-gen',
});

module.exports = defineConfig({
  testDir,
  fullyParallel: true,
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
