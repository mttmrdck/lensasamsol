import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { apiLogin, adminJson, login, tokenOf, horizontalOverflow } from './helpers';
import { arrangeStyle, TEMPLATES } from '../../shared/composition';
import { DEFAULT_STYLE, type StyleConfig } from '../../shared/style';
import type { GalleryResponse, AdminCollectionDetail } from '../../shared/api';

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});

test('composition draft keeps text and cover private until published; undo and manual choices work', async ({
  page,
  request,
}) => {
  await apiLogin(request);
  const id = 'col_demo_coast',
    token = await tokenOf(request, id);
  const before = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
  const detail = await adminJson<AdminCollectionDetail>(request, 'GET', `/api/admin/collections/${id}`);
  try {
    await login(page);
    await page.goto(`/admin/collections/${id}/design`);
    await page.getByRole('button', { name: 'Auto Arrange', exact: true }).click();
    await page.getByRole('button', { name: 'Portrait Story', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Portrait Story', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByLabel('Gallery title override').fill('A Private Monograph');
    await page.getByLabel('Gallery subtitle', { exact: true }).fill('An afternoon by the water');
    const selected = before.photos[2].id;
    await page.getByLabel('Highlighted photograph', { exact: true }).selectOption(selected);
    await expect(page.locator('.g-hero-img')).toHaveAttribute('src', new RegExp(`/${selected}/l$`));
    await page.getByRole('button', { name: 'Undo (Cmd+Z)', exact: true }).click();
    await expect(page.locator('.g-hero-img')).toHaveAttribute(
      'src',
      new RegExp(`/${before.collection.coverPhotoId}/l$`),
    );
    await page.getByRole('button', { name: 'Redo (Shift+Cmd+Z)', exact: true }).click();
    await expect(page.locator('.g-hero-img')).toHaveAttribute('src', new RegExp(`/${selected}/l$`));
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByText('Draft saved, not published')).toBeVisible();
    let live = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
    expect(live.collection.title).toBe(before.collection.title);
    expect(live.collection.coverPhotoId).toBe(before.collection.coverPhotoId);
    await page.reload();
    await expect(page.getByLabel('Gallery subtitle', { exact: true })).toHaveValue(
      'An afternoon by the water',
    );
    await expect(page.getByRole('button', { name: 'Portrait Story', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
    await expect(page.getByText('Live design')).toBeVisible();
    live = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
    expect(live.collection.title).toBe('A Private Monograph');
    expect(live.collection.coverPhotoId).toBe(selected);
    expect(live.collection.style.composition?.template).toBe('portrait-story');
    await page.goto(`/g/${token}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('A Private Monograph');
    await expect(page.getByText('An afternoon by the water')).toBeVisible();
  } finally {
    await adminJson(request, 'POST', `/api/admin/collections/${id}/style/publish`, {
      style: before.collection.style,
    });
    await adminJson(request, 'PUT', `/api/admin/collections/${id}/style`, { style: detail.styleDraft });
  }
});

test('foreign covers are rejected; studio defaults remove client content; legacy JSON retains its mode', async ({
  request,
}) => {
  await apiLogin(request);
  const own = await adminJson<AdminCollectionDetail>(request, 'GET', '/api/admin/collections/col_demo_coast');
  const foreign = await adminJson<AdminCollectionDetail>(
    request,
    'GET',
    '/api/admin/collections/col_demo_city',
  );
  const style: StyleConfig = {
    ...own.styleDraft,
    composition: { template: 'editorial-signature', coverId: foreign.photos[0].id },
  };
  for (const [method, path] of [
    ['PUT', 'style'],
    ['POST', 'style/publish'],
  ]) {
    const res = await request.fetch(`/api/admin/collections/${own.id}/${path}`, {
      method,
      data: { style },
      headers: { 'x-archive-csrf': '1', origin: 'http://localhost:5190' },
    });
    expect(res.status()).toBe(422);
  }
  const settings = await adminJson<{ defaultStyle: StyleConfig }>(request, 'GET', '/api/admin/settings');
  try {
    await adminJson(request, 'PUT', '/api/admin/settings/default-style', {
      style: {
        ...style,
        composition: {
          ...style.composition,
          title: 'PRIVATE CLIENT',
          subtitle: 'PRIVATE SUBTITLE',
          description: 'PRIVATE DESCRIPTION',
        },
      },
    });
    const saved = await adminJson<{ defaultStyle: StyleConfig }>(request, 'GET', '/api/admin/settings');
    expect(saved.defaultStyle.composition).toEqual({ template: 'editorial-signature' });
  } finally {
    await adminJson(request, 'PUT', '/api/admin/settings/default-style', { style: settings.defaultStyle });
  }
});

for (const [index, t] of TEMPLATES.entries()) {
  test(`${t.name}: real photos, five viewport screenshots and natural hero`, async ({ page, request }) => {
    await apiLogin(request);
    const ids = [
      'col_demo_coast',
      'col_demo_archive',
      'col_demo_portraits',
      'col_demo_highlands',
      'col_demo_night',
    ];
    const id = ids[index],
      token = await tokenOf(request, id);
    const before = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
    const detail = await adminJson<AdminCollectionDetail>(request, 'GET', `/api/admin/collections/${id}`);
    const style = arrangeStyle(
      {
        ...before.collection.style,
        cover: { ...before.collection.style.cover, style: 'featured-below' },
        sequence: { enabled: false, heading: 'Selected moments' },
      },
      before.photos,
      before.collection.coverPhotoId,
      t.id,
    );
    style.composition = { ...style.composition!, subtitle: 'Photographs, thoughtfully kept' };
    try {
      await adminJson(request, 'POST', `/api/admin/collections/${id}/style/publish`, { style });
      mkdirSync('screenshots/composition', { recursive: true });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      for (const width of [1440, 1024, 768, 390, 360]) {
        await page.setViewportSize({ width, height: width < 640 ? 844 : 1000 });
        await page.goto(`/g/${token}`);
        const hero = page.getByTestId('featured-hero');
        await expect(hero).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(hero.locator('img')).toHaveCSS('object-fit', 'contain');
        const image = await hero.locator('img').boundingBox(),
          title = await hero.locator('h1').boundingBox();
        expect(title!.y).toBeGreaterThanOrEqual(image!.y + image!.height);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `screenshots/composition/${t.id}-${width}-hero.png` });
        await page.getByTestId('photo-grid').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `screenshots/composition/${t.id}-${width}-grid.png` });
        if (id === 'col_demo_archive') {
          await page.mouse.wheel(0, 8000);
          await page.waitForTimeout(250);
          const count = await page.locator('[data-testid="photo-grid"] .g-tile').count();
          expect(count).toBeGreaterThan(0);
          expect(count).toBeLessThan(160);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await adminJson(request, 'POST', `/api/admin/collections/${id}/style/publish`, {
        style: before.collection.style,
      });
      await adminJson(request, 'PUT', `/api/admin/collections/${id}/style`, { style: detail.styleDraft });
    }
  });
}

test('one photo with unknown dimensions renders stable geometry and viewer', async ({ page, request }) => {
  await apiLogin(request);
  const token = await tokenOf(request, 'col_demo_coast');
  const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
  const photo = { ...data.photos[0], w: 0, h: 0, dimsKnown: false, featured: false };
  const style = { ...DEFAULT_STYLE, sequence: { enabled: false, heading: 'Selected moments' } };
  await page.route(`**/api/public/g/${token}`, (route) =>
    route.fulfill({
      json: {
        ...data,
        photos: [photo],
        collection: {
          ...data.collection,
          photoCount: 1,
          coverPhotoId: photo.id,
          cover: { id: photo.id, w: 0, h: 0 },
          style,
        },
      },
    }),
  );
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/g/${token}`);
  await expect(page.getByTestId('featured-hero')).toBeVisible();
  await page.getByTestId('photo-grid').scrollIntoViewIfNeeded();
  await page.locator('.g-tile-link').click();
  await expect(page.getByTestId('lightbox')).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('clearing saved introduction overrides previews original metadata; legacy layout preserves content', async ({
  page,
  request,
}) => {
  await apiLogin(request);
  const id = 'col_demo_coast';
  const before = await adminJson<AdminCollectionDetail>(request, 'GET', `/api/admin/collections/${id}`);
  const cover = before.photos.filter((p) => p.assigned)[2].id;
  try {
    const style = {
      ...before.styleDraft,
      composition: {
        template: 'editorial-signature',
        coverId: cover,
        title: 'Saved draft title',
        subtitle: 'Keep this subtitle',
        description: 'Saved draft description',
      },
    };
    await adminJson(request, 'PUT', `/api/admin/collections/${id}/style`, { style });
    await login(page);
    await page.goto(`/admin/collections/${id}/design`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saved draft title');
    await page.getByLabel('Gallery title override').fill('');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(before.title);
    await page.getByLabel('Gallery description override').fill('');
    await expect(page.getByText(before.description!, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Layout', exact: true }).click();
    await page.getByRole('radio', { name: 'Columns', exact: true }).click();
    await expect(page.getByLabel('Gallery subtitle', { exact: true })).toHaveValue('Keep this subtitle');
    await expect(page.locator('.g-hero-img')).toHaveAttribute('src', new RegExp(`/${cover}/l$`));
    await page.getByLabel('Highlighted photograph', { exact: true }).selectOption('');
    await expect(page.getByLabel('Highlighted photograph', { exact: true })).toHaveValue('');
    await expect(page.locator('.g-hero-img')).not.toHaveAttribute('src', new RegExp(`/${cover}/l$`));
  } finally {
    await adminJson(request, 'PUT', `/api/admin/collections/${id}/style`, { style: before.styleDraft });
  }
});

test('browser benchmark records actual 1,200-photo geometry timings and virtualized DOM', async ({
  page,
  request,
}) => {
  await apiLogin(request);
  const token = await tokenOf(request, 'col_demo_archive');
  const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
  await page.goto(`/g/${token}`);
  const timings = await page.evaluate(
    async ({ photos, style }) => {
      const path = '/shared/composition.ts';
      const { TEMPLATES, arrangeStyle, compositionLayout } = await import(path);
      const results = [];
      for (const t of TEMPLATES)
        for (const width of [336, 358, 720, 976, 1344]) {
          const config = arrangeStyle(style, photos, null, t.id);
          for (let i = 0; i < 10; i++) compositionLayout(photos, width, config);
          const times = [];
          for (let i = 0; i < 50; i++) {
            const start = performance.now();
            compositionLayout(photos, width, config);
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          results.push({ template: t.id, width, medianMs: times[25], p95Ms: times[47] });
        }
      return results;
    },
    { photos: data.photos, style: data.collection.style },
  );
  for (const r of timings) expect(r.p95Ms).toBeLessThan(50); // broad regression guard; 10 ms is a measured target.
  await page.getByTestId('photo-grid').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 10000);
  await expect.poll(() => page.locator('[data-testid="photo-grid"] .g-tile').count()).toBeGreaterThan(0);
  const mounted = await page.locator('[data-testid="photo-grid"] .g-tile').count();
  expect(mounted).toBeLessThan(160);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    'test-results/composition-browser-benchmark.json',
    JSON.stringify({ photoCount: data.photos.length, mounted, timings }, null, 2),
  );
});

test('closing a far-photo deep link restores the exact virtualized tile and keyboard focus', async ({
  page,
  request,
}) => {
  await apiLogin(request);
  const token = await tokenOf(request, 'col_demo_archive');
  const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
  const style = arrangeStyle(
    { ...data.collection.style, sequence: { enabled: false, heading: 'Selected moments' } },
    data.photos,
    data.collection.coverPhotoId,
    'cinematic-archive',
  );
  await page.route(`**/api/public/g/${token}`, (route) =>
    route.fulfill({ json: { ...data, collection: { ...data.collection, style } } }),
  );
  const target = 1100;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/g/${token}?photo=${data.photos[target].id}`);
  await expect(page.getByTestId('lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  const tile = page.locator(`[data-testid="photo-grid"] .g-tile-link[data-tile-index="${target}"]`);
  await expect(tile).toBeFocused();
  await expect(tile).toBeInViewport();
});

test('exact editorial spread renders real photographs with aligned uncropped edges', async ({
  page,
  request,
}) => {
  await apiLogin(request);
  const token = await tokenOf(request, 'col_demo_coast');
  const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
  const portrait = data.photos.find((p) => p.w / p.h < 0.92)!;
  const landscapes = data.photos.filter((p) => p.w / p.h > 1.08).slice(0, 2);
  const photos = [portrait, ...landscapes].map((p) => ({ ...p, featured: false }));
  const style = arrangeStyle(
    { ...DEFAULT_STYLE, sequence: { enabled: false, heading: 'Selected moments' } },
    photos,
    portrait.id,
    'editorial-signature',
  );
  // The wider exhibition gutters need the taller supported scale for this exact spread fixture.
  style.layout.rowHeight = 360;
  await page.route(`**/api/public/g/${token}`, (route) =>
    route.fulfill({
      json: {
        ...data,
        photos,
        collection: {
          ...data.collection,
          style,
          photoCount: 3,
          coverPhotoId: portrait.id,
          cover: { id: portrait.id, w: portrait.w, h: portrait.h },
        },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/g/${token}`);
  const grid = page.getByTestId('photo-grid');
  await grid.evaluate((el) =>
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 60, behavior: 'instant' }),
  );
  await expect(grid.locator('.g-tile')).toHaveCount(3);
  const boxes = await grid.locator('.g-tile').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  expect(Math.abs(boxes[0].h - (boxes[1].h + 12 + boxes[2].h))).toBeLessThan(0.1);
  expect(Math.abs(boxes[1].x - boxes[2].x)).toBeLessThan(0.1);
  for (let i = 0; i < boxes.length; i++)
    expect(Math.abs(boxes[i].w / boxes[i].h - photos[i].w / photos[i].h)).toBeLessThan(0.001);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/composition/editorial-signature-cluster-1440.png' });
});
