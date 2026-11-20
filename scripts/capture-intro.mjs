// Captures the client-gallery iris entrance frame by frame (slowed 8x via a test-only knob) for visual review.
// Usage: node scripts/capture-intro.mjs <gallery path /g/token> <width> <height> <prefix>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [path, w = '1440', h = '900', prefix = 'intro'] = process.argv.slice(2);
const SPEED = 0.125;
mkdirSync('screenshots/intro', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
});
await ctx.addInitScript((s) => (window.__LSG_INTRO_SPEED__ = s), SPEED);
const page = await ctx.newPage();
await page.goto('http://localhost:5188' + path);
await page.waitForSelector('[data-testid="client-entrance"][data-state="opening"]', { timeout: 15000 });
const t0 = Date.now();
// Real-time moments (ms) in the choreography → wall-clock at 1/SPEED.
for (const ms of [60, 300, 520, 760, 900, 1050, 1200, 1350]) {
  const wait = ms / SPEED - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `screenshots/intro/${prefix}-${String(ms).padStart(4, '0')}.png` });
}
await page.waitForSelector('[data-testid="client-entrance"]', { state: 'detached', timeout: 20000 });
await page.waitForTimeout(1100);
await page.screenshot({ path: `screenshots/intro/${prefix}-final.png` });
console.log('captured');
await browser.close();
