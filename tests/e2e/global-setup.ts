import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

export const DRIVE_FIXTURE_TOKEN = 'e2eDriveFixtureToken000001';
export const DRIVE_FIXTURE_FILES = [
  '1AbCdEfGhIjKlMnOpQrStUvWxYz01',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz02',
  '1AbCdEfGhIjKlMnOpQrStUvWxYz03',
];

/**
 * Re-seeds the deterministic demo data, clears the login throttle, and adds one TEST-ONLY Drive-sourced
 * gallery whose photos carry known per-file Drive links (used to verify download buttons point at the
 * intended files). No real Drive account is involved; previews for it are expected to be unavailable.
 */
export default function globalSetup() {
  execSync('node scripts/prepare-test-env.mjs && npx wrangler d1 migrations apply DB --local --env test && node scripts/gen-demo-seed.mjs && npx wrangler d1 execute DB --local --env test --file=seed/demo.sql', { stdio: 'ignore' });
  const now = new Date().toISOString();
  const style = JSON.stringify({
    version: 1,
    presetId: 'minimal-archival',
    layout: { mode: 'justified', rowHeight: 320, columns: 3, gap: 12, uniformAspect: '3:2', maxWidth: 1600 },
    cover: {
      style: 'typographic',
      focal: { x: 0.5, y: 0.5 },
      focalMobile: { x: 0.5, y: 0.5 },
      height: 82,
      titleAlign: 'left',
      titleScale: 1,
      showDescription: true,
      showDate: true,
      showCount: true,
    },
    type: { pairing: 'archival' },
    color: { theme: 'archival', customBg: null, lightbox: 'darkroom' },
    actions: {
      showFolderButton: true,
      showPhotoButton: true,
      showLightboxButton: true,
      label: 'open',
      showFilenames: false,
    },
    sequence: { enabled: false, heading: 'Selected moments' },
  }).replace(/'/g, "''");
  const photos = DRIVE_FIXTURE_FILES.map(
    (f, i) =>
      `('ph_e2edrive00${i}', 'col_e2e_drive', '${f}', 'IMG_${i}.jpg', 'image/jpeg', 1500, 1000, 1, ${i}, 0, 1, 0, 'v1', 'https://drive.google.com/file/d/${f}/view', '${now}', '${now}')`,
  );
  const sql = [
    "DELETE FROM collections WHERE id = 'col_e2e_drive';",
    `INSERT INTO collections (id, slug, title, client_name, source, drive_folder_id, drive_folder_name, status, assignment_mode, share_token, style_draft_json, style_published_json, photo_count, created_at, updated_at)
     VALUES ('col_e2e_drive', 'e2e-drive-fixture', 'E2E Drive Fixture', 'Test only', 'drive', '1FolderIdForE2eTestsOnly00', 'E2E', 'published', 'selected', '${DRIVE_FIXTURE_TOKEN}', '${style}', '${style}', 3, '${now}', '${now}');`,
    `INSERT INTO photos (id, collection_id, drive_file_id, filename, mime_type, width, height, dims_known, sort_order, hidden, assigned, featured, source_version, view_url, created_at, updated_at) VALUES ${photos.join(',')};`,
    'DELETE FROM login_attempts;',
  ].join('\n');
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/e2e-fixture.sql', sql);
  execSync('npx wrangler d1 execute DB --local --env test --file=test-results/e2e-fixture.sql', { stdio: 'ignore' });
}
