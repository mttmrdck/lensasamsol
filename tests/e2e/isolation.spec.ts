import { expect, test } from '@playwright/test';
import { adminJson, apiLogin, detail, login, tokenOf } from './helpers';
import { DRIVE_FIXTURE_FILES, DRIVE_FIXTURE_TOKEN } from './global-setup';

/** These suites test the gallery itself; the iris entrance has its own suite (intro.spec.ts). */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    () => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true),
  );
});

/**
 * The product contract: one photographer, many client galleries, each reachable only through its own
 * link and showing only the photos assigned to it.
 */
test.describe.serial('client gallery isolation', () => {
  let idA = '';
  let idB = '';
  let tokenA = '';
  let tokenB = '';

  test('1–4, 13: create Gallery A in the UI, publish it, and copy its client link', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await login(page);
    await page.goto('/admin/collections/new');
    await page.getByRole('button', { name: 'Coastline' }).click();
    await expect(page.getByText('29 supported images found')).toBeVisible();
    await page.getByLabel('Client name').fill('E2E Client A');
    await page.getByLabel('Gallery title').fill('E2E Gallery A');
    await page.getByRole('radio', { name: /Every photo in this folder/ }).click();
    await page.getByRole('button', { name: 'Publish & Generate Link' }).click();
    await expect(page).toHaveURL(/\/admin\/collections\/col_/);
    idA = new URL(page.url()).pathname.split('/').pop()!;

    const linkField = page.getByTestId('client-link');
    await expect(linkField).toHaveValue(/\/g\/[A-Za-z0-9_-]{24}$/);
    const shown = await linkField.inputValue();
    await page.getByRole('button', { name: 'Copy Client Link' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
    tokenA = shown.split('/g/')[1];
    expect(shown).toBe(`http://localhost:5190/g/${tokenA}`);
  });

  test('2–3: create Gallery B from a shared folder and assign a different subset', async ({
    page,
    request,
  }) => {
    await apiLogin(request);
    const created = await adminJson<{ id: string; shareToken: string }>(
      request,
      'POST',
      '/api/admin/collections',
      {
        title: 'E2E Gallery B',
        clientName: 'E2E Client B',
        eventDate: null,
        folderInput: 'demo:city',
        assignmentMode: 'selected',
        presetId: 'darkroom-noir',
        coverFileId: null,
        publish: false,
      },
    );
    idB = created.id;
    tokenB = created.shareToken;
    const before = await detail(request, idB);
    expect(before.photos.length).toBe(24);
    expect(before.photos.filter((p) => p.assigned)).toHaveLength(0); // shared folder: nothing exposed by default

    await login(page);
    await page.goto(`/admin/collections/${idB}`);
    const tiles = page.locator('li[data-photo-id] > button[aria-pressed]');
    for (const i of [0, 1, 2]) await tiles.nth(i).click();
    await expect(page.getByTestId('assign-summary')).toContainText('3 assigned to this client');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Shared', { exact: true }).first()).toBeVisible();
    const after = await detail(request, idB);
    expect(after.photos.filter((p) => p.assigned)).toHaveLength(3);
    expect(after.status).toBe('published');
  });

  test('5–6, 9, 14: each link shows only its own gallery and cannot reach the other', async ({
    page,
    request,
  }) => {
    const a = await (await request.get(`/api/public/g/${tokenA}`)).json();
    const b = await (await request.get(`/api/public/g/${tokenB}`)).json();
    expect(a.collection.title).toBe('E2E Gallery A');
    expect(b.collection.title).toBe('E2E Gallery B');
    expect(b.photos).toHaveLength(3);
    const idsA = new Set<string>(a.photos.map((p: { id: string }) => p.id));
    const idsB: string[] = b.photos.map((p: { id: string }) => p.id);
    expect(idsB.some((id) => idsA.has(id))).toBe(false);
    // Nothing internal or cross-client in the public payload.
    const raw = JSON.stringify(a);
    for (const leak of [
      'E2E Client A',
      'E2E Gallery B',
      tokenB,
      'slug',
      'clientName',
      'shareToken',
      'drive_file_id',
    ])
      expect(raw).not.toContain(leak);

    // Gallery A's page never mentions Gallery B.
    await page.goto(`/g/${tokenA}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Gallery A' })).toBeVisible();
    await expect(page.getByText('E2E Gallery B')).toHaveCount(0);

    // A's token cannot fetch B's images; B's token can.
    expect((await request.get(`/img/t/${tokenA}/${idsB[0]}/s`)).status()).toBe(404);
    expect((await request.get(`/img/t/${tokenB}/${idsB[0]}/s`)).status()).toBe(200);
    // Unassigned photos of B's shared folder aren't reachable even with B's token.
    await apiLogin(request);
    const unassigned = (await detail(request, idB)).photos.find((p) => !p.assigned)!;
    expect((await request.get(`/img/t/${tokenB}/${unassigned.id}/s`)).status()).toBe(404);

    // Deep links are gallery-scoped: B's photo ID on A's page opens nothing.
    await page.goto(`/g/${tokenA}?photo=${idsB[0]}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Gallery A' })).toBeVisible();
    await expect(page.getByTestId('lightbox')).toHaveCount(0);
    // …while A's own photo deep link opens the viewer.
    await page.goto(`/g/${tokenA}?photo=${[...idsA][1]}`);
    await expect(page.getByTestId('lightbox')).toContainText('02 /');
  });

  test('7–8: the homepage and public API never list client galleries', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'lensasamsol' })).toBeVisible();
    for (const t of ['E2E Gallery A', 'E2E Gallery B', 'Coastline, Late Summer', 'Night Skies'])
      await expect(page.getByText(t)).toHaveCount(0);
    expect(await page.locator('a[href*="/g/"]').count()).toBe(0);
    const studio = JSON.stringify(await (await request.get('/api/public/studio')).json());
    expect(studio).not.toContain('Gallery');
    for (const path of [
      '/api/public/home',
      '/api/public/collections',
      '/api/public/collections/coastline-late-summer',
      '/api/public/g',
      '/api/admin/collections',
    ])
      expect([401, 404]).toContain((await request.get(path)).status());
  });

  test('10–12: drafts, unpublishing and regenerated links all close public access', async ({ request }) => {
    await apiLogin(request);
    // 10. Draft gallery (seeded) has a token but can't be opened.
    const draftToken = await tokenOf(request, 'col_demo_lights');
    expect((await request.get(`/api/public/g/${draftToken}`)).status()).toBe(404);

    // 11. Unpublish B → link and images stop working; republish → the same link works again.
    const b = await (await request.get(`/api/public/g/${tokenB}`)).json();
    await adminJson(request, 'POST', `/api/admin/collections/${idB}/unpublish`);
    expect((await request.get(`/api/public/g/${tokenB}`)).status()).toBe(404);
    expect((await request.get(`/img/t/${tokenB}/${b.photos[0].id}/s`)).status()).toBe(404);
    await adminJson(request, 'POST', `/api/admin/collections/${idB}/publish`);
    expect((await request.get(`/api/public/g/${tokenB}`)).status()).toBe(200);

    // 12. Regenerate → old link + old image URLs dead, new link alive.
    const regen = await adminJson<{ shareToken: string; replaced: boolean }>(
      request,
      'POST',
      `/api/admin/collections/${idB}/link`,
    );
    expect(regen.replaced).toBe(true);
    expect(regen.shareToken).not.toBe(tokenB);
    expect((await request.get(`/api/public/g/${tokenB}`)).status()).toBe(404);
    expect((await request.get(`/img/t/${tokenB}/${b.photos[0].id}/s`)).status()).toBe(404);
    expect((await request.get(`/api/public/g/${regen.shareToken}`)).status()).toBe(200);
    // Revoke → no link works.
    await adminJson(request, 'DELETE', `/api/admin/collections/${idB}/link`);
    expect((await request.get(`/api/public/g/${regen.shareToken}`)).status()).toBe(404);
    expect((await detail(request, idB)).shareToken).toBeNull();
  });

  test('15: individual download buttons open the intended Drive file, never the folder', async ({ page }) => {
    await page.goto(`/g/${DRIVE_FIXTURE_TOKEN}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Drive Fixture' })).toBeVisible();
    // The fixture style has showFolderButton=true, but it's a shared-folder ('selected') gallery: no folder link.
    await expect(page.locator('a[href*="/drive/folders/"]')).toHaveCount(0);
    await page.locator('[data-testid="photo-grid"]').scrollIntoViewIfNeeded();
    const chips = page.locator('.g-tile a.g-chip');
    await expect(chips).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const tile = page.locator(`.g-tile:has(.g-tile-link[data-tile-index="${i}"]) a.g-chip`);
      await expect(tile).toHaveAttribute(
        'href',
        `https://drive.google.com/file/d/${DRIVE_FIXTURE_FILES[i]}/view`,
      );
      await expect(tile).toHaveAttribute('target', '_blank');
      await expect(tile).toHaveAttribute('rel', 'noopener noreferrer');
    }
    await page.locator('.g-tile-link[data-tile-index="1"]').click();
    const btn = page.getByTestId('lightbox').getByRole('link', { name: /Open Original in Google Drive/ });
    await expect(btn).toHaveAttribute(
      'href',
      `https://drive.google.com/file/d/${DRIVE_FIXTURE_FILES[1]}/view`,
    );
  });

  test('cleanup: delete test galleries (metadata only)', async ({ request }) => {
    await apiLogin(request);
    for (const id of [idA, idB]) if (id) await adminJson(request, 'DELETE', `/api/admin/collections/${id}`);
    expect((await request.get(`/api/public/g/${tokenA}`)).status()).toBe(404);
  });
});
