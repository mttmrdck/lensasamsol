import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { isDemo } from '../env';
import type { CollectionRow } from '../db';
import { buildGallery, getSettings, publicStudio } from '../gallery';
import { shareTokenSchema } from '../../shared/api';

/**
 * Public API. There is deliberately NO listing endpoint: a client gallery is reachable only through its
 * share token. Share links are bearer capabilities (anyone holding the link can view), not authentication.
 */
export const publicRoutes = new Hono<AppEnv>();

const NOT_FOUND = {
  error: 'not_found',
  message: 'This gallery link may have expired or is not currently shared.',
};

publicRoutes.get('/studio', async (c) => {
  const settings = await getSettings(c.env);
  c.header('cache-control', 'public, max-age=60');
  return c.json({ studio: publicStudio(settings), demoMode: isDemo(c.env) });
});

publicRoutes.get('/g/:token', async (c) => {
  c.header('cache-control', 'private, no-store');
  c.header('x-robots-tag', 'noindex, nofollow');
  const token = shareTokenSchema.safeParse(c.req.param('token'));
  if (!token.success) return c.json(NOT_FOUND, 404);
  const row = await c.env.DB.prepare(
    `SELECT * FROM collections WHERE share_token = ? AND status = 'published'`,
  )
    .bind(token.data)
    .first<CollectionRow>();
  // Same 404 for unknown, revoked, unpublished and (outside demo mode) demo galleries: no existence oracle.
  if (!row || (row.source === 'demo' && !isDemo(c.env))) return c.json(NOT_FOUND, 404);
  return c.json(await buildGallery(c.env, row, { preview: false }));
});
