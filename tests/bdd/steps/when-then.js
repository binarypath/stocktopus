// When/Then step definitions for the stocktopus BDD suite.
//
// Keyboard steps delegate to the shared world helpers so timing stays
// consistent across the suite. Assertion steps lean on Playwright's
// expect matchers and target the well-known DOM hooks documented in
// CLAUDE.md (#article-reader, #info-tabs, .vim-selected, etc.).

const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');

const { pressKey, pressSequence } = require('../support/world');

const { When, Then } = createBdd();

When('I press {string}', async ({ page }, key) => {
  await pressKey(page, key);
  // Extra settle to give navigation / slide-in handlers room to react.
  await page.waitForTimeout(120);
});

When('I press the keys {string}', async ({ page }, seq) => {
  await pressSequence(page, seq);
  await page.waitForTimeout(120);
});

Then('the browser URL should match {string}', async ({ page }, pattern) => {
  await page.waitForLoadState('domcontentloaded');
  expect(page.url()).toMatch(new RegExp(pattern));
});

Then('the preview slide-in is visible', async ({ page }) => {
  const reader = page.locator('#article-reader');
  await expect(reader).not.toHaveClass(/(^|\s)hidden(\s|$)/, { timeout: 2000 });
});

Then('the preview slide-in is hidden', async ({ page }) => {
  const reader = page.locator('#article-reader');
  await expect(reader).toHaveClass(/(^|\s)hidden(\s|$)/, { timeout: 2000 });
});

Then('the preview slide-in title contains {string}', async ({ page }, text) => {
  await expect(page.locator('#reader-title')).toContainText(text);
});

Then('a row is highlighted', async ({ page }) => {
  await expect(page.locator('.vim-selected').first()).toBeVisible({
    timeout: 2000,
  });
});

Then('the active tab is {string}', async ({ page }, label) => {
  await expect(page.locator('#info-tabs .info-tab.active')).toContainText(label);
});
