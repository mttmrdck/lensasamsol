import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, horizontalOverflow, tokenOf } from './helpers';

/** These suites test the gallery itself; the iris entrance has its own suite (intro.spec.ts). */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});

const tokens: Record<string, string> = {};
async function link(request: APIRequestContext, id: string) {
  if (!tokens[id]) {
    await apiLogin(request);
    tokens[id] = await tokenOf(request, id);
  }
  return `/g/${tokens[id]}`;
}

test.describe('client gallery experience', () => {
  test('static hero, direct gallery, viewer with keyboard, deep link and back button', async ({
    page,
    request,
  }) => {
    const url = await link(request, 'col_demo_coast');
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: 'Coastline, Late Summer' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Selected moments' })).toHaveCount(0);
    // Standalone: no links to a directory, the studio homepage or other galleries.
    expect(await page.locator('a[href="/"], a[href*="/g/"]').count()).toBe(0);
    await expect(page.getByText(/Anyone who has this link can view the gallery/)).toBeVisible();

    await page
      .getByTestId('photo-grid')
      .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await expect(page.locator('[data-testid="photo-grid"] .g-tile').first()).toBeAttached();
    const firstTile = page.locator('.g-tile-link[data-tile-index="0"]');
    await firstTile.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await firstTile.click();
    const viewer = page.getByTestId('lightbox');
    await expect(viewer).toBeVisible();
    await expect(page).toHaveURL(/\?photo=ph_/);
    await expect(viewer).toContainText('01 / 28');
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toContainText('02 / 28');
    const stepped = new URL(page.url()).searchParams.get('photo');

    await page.goBack();
    await expect(viewer).toBeHidden();
    await expect(page).not.toHaveURL(/photo=/);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(400);

    await page.goto(`${url}?photo=${stepped}`);
    await expect(page.getByTestId('lightbox')).toContainText('02 / 28');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('lightbox')).toBeHidden();
    await expect(page).not.toHaveURL(/photo=/);
  });

  test('viewer traps focus and labels the external handoff', async ({ page, request }) => {
    const url = await link(request, 'col_demo_city');
    const photo = (await (await request.get(`/api/public${url}`)).json()).photos[10].id;
    await page.goto(`${url}?photo=${photo}`);
    const viewer = page.getByTestId('lightbox');
    await expect(viewer).toHaveAttribute('aria-modal', 'true');
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="lightbox"]'))).toBe(
      true,
    );
    const handoff = viewer.getByRole('link', { name: /demo source/i });
    await expect(handoff).toHaveAttribute('target', '_blank');
    await expect(handoff).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('image route refuses malformed, unknown and retired requests', async ({ request }) => {
    const url = await link(request, 'col_demo_coast');
    const token = url.split('/g/')[1];
    const own = (await (await request.get(`/api/public${url}`)).json()).photos[0].id;
    expect((await request.get(`/img/t/${token}/${own}/m`)).status()).toBe(200);
    expect((await request.get(`/img/t/${token}/${own}/huge`)).status()).toBe(404);
    expect((await request.get(`/img/t/${token}/ph_doesnotexist00/m`)).status()).toBe(404);
    expect((await request.get(`/img/t/not-a-real-token-value-xx/${own}/m`)).status()).toBe(404);
    expect((await request.get(`/img/${own}/m`)).status()).toBe(404); // retired unscoped route
    const img = await request.get(`/img/t/${token}/${own}/m?w=99999`);
    expect(img.headers()['content-type']).toBe('image/webp'); // fixed variants only
    expect(img.headers()['cache-control']).toContain('private');
  });

  test('1,200-frame archive keeps the DOM small', async ({ page, request }) => {
    await page.goto(await link(request, 'col_demo_archive'));
    await page.locator('[data-testid="photo-grid"]').scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(400);
    const mounted = await page.locator('[data-testid="photo-grid"] .g-tile').count();
    expect(mounted).toBeGreaterThan(5);
    expect(mounted).toBeLessThan(160);
  });

  for (const [w, h] of [
    [390, 844],
    [360, 780],
  ]) {
    test(`16: no horizontal overflow at ${w}px`, async ({ browser, request }) => {
      const urls = [
        '/',
        await link(request, 'col_demo_coast'),
        await link(request, 'col_demo_portraits'),
        await link(request, 'col_demo_highlands'),
      ];
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        isMobile: true,
        hasTouch: true,
      });
      await ctx.addInitScript(
        () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
      );
      const page = await ctx.newPage();
      for (const path of urls) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
      }
      await page.goto(urls[1]);
      await page.locator('[data-testid="photo-grid"]').evaluate((el) => {
        window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 60, behavior: 'instant' });
      });
      const chip = page.locator('[data-testid="photo-grid"] .g-tile a.g-chip').first();
      await expect(chip).toBeInViewport();
      await expect(chip).toBeVisible();
      expect(Number(await chip.evaluate((el) => getComputedStyle(el.parentElement!).opacity))).toBe(1);
      await ctx.close();
    });
  }

  test('reduced motion: the gallery is directly scrollable', async ({ browser, request }) => {
    const url = await link(request, 'col_demo_city');
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(
      () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
    );
    const page = await ctx.newPage();
    await page.goto(url);
    await page
      .getByTestId('photo-grid')
      .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.waitForTimeout(60);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    await ctx.close();
  });
});
