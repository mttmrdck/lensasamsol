import { expect, test } from '@playwright/test';
import { adminJson, apiLogin, login, tokenOf } from './helpers';
import type { AdminCollectionDetail } from '../../shared/api';

/** These suites test the gallery itself; the iris entrance has its own suite (intro.spec.ts). */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});

test.describe('admin', () => {
  test('editor preview renders the folio sheet with the selected cover leading', async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ contentType: 'text/css', body: '' }),
    );
    await login(page);
    await page.goto('/admin/collections/col_demo_coast/design');
    await expect(page.locator('.g-folio')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const first = page.locator('[data-testid="photo-grid"] .g-tile img').first();
    await expect(first).toHaveAttribute('src', /\/img\//);
    await expect
      .poll(() => first.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  });

  test('editor lightbox remains inside its smaller mobile preview frame', async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ contentType: 'text/css', body: '' }),
    );
    await login(page);
    await page.goto('/admin/collections/col_demo_coast/design');
    await page.getByRole('radio', { name: /Mobile/ }).click();
    const frame = page.getByTestId('preview-frame');
    await expect.poll(async () => (await frame.boundingBox())?.width).toBe(390);
    await frame.locator('.g-tile-link').first().click();
    const viewer = frame.getByTestId('lightbox');
    await expect(viewer).toBeVisible();
    const f = (await frame.boundingBox())!;
    const v = (await viewer.boundingBox())!;
    expect(v.y).toBeGreaterThanOrEqual(f.y - 1);
    expect(v.y + v.height).toBeLessThanOrEqual(f.y + f.height + 1);
    await expect(viewer.getByRole('button', { name: /filmstrip/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
  });

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

  test('cards open a menu with Manage photos, Customize design and Copy client link', async ({ page }) => {
    await login(page);
    await page.goto('/admin/collections');
    await expect(page.getByRole('heading', { name: 'Collections', level: 1 })).toBeVisible();
    const card = page.locator('article').filter({ hasText: 'Hana Rahman' });
    await card.getByRole('button', { name: /Actions for/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Manage photos' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Customize design' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy client link' })).toBeEnabled();
    await page.keyboard.press('Escape');
    // Drafts can't hand out a link that doesn't open.
    await page
      .locator('article')
      .filter({ hasText: 'Mei Chen' })
      .getByRole('button', { name: /Actions for/ })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Copy client link' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
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

test('mobile studio menu traps focus and restores it on Escape', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await page.getByRole('button', {name:'Open menu'}).click();
  const menu=page.getByRole('dialog', {name:'Menu',exact:true});
  await expect(menu).toBeVisible();
  for(let i=0;i<15;i++) {
    await page.keyboard.press('Tab');
    expect(await menu.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Open menu'})).toBeFocused();
});

test('resizing an open mobile menu to desktop releases the workspace', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await login(page);
  await page.getByRole('button', {name:'Open menu'}).click();
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('dialog', {name:'Menu',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
  await page.getByRole('link', {name:'Create Client Gallery',exact:true}).click();
  await expect(page).toHaveURL(/collections\/new/);
});

test('publishing waits for an in-flight photo selection change', async ({ page, request }) => {
  await apiLogin(request);
  const id='col_demo_lights';
  const original=await adminJson<AdminCollectionDetail>(request,'GET',`/api/admin/collections/${id}`);
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve});
  await page.route(`**/api/admin/collections/${id}/photos/*`,async route=>{
    if(route.request().method()==='PATCH') await pending;
    await route.continue();
  });
  try {
    await login(page);await page.goto(`/admin/collections/${id}`);
    await page.locator('li[data-assigned="true"] > button[aria-pressed="true"]').first().click();
    await expect(page.getByRole('button',{name:'Publish',exact:true})).toBeDisabled({timeout:1000});
    release();
    await expect(page.getByRole('button',{name:'Publish',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Publish',exact:true}).click();
    await expect(page.getByRole('alertdialog')).toContainText(`${original.photos.filter(p=>p.assigned).length-1} assigned photographs`);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
  } finally {
    release();await page.unrouteAll({behavior:'wait'});
    await adminJson(request,'POST',`/api/admin/collections/${id}/photos/bulk`,{ids:original.photos.filter(p=>p.assigned).map(p=>p.id),assigned:true});
  }
});
