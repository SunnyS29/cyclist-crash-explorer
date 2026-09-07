import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const base = process.env.BASE_URL || 'http://127.0.0.1:8000/';
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app', { state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#status').textContent === '');
  assert.equal(await page.locator('#crash-count').textContent(), '15,485');
  assert.equal(await page.locator('#table-wrap').isVisible(), false);
  await page.locator('#toggle-data').click();
  assert.equal(await page.locator('#table-wrap').isVisible(), true);
  assert.equal(await page.locator('#toggle-data').getAttribute('aria-expanded'), 'true');
  await page.locator('#toggle-data').click();
  assert.equal(await page.locator('#table-wrap').isVisible(), false);
  async function search(input) {
    await page.locator('#search').fill(input);
    await page.locator('#search-btn').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent === '');
    return page.locator('#result-answer').textContent();
  }
  assert.match(await search('fatal crashes'), /^76 recorded crashes/);
  await search('crashes in Yarra by year');
  assert.match(await page.locator('#result-caption').textContent(), /Council: Yarra/);
  assert.match(await page.locator('#result-answer').textContent(), /complete years/);
  for (const input of ['minor injuries in Yarra', 'crashes in Yarra per capita', 'crashes on Sydney Road', 'crashes before 2012', 'fatal crashes 2026']) {
    await search(input);
    assert.equal(await page.locator('#result-title').textContent(), 'Unable to answer this question');
  }
  await search('fatal crashes in Yarra on Sunday at 8am');
  const caption = await page.locator('#result-caption').textContent();
  for (const filter of ['Council: Yarra', 'Severity: Fatal', 'Sunday', '8:00']) assert.ok(caption.includes(filter), caption);
  assert.match(await search('Cardinia 2025'), /Cardinia had 0 recorded crashes/);
  assert.equal(await page.locator('#year-label').textContent(), '2025');
  assert.match(await search('safest council 2025'), /Cardinia had 0 recorded crashes/);
  // Moving the year slider re-runs the same aggregation with the visible years.
  await page.locator('#year-min').evaluate((el) => { el.value = '2024'; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.querySelector('#status').textContent === '');
  assert.match(await page.locator('#result-caption').textContent(), /Years: 2024–2025/);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
  assert.equal(await page.getByRole('slider', { name: 'First year' }).count(), 1);
  await page.goto(new URL('eval/', base).href);
  await page.waitForFunction(() => document.querySelector('#score').textContent.includes('PASS'));
  assert.deepEqual(errors, []);
  console.log('PASS — browser startup, counts, filters, fallbacks, zero councils, table toggle, slider, mobile layout, and browser eval');
} finally {
  await browser.close();
}
