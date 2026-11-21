import { boundedImageBody } from './image-delivery';
import { Hono, type Context } from 'hono';
import type { AppEnv } from './env';
import { isDemo } from './env';
import { isAdminRequest } from './auth';
import { DriveError, fetchDrivePreview, getConnection } from './google';
import { shareTokenSchema } from '../shared/api';
import { IMAGE_VARIANTS } from '../shared/image-variants';
import { sha256 } from './crypto';

/**
 * Preview images. Two entry points, both checked server-side before any cache lookup:
 *   /img/t/:token/:photoId/:variant — visitor: the photo must be an ASSIGNED member of the PUBLISHED gallery
 *                                     that owns this share token. A valid link for gallery A therefore
 *                                     cannot fetch gallery B's photos, whatever ID is guessed.
 *   /img/a/:photoId/:variant        — owner: requires an admin session.
 * Fixed variants only; originals are never proxied (visitors open originals on Google Drive).
 */
export const VARIANTS = IMAGE_VARIANTS;
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
imageRoutes.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'private, no-store');
  c.header('x-content-type-options', 'nosniff');
  c.header('x-robots-tag', 'noindex');
});

imageRoutes.get('/t/:token/:photoId/:variant', async (c) => {
  const { token, photoId, variant } = c.req.param();
  if (
    !shareTokenSchema.safeParse(token).success ||
    !PHOTO_ID.test(photoId) ||
    !Object.hasOwn(VARIANTS, variant)
  )
    return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT p.drive_file_id, p.resource_key, p.source_version, p.demo_asset, c.source
     FROM photos p JOIN collections c ON c.id = p.collection_id
     WHERE p.id = ?1 AND c.share_token = ?2 AND c.status = 'published' AND p.assigned = 1 AND p.unavailable = 0`,
  )
    .bind(photoId, token)
    .first<ImgRow>();
  if (!row || (row.source === 'demo' && !isDemo(c.env))) return c.notFound();
  return serve(c, row, variant as Variant);
});

imageRoutes.get('/a/:photoId/:variant', async (c) => {
  const { photoId, variant } = c.req.param();
  if (!PHOTO_ID.test(photoId) || !Object.hasOwn(VARIANTS, variant)) return c.notFound();
  if (!(await isAdminRequest(c))) return c.notFound();
  const row = await c.env.DB.prepare(
    `SELECT p.drive_file_id, p.resource_key, p.source_version, p.demo_asset, c.source
     FROM photos p JOIN collections c ON c.id = p.collection_id WHERE p.id = ? AND p.unavailable = 0`,
  )
    .bind(photoId)
    .first<ImgRow>();
  if (!row || (row.source === 'demo' && !isDemo(c.env))) return c.notFound();
  return serve(c, row, variant as Variant);
});

async function serve(c: Context<AppEnv>, row: ImgRow, variant: Variant) {
  const connection = row.source === 'drive' ? await getConnection(c.env) : null;
  if (
    row.source === 'drive' &&
    (!connection ||
      (c.env.GOOGLE_ALLOWED_EMAIL &&
        connection.email?.toLowerCase() !== c.env.GOOGLE_ALLOWED_EMAIL.trim().toLowerCase()))
  )
    return c.notFound();
  const baseIdentity = await sha256(
    JSON.stringify([
      'private-preview-v2',
      row.drive_file_id,
      row.source_version,
      !!c.env.IMAGES,
      connection?.connected_at,
      connection?.refresh_token_enc,
      c.env.TOKEN_ENCRYPTION_KEY,
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_ALLOWED_EMAIL,
    ]),
  );
  const identity = `${baseIdentity}-${variant}`;
  const etag = `"${identity}"`;
  const cacheControl = 'private, no-store';
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
      new URL(`/__fixtures/${row.demo_asset}/${variant === 'xl' ? 'l' : variant}.webp`, c.req.url),
    );
    if (!asset.ok) return c.notFound();
    return new Response(asset.body, { headers: { ...headers, 'content-type': 'image/webp' } });
  }
  // Only private derivatives enter this internal cache. Authorization and active connection are
  // checked first on every request. Never put a Worker cache in front of these access checks.
  const cacheKey = new Request(
    `https://${new URL(c.req.url).host}/__image-cache/private-preview-v2/${identity}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  let hit: Response | undefined;
  try {
    hit = await cache.match(cacheKey);
  } catch {
    /* Cache availability does not decide access. */
  }
  if (hit)
    return new Response(hit.body, {
      headers: {
        ...headers,
        'content-type': hit.headers.get('content-type') ?? 'image/webp',
        'x-preview-quality': hit.headers.get('x-preview-quality') ?? 'transformed',
      },
    });
  try {
    let res: Response;
    let quality: 'transformed' | 'thumbnail-fallback';
    if (!c.env.IMAGES) {
      ({ res, quality } = await fetchDrivePreview(
        c.env,
        row.drive_file_id,
        row.resource_key,
        VARIANTS[variant],
      ));
    } else {
      // Reuse a 2560px metadata-free preview for smaller sizes. It is a derivative, not an original:
      // subsequent viewer sizes reuse the cached master without another Drive media download.
      const masterKey = new Request(
        `https://${new URL(c.req.url).host}/__image-cache/private-preview-v2/${baseIdentity}-xl`,
      );
      let master: Response | undefined;
      if (variant !== 'xl') {
        try {
          master = await cache.match(masterKey);
        } catch {
          /* Cache miss. */
        }
      }
      if (!master || master.headers.get('x-preview-quality') !== 'transformed') {
        const fetched = await fetchDrivePreview(c.env, row.drive_file_id, row.resource_key, VARIANTS.xl);
        master = new Response(boundedImageBody(fetched.res), {
          headers: {
            'content-type': fetched.res.headers.get('content-type')!,
            'x-preview-quality': fetched.quality,
            'cache-control': 'public, max-age=3600',
          },
        });
        // Only a request's own stream is cloned. Sharing live streams across Worker requests is unsafe.
        if (fetched.quality === 'transformed') {
          c.executionCtx.waitUntil(cache.put(masterKey, master.clone()).catch(() => {}));
        }
      }
      quality =
        master.headers.get('x-preview-quality') === 'transformed' ? 'transformed' : 'thumbnail-fallback';
      if (variant === 'xl' || quality === 'thumbnail-fallback') {
        res = master;
      } else {
        const edge = VARIANTS[variant];
        const output = await c.env.IMAGES.input(boundedImageBody(master))
          .transform({ width: edge, height: edge, fit: 'scale-down' })
          .output({ format: 'image/webp', quality: 84, anim: false });
        res = output.response();
      }
    }
    if (quality === 'transformed' && res.headers.get('content-type')?.split(';')[0] !== 'image/webp') {
      void res.body?.cancel().catch(() => {});
      throw new Error('Unexpected derivative format');
    }
    const body = boundedImageBody(res);
    const type = res.headers.get('content-type')!;
    const derivative = new Response(body, {
      headers: {
        'content-type': type,
        'cache-control': `public, max-age=${quality === 'transformed' ? 3600 : 60}`,
        'x-preview-quality': quality,
      },
    });
    if (variant !== 'xl' || quality !== 'transformed' || !c.env.IMAGES)
      c.executionCtx.waitUntil(cache.put(cacheKey, derivative.clone()).catch(() => {}));
    return new Response(derivative.body, {
      headers: { ...headers, 'content-type': type, 'x-preview-quality': quality },
    });
  } catch (e) {
    const status = e instanceof DriveError && e.kind === 'not_found' ? 404 : 502;
    return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
  }
}
