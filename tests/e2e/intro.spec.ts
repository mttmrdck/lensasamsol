import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiLogin, horizontalOverflow, login, tokenOf } from './helpers';

/** Client-gallery camera-iris entrance: when it plays, what it reveals, and when it must never appear. */

const tokens: Record<string, string> = {};
async function link(request: APIRequestContext, id: string) {
  if (!tokens[id]) {
    await apiLogin(request);
    tokens[id] = await tokenOf(request, id);
  }
  return `/g/${tokens[id]}`;
}
const entrance = (page: Page) => page.getByTestId('client-entrance');

/** Records whether the entrance overlay ever mounts from now on. */
async function watchForEntrance(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __introSeen: boolean };
    w.__introSeen = !!document.querySelector('[data-testid="client-entrance"]');
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="client-entrance"]')) w.__introSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const introSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __introSeen: boolean }).__introSeen);

test.describe('client gallery entrance', () => {
  test('1, 2, 18: a direct link plays the iris over the real gallery, then hands over cleanly', async ({
    page,
    request,
  }) => {
    const url = await link(request, 'col_demo_coast');
    const cover = (await (await request.get(`/api/public${url}`)).json()).collection.cover.id;
    await page.goto(url);
    await expect(entrance(page)).toBeAttached();
    await expect(page.getByTestId('iris-intro')).toBeAttached();
    // The real gallery is rendered underneath — the hero image IS this gallery's cover, not a stand-in.
    await expect(page.locator('.g-root[data-mode="public"] .g-hero-img')).toHaveAttribute(
      'src',
      new RegExp(`/img/t/[^/]+/${cover}/l$`),
    );
    await expect(page.locator('.g-root[data-entrance]')).toBeAttached();
    await expect(entrance(page)).not.toBeAttached({ timeout: 6000 });
    await expect(page.locator('.g-root')).toHaveAttribute('data-entrance', 'reveal');
    await expect(page.locator('.g-hero-text').first()).toHaveCSS('opacity', '1', { timeout: 3000 });
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
    // Keyboard reaches the gallery straight away (nothing left inert).
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.g-root'))).toBe(true);
  });

  test('20: each client gallery reveals its own cover', async ({ browser, request }) => {
    for (const id of ['col_demo_night', 'col_demo_portraits']) {
      const url = await link(request, id);
      const cover = (await (await request.get(`/api/public${url}`)).json()).collection.cover.id;
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(entrance(page)).toBeAttached();
      await expect(page.locator('.g-hero-img')).toHaveAttribute('src', new RegExp(`/${cover}/l$`));
      await ctx.close();
    }
  });

  test('3–5: no replay on reload, photo navigation or Back', async ({ page, request }) => {
    const url = await link(request, 'col_demo_city');
    await page.goto(url);
    await expect(entrance(page)).not.toBeAttached({ timeout: 6000 });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await watchForEntrance(page);
    await page
      .getByTestId('photo-grid')
      .evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.locator('.g-tile-link[data-tile-index="0"]').click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.goBack();
    await expect(page.getByTestId('lightbox')).toBeHidden();
    await page.waitForTimeout(300);
    expect(await introSeen(page)).toBe(false);
  });

  test('6: a ?photo= deep link opens the photo directly, with no intro', async ({ page, request }) => {
    const url = await link(request, 'col_demo_coast');
    const photo = (await (await request.get(`/api/public${url}`)).json()).photos[3].id;
    await page.goto(`${url}?photo=${photo}`);
    await expect(page.getByTestId('lightbox')).toContainText('04 /');
    await expect(entrance(page)).toHaveCount(0);
  });

  test('7: Skip intro reveals the gallery at once', async ({ page, request }) => {
    await page.addInitScript(
      () => ((window as unknown as { __LSG_INTRO_SPEED__: number }).__LSG_INTRO_SPEED__ = 0.05),
    );
    await page.goto(await link(request, 'col_demo_coast'));
    const skip = page.getByRole('button', { name: 'Skip intro' });
    await expect(skip).toBeVisible();
    await skip.click();
    await expect(entrance(page)).not.toBeAttached({ timeout: 1500 });
    await expect(page.locator('.g-hero-text').first()).toHaveCSS('opacity', '1', { timeout: 2000 });
  });

  test('8: reduced motion goes straight to the gallery', async ({ browser, request }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(await link(request, 'col_demo_coast'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(entrance(page)).toHaveCount(0);
    await ctx.close();
  });

  test('9: invalid or revoked links show Not Found, never the iris', async ({ page }) => {
    await page.goto('/g/thisLinkDoesNotExist0000001');
    await expect(page.getByRole('heading', { name: 'Gallery unavailable' })).toBeVisible();
    await expect(page.getByTestId('iris-intro')).toHaveCount(0);
    await expect(entrance(page)).toHaveCount(0);
  });

  test('10–13: never on the homepage, login, admin, editor or client preview', async ({ page }) => {
    await page.goto('/');
    await watchForEntrance(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await introSeen(page)).toBe(false);
    for (const path of ['/admin/login']) {
      await page.goto(path);
      await page.waitForTimeout(400);
      await expect(entrance(page)).toHaveCount(0);
    }
    await login(page);
    for (const path of [
      '/admin',
      '/admin/collections',
      '/admin/collections/col_demo_coast',
      '/admin/collections/col_demo_coast/design',
      '/admin/collections/col_demo_coast/preview',
      '/admin/settings',
    ]) {
      await page.goto(path);
      await page.waitForTimeout(500);
      await expect(entrance(page), path).toHaveCount(0);
      await expect(page.locator('[data-entrance]'), path).toHaveCount(0);
    }
  });

  test('14: a slow cover never traps the visitor', async ({ page, request }) => {
    await page.route('**/img/t/**', async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue().catch(() => {});
    });
    const start = Date.now();
    await page.goto(await link(request, 'col_demo_coast'));
    await expect(entrance(page)).not.toBeAttached({ timeout: 4000 });
    expect(Date.now() - start).toBeLessThan(4500);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('15: a failed cover falls back to the gallery', async ({ page, request }) => {
    await page.route('**/img/t/**', (route) => route.abort());
    await page.goto(await link(request, 'col_demo_coast'));
    await expect(entrance(page)).not.toBeAttached({ timeout: 2500 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('16: leaving mid-intro cleans up (overlay gone, scrolling restored)', async ({ page, request }) => {
    await page.addInitScript(
      () => ((window as unknown as { __LSG_INTRO_SPEED__: number }).__LSG_INTRO_SPEED__ = 0.05),
    );
    await page.goto(await link(request, 'col_demo_coast'));
    await expect(entrance(page)).toHaveAttribute('data-state', 'opening');
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
    await page.evaluate(() => {
      history.pushState({}, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { level: 1, name: 'lensasamsol' })).toBeVisible();
    await expect(entrance(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  for (const [w, h] of [
    [390, 844],
    [360, 780],
  ]) {
    test(`17: no horizontal overflow during and after the intro at ${w}px`, async ({ browser, request }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        isMobile: true,
        hasTouch: true,
      });
      await ctx.addInitScript(
        () => ((window as unknown as { __LSG_INTRO_SPEED__: number }).__LSG_INTRO_SPEED__ = 0.25),
      );
      const page = await ctx.newPage();
      await page.goto(await link(request, 'col_demo_portraits'));
      await expect(entrance(page)).toHaveAttribute('data-state', 'opening');
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expect(entrance(page)).not.toBeAttached({ timeout: 10000 });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
});
