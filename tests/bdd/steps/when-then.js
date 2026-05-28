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

// ── Watchlist column assertions ──

Then('the watchlist header row contains {string}', async ({ page }, label) => {
  await expect(
    page.locator('table.quote-table thead tr', { hasText: label })
  ).toBeVisible({ timeout: 2000 });
});

Then('the watchlist header row does not contain {string}', async ({ page }, label) => {
  const headers = page.locator('table.quote-table thead th');
  // No <th> should equal the forbidden label (case-sensitive, trimmed).
  const texts = await headers.allTextContents();
  const trimmed = texts.map((t) => t.trim());
  expect(trimmed).not.toContain(label);
});

Then('the first watchlist row eventually has a populated cell with id suffix {string}',
  async ({ page }, suffix) => {
    const firstRow = page.locator('#quote-body tr').first();
    const symbol = await firstRow.locator('[data-symbol]').getAttribute('data-symbol');
    expect(symbol, 'first row must carry a data-symbol').toBeTruthy();
    const cell = page.locator('#quote-' + symbol + '-' + suffix);
    // The static cells are populated by an async fetch — wait for non-empty
    // text. Give it up to 5s on a cold FMP cache.
    await expect.poll(
      async () => ((await cell.textContent()) || '').trim().replace(/[·\s]/g, ''),
      { timeout: 5000 }
    ).not.toBe('');
  }
);

Then('the first watchlist row eventually has a sparkline', async ({ page }) => {
  const firstRow = page.locator('#quote-body tr').first();
  const symbol = await firstRow.locator('[data-symbol]').getAttribute('data-symbol');
  const sparkHost = page.locator('#quote-' + symbol + '-spark');
  // lightweight-charts renders into a <canvas>. Wait for one to appear.
  await expect(sparkHost.locator('canvas').first()).toBeVisible({ timeout: 5000 });
});

Then('the preview slide-in contains a company info panel', async ({ page }) => {
  // The panel renders inside the slide-in body as #price-preview-cpanel
  // and gets populated by window._renderCompanyPanel() — wait for the
  // symbol chip to appear (the first thing the panel writes).
  await expect(
    page.locator('#price-preview-cpanel .cpanel-sym')
  ).toBeVisible({ timeout: 5000 });
});

When('I switch to the next watchlist tab', async ({ page }) => {
  const tabs = page.locator('.wl-tab');
  const count = await tabs.count();
  if (count < 2) return; // only one list — nothing to switch to
  await tabs.nth(1).click();
  await page.waitForTimeout(300);
});

When('I switch to the previous watchlist tab', async ({ page }) => {
  await page.locator('.wl-tab').first().click();
  await page.waitForTimeout(300);
});

Then("the first watchlist row's sparkline canvas is the host's width",
  async ({ page }) => {
    // Regression net for the display:none → 0x0 canvas bug. The canvas
    // should match the host div's clientWidth once the row is visible
    // again; anything below it means lightweight-charts collapsed and
    // failed to recover on show.
    const widths = await page.evaluate(() => {
      const firstRow = document.querySelector('#quote-body tr');
      if (!firstRow) return null;
      const sym = firstRow.querySelector('[data-symbol]')?.dataset.symbol;
      if (!sym) return null;
      const host = document.getElementById('quote-' + sym + '-spark');
      const canvas = host?.querySelector('canvas');
      return {
        hostW: host?.clientWidth || 0,
        canvasW: canvas?.getBoundingClientRect().width || 0,
      };
    });
    expect(widths, 'no first-row sparkline host found').not.toBeNull();
    expect(widths.hostW, 'host width should be > 0').toBeGreaterThan(0);
    expect(widths.canvasW, 'canvas width should match host width').toBeGreaterThan(0);
  }
);
