import type { Env } from './env';
import { batchAll, nowIso, refreshCounts, type CollectionRow, type PhotoRow } from './db';
import { newId } from './crypto';
import { DriveError, folderAccess, listFolder, orientedDims } from './google';
import { listDemoFolder } from './demo';
import { KNOWN_UNSUPPORTED_IMAGE, SUPPORTED_MIME, safeDriveUrl } from '../shared/drive';

/** Normalised source file — Drive and demo fixtures both reduce to this before diffing. */
export interface SourceFile {
  fileId: string;
  name: string;
  mimeType: string;
  w: number;
  h: number;
  dimsKnown: boolean;
  version: string;
  modifiedTime: string | null;
  viewUrl: string | null;
  resourceKey: string | null;
  demoAsset: string | null;
  demoCredit: string | null;
}

export interface Listing {
  files: SourceFile[];
  unsupported: number;
  unsupportedKinds: string[];
  truncated: boolean;
}

export async function listSource(
  env: Env,
  source: 'drive' | 'demo',
  folderId: string,
  resourceKey: string | null,
): Promise<Listing> {
  if (source === 'demo') {
    const files = listDemoFolder(folderId.replace(/^demo:/, '')).map<SourceFile>((f) => ({
      fileId: f.fileId,
      name: f.name,
      mimeType: 'image/jpeg',
      w: f.w,
      h: f.h,
      dimsKnown: true,
      version: 'fixture-1',
      modifiedTime: null,
      viewUrl: null,
      resourceKey: null,
      demoAsset: f.asset,
      demoCredit: JSON.stringify(f.credit),
    }));
    return { files, unsupported: 0, unsupportedKinds: [], truncated: false };
  }
  const { files, truncated } = await listFolder(env, folderId, resourceKey);
  const kinds = new Set<string>();
  let unsupported = 0;
  const out: SourceFile[] = [];
  for (const f of files) {
    if ((SUPPORTED_MIME as readonly string[]).includes(f.mimeType)) {
      const d = orientedDims(f);
      out.push({
        fileId: f.id,
        name: f.name,
        mimeType: f.mimeType,
        w: d.w,
        h: d.h,
        dimsKnown: d.known,
        version: f.version ?? f.md5Checksum ?? f.modifiedTime ?? '0',
        modifiedTime: f.modifiedTime ?? null,
        viewUrl: safeDriveUrl(f.webViewLink),
        resourceKey: f.resourceKey ?? null,
        demoAsset: null,
        demoCredit: null,
      });
    } else if (
      KNOWN_UNSUPPORTED_IMAGE.test(f.mimeType) ||
      /\.(heic|heif|cr2|cr3|nef|arw|dng|raf|orf|tif|tiff|gif|mov|mp4)$/i.test(f.name)
    ) {
      unsupported++;
      kinds.add((f.name.split('.').pop() ?? f.mimeType).toUpperCase());
    }
  }
  return { files: out, unsupported, unsupportedKinds: [...kinds].slice(0, 6), truncated };
}

export interface SyncSummary {
  runId: string;
  status: 'success' | 'partial' | 'error';
  added: number;
  removed: number;
  updated: number;
  renamed: number;
  unchanged: number;
  skippedUnsupported: number;
  error: string | null;
}

/**
 * Re-indexes a collection against its source folder. Only app metadata changes:
 * Drive files are never written, moved or deleted. Removed files simply leave the gallery index.
 */
export class SyncBusyError extends Error {}
const LOCK_TTL_MS = 5 * 60 * 1000;

export async function syncCollection(env: Env, c: CollectionRow, trigger: string): Promise<SyncSummary> {
  const db = env.DB;
  const runId = newId('sync');
  const started = nowIso();
  // Atomic lock: only one sync per collection; stale locks (crashed requests) expire after 5 minutes.
  const claim = await db
    .prepare(
      `UPDATE collections SET sync_status = 'syncing', sync_started_at = ?1
       WHERE id = ?2 AND (sync_status != 'syncing' OR sync_started_at IS NULL OR sync_started_at < ?3)`,
    )
    .bind(Date.now(), c.id, Date.now() - LOCK_TTL_MS)
    .run();
  if (!claim.meta.changes) throw new SyncBusyError('A sync is already running for this collection.');
  await db
    .prepare(
      `INSERT INTO sync_runs (id, collection_id, trigger, started_at, status) VALUES (?, ?, ?, ?, 'running')`,
    )
    .bind(runId, c.id, trigger, started)
    .run();
  try {
    const listing = await listSource(env, c.source, c.drive_folder_id, c.drive_resource_key);
    const existing = (
      await db.prepare('SELECT * FROM photos WHERE collection_id = ?').bind(c.id).all<PhotoRow>()
    ).results;
    const byFile = new Map(existing.map((p) => [p.drive_file_id, p]));
    const seen = new Set<string>();
    const stmts: D1PreparedStatement[] = [];
    const now = nowIso();
    let added = 0,
      updated = 0,
      renamed = 0,
      unchanged = 0;
    listing.files.forEach((f, order) => {
      seen.add(f.fileId);
      const prev = byFile.get(f.fileId);
      if (!prev) {
        added++;
        stmts.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO photos (id, collection_id, drive_file_id, filename, mime_type, width, height, dims_known, sort_order,
                source_version, modified_time, view_url, resource_key, demo_asset, demo_credit, created_at, updated_at, assigned)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              newId('ph'),
              c.id,
              f.fileId,
              f.name,
              f.mimeType,
              f.w,
              f.h,
              f.dimsKnown ? 1 : 0,
              order,
              f.version,
              f.modifiedTime,
              f.viewUrl,
              f.resourceKey,
              f.demoAsset,
              f.demoCredit,
              now,
              now,
              // 'all': the folder belongs to this client, new files join the gallery.
              // 'selected': shared folder, new files stay out until the photographer assigns them.
              c.assignment_mode === 'selected' ? 0 : 1,
            ),
        );
        return;
      }
      const changedVersion = prev.source_version !== f.version;
      const changedName = prev.filename !== f.name;
      if (changedVersion) updated++;
      else if (changedName) renamed++;
      else unchanged++;
      if (
        changedVersion ||
        changedName ||
        prev.sort_order !== order ||
        prev.view_url !== f.viewUrl ||
        prev.width !== f.w || prev.height !== f.h || prev.dims_known !== (f.dimsKnown ? 1 : 0) ||
        prev.resource_key !== f.resourceKey ||
        prev.unavailable
      ) {
        stmts.push(
          db
            .prepare(
              `UPDATE photos SET filename=?, mime_type=?, width=?, height=?, dims_known=?, sort_order=?, source_version=?, modified_time=?,
                view_url=?, resource_key=?, unavailable=0, updated_at=? WHERE id=?`,
            )
            .bind(
              f.name,
              f.mimeType,
              f.w,
              f.h,
              f.dimsKnown ? 1 : 0,
              order,
              f.version,
              f.modifiedTime,
              f.viewUrl,
              f.resourceKey,
              now,
              prev.id,
            ),
        );
      }
    });
    // A truncated listing can't prove absence, so nothing is removed in that case.
    const gone = listing.truncated ? [] : existing.filter((p) => !seen.has(p.drive_file_id));
    for (const p of gone) stmts.push(db.prepare('DELETE FROM photos WHERE id = ?').bind(p.id));
    await batchAll(db, stmts);

    const access =
      c.source === 'drive' ? await folderAccess(env, c.drive_folder_id, c.drive_resource_key) : 'unknown';
    const status = listing.truncated ? 'partial' : 'success';
    const summary: SyncSummary = {
      runId,
      status,
      added,
      removed: gone.length,
      updated,
      renamed,
      unchanged,
      skippedUnsupported: listing.unsupported,
      error: listing.truncated
        ? 'Folder has more files than one sync can index (20,000). Remaining files were skipped.'
        : null,
    };
    await db.batch([
      db
        .prepare(
          `UPDATE sync_runs SET finished_at=?, status=?, added=?, removed=?, updated=?, renamed=?, unchanged=?, skipped_unsupported=?, error=? WHERE id=?`,
        )
        .bind(
          nowIso(),
          status,
          added,
          gone.length,
          updated,
          renamed,
          unchanged,
          listing.unsupported,
          summary.error,
          runId,
        ),
      db
        .prepare(
          `UPDATE collections SET sync_status=?1, sync_error=?2, last_synced_at=?3, folder_access=?4, updated_at=?3, sync_started_at=NULL,
           cover_photo_id = CASE WHEN cover_photo_id IN (SELECT id FROM photos WHERE collection_id = ?5 AND assigned = 1) THEN cover_photo_id ELSE NULL END
         WHERE id = ?5`,
        )
        .bind(status === 'success' ? 'synced' : 'partial', summary.error, nowIso(), access, c.id),
    ]);
    await ensureCover(db, c.id);
    await refreshCounts(db, c.id);
    return summary;
  } catch (e) {
    const msg = e instanceof DriveError ? e.message : 'Sync failed unexpectedly.';
    await db.batch([
      db
        .prepare(`UPDATE sync_runs SET finished_at=?, status='error', error=? WHERE id=?`)
        .bind(nowIso(), msg, runId),
      db
        .prepare(`UPDATE collections SET sync_status='error', sync_error=?, sync_started_at=NULL WHERE id=?`)
        .bind(msg, c.id),
    ]);
    if (!(e instanceof DriveError)) console.error('sync_failed');
    return {
      runId,
      status: 'error',
      added: 0,
      removed: 0,
      updated: 0,
      renamed: 0,
      unchanged: 0,
      skippedUnsupported: 0,
      error: msg,
    };
  }
}

/** Picks a sensible default cover (first visible landscape frame) when none is set. */
/**
 * Keeps the cover valid: it must be an assigned, available member of the gallery (an unassigned photo is
 * never exposed as a cover). Falls back to the first assigned landscape frame, then any assigned frame.
 */
export async function ensureCover(db: D1Database, collectionId: string) {
  await db.batch([
    db
      .prepare(
        `UPDATE collections SET cover_photo_id = NULL
         WHERE id = ?1 AND cover_photo_id IS NOT NULL
           AND cover_photo_id NOT IN (SELECT id FROM photos WHERE collection_id = ?1 AND assigned = 1 AND unavailable = 0)`,
      )
      .bind(collectionId),
    db
      .prepare(
        `UPDATE collections SET cover_photo_id = COALESCE(
           (SELECT id FROM photos WHERE collection_id = ?1 AND assigned = 1 AND unavailable = 0 AND width > height ORDER BY sort_order LIMIT 1),
           (SELECT id FROM photos WHERE collection_id = ?1 AND assigned = 1 AND unavailable = 0 ORDER BY sort_order LIMIT 1))
         WHERE id = ?1 AND cover_photo_id IS NULL`,
      )
      .bind(collectionId),
  ]);
}
