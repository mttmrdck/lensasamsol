import { Hono } from 'hono';
import type { AppEnv } from './env';
import { isDemo } from './env';
import { DriveError, fetchDriveOriginal } from './google';
import { shareTokenSchema } from '../shared/api';
import { MAX_ORIGINAL_BYTES, attachmentHeader, downloadContentType } from '../shared/download';

/**
 * Original-photo downloads for visitors: /dl/t/:token/:photoId
 *
 * Authorization is the same rule the preview images use, and it is checked before anything is fetched: the photo must
 * be an ASSIGNED, available member of the PUBLISHED gallery that owns this share token. A link for gallery A can
 * therefore never download gallery B's photos, drafts and revoked galleries return 404, and there is no endpoint
 * that accepts a bare Drive file ID.
 *
 * The Worker streams the Drive response straight through. It never buffers a photo and spends no CPU per byte; a
 * client cancel aborts the Drive transfer. "Download all" is assembled in the visitor's browser from these same
 * per-photo requests, so the Worker never builds a ZIP (a ZIP needs a CRC-32 over every byte, which is CPU work that
 * grows with gallery size).
 */
export const downloadRoutes = new Hono<AppEnv>();
downloadRoutes.use('*', async (c, next) => {
  await next();
  // Private content: never stored in a shared cache, never sniffed, never indexed.
  c.header('cache-control', 'private, no-store');
  c.header('x-content-type-options', 'nosniff');
  c.header('x-robots-tag', 'noindex');
  c.header('referrer-policy', 'no-referrer');
});

const PHOTO_ID = /^ph_[A-Za-z0-9_-]{8,40}$/;

interface Row {
  drive_file_id: string;
  resource_key: string | null;
  filename: string;
  mime_type: string;
  demo_asset: string | null;
  source: string;
}

downloadRoutes.get('/t/:token/:photoId', async (c) => {
  const { token, photoId } = c.req.param();
  if (!shareTokenSchema.safeParse(token).success || !PHOTO_ID.test(photoId)) return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT p.drive_file_id, p.resource_key, p.filename, p.mime_type, p.demo_asset, c.source
     FROM photos p JOIN collections c ON c.id = p.collection_id
     WHERE p.id = ?1 AND c.share_token = ?2 AND c.status = 'published' AND p.assigned = 1 AND p.unavailable = 0`,
  )
    .bind(photoId, token)
    .first<Row>();
  if (!row || (row.source === 'demo' && !isDemo(c.env))) return c.notFound();

  let upstream: Response;
  try {
    if (row.source === 'demo') {
      // Demo galleries have fixture images instead of Drive files.
      upstream = await c.env.ASSETS.fetch(new URL(`/__fixtures/${row.demo_asset}/l.webp`, c.req.url));
      if (!upstream.ok) return new Response(null, { status: 404 });
    } else {
      upstream = await fetchDriveOriginal(c.env, row.drive_file_id, row.resource_key, c.req.raw.signal);
    }
  } catch (e) {
    if (e instanceof DriveError) {
      // Sanitized, user-readable, and never a 401 (the browser would treat that as "signed out").
      const status = e.kind === 'not_found' ? 404 : e.kind === 'forbidden' ? 503 : 502;
      return c.json({ error: `drive_${e.kind}`, message: e.message }, status, status === 503 ? { 'retry-after': '30' } : {});
    }
    console.error('download_failed');
    return c.json({ error: 'server', message: 'The download could not be started.' }, 500);
  }

  const length = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_ORIGINAL_BYTES) {
    await upstream.body?.cancel();
    return c.json({ error: 'too_large', message: 'This photograph is too large to download here. Open it in Google Drive.' }, 413);
  }
  const headers = new Headers({
    // Only the content types the gallery indexes; never an upstream-controlled value.
    'content-type':
      row.source === 'demo' ? (upstream.headers.get('content-type') ?? 'image/webp') : downloadContentType(row.mime_type),
    'content-disposition': attachmentHeader(row.filename),
  });
  if (Number.isFinite(length) && length > 0) headers.set('content-length', String(length));
  return new Response(upstream.body, { status: 200, headers });
});
