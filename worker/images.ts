import { boundedPreview } from './image-delivery';
import { Hono, type Context } from 'hono';
import type { AppEnv } from './env';
import { isDemo } from './env';
import { isAdminRequest } from './auth';
import { DriveError, fetchDrivePreview } from './google';
import { shareTokenSchema } from '../shared/api';

/**
 * Preview images. Two entry points, both checked server-side before any cache lookup:
 *   /img/t/:token/:photoId/:variant — visitor: the photo must be an ASSIGNED member of the PUBLISHED gallery
 *                                     that owns this share token. A valid link for gallery A therefore
 *                                     cannot fetch gallery B's photos, whatever ID is guessed.
 *   /img/a/:photoId/:variant        — owner: requires an admin session.
 * Fixed variants only; originals are never proxied (visitors open originals on Google Drive).
 */
export const VARIANTS = { s: 480, m: 960, l: 1600 } as const;
type Variant = keyof typeof VARIANTS;
const PHOTO_ID = /^ph_[A-Za-z0-9_-]{8,40}$/;

interface ImgRow {
  drive_file_id: string;
  resource_key: string | null;
  source_version: string;
  demo_asset: string | null;
  source: string;
}

export const imageRoutes = new Hono<AppEnv>();

imageRoutes.get('/t/:token/:photoId/:variant', async (c) => {
  const { token, photoId, variant } = c.req.param();
  if (!shareTokenSchema.safeParse(token).success || !PHOTO_ID.test(photoId) || !(variant in VARIANTS))
    return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT p.drive_file_id, p.resource_key, p.source_version, p.demo_asset, c.source
     FROM photos p JOIN collections c ON c.id = p.collection_id
     WHERE p.id = ?1 AND c.share_token = ?2 AND c.status = 'published' AND p.assigned = 1 AND p.unavailable = 0`,
  )
    .bind(photoId, token)
    .first<ImgRow>();
  if (!row || (row.source === 'demo' && !isDemo(c.env))) return c.notFound();
  // private: browsers may keep an image they already loaded for up to an hour; shared caches must not.
  // Revoking/regenerating a link or unpublishing stops new fetches immediately (checked above, before any cache).
  return serve(c, row, variant as Variant, 'private, max-age=3600');
});

imageRoutes.get('/a/:photoId/:variant', async (c) => {
  const { photoId, variant } = c.req.param();
  if (!PHOTO_ID.test(photoId) || !(variant in VARIANTS)) return c.notFound();
  if (!(await isAdminRequest(c))) return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT p.drive_file_id, p.resource_key, p.source_version, p.demo_asset, c.source
     FROM photos p JOIN collections c ON c.id = p.collection_id WHERE p.id = ?`,
  )
    .bind(photoId)
    .first<ImgRow>();
  if (!row) return c.notFound();
  return serve(c, row, variant as Variant, 'private, max-age=600');
});

async function serve(c: Context<AppEnv>, row: ImgRow, variant: Variant, cacheControl: string) {
  const etag = `"${row.source_version}-${variant}"`;
  if (c.req.header('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } });
  }
  const headers = {
    'cache-control': cacheControl,
    etag,
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex',
  };
  if (row.source === 'demo') {
    const asset = await c.env.ASSETS.fetch(
      new URL(`/__fixtures/${row.demo_asset}/${variant}.webp`, c.req.url),
    );
    if (!asset.ok) return c.notFound();
    return new Response(asset.body, { headers: { ...headers, 'content-type': 'image/webp' } });
  }
  // Edge cache keyed by Drive file + version + variant. Access was already authorised above, so the
  // cache never decides who may see an image. (Cache API is a no-op on *.workers.dev.)
  const cacheKey = new Request(
    `https://${new URL(c.req.url).host}/__image-cache/${row.drive_file_id}/${encodeURIComponent(row.source_version)}/${variant}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit)
    return new Response(hit.body, {
      headers: { ...headers, 'content-type': hit.headers.get('content-type') ?? 'image/jpeg' },
    });
  try {
    const { res } = await fetchDrivePreview(c.env, row.drive_file_id, row.resource_key, VARIANTS[variant]);
    const {bytes,type} = await boundedPreview(res);
    c.executionCtx.waitUntil(
      cache.put(
        cacheKey,
        new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800' } }),
      ),
    );
    return new Response(bytes, { headers: { ...headers, 'content-type': type } });
  } catch (e) {
    const status = e instanceof DriveError && e.kind === 'not_found' ? 404 : 502;
    return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  }
}
