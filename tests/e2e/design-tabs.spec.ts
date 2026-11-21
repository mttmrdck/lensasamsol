import { expect, test, type Page } from '@playwright/test';
import { adminJson, apiLogin, login, horizontalOverflow } from './helpers';
import type { AdminCollectionDetail } from '../../shared/api';

const ID = 'col_demo_coast'; // a gallery on the default (Folio) style
test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }));
  await login(page);
  await page.goto(`/admin/collections/${ID}/design`);
  await expect(page.getByTestId('preview-frame')).toBeVisible();
});

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Design inspector' });

// One marker per area; the panel for a tab must contain its own markers and none of the others.
const markers = {
  Presets: (p: Page) => [p.getByRole('button', { name: 'Auto Arrange', exact: true }), p.getByLabel('Composition templates')],
  Layout: (p: Page) => [p.getByRole('radiogroup', { name: 'Layout', exact: true }), p.getByRole('radiogroup', { name: 'Layout density' }), p.getByLabel('Photo order')],
  Cover: (p: Page) => [p.getByLabel('Gallery title override'), p.getByLabel('Highlighted photograph', { exact: true }), p.getByLabel('Gallery subtitle', { exact: true })],
  Colour: (p: Page) => [p.getByRole('radiogroup', { name: 'Colour theme' }), p.getByRole('radiogroup', { name: 'Viewer background' }), p.getByLabel('Background hex')],
} as const;
type TabName = keyof typeof markers;
const names = Object.keys(markers) as TabName[];

test.describe('Customize Design tabs', () => {
  for (const active of names) {
    test(`${active} shows only its own controls (the others are not in the DOM)`, async ({ page }) => {
      await tab(page, active).click();
      await expect(tab(page, active)).toHaveAttribute('aria-selected', 'true');
      for (const m of markers[active](page)) await expect(m).toHaveCount(1);
      for (const other of names.filter((n) => n !== active))
        for (const m of markers[other](page)) await expect(m).toHaveCount(0);
      await expect(page.getByRole('tabpanel')).toHaveCount(1);
      // the panel is conditionally rendered, never merely scrolled to
      await expect(page.getByRole('tabpanel')).toHaveAccessibleName(active);
    });
  }

  test('Presets explains presets and keeps Auto Arrange; Cover and Colour hold what their names say', async ({ page }) => {
    await expect(inspector(page)).toContainText('A style preset sets layout, cover style, typography and colour together');
    await tab(page, 'Colour').click();
    await expect(page.getByRole('heading', { name: 'Typography' })).toBeVisible(); // typography lives with colour
    await tab(page, 'Layout').click();
    await expect(page.getByRole('heading', { name: 'Photo buttons' })).toBeVisible(); // Drive buttons live with the photos
    await expect(page.getByRole('radiogroup', { name: 'Layout', exact: true }).getByRole('radio', { name: 'Folio' })).toBeChecked();
    await tab(page, 'Cover').click();
    await expect(page.getByRole('radiogroup', { name: 'Cover style' })).toHaveCount(0); // not used by Folio
    await expect(inspector(page)).toContainText('Folio layout opens with a compact information column');
  });

  test('switching tabs keeps unsaved edits, saves nothing and leaves the preview mounted', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/admin/')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await page.getByTestId('preview-frame').evaluate((el) => el.setAttribute('data-keep', 'yes'));
    await tab(page, 'Cover').click();
    await page.getByLabel('Gallery title override').fill('E2E Tab Title');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText('E2E Tab Title'); // live preview
    for (const n of ['Layout', 'Colour', 'Presets', 'Cover']) await tab(page, n).click();
    await expect(page.getByLabel('Gallery title override')).toHaveValue('E2E Tab Title');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await expect(page.getByTestId('preview-frame')).toHaveAttribute('data-keep', 'yes'); // same element, not remounted
    expect(writes).toEqual([]); // switching tabs never saves or publishes
  });

  test('undo and redo work across tab changes', async ({ page }) => {
    await tab(page, 'Layout').click();
    const density = page.getByRole('radiogroup', { name: 'Layout density' });
    await density.getByRole('radio', { name: 'Spacious' }).click();
    await expect(density.getByRole('radio', { name: 'Spacious' })).toBeChecked();
    await tab(page, 'Colour').click();
    await page.getByRole('button', { name: 'Undo (Cmd+Z)', exact: true }).click();
    await tab(page, 'Layout').click();
    await expect(density.getByRole('radio', { name: 'Spacious' })).not.toBeChecked();
    await tab(page, 'Cover').click();
    await page.getByRole('button', { name: 'Redo (Shift+Cmd+Z)', exact: true }).click();
    await tab(page, 'Layout').click();
    await expect(density.getByRole('radio', { name: 'Spacious' })).toBeChecked();
  });

  test('reset discards unsaved changes made on any tab', async ({ page }) => {
    await tab(page, 'Colour').click();
    await page.getByRole('radiogroup', { name: 'Viewer background' }).getByRole('radio', { name: 'Match gallery' }).click();
    await tab(page, 'Cover').click();
    await page.getByLabel('Gallery subtitle', { exact: true }).fill('E2E temporary');
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('button', { name: /^Reset/ }).last().click();
    await expect(page.getByLabel('Gallery subtitle', { exact: true })).toHaveValue('');
  });

  test('keyboard: arrow keys move between tabs and the panel follows focus', async ({ page }) => {
    await expect(page.getByRole('tablist', { name: 'Inspector sections' })).toBeVisible();
    await tab(page, 'Presets').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Layout')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Photo order')).toHaveCount(1);
    // One key at a time, as a person types: wait for each tab (and focus) to settle before the next key.
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Cover')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Cover')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Colour')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Photo order')).toHaveCount(0);
    await expect(tab(page, 'Colour')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab(page, 'Presets')).toHaveAttribute('aria-selected', 'true');
  });

  test('the panel scrolls back to the top when the tab changes', async ({ page }) => {
    await tab(page, 'Layout').click();
    const panel = page.getByRole('tabpanel');
    const scroller = panel.locator('xpath=..');
    await scroller.evaluate((el) => (el.scrollTop = 500));
    await tab(page, 'Colour').click();
    expect(await page.getByRole('tabpanel').locator('xpath=..').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('Save draft still works from any tab and keeps the design compatible', async ({ page, request }) => {
    await apiLogin(request);
    const before = await adminJson<AdminCollectionDetail>(request, 'GET', `/api/admin/collections/${ID}`);
    try {
      await tab(page, 'Colour').click();
      await page.getByRole('radiogroup', { name: 'Viewer background' }).getByRole('radio', { name: 'Match gallery' }).click();
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.getByText('Draft saved, not published')).toBeVisible();
      const after = await adminJson<AdminCollectionDetail>(request, 'GET', `/api/admin/collections/${ID}`);
      expect(after.styleDraft.color.lightbox).toBe('match');
      expect(after.styleDraft.version).toBe(1);
      expect(after.styleDraft.layout.mode).toBe(before.styleDraft.layout.mode); // nothing else changed
    } finally {
      await adminJson(request, 'PUT', `/api/admin/collections/${ID}/style`, { style: before.styleDraft });
    }
  });

  test('on a phone the tabs fit without horizontal overflow and still switch panels', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/collections/${ID}/design`);
    for (const n of names) {
      await tab(page, n).click();
      await expect(page.getByRole('tabpanel')).toHaveAccessibleName(n);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    }
    for (const m of markers.Colour(page)) await expect(m).toHaveCount(1);
    for (const m of markers.Layout(page)) await expect(m).toHaveCount(0);
  });
});
