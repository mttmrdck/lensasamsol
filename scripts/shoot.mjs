// Visual QA helper: node scripts/shoot.mjs <outName> <path> [width] [height] [scrollY|#selector] [--login] [--full]
// Saves screenshots/<outName>.png from the running dev server.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name, path, w = '1440', h = '900', scroll] = process.argv.slice(2);
const flags = new Set(process.argv.filter((a) => a.startsWith('--')));
const base = process.env.BASE_URL ?? 'http://localhost:5188';
mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
  hasTouch: Number(w) < 800,
  isMobile: Number(w) < 800,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
if (flags.has('--login')) {
  await page.goto(base + '/admin/login');
  await page.getByLabel('User ID',{exact:true}).fill(process.env.ADMIN_USER ?? 'admin');
  await page.getByLabel('Password').fill(process.env.ADMIN_PASS ?? 'archive-demo-passphrase');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/admin(?!\/login)/);
}
await page.goto(base + path, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
if (scroll && scroll.startsWith('#')) await page.locator(scroll.slice(1)).first().scrollIntoViewIfNeeded();
else if (scroll && scroll !== '0') await page.evaluate((y) => window.scrollTo(0, y), Number(scroll));
await page.waitForTimeout(900);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
await page.screenshot({ path: `screenshots/${name}.png`, fullPage: flags.has('--full') });
console.log(JSON.stringify({ name, overflow, errors: errors.slice(0, 5) }));
await browser.close();
