import type { AdminCollectionSummary, AdminPhoto, AssignmentMode, SyncRun } from '../shared/api';
import { randomToken } from './crypto';

export const nowIso = () => new Date().toISOString();

export interface CollectionRow {
  id: string;
  slug: string;
  title: string;
  client_name: string | null;
  description: string | null;
  event_date: string | null;
  location: string | null;
  source: 'drive' | 'demo';
  drive_folder_id: string;
  drive_resource_key: string | null;
  drive_folder_name: string | null;
  folder_access: 'anyone_with_link' | 'restricted' | 'unknown';
  cover_photo_id: string | null;
  status: 'draft' | 'published';
  assignment_mode: AssignmentMode;
  share_token: string | null;
  share_token_created_at: string | null;
  style_draft_json: string;
  style_published_json: string | null;
  style_draft_updated_at: string | null;
  style_published_at: string | null;
  sync_status: AdminCollectionSummary['syncStatus'];
  sync_error: string | null;
  sync_started_at?: number | null;
  last_synced_at: string | null;
  photo_count: number;
  hidden_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface PhotoRow {
  id: string;
  collection_id: string;
  drive_file_id: string;
  filename: string;
  mime_type: string;
  width: number;
  height: number;
  dims_known: number;
  sort_order: number;
  /** Membership of this Drive file in this client gallery. */
  assigned: number;
  featured: number;
  featured_order: number | null;
  source_version: string;
  modified_time: string | null;
  view_url: string | null;
  resource_key: string | null;
  demo_asset: string | null;
  demo_credit: string | null;
  unavailable: number;
}

export function toSummary(
  r: CollectionRow & { cover_w?: number | null; cover_h?: number | null },
): AdminCollectionSummary {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    clientName: r.client_name,
    eventDate: r.event_date,
    location: r.location,
    source: r.source,
    status: r.status,
    assignmentMode: r.assignment_mode,
    shareToken: r.share_token,
    photoCount: r.photo_count,
    unassignedCount: r.hidden_count,
    syncStatus: r.sync_status,
    syncError: r.sync_error,
    lastSyncedAt: r.last_synced_at,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    cover:
      r.cover_photo_id && r.cover_w && r.cover_h
        ? { id: r.cover_photo_id, w: r.cover_w, h: r.cover_h }
        : null,
    hasUnpublishedStyle: r.status === 'published' && r.style_published_json !== r.style_draft_json,
    folderAccess: r.folder_access,
  };
}

export function toAdminPhoto(p: PhotoRow): AdminPhoto {
  return {
    id: p.id,
    driveFileId: p.drive_file_id,
    filename: p.filename,
    mimeType: p.mime_type,
    w: p.width,
    h: p.height,
    dimsKnown: !!p.dims_known,
    assigned: !!p.assigned,
    featured: !!p.featured,
    featuredOrder: p.featured_order,
    sortOrder: p.sort_order,
    viewUrl: p.view_url,
    unavailable: !!p.unavailable,
  };
}

export function toSyncRun(r: Record<string, unknown>): SyncRun {
  return {
    id: r.id as string,
    collectionId: r.collection_id as string,
    trigger: r.trigger as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null,
    status: r.status as SyncRun['status'],
    added: r.added as number,
    removed: r.removed as number,
    updated: r.updated as number,
    renamed: r.renamed as number,
    unchanged: r.unchanged as number,
    skippedUnsupported: r.skipped_unsupported as number,
    error: (r.error as string) ?? null,
  };
}

/** Cover dims only when the cover is an assigned member (never leak an unassigned photo as a cover). */
export const SUMMARY_SELECT = `SELECT c.*, p.width AS cover_w, p.height AS cover_h
  FROM collections c LEFT JOIN photos p ON p.id = c.cover_photo_id AND p.assigned = 1`;

/** photo_count = photos the client can see; hidden_count column now stores the unassigned count. */
export async function refreshCounts(db: D1Database, collectionId: string) {
  await db
    .prepare(
      `UPDATE collections SET
        photo_count = (SELECT COUNT(*) FROM photos WHERE collection_id = ?1 AND assigned = 1 AND unavailable = 0),
        hidden_count = (SELECT COUNT(*) FROM photos WHERE collection_id = ?1 AND assigned = 0)
       WHERE id = ?1`,
    )
    .bind(collectionId)
    .run();
}

/** Runs prepared statements in D1 batches (each batch is a transaction). */
export async function batchAll(db: D1Database, stmts: D1PreparedStatement[], size = 80) {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'collection'
  );
}

export async function uniqueSlug(db: D1Database, base: string, exceptId?: string): Promise<string> {
  let slug = base;
  for (let n = 2; n < 200; n++) {
    const row = await db
      .prepare('SELECT id FROM collections WHERE slug = ?')
      .bind(slug)
      .first<{ id: string }>();
    if (!row || row.id === exceptId) return slug;
    slug = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** 18 random bytes → 24 base64url chars (144 bits). Unique index + retry handles the theoretical collision. */
export async function issueShareToken(db: D1Database, collectionId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomToken(18);
    try {
      await db
        .prepare(
          'UPDATE collections SET share_token = ?, share_token_created_at = ?, updated_at = ? WHERE id = ?',
        )
        .bind(token, nowIso(), nowIso(), collectionId)
        .run();
      return token;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
    }
  }
  throw new Error('Could not generate a unique share link.');
}
