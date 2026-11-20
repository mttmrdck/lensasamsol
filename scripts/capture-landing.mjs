import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const phase = process.argv[2] ?? 'after';
const base = 'http://localhost:5188';
const out = `screenshots/static-landing/${phase}`;
mkdirSync(out, { recursive: true });
const paths = ['src/pages/admin', 'src/components/admin'];
const hash = Object.fromEntries(
  paths.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => {
        const path = `${dir}/${f}`;
        return [path, createHash('sha256').update(readFileSync(path)).digest('hex')];
      }),
  ),
);
if (phase === 'before')
  writeFileSync('screenshots/static-landing/admin-source-before.json', JSON.stringify(hash, null, 2));
else if (
  JSON.stringify(hash) !==
  JSON.stringify(JSON.parse(readFileSync('screenshots/static-landing/admin-source-before.json', 'utf8')))
)
  throw new Error('Admin sources changed');
const browser = await chromium.launch();
const context = await browser.newContext({ reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await context.request.post(`${base}/api/auth/login`, {
  data: { username:process.env.ADMIN_USER ?? 'admin', password: process.env.ADMIN_PASS ?? 'archive-demo-passphrase' },
  headers: { 'x-archive-csrf': '1', origin: base },
});
const links = [];
for (const key of ['coast', 'portraits', 'highlands', 'night', 'archive']) {
  const res = await context.request.get(`${base}/api/admin/collections/col_demo_${key}`);
  if (!res.ok()) throw new Error(`Cannot load ${key}: ${res.status()}`);
  const d = await res.json();
  const url = `${base}/g/${d.shareToken}`;
  links.push({ key, url });
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}/${key}-${width}-hero.png` });
    if (phase === 'after') {
      await page
        .getByTestId('photo-grid')
        .evaluate((el) =>
          window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top, behavior: 'instant' }),
        );
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/${key}-${width}-grid.png` });
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(`Overflow: ${key} ${width}`);
  }
}
writeFileSync('screenshots/static-landing/preview-links.json', JSON.stringify(links, null, 2));
console.log(
  JSON.stringify({ phase, captures: phase === 'after' ? 50 : 25, adminUnchanged: true, errors, links }),
);
await browser.close();
