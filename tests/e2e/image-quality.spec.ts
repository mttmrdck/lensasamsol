import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_STYLE } from '../../shared/style';
import { previewDimensions, type ImageVariant } from '../../shared/image-variants';

const token = 'SyntheticGalleryToken00001';
const photos = Array.from({ length: 1200 }, (_, i) => ({
  id: `synthetic_${i}`,
  w: i % 2 ? 6000 : 4000,
  h: i % 2 ? 4000 : 6000,
  dimsKnown: true,
  featured: false,
  featuredOrder: null,
  filename: `Synthetic ${i}.png`,
  driveUrl: null,
  credit: null,
}));

async function mockGallery(page: Page, failHigh = false, failAll = false, coverIndex = 0) {
  await page.addInitScript(() => {
    (window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true;
  });
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: '' }),
  );
  const requests: string[] = [];
  const cache = new Map<string, Buffer>();
  // Raster bytes have their true declared dimensions; no real/private image or external source is used.
  for (const p of photos.slice(0, 2)) {
    for (const variant of ['s', 'm', 'l', 'xl'] as const) {
      const { width, height } = previewDimensions(p.w, p.h, variant);
      const key = `${width}x${height}`;
      if (!cache.has(key)) {
        const data = await page.evaluate(
          ({ width, height }) => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#536878';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#e8dfcd';
            for (let y = 0; y < height; y += 12)
              for (let x = 0; x < width; x += 12) if ((x + y) % 24 === 0) ctx.fillRect(x, y, 6, 6);
            ctx.strokeStyle = '#141414';
            ctx.lineWidth = 1;
            for (let x = 0; x < width; x += 48) {
              ctx.beginPath();
              ctx.moveTo(x, 0);
              ctx.lineTo(width - x, height);
              ctx.stroke();
            }
            return canvas.toDataURL('image/png').split(',')[1];
          },
          { width, height },
        );
        cache.set(key, Buffer.from(data, 'base64'));
      }
    }
  }
  await page.route('**/api/public/g/**', (route) =>
    route.fulfill({
      json: {
        studio: { name: 'Synthetic Studio', intro: null, contactUrl: null, contactLabel: null },
        demoMode: false,
        preview: false,
        collection: {
          id: 'synthetic',
          title: 'Synthetic photographs',
          description: null,
          eventDate: null,
          location: null,
          source: 'drive',
          coverPhotoId: photos[coverIndex].id,
          cover: photos[coverIndex],
          photoCount: photos.length,
          folderUrl: null,
          folderAccess: 'unknown',
          style: DEFAULT_STYLE,
        },
        photos,
      },
    }),
  );
  await page.route('**/img/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const match = path.match(/synthetic_(\d+)\/(s|m|l|xl)$/);
    if (!match) return route.abort();
    const [, idx, variant] = match;
    if (failAll || (failHigh && variant !== 's')) return route.fulfill({ status: 503, body: 'Unavailable' });
    const p = photos[Number(idx)];
    const { width, height } = previewDimensions(p.w, p.h, variant as ImageVariant);
    if (variant !== 's') await new Promise((resolve) => setTimeout(resolve, 120));
    return route.fulfill({ contentType: 'image/png', body: cache.get(`${width}x${height}`)! });
  });
  return requests;
}

for (const device of [
  { name: 'desktop', width: 1440, height: 900, dpr: 1 },
  { name: 'retina', width: 1440, height: 900, dpr: 2 },
  { name: 'mobile', width: 390, height: 844, dpr: 3 },
]) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: device.dpr,
      reducedMotion: 'reduce',
    });
    test('portrait and landscape hero selects detail for its measured slot', async ({ page }) => {
      const measurements = [];
      for (const coverIndex of [0, 1]) {
        await page.unrouteAll({ behavior: 'wait' });
        await mockGallery(page, false, false, coverIndex);
        await page.goto(`/g/${token}`);
        const image = page.locator('.g-hero-img');
        await expect
          .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
          .toBe(true);
        const measured = await image.evaluate((img: HTMLImageElement) => ({
          currentSrc: img.currentSrc,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: img.getBoundingClientRect().width,
          height: img.getBoundingClientRect().height,
          sizes: img.sizes,
        }));
        const variant = measured.currentSrc.split('/').at(-1) as ImageVariant;
        const raw = previewDimensions(photos[coverIndex].w, photos[coverIndex].h, variant);
        expect(
          Math.abs(measured.width / measured.height - photos[coverIndex].w / photos[coverIndex].h),
        ).toBeLessThan(0.01);
        expect(raw.width).toBeGreaterThanOrEqual(
          Math.min(
            measured.width * device.dpr,
            previewDimensions(photos[coverIndex].w, photos[coverIndex].h, 'xl').width,
          ) - 2,
        );
        expect(Math.abs(parseFloat(measured.sizes) - measured.width)).toBeLessThan(2);
        measurements.push({ device, orientation: coverIndex ? 'landscape' : 'portrait', ...measured, raw });
      }
      mkdirSync('.wrangler/image-quality-evidence', { recursive: true });
      writeFileSync(
        `.wrangler/image-quality-evidence/${test.info().project.name}-${device.name}-hero.json`,
        JSON.stringify(measurements, null, 2),
      );
    });
    test('portrait and landscape fill their available contain bounds with sharp derivatives', async ({
      page,
    }) => {
      const requests = await mockGallery(page);
      await page.goto(`/g/${token}?photo=synthetic_0`);
      const viewer = page.getByTestId('lightbox');
      const image = viewer.locator('img[alt^="Photograph"]');
      const measurements = [];
      for (let i = 0; i < 2; i++) {
        await expect(image).toHaveAttribute('alt', `Photograph ${i + 1} of 1200`);
        await expect
          .poll(() =>
            image.evaluate(
              (img: HTMLImageElement) =>
                img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0,
            ),
          )
          .toBe(true);
        await expect(image).toHaveCSS('opacity', '1');
        // Cached adjacent decodes can complete before the replacement image's first layout.
        await expect
          .poll(() =>
            image.evaluate((img) => {
              const r = img.getBoundingClientRect();
              return r.width / r.height;
            }),
          )
          .toBeCloseTo(photos[i].w / photos[i].h, 2);
        const measured = await image.evaluate((img: HTMLImageElement) => {
          const r = img.getBoundingClientRect();
          const b = document.querySelector('.g-lb-bounds')!.getBoundingClientRect();
          return {
            alt: img.alt,
            src: img.currentSrc,
            parent: img.parentElement?.getAttribute('style'),
            width: r.width,
            height: r.height,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            bw: b.width,
            bh: b.height,
            top: r.top,
            bottom: r.bottom,
            bt: b.top,
            bb: b.bottom,
          };
        });
        measurements.push({ device, orientation: i ? 'landscape' : 'portrait', ...measured });
        mkdirSync('.wrangler/image-quality-evidence', { recursive: true });
        writeFileSync(
          `.wrangler/image-quality-evidence/${test.info().project.name}-${device.name}-debug.json`,
          JSON.stringify(measurements, null, 2),
        );
        const p = photos[i];
        expect(Math.abs(measured.width / measured.height - p.w / p.h)).toBeLessThan(0.01);
        expect(Math.max(measured.width / measured.bw, measured.height / measured.bh)).toBeCloseTo(1, 2);
        expect(measured.top).toBeGreaterThanOrEqual(measured.bt - 1);
        expect(measured.bottom).toBeLessThanOrEqual(measured.bb + 1);
        expect(Math.max(measured.naturalWidth, measured.naturalHeight)).toBeGreaterThanOrEqual(
          Math.min(Math.max(measured.width, measured.height) * device.dpr, 2560) - 2,
        );
        if (i === 0) await page.keyboard.press('ArrowRight');
      }
      mkdirSync('.wrangler/image-quality-evidence', { recursive: true });
      writeFileSync(
        `.wrangler/image-quality-evidence/${test.info().project.name}-${device.name}.json`,
        JSON.stringify(measurements, null, 2),
      );
      await page.screenshot({
        path: `.wrangler/image-quality-evidence/${test.info().project.name}-${device.name}.png`,
      });
      await expect(viewer).toContainText('0002 / 1200');
      // Only current and neighboring high tiers, with a small filmstrip window.
      expect(requests.every((p) => /\/(s|m|l|xl)$/.test(p))).toBe(true);
      expect(await viewer.locator('.g-filmstrip img').count()).toBeLessThanOrEqual(13);
      await page.waitForLoadState('networkidle');
      requests.length = 0;
      await page.keyboard.press('End');
      await expect(image).toHaveAttribute('alt', 'Photograph 1200 of 1200');
      await expect(image).toHaveCSS('opacity', '1');
      const prefetched = requests.filter((p) => !p.endsWith('/s')).map((p) => p.split('/').at(-2));
      expect(prefetched.every((id) => id === 'synthetic_1198' || id === 'synthetic_1199')).toBe(true);
      expect(new Set(prefetched).size).toBeLessThanOrEqual(2);
      await page.keyboard.press('Escape');
      await expect(viewer).toBeHidden();
      await page.getByTestId('photo-grid').scrollIntoViewIfNeeded();
      expect(await page.locator('.g-tile').count()).toBeLessThan(160);
      await expect(page.locator('.g-tile img').first()).toHaveAttribute('loading', 'lazy');
    });
  });
}

test('a failed large preview retains its loaded small preview and usable navigation', async ({ page }) => {
  await mockGallery(page, true);
  await page.goto(`/g/${token}?photo=synthetic_0`);
  await expect(page.getByTestId('lightbox')).toContainText('Showing a smaller preview.');
  await expect(page.locator('.g-lb-img[aria-hidden]')).toHaveCSS('opacity', '1');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lightbox')).toContainText('0002 / 1200');
});

test('all failed previews provide a readable fallback', async ({ page }) => {
  await mockGallery(page, false, true);
  await page.goto(`/g/${token}?photo=synthetic_0`);
  await expect(page.getByTestId('lightbox')).toContainText('This preview couldn’t be loaded.');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lightbox')).toBeHidden();
});

test.describe('responsive preview upgrade', () => {
  test.use({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  test('retains its small preview when a larger responsive derivative fails', async ({ page }) => {
    await mockGallery(page);
    await page.goto(`/g/${token}?photo=synthetic_1`);
    const viewer = page.getByTestId('lightbox');
    const high = viewer.locator('img[alt^="Photograph"]');
    const low = viewer.locator('img[aria-hidden="true"]');
    await expect(high).toHaveAttribute('src', /\/m$/);
    await expect(high).toHaveCSS('opacity', '1');
    await expect
      .poll(() => low.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await page.route('**/img/**/xl', (route) =>
      route.fulfill({ status: 503, body: 'Synthetic upgrade unavailable' }),
    );
    await page.setViewportSize({ width: 2400, height: 1400 });
    await expect(high).toHaveAttribute('src', /\/xl$/);
    await expect(viewer).toContainText('Showing a smaller preview.');
    await expect(low).toHaveCSS('opacity', '1');
    await expect(high).toHaveCSS('opacity', '0');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
  });
});
