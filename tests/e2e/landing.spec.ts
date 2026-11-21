import { expect, test } from '@playwright/test';
import { apiLogin, login, tokenOf, horizontalOverflow } from './helpers';
import type { GalleryResponse } from '../../shared/api';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});
// Galleries on the default style take the folio look; galleries the photographer styled keep their own.
for (const key of ['coast', 'archive']) {
  test(`folio ${key} landing leads with the selected cover and fills the sheet at five widths`, async ({
    page,
    request,
  }) => {
    await apiLogin(request);
    const token = await tokenOf(request, `col_demo_${key}`);
    const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
    for (const width of [1440, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
      await page.goto(`/g/${token}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // No banner hero, no decorative slogan, no empty left column: the sheet starts under a compact header.
      await expect(page.getByTestId('featured-hero')).toHaveCount(0);
      await expect(page.getByText('A private photographic edition')).toHaveCount(0);
      const first = page.locator('[data-testid="photo-grid"] .g-tile').first();
      await expect(first).toHaveAttribute('data-photo-id', data.collection.coverPhotoId!);
      const box = await first.boundingBox();
      expect(box!.y).toBeLessThan(width >= 1100 ? 120 : 300);
      const ar = data.collection.cover!.w / data.collection.cover!.h;
      expect(Math.abs(box!.width / box!.height - ar)).toBeLessThan(0.02);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // Every tile is a distinct record.
      const ids = await page.locator('.g-tile').evaluateAll((els) => els.map((e) => e.getAttribute('data-photo-id')));
      expect(new Set(ids).size).toBe(ids.length);
      if (key === 'archive') {
        await page
          .getByTestId('photo-grid')
          .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.mouse.wheel(0, 9000);
        await expect.poll(() => page.locator('.g-tile').count()).toBeGreaterThan(0);
        expect(await page.locator('.g-tile').count()).toBeLessThan(160);
      }
    }
  });
}

test('live editor preview renders the folio sheet and retains its inspector', async ({ page }) => {
  await login(page);
  await page.goto('/admin/collections/col_demo_coast/design');
  const frame = page.getByTestId('preview-frame');
  await expect(frame.locator('.g-folio')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Design inspector' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto Arrange', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Mobile/ }).click();
  await expect.poll(async () => (await frame.boundingBox())!.width).toBe(390);
  const grid = await frame.getByTestId('photo-grid').boundingBox();
  const title = await frame.locator('h1').boundingBox();
  expect(grid!.y).toBeGreaterThan(title!.y);
});
