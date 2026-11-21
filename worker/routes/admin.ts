import { boundedPreview } from '../image-delivery';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from '../env';
import { isDemo } from '../env';
import { isAdminRequest, requireAdmin, sessionTokenHash } from '../auth';
import { newId, randomToken, sha256b64url } from '../crypto';
import {
  SUMMARY_SELECT,
  nowIso,
  issueShareToken,
  refreshCounts,
  slugify,
  toAdminPhoto,
  toSummary,
  toSyncRun,
  uniqueSlug,
  type CollectionRow,
  type PhotoRow,
} from '../db';
import { buildGallery, defaultStyle, getSettings } from '../gallery';
import {
  DriveError,
  DRIVE_SCOPE,
  authUrl,
  disconnect,
  driveGet,
  exchangeCode,
  fetchDrivePreview,
  folderAccess,
  getAccessToken,
  getConnection,
  getFolder,
  googleConfigMissing,
  storeConnection,
} from '../google';
import { DEMO_FOLDERS, parseDemoFolder } from '../demo';
import { SyncBusyError, ensureCover, listSource, syncCollection } from '../sync';
import {
  bulkPhotoSchema,
  createCollectionSchema,
  photoPatchSchema,
  settingsSchema,
  styleSaveSchema,
  updateCollectionSchema,
  type AdminCollectionDetail,
  type DriveStatus,
  type FolderValidation,
} from '../../shared/api';
import { FOLDER_PARSE_MESSAGES, driveFolderUrl, isDriveId, parseDriveFolderInput } from '../../shared/drive';
import { PRESETS, applyPreset, parseStyle } from '../../shared/style';
import type { OAuthFailureCode } from '../../shared/oauth';

export const adminRoutes = new Hono<AppEnv>();

function oauthFailure(c: Context<AppEnv>, code: OAuthFailureCode, error?: unknown) {
  if (c.env.APP_ENV === 'staging') {
    // Emit fixed classifications only: no exception text, URLs, headers, cookies, or OAuth values.
    console.warn('oauth_callback_failed', {
      code,
      ...(error instanceof DriveError && error.status ? { httpStatus: error.status } : {}),
      ...(error instanceof DriveError && error.redirectLocationPresent !== undefined
        ? { hasLocation: error.redirectLocationPresent }
        : {}),
    });
  }
  return c.redirect(`/admin/drive?error=${code}`);
}

// OAuth callback is a top-level navigation from Google: it must be reachable without the CSRF header,
// but still requires a valid admin session cookie + matching single-use state.
adminRoutes.get('/drive/callback', async (c) => {
  if (!(await isAdminRequest(c))) return c.redirect('/admin/login?next=/admin/drive');
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code');
  const err = c.req.query('error');
  const sessionHash = await sessionTokenHash(c);
  // Single-use state consumption is atomic and bound to the initiating browser session.
  const row = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ? AND session_hash = ? RETURNING code_verifier, created_at')
    .bind(state, sessionHash).first<{code_verifier:string;created_at:number}>();
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(Date.now()-15*60*1000).run();
  if (err) return oauthFailure(c, err === 'access_denied' ? 'consent_denied' : 'consent_failed');
  if (!row || !code || Date.now() - row.created_at > 15 * 60 * 1000) {
    return oauthFailure(c, 'state_invalid');
  }
  let stage: OAuthFailureCode = 'token_exchange_failed';
  try {
    const tokens = await exchangeCode(c.env, c.req.url, code, row.code_verifier);
    if (!tokens.scope.split(' ').includes(DRIVE_SCOPE)) {
      return oauthFailure(c, 'drive_scope_missing');
    }
    stage = 'connection_save_failed';
    await storeConnection(c.env, tokens);
    return c.redirect('/admin/drive?connected=1');
  } catch (e) {
    return oauthFailure(c, e instanceof DriveError && e.callbackCode ? e.callbackCode : stage, e);
  }
});

adminRoutes.use('*', requireAdmin);

function bad(c: Context<AppEnv>, error: z.ZodError | string, status: 400 | 404 | 409 | 422 = 400) {
  const message =
    typeof error === 'string'
      ? error
      : error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
  return c.json({ error: 'invalid', message }, status);
}

function driveFail(c: Context<AppEnv>, e: unknown) {
  if (e instanceof DriveError) {
    const status =
      e.kind === 'not_connected' || e.kind === 'config'
        ? 412
        : e.kind === 'rate_limited'
          ? 429
          : e.kind === 'auth'
            ? 401
            : 422;
    return c.json({ error: `drive_${e.kind}`, message: e.message }, status);
  }
  console.error('drive_request_failed');
  return c.json({ error: 'server', message: 'Something went wrong talking to Google Drive.' }, 500);
}

async function loadCollection(c: Context<AppEnv>): Promise<CollectionRow | null> {
  return c.env.DB.prepare('SELECT * FROM collections WHERE id = ?')
    .bind(c.req.param('id'))
    .first<CollectionRow>();
}

// ------------------------------------------------------------------ Overview

adminRoutes.get('/overview', async (c) => {
  const db = c.env.DB;
  const [counts, recent, conn, runs] = await Promise.all([
    db
      .prepare(
        `SELECT SUM(status='published') AS published, SUM(status='draft') AS drafts, SUM(sync_status='error') AS errors,
                SUM(photo_count) AS photos, MAX(last_synced_at) AS last_sync FROM collections`,
      )
      .first<{
        published: number;
        drafts: number;
        errors: number;
        photos: number;
        last_sync: string | null;
      }>(),
    db
      .prepare(`${SUMMARY_SELECT} ORDER BY c.updated_at DESC LIMIT 8`)
      .all<CollectionRow & { cover_w: number; cover_h: number }>(),
    getConnection(c.env),
    db
      .prepare(
        `SELECT s.*, c.title FROM sync_runs s JOIN collections c ON c.id = s.collection_id ORDER BY s.started_at DESC LIMIT 6`,
      )
      .all<Record<string, unknown>>(),
  ]);
  return c.json({
    counts: {
      published: counts?.published ?? 0,
      drafts: counts?.drafts ?? 0,
      errors: counts?.errors ?? 0,
      photos: counts?.photos ?? 0,
      lastSync: counts?.last_sync ?? null,
    },
    drive: { connected: !!conn, email: conn?.email ?? null, lastError: conn?.last_error ?? null },
    demoMode: isDemo(c.env),
    recent: recent.results.map(toSummary),
    runs: runs.results.map((r) => ({ ...toSyncRun(r), title: r.title as string })),
  });
});

// ------------------------------------------------------------------ Collections

adminRoutes.get('/collections', async (c) => {
  const rows = await c.env.DB.prepare(`${SUMMARY_SELECT} ORDER BY c.updated_at DESC`).all<
    CollectionRow & { cover_w: number; cover_h: number }
  >();
  return c.json({ collections: rows.results.map(toSummary) });
});

adminRoutes.post('/drive/validate-folder', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { input?: string };
  const input = String(body.input ?? '').slice(0, 2048);
  try {
    return c.json(await validateFolder(c, input));
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, e.message, 422);
    return driveFail(c, e);
  }
});

class ValidationError extends Error {}

async function validateFolder(c: Context<AppEnv>, input: string): Promise<FolderValidation> {
  const demoKey = parseDemoFolder(input);
  if (demoKey) {
    if (!isDemo(c.env)) throw new ValidationError('Demo folders are disabled (DEMO_MODE is off).');
    const listing = await listSource(c.env, 'demo', demoKey, null);
    return {
      folderId: `demo:${demoKey}`,
      resourceKey: null,
      name: DEMO_FOLDERS[demoKey].name,
      source: 'demo',
      imageCount: listing.files.length,
      unsupportedCount: 0,
      unsupportedKinds: [],
      access: 'unknown',
      truncated: false,
      candidates: listing.files.slice(0, 12).map((f) => ({
        fileId: f.fileId,
        name: f.name,
        w: f.w,
        h: f.h,
        thumb: `/__fixtures/${f.demoAsset}/s.webp`,
      })),
    };
  }
  const parsed = parseDriveFolderInput(input);
  if (!parsed.ok) throw new ValidationError(FOLDER_PARSE_MESSAGES[parsed.reason]);
  const folder = await getFolder(c.env, parsed.folderId, parsed.resourceKey);
  const resourceKey = parsed.resourceKey ?? folder.resourceKey ?? null;
  const [listing, access] = await Promise.all([
    listSource(c.env, 'drive', parsed.folderId, resourceKey),
    folderAccess(c.env, parsed.folderId, resourceKey),
  ]);
  return {
    folderId: parsed.folderId,
    resourceKey,
    name: folder.name,
    source: 'drive',
    imageCount: listing.files.length,
    unsupportedCount: listing.unsupported,
    unsupportedKinds: listing.unsupportedKinds,
    access,
    truncated: listing.truncated,
    candidates: listing.files.slice(0, 12).map((f) => ({
      fileId: f.fileId,
      name: f.name,
      w: f.w,
      h: f.h,
      thumb: `/api/admin/drive/thumb/${f.fileId}${f.resourceKey ? `?rk=${encodeURIComponent(f.resourceKey)}` : ''}`,
    })),
  };
}

// Admin-only thumbnail for not-yet-indexed files during collection creation.
adminRoutes.get('/drive/thumb/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const rk = c.req.query('rk') ?? null;
  if (!isDriveId(fileId) || (rk && !/^[A-Za-z0-9_-]{1,128}$/.test(rk))) return c.notFound();
  try {
    const { res } = await fetchDrivePreview(c.env, fileId, rk, 480);
    const {bytes,type} = await boundedPreview(res);
    return new Response(bytes, {
      headers: {
        'content-type': type,
        'cache-control': 'private, max-age=600',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
});

adminRoutes.post('/collections', async (c) => {
  const parsed = createCollectionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const input = parsed.data;
  let v: FolderValidation;
  try {
    v = await validateFolder(c, input.folderInput);
  } catch (e) {
    if (e instanceof ValidationError) return bad(c, e.message, 422);
    return driveFail(c, e);
  }
  const db = c.env.DB;
  const settings = await getSettings(c.env);
  const preset = PRESETS.find((p) => p.id === input.presetId) ?? PRESETS[0];
  const style = JSON.stringify(applyPreset(defaultStyle(settings), preset));
  const slug = await uniqueSlug(
    db,
    input.slug ?? slugify(input.clientName ? `${input.clientName} ${input.title}` : input.title),
  );
  const id = newId('col');
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO collections (id, slug, title, client_name, event_date, source, drive_folder_id, drive_resource_key, drive_folder_name,
        folder_access, assignment_mode, status, style_draft_json, style_draft_updated_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)`,
    )
    .bind(
      id,
      slug,
      input.title,
      input.clientName || null,
      input.eventDate,
      v.source,
      v.folderId.replace(/^demo:/, ''),
      v.resourceKey,
      v.name,
      v.access,
      input.assignmentMode,
      style,
      now,
      now,
      now,
    )
    .run();
  // Every client gallery gets its own unguessable link at creation; it only opens once published.
  const shareToken = await issueShareToken(db, id);
  const row = (await db.prepare('SELECT * FROM collections WHERE id = ?').bind(id).first<CollectionRow>())!;
  const sync = await syncCollection(c.env, row, 'create');
  if (input.coverFileId) {
    // Choosing a cover is an explicit choice, so it is assigned even in "selected photos" mode.
    await db.batch([
      db
        .prepare('UPDATE photos SET assigned = 1 WHERE collection_id = ? AND drive_file_id = ?')
        .bind(id, input.coverFileId),
      db
        .prepare(
          'UPDATE collections SET cover_photo_id = (SELECT id FROM photos WHERE collection_id = ? AND drive_file_id = ?) WHERE id = ?',
        )
        .bind(id, input.coverFileId, id),
    ]);
  }
  await ensureCover(db, id);
  await refreshCounts(db, id);
  const visible = await db
    .prepare('SELECT photo_count FROM collections WHERE id = ?')
    .bind(id)
    .first<{ photo_count: number }>();
  const published = input.publish && sync.status !== 'error' && (visible?.photo_count ?? 0) > 0;
  if (published) {
    await db
      .prepare(
        `UPDATE collections SET status='published', style_published_json=style_draft_json, style_published_at=?, published_at=? WHERE id=?`,
      )
      .bind(now, now, id)
      .run();
  }
  return c.json({ id, shareToken, published, sync }, 201);
});

adminRoutes.get('/collections/:id', async (c) => {
  const row = await c.env.DB.prepare(`${SUMMARY_SELECT} WHERE c.id = ?`)
    .bind(c.req.param('id'))
    .first<CollectionRow & { cover_w: number; cover_h: number }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const [photos, runs] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM photos WHERE collection_id = ? ORDER BY sort_order')
      .bind(row.id)
      .all<PhotoRow>(),
    c.env.DB.prepare('SELECT * FROM sync_runs WHERE collection_id = ? ORDER BY started_at DESC LIMIT 10')
      .bind(row.id)
      .all<Record<string, unknown>>(),
  ]);
  const detail: AdminCollectionDetail = {
    ...toSummary(row),
    description: row.description,
    driveFolderId: row.drive_folder_id,
    driveFolderName: row.drive_folder_name,
    folderUrl: row.source === 'drive' ? driveFolderUrl(row.drive_folder_id, row.drive_resource_key) : null,
    shareTokenCreatedAt: row.share_token_created_at,
    styleDraft: parseStyle(row.style_draft_json),
    stylePublished: row.style_published_json ? parseStyle(row.style_published_json) : null,
    styleDraftUpdatedAt: row.style_draft_updated_at,
    stylePublishedAt: row.style_published_at,
    publishedAt: row.published_at,
    photos: photos.results.map(toAdminPhoto),
    recentSyncs: runs.results.map(toSyncRun),
  };
  return c.json(detail);
});

adminRoutes.patch('/collections/:id', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const parsed = updateCollectionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const u = parsed.data;
  if (u.slug && u.slug !== row.slug) {
    const free = await uniqueSlug(c.env.DB, u.slug, row.id);
    if (free !== u.slug) return bad(c, 'That internal name is already used by another gallery.', 409);
  }
  if (u.coverPhotoId) {
    const p = await c.env.DB.prepare(
      'SELECT id FROM photos WHERE id = ? AND collection_id = ? AND assigned = 1',
    )
      .bind(u.coverPhotoId, row.id)
      .first();
    if (!p) return bad(c, 'The cover must be one of the photos assigned to this client.', 422);
  }
  const map: Record<string, string> = {
    title: 'title',
    clientName: 'client_name',
    description: 'description',
    eventDate: 'event_date',
    location: 'location',
    slug: 'slug',
    assignmentMode: 'assignment_mode',
    coverPhotoId: 'cover_photo_id',
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(u)) {
    if (v === undefined) continue;
    sets.push(`${map[k]} = ?`);
    vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v === '' ? null : v);
  }
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE collections SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...vals, nowIso(), row.id)
    .run();
  return c.json({ ok: true });
});

adminRoutes.post('/collections/:id/publish', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.photo_count === 0)
    return bad(c, 'Assign at least one photo to this client before publishing.', 422);
  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE collections SET status='published', published_at=COALESCE(published_at, ?), updated_at=?,
       style_published_json=COALESCE(style_published_json, style_draft_json), style_published_at=COALESCE(style_published_at, ?) WHERE id=?`,
  )
    .bind(now, now, now, row.id)
    .run();
  // Publishing a gallery whose link was revoked issues a fresh link.
  const shareToken = row.share_token ?? (await issueShareToken(c.env.DB, row.id));
  return c.json({ ok: true, shareToken });
});

adminRoutes.post('/collections/:id/unpublish', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE collections SET status='draft', updated_at=? WHERE id=?`)
    .bind(nowIso(), row.id)
    .run();
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Client share link

/** Generate (when none) or regenerate: the previous link stops working immediately. */
adminRoutes.post('/collections/:id/link', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const shareToken = await issueShareToken(c.env.DB, row.id);
  return c.json({ ok: true, shareToken, replaced: !!row.share_token });
});

/** Revoke: no link opens this gallery until a new one is generated. */
adminRoutes.delete('/collections/:id/link', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    'UPDATE collections SET share_token = NULL, share_token_created_at = NULL, updated_at = ? WHERE id = ?',
  )
    .bind(nowIso(), row.id)
    .run();
  return c.json({ ok: true });
});

adminRoutes.post('/collections/:id/sync', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  let summary;
  try {
    summary = await syncCollection(c.env, row, 'manual');
  } catch (e) {
    if (e instanceof SyncBusyError) return bad(c, e.message, 409);
    throw e;
  }
  return c.json(summary, summary.status === 'error' ? 502 : 200);
});

adminRoutes.delete('/collections/:id', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  // Deletes app metadata only (gallery, its photo memberships, sync history). Google Drive is never touched.
  await c.env.DB.prepare('DELETE FROM collections WHERE id = ?').bind(row.id).run();
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Photo membership (assign / remove / feature)

adminRoutes.patch('/collections/:id/photos/:photoId', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const parsed = photoPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const photoId = c.req.param('photoId');
  const p = await c.env.DB.prepare('SELECT id, assigned FROM photos WHERE id = ? AND collection_id = ?')
    .bind(photoId, row.id)
    .first<{ id: string; assigned: number }>();
  if (!p) return c.json({ error: 'not_found' }, 404);
  const { assigned, featured } = parsed.data;
  if (featured === true) {
    if (!p.assigned && assigned !== true)
      return bad(c, 'Assign the photo to this client before featuring it.', 422);
    const n = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM photos WHERE collection_id = ? AND featured = 1',
    )
      .bind(row.id)
      .first<{ n: number }>();
    if ((n?.n ?? 0) >= 8) return bad(c, 'Up to 8 featured moments per gallery.', 422);
  }
  const stmts = [];
  if (assigned !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        'UPDATE photos SET assigned = ?1, featured = CASE WHEN ?1 = 0 THEN 0 ELSE featured END WHERE id = ?2',
      ).bind(assigned ? 1 : 0, photoId),
    );
  }
  if (featured !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        `UPDATE photos SET featured = ?, featured_order = CASE WHEN ? = 1 THEN (SELECT COALESCE(MAX(featured_order), 0) + 1 FROM photos WHERE collection_id = ?) ELSE NULL END WHERE id = ?`,
      ).bind(featured ? 1 : 0, featured ? 1 : 0, row.id, photoId),
    );
  }
  stmts.push(c.env.DB.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').bind(nowIso(), row.id));
  await c.env.DB.batch(stmts);
  await ensureCover(c.env.DB, row.id);
  await refreshCounts(c.env.DB, row.id);
  return c.json({ ok: true });
});

adminRoutes.post('/collections/:id/photos/bulk', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const parsed = bulkPhotoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const stmts = parsed.data.ids.map((id) =>
    c.env.DB.prepare(
      'UPDATE photos SET assigned = ?1, featured = CASE WHEN ?1 = 0 THEN 0 ELSE featured END WHERE id = ?2 AND collection_id = ?3',
    ).bind(parsed.data.assigned ? 1 : 0, id, row.id),
  );
  for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
  await ensureCover(c.env.DB, row.id);
  await refreshCounts(c.env.DB, row.id);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Style (draft vs published)

adminRoutes.put('/collections/:id/style', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const parsed = styleSaveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const proposedCover = parsed.data.style.composition?.coverId;
  if (proposedCover) {
    const eligible = await c.env.DB.prepare(
      'SELECT id FROM photos WHERE id = ? AND collection_id = ? AND assigned = 1 AND unavailable = 0',
    )
      .bind(proposedCover, row.id)
      .first();
    if (!eligible) return bad(c, 'The cover must be one of the photos assigned to this client.', 422);
  }

  const now = nowIso();
  // Draft only: the client's live gallery keeps serving style_published_json.
  await c.env.DB.prepare(
    'UPDATE collections SET style_draft_json = ?, style_draft_updated_at = ?, updated_at = ? WHERE id = ?',
  )
    .bind(JSON.stringify(parsed.data.style), now, now, row.id)
    .run();
  return c.json({ ok: true, savedAt: now });
});

adminRoutes.post('/collections/:id/style/publish', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const parsed = styleSaveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const proposedCover = parsed.data.style.composition?.coverId;
  if (proposedCover) {
    const eligible = await c.env.DB.prepare(
      'SELECT id FROM photos WHERE id = ? AND collection_id = ? AND assigned = 1 AND unavailable = 0',
    )
      .bind(proposedCover, row.id)
      .first();
    if (!eligible) return bad(c, 'The cover must be one of the photos assigned to this client.', 422);
  }

  const json = JSON.stringify(parsed.data.style);
  const now = nowIso();
  await c.env.DB.prepare(
    `UPDATE collections SET style_draft_json = ?1, style_published_json = ?1, style_draft_updated_at = ?2, style_published_at = ?2, updated_at = ?2 WHERE id = ?3`,
  )
    .bind(json, now, row.id)
    .run();
  return c.json({ ok: true, publishedAt: now, live: row.status === 'published' });
});

/** Owner preview: exactly the client's payload (assigned photos only), rendered with the draft design. */
adminRoutes.get('/collections/:id/preview', async (c) => {
  const row = await loadCollection(c);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(await buildGallery(c.env, row, { preview: true }));
});

// ------------------------------------------------------------------ Studio settings + default style

adminRoutes.get('/settings', async (c) => {
  const s = await getSettings(c.env);
  return c.json({
    studioName: s.studio_name,
    intro: s.intro,
    contactUrl: s.contact_url,
    contactLabel: s.contact_label,
    defaultStyle: defaultStyle(s),
    demoMode: isDemo(c.env),
    updatedAt: s.updated_at,
  });
});

adminRoutes.put('/settings', async (c) => {
  const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const s = parsed.data;
  await c.env.DB.prepare(
    `UPDATE studio_settings SET studio_name=?, intro=?, contact_url=?, contact_label=?, updated_at=? WHERE id=1`,
  )
    .bind(s.studioName, s.intro || null, s.contactUrl || null, s.contactLabel || null, nowIso())
    .run();
  return c.json({ ok: true });
});

adminRoutes.put('/settings/default-style', async (c) => {
  const parsed = styleSaveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, parsed.error);
  const style = parsed.data.style;
  // Studio defaults carry visual settings, never another client's cover or public introduction.
  if (style.composition) {
    const { template, useTemplate, order, clusters, emphasizeFeatured } = style.composition;
    style.composition = { template, useTemplate, order, clusters, emphasizeFeatured };
  }
  await c.env.DB.prepare('UPDATE studio_settings SET default_style_json = ?, updated_at = ? WHERE id = 1')
    .bind(JSON.stringify(style), nowIso())
    .run();
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ Google Drive connection

adminRoutes.get('/drive/status', async (c) => {
  const conn = await getConnection(c.env);
  const missing = googleConfigMissing(c.env);
  const status: DriveStatus = {
    configured: missing.length === 0,
    missing,
    connected: !!conn,
    email: conn?.email ?? null,
    scopes: conn?.scopes.split(' ') ?? [],
    connectedAt: conn?.connected_at ?? null,
    lastCheckedAt: conn?.last_checked_at ?? null,
    lastError: conn?.last_error ?? null,
    pickerAvailable: !!(c.env.GOOGLE_PICKER_API_KEY && conn),
    demoMode: isDemo(c.env),
  };
  return c.json(status);
});

adminRoutes.post('/drive/connect', async (c) => {
  const missing = googleConfigMissing(c.env);
  if (missing.length) return bad(c, `Missing server secrets: ${missing.join(', ')}.`, 422);
  const state = randomToken(24);
  const verifier = randomToken(48);
  await c.env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(Date.now()-15*60*1000).run();
  await c.env.DB.prepare('INSERT INTO oauth_states (state, code_verifier, created_at, session_hash) VALUES (?, ?, ?, ?)')
    .bind(state, verifier, Date.now(), await sessionTokenHash(c))
    .run();
  return c.json({ url: authUrl(c.env, c.req.url, state, await sha256b64url(verifier)) });
});

adminRoutes.post('/drive/disconnect', async (c) => {
  await disconnect(c.env);
  return c.json({ ok: true });
});

adminRoutes.post('/drive/test', async (c) => {
  const t0 = Date.now();
  try {
    await getAccessToken(c.env);
    const about = await driveGet<{ user?: { emailAddress?: string } }>(c.env, '/about', {
      fields: 'user(emailAddress)',
    });
    await c.env.DB.prepare(
      'UPDATE google_connections SET last_checked_at = ?, last_error = NULL WHERE id = 1',
    )
      .bind(nowIso())
      .run();
    return c.json({ ok: true, ms: Date.now() - t0, email: about.user?.emailAddress ?? null });
  } catch (e) {
    return driveFail(c, e);
  }
});

/** Short-lived token for Google Picker in the owner's browser. Never exposed on public routes. */
adminRoutes.get('/drive/picker', async (c) => {
  if (!c.env.GOOGLE_PICKER_API_KEY) return bad(c, 'Google Picker is not configured.', 404);
  try {
    const token = await getAccessToken(c.env);
    c.header('cache-control', 'no-store');
    return c.json({ apiKey: c.env.GOOGLE_PICKER_API_KEY, appId: c.env.GOOGLE_PROJECT_NUMBER ?? null, token });
  } catch (e) {
    return driveFail(c, e);
  }
});

adminRoutes.get('/sync-runs', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.*, c.title FROM sync_runs s JOIN collections c ON c.id = s.collection_id ORDER BY s.started_at DESC LIMIT 50`,
  ).all<Record<string, unknown>>();
  return c.json({ runs: rows.results.map((r) => ({ ...toSyncRun(r), title: r.title as string })) });
});
