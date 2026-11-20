import { expect, test } from '@playwright/test';
import { apiLogin, login, tokenOf, horizontalOverflow } from './helpers';
import type { GalleryResponse } from '../../shared/api';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});
for (const key of ['coast', 'portraits', 'highlands', 'night', 'archive']) {
  test(`static ${key} landing preserves selected cover and flows directly to the grid at five widths`, async ({
    page,
    request,
  }) => {
    await apiLogin(request);
    const token = await tokenOf(request, `col_demo_${key}`);
    const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
    for (const width of [1440, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
      await page.goto(`/g/${token}`);
      const hero = page.getByTestId('featured-hero');
      await expect(hero).toBeVisible();
      const image = hero.locator('img');
      await expect(image).toHaveAttribute('src', new RegExp(`/${data.collection.coverPhotoId}/l$`));
      await expect(image).toHaveCSS('object-fit', 'contain');
      await expect(page.locator('.g-hero-text')).toHaveCSS('transition-duration', '0s');
      await expect(page.locator('.g-hero-text')).toHaveCSS('transform', 'none');
      await expect(page.locator('.g-bar, .g-split, [data-testid="selected-grid"]')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /Selected moments|All photographs/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Explore the gallery' })).toHaveCount(0);
      const im = await image.boundingBox(),
        title = await hero.locator('h1').boundingBox(),
        hr = await hero.boundingBox();
      expect(title!.y).toBeGreaterThan(im!.y + im!.height);
      expect(Math.abs(title!.x - im!.x)).toBeLessThan(1);
      const ar = data.collection.cover!.w / data.collection.cover!.h;
      expect(Math.abs(im!.width / im!.height - ar)).toBeLessThan(0.002);
      const grid = await page.getByTestId('photo-grid').boundingBox();
      expect(grid!.y - hr!.y - hr!.height).toBeGreaterThanOrEqual(20);
      expect(grid!.y - hr!.y - hr!.height).toBeLessThanOrEqual(32);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
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

test('live editor preview uses the same static opening and retains its inspector', async ({ page }) => {
  await login(page);
  await page.goto('/admin/collections/col_demo_portraits/design');
  const frame = page.getByTestId('preview-frame');
  await expect(frame.getByTestId('featured-hero')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Design inspector' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto Arrange', exact: true })).toBeVisible();
  await expect(frame.locator('.g-bar, .g-split, [data-testid="selected-grid"]')).toHaveCount(0);
  await page.getByRole('radio', { name: /Mobile/ }).click();
  await expect.poll(async () => (await frame.boundingBox())!.width).toBe(390);
  const image = await frame.locator('.g-hero-img').boundingBox(),
    title = await frame.locator('h1').boundingBox();
  expect(title!.y).toBeGreaterThan(image!.y + image!.height);
  await expect(frame.locator('.g-hero-text')).toHaveCSS('transition-duration', '0s');
});
