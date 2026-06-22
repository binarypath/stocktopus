// Given step definitions for the stocktopus BDD suite.
//
// These steps establish preconditions: server reachability, watchlist
// seeding, and landing on a specific page. They share the page fixture
// provided by playwright-bdd so subsequent When/Then steps act on the
// same browser context.

const { createBdd } = require('playwright-bdd');
const { expect } = require('@playwright/test');

const { Given } = createBdd();

// Ensures the first watchlist returned by the API has at least one
// symbol. Tolerates both shapes the API may return: plain strings or
// objects with a `symbol` field. Seeds AAPL when empty.
async function ensureDefaultWatchlistSeeded(page) {
  const res = await page.request.get('/api/watchlists');
  if (!res.ok()) {
    throw new Error('GET /api/watchlists failed: ' + res.status());
  }
  const lists = await res.json();
  if (!Array.isArray(lists) || lists.length === 0) {
    throw new Error('No watchlists returned from /api/watchlists');
  }
  const first = lists[0];
  const symbols = Array.isArray(first.symbols) ? first.symbols : [];
  const normalized = symbols
    .map((s) => (typeof s === 'string' ? s : (s && s.symbol) || ''))
    .filter(Boolean);
  if (normalized.length > 0) {
    return;
  }
  const addRes = await page.request.post(
    '/api/watchlists/' + first.id + '/symbols',
    { data: { symbol: 'AAPL' } }
  );
  if (!addRes.ok()) {
    throw new Error(
      'POST /api/watchlists/' + first.id + '/symbols failed: ' + addRes.status()
    );
  }
}

Given('the dev server is reachable', async ({ page }) => {
  const response = await page.goto('/');
  expect(response, 'no response from GET /').not.toBeNull();
  expect(response.status()).toBeLessThan(500);
});

Given('the default watchlist has at least one security', async ({ page }) => {
  await ensureDefaultWatchlistSeeded(page);
});

Given('I am on the watchlist page', async ({ page }) => {
  await page.goto('/watchlist');
  await page.waitForSelector('#quote-body tr', { state: 'visible' });
});

Given('I am on the economics page', async ({ page }) => {
  await page.goto('/economics');
  await page.waitForSelector('#economics-tabs .economics-tab.active');
});

Given('I am on the stock chart page for {string}', async ({ page }, sym) => {
  await page.goto('/stock/' + sym);
  await page.waitForSelector('#chart-range-bar .chart-range-btn.active');
});

Given('I am on the screener page', async ({ page }) => {
  // Capture every /api/screener request so later steps can assert on the
  // exact URL the form submits (used by the shorthand-parsing scenario).
  page.__screenerRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/screener')) {
      page.__screenerRequests.push(req.url());
    }
  });
  await page.goto('/screener');
  await page.waitForSelector('#screener-form');
  // <details> elements are closed by default; give them a tick to settle.
  await page.waitForTimeout(150);
});

Given('I am on the security page for {string}', async ({ page }, sym) => {
  // Capture any uncaught JS errors so robustness scenarios can assert
  // none fired during a key-mash. Stash on the page so When/Then steps
  // can read it.
  page.__pageErrors = [];
  page.on('pageerror', (err) => { page.__pageErrors.push(err.message); });
  await page.goto('/security/' + sym);
  await page.waitForSelector('#info-tabs .info-tab.active');
  // Wait for the Overview tab to finish painting — otherwise its late
  // render triggers a MutationObserver reset that clobbers selection
  // state mid-keystroke and the test races itself.
  await page.waitForSelector('.info-overview', { timeout: 5000 });
});

Given('I am on the news page', async ({ page }) => {
  page.__pageErrors = [];
  page.on('pageerror', (err) => { page.__pageErrors.push(err.message); });
  await page.goto('/news');
  await page.waitForSelector('#news-tabs .news-tab');
  // Let the first category's cards render so j can drop into them.
  await page.waitForSelector('#news-cards .news-card', { timeout: 5000 });
});

module.exports = {
  ensureDefaultWatchlistSeeded,
};
