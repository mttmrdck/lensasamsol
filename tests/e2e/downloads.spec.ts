import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { adminJson, apiLogin, horizontalOverflow, tokenOf, ORIGIN } from './helpers';
import type { GalleryResponse } from '../../shared/api';

const dir = mkdtempSync(join(tmpdir(), 'dl-e2e-'));
let seq = 0;
const HEADERS = { 'x-archive-csrf': '1', origin: ORIGIN };
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => ((window as unknown as { __LSG_NO_INTRO__: boolean }).__LSG_NO_INTRO__ = true));
});

function inspect(bytes: Buffer) {
  const path = join(dir, `z${seq++}.zip`);
  writeFileSync(path, bytes);
  const py = `
import zipfile, hashlib, json, sys
z = zipfile.ZipFile(sys.argv[1])
print(json.dumps({"bad": z.testzip(), "entries": [{"name": i.filename, "size": i.file_size, "sha256": hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]}))`;
  const r = spawnSync('python3', ['-I', '-c', py, path], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`invalid zip: ${r.stderr}`);
  return JSON.parse(r.stdout) as { bad: string | null; entries: { name: string; size: number; sha256: string }[] };
}
async function gallery(request: import('@playwright/test').APIRequestContext, id: string) {
  const token = await tokenOf(request, id);
  const data = (await (await request.get(`/api/public/g/${token}`)).json()) as GalleryResponse;
  return { token, data };
}
/** Ground truth: the original file names as the photographer's index holds them, in gallery order. */
async function truth(request: import('@playwright/test').APIRequestContext, id: string) {
  const d = await adminJson<{ photos: { id: string; filename: string; assigned: boolean }[] }>(request, 'GET', `/api/admin/collections/${id}`);
  return d.photos.filter((p) => p.assigned);
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test.describe('direct downloads: authorization', () => {
  test('an assigned photo downloads as an attachment with private headers and the original bytes', async ({ request }) => {
    await apiLogin(request);
    const { token, data } = await gallery(request, 'col_demo_coast');
    const photo = data.photos[2];
    const names = new Map((await truth(request, 'col_demo_coast')).map((p) => [p.id, p.filename]));
    const res = await request.get(`/dl/t/${token}/${photo.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain(`filename="${names.get(photo.id)}"`);
    expect(res.headers()['cache-control']).toBe('private, no-store');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['set-cookie']).toBeUndefined();
    const body = await res.body();
    expect(body.subarray(0, 4).toString()).toBe('RIFF'); // the full-size fixture, not a thumbnail
    expect(body.length).toBeGreaterThan(5_000);
  });

  test('drafts, other galleries, revoked and regenerated links, unknown IDs are all refused', async ({ request }) => {
    await apiLogin(request);
    const coast = await gallery(request, 'col_demo_coast');
    const night = await gallery(request, 'col_demo_night');
    // another gallery's photo with this gallery's valid token
    expect((await request.get(`/dl/t/${coast.token}/${night.data.photos[0].id}`)).status()).toBe(404);
    // a draft gallery's own token and photo
    const draft = await adminJson<{ photos: { id: string }[]; shareToken: string; status: string }>(request, 'GET', '/api/admin/collections/col_demo_lights');
    expect(draft.status).toBe('draft');
    expect((await request.get(`/dl/t/${draft.shareToken}/${draft.photos[0].id}`)).status()).toBe(404);
    // a raw file ID, junk, and an unknown photo
    expect((await request.get(`/dl/t/${coast.token}/1AbCdEfGhIjKlMnOpQrStUvWxYz`)).status()).toBe(404);
    expect((await request.get(`/dl/t/${coast.token}/ph_doesnotexist0`)).status()).toBe(404);
    expect((await request.get(`/dl/t/short/${coast.data.photos[0].id}`)).status()).toBe(404);
    expect((await request.get('/dl/anything')).status()).toBe(404);

    // revoke and regenerate on a throwaway gallery
    const created = await adminJson<{ id: string; shareToken: string }>(request, 'POST', '/api/admin/collections', {
      title: 'E2E Download Temp', clientName: 'E2E', eventDate: null, folderInput: 'demo:city', assignmentMode: 'all',
      presetId: 'minimal-archival', coverFileId: null, publish: true,
    });
    try {
      const pub = await adminJson<{ photos: { id: string }[] }>(request, 'GET', `/api/admin/collections/${created.id}`);
      const pid = pub.photos[0].id;
      expect((await request.get(`/dl/t/${created.shareToken}/${pid}`)).status()).toBe(200);
      const fresh = await adminJson<{ shareToken: string }>(request, 'POST', `/api/admin/collections/${created.id}/link`);
      expect((await request.get(`/dl/t/${created.shareToken}/${pid}`)).status()).toBe(404); // regenerated: old link dead
      expect((await request.get(`/dl/t/${fresh.shareToken}/${pid}`)).status()).toBe(200);
      await request.delete(`/api/admin/collections/${created.id}/link`, { headers: HEADERS });
      expect((await request.get(`/dl/t/${fresh.shareToken}/${pid}`)).status()).toBe(404); // revoked
      await adminJson(request, 'POST', `/api/admin/collections/${created.id}/unpublish`);
    } finally {
      await request.delete(`/api/admin/collections/${created.id}`, { headers: HEADERS });
    }
  });
});

test.describe('direct downloads: the visitor experience', () => {
  test('Download Photo in the viewer saves the original with its own file name', async ({ page, request }) => {
    await apiLogin(request);
    const { token, data } = await gallery(request, 'col_demo_coast');
    await page.goto(`/g/${token}`);
    const first = page.locator('[data-testid="photo-grid"] .g-tile').first();
    const photoId = (await first.getAttribute('data-photo-id'))!;
    void data;
    const expected = (await truth(request, 'col_demo_coast')).find((p) => p.id === photoId)!;
    await first.locator('.g-tile-link').click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    // the existing "Open in Drive" style action remains available alongside it
    await expect(page.getByTestId('lightbox').locator('a.g-lb-secondary')).toHaveCount(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download this photograph' }).click()]);
    expect(download.suggestedFilename()).toBe(expected.filename);
    const path = await download.path();
    const saved = readFileSync(path);
    const direct = await (await request.get(`/dl/t/${token}/${photoId}`)).body();
    expect(sha(saved)).toBe(sha(direct));
  });

  test('the owner preview offers no download (there is no share token to authorize)', async ({ page, request }) => {
    await apiLogin(request);
    await page.goto('/admin/login');
    await page.getByLabel('User ID', { exact: true }).fill(process.env.ADMIN_USER ?? 'admin');
    await page.getByLabel('Password').fill(process.env.ADMIN_PASS ?? 'archive-demo-passphrase');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'));
    await page.goto('/admin/collections/col_demo_coast/preview');
    await expect(page.locator('.g-root')).toBeVisible();
    await expect(page.getByTestId('download-all')).toHaveCount(0);
  });
});

test.describe('download all', () => {
  test.use({ acceptDownloads: true });

  async function openGallery(page: Page, request: import('@playwright/test').APIRequestContext, id = 'col_demo_coast') {
    await apiLogin(request);
    const g = await gallery(request, id);
    await page.goto(`/g/${g.token}`);
    await expect(page.getByTestId('download-all')).toBeVisible();
    return g;
  }

  test('without direct-to-disk support: one tap saves a valid ZIP in the photographer’s order', async ({ page, request }) => {
    await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    const { data } = await openGallery(page, request);
    await page.getByRole('button', { name: /Download all \(28 photos\)/ }).click();
    await expect(page.getByRole('button', { name: 'Save part 1' })).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save part 1' }).click()]);
    expect(download.suggestedFilename()).toBe('Coastline-Late-Summer.zip');
    const z = inspect(readFileSync(await download.path()));
    expect(z.bad).toBeNull();
    expect(z.entries).toHaveLength(data.photos.length);
    expect(z.entries.map((e) => e.name)).toEqual((await truth(request, 'col_demo_coast')).map((p) => p.filename));
    // every entry is the exact original the direct endpoint serves
    const { token } = await gallery(request, 'col_demo_coast');
    for (const i of [0, 7, data.photos.length - 1]) {
      const direct = await (await request.get(`/dl/t/${token}/${data.photos[i].id}`)).body();
      expect(z.entries[i].sha256).toBe(sha(direct));
    }
    await expect(page.getByText('Saved 28 photos.')).toBeVisible();
  });

  test('with direct-to-disk support: streams one ZIP to the chosen file', async ({ page, request }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { showSaveFilePicker: unknown; __zip: Uint8Array[]; __name: string };
      w.__zip = [];
      w.showSaveFilePicker = async (o: { suggestedName: string }) => {
        w.__name = o.suggestedName;
        return { createWritable: async () => new WritableStream({ write: (c: Uint8Array) => void w.__zip.push(new Uint8Array(c)) }) };
      };
    });
    await openGallery(page, request);
    await page.getByRole('button', { name: /Download all/ }).click();
    await expect(page.getByText('Saved 28 photos.')).toBeVisible({ timeout: 30_000 });
    const b64 = await page.evaluate(() => {
      const w = window as unknown as { __zip: Uint8Array[] };
      const out = new Uint8Array(w.__zip.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of w.__zip) {
        out.set(c, o);
        o += c.length;
      }
      let s = '';
      for (let i = 0; i < out.length; i += 32768) s += String.fromCharCode(...out.subarray(i, i + 32768));
      return btoa(s);
    });
    expect(await page.evaluate(() => (window as unknown as { __name: string }).__name)).toBe('Coastline-Late-Summer.zip');
    const z = inspect(Buffer.from(b64, 'base64'));
    expect(z.bad).toBeNull();
    expect(z.entries.map((e) => e.name)).toEqual((await truth(request, 'col_demo_coast')).map((p) => p.filename));
  });

  test('cancelling stops the transfer and saves nothing', async ({ page, request }) => {
    await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    await page.route('**/dl/t/**', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue().catch(() => undefined);
    });
    await openGallery(page, request);
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.getByRole('button', { name: /Download all/ }).click();
    await expect(page.getByText(/Preparing: photo/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: /Download all/ })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(downloads).toBe(0);
    await expect(page.getByRole('button', { name: /Save part/ })).toHaveCount(0);
  });

  test('photos that cannot be fetched are reported and listed in the archive, never silently dropped', async ({ page, request }) => {
    await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    const g = await openGallery(page, request);
    const bad = new Set([g.data.photos[3].id, g.data.photos[11].id]);
    await page.route('**/dl/t/**', (route) => {
      const id = route.request().url().split('/').pop()!;
      return bad.has(id)
        ? route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'This photograph is no longer available in Google Drive.' }) })
        : route.continue();
    });
    await page.getByRole('button', { name: /Download all/ }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save part 1' }).click({ timeout: 30_000 })]);
    const z = inspect(readFileSync(await download.path()));
    expect(z.bad).toBeNull();
    expect(z.entries).toHaveLength(26 + 1);
    expect(z.entries.at(-1)!.name).toBe('DOWNLOAD-ERRORS.txt');
    await expect(page.getByText(/Saved 26 photos\. 2 photos could not be added/)).toBeVisible();
  });

  test('a 1,200-photo gallery downloads completely', async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
    const { data } = await openGallery(page, request, 'col_demo_archive');
    expect(data.photos.length).toBe(1200);
    await page.getByRole('button', { name: /Download all \(1,?200 photos\)/ }).click();
    await expect(page.getByRole('button', { name: /Save part 1/ })).toBeVisible({ timeout: 200_000 });
    const names: string[] = [];
    let total = 0;
    for (let part = 1; ; part++) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: `Save part ${part}` }).click()]);
      const z = inspect(readFileSync(await download.path()));
      expect(z.bad).toBeNull();
      names.push(...z.entries.map((e) => e.name));
      total += z.entries.length;
      if (total >= 1200) break;
      await expect(page.getByRole('button', { name: `Save part ${part + 1}` })).toBeVisible({ timeout: 200_000 });
    }
    expect(total).toBe(1200);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(1200); // duplicate names were made unique
  });

  test('on a phone the controls fit and stay reachable', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGallery(page, request);
    await expect(page.getByRole('button', { name: /Download all/ })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.locator('[data-testid="photo-grid"] .g-tile .g-tile-link').first().click();
    await expect(page.getByRole('link', { name: 'Download this photograph' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
