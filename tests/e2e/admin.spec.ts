import { expect, test } from '@playwright/test';
import { apiLogin, login, tokenOf } from './helpers';

/** These suites test the gallery itself; the iris entrance has its own suite (intro.spec.ts). */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});

test.describe('admin', () => {
  test('admin routes are protected and login rejects a wrong password', async ({ page, request }) => {
    await page.goto('/admin/collections');
    await expect(page).toHaveURL(/\/admin\/login\?next=/);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That user ID or password is not correct.')).toBeVisible();
    expect((await request.get('/api/admin/collections')).status()).toBe(401);
    expect((await request.post('/api/admin/collections/col_demo_city/unpublish')).status()).toBe(403);
    expect(
      (
        await request.post('/api/admin/collections/col_demo_city/link', {
          headers: { 'x-archive-csrf': '1', origin: 'http://localhost:5190' },
        })
      ).status(),
    ).toBe(401);
    expect((await request.get('/img/a/ph_demo000001/s')).status()).toBe(404);
  });

  test('mutations require same-origin + CSRF header even with a session', async ({ page }) => {
    await login(page);
    const status = await page.evaluate(
      async () => (await fetch('/api/admin/collections/col_demo_city/link', { method: 'POST' })).status,
    );
    expect(status).toBe(403);
  });

  test('cards offer Manage Photos, Customize Design and Copy Client Link', async ({ page }) => {
    await login(page);
    await page.goto('/admin/collections');
    await expect(page.getByRole('heading', { name: 'Client Galleries' })).toBeVisible();
    const card = page.locator('article').filter({ hasText: 'Hana Rahman' });
    await expect(card.getByRole('link', { name: 'Manage Photos' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Customize Design' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Copy Client Link' })).toBeEnabled();
    // Drafts can't hand out a link that doesn't open.
    await expect(
      page
        .locator('article')
        .filter({ hasText: 'Mei Chen' })
        .getByRole('button', { name: 'Copy Client Link' }),
    ).toBeDisabled();
  });

  test('removing a photo from a client gallery removes it for that client', async ({ page, request }) => {
    await apiLogin(request);
    const token = await tokenOf(request, 'col_demo_portraits');
    const before = (await (await request.get(`/api/public/g/${token}`)).json()).photos.length;
    await login(page);
    await page.goto('/admin/collections/col_demo_portraits');
    const updated = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes('/photos/') && r.status() === 200,
    );
    await page.locator('li[data-assigned="true"] > button[aria-pressed="true"]').first().click();
    await updated;
    await expect(page.getByTestId('assign-summary')).toContainText(`${before - 1} assigned to this client`);
    const after = (await (await request.get(`/api/public/g/${token}`)).json()).photos.length;
    expect(after).toBe(before - 1);
  });

  test('client preview shows exactly the assigned photos', async ({ page }) => {
    await login(page);
    await page.goto('/admin/collections/col_demo_night/preview');
    await expect(page.getByRole('heading', { level: 1, name: 'Night Skies' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Owner preview controls' })).toContainText(
      'only their 7 assigned photos',
    );
  });

  test('editor: draft does not change the client gallery until published', async ({ page, request }) => {
    await apiLogin(request);
    const token = await tokenOf(request, 'col_demo_city');
    await login(page);
    await page.goto('/admin/collections/col_demo_city/design');
    await expect(page.getByTestId('preview-frame')).toBeVisible();
    await page.getByRole('tab', { name: 'Layout' }).click();
    await page.getByRole('radio', { name: 'Columns' }).click();
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved, not published')).toBeVisible();
    let live = await (await request.get(`/api/public/g/${token}`)).json();
    expect(live.collection.style.layout.mode).toBe('justified');

    await page.getByRole('button', { name: 'Publish changes' }).click();
    await expect(page.getByText('Live design')).toBeVisible();
    live = await (await request.get(`/api/public/g/${token}`)).json();
    expect(live.collection.style.layout.mode).toBe('masonry');
  });

  test('editor: folder button locked for shared folders; mobile preview + undo work', async ({ page }) => {
    await login(page);
    await page.goto('/admin/collections/col_demo_highlands/design');
    await page.getByRole('tab', { name: 'Colour' }).click();
    await expect(page.getByRole('switch', { name: /Whole-folder button/ })).toBeDisabled();
    await page.getByRole('radio', { name: /Mobile/ }).click();
    await expect.poll(async () => (await page.getByTestId('preview-frame').boundingBox())?.width).toBe(390);
    await page
      .getByRole('radiogroup', { name: 'Colour theme' })
      .getByRole('radio', { name: 'Darkroom' })
      .click();
    await expect(page.locator('[data-testid="preview-frame"] .g-root')).toHaveAttribute(
      'data-theme',
      'darkroom',
    );
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('[data-testid="preview-frame"] .g-root')).not.toHaveAttribute(
      'data-theme',
      'darkroom',
    );
  });
});
