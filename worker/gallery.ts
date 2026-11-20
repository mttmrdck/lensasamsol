import { orderPhotos, selectCover } from '../shared/composition';
import type { Env } from './env';
import { isDemo } from './env';
import type { CollectionRow, PhotoRow } from './db';
import type { GalleryResponse, PublicStudio } from '../shared/api';
import { DEFAULT_STYLE, parseStyle, type StyleConfig } from '../shared/style';
import { driveFolderUrl, safeDriveUrl } from '../shared/drive';

export interface SettingsRow {
  studio_name: string;
  intro: string | null;
  contact_url: string | null;
  contact_label: string | null;
  homepage_enabled: number;
  default_style_json: string | null;
  updated_at: string;
}

export async function getSettings(env: Env): Promise<SettingsRow> {
  const row = await env.DB.prepare('SELECT * FROM studio_settings WHERE id = 1').first<SettingsRow>();
  return (
    row ?? {
      studio_name: 'lensasamsol',
      intro: null,
      contact_url: null,
      contact_label: null,
      homepage_enabled: 1,
      default_style_json: null,
      updated_at: new Date().toISOString(),
    }
  );
}

export const defaultStyle = (s: SettingsRow): StyleConfig => parseStyle(s.default_style_json, DEFAULT_STYLE);

export function publicStudio(s: SettingsRow): PublicStudio {
  return { name: s.studio_name, intro: s.intro, contactUrl: s.contact_url, contactLabel: s.contact_label };
}

/**
 * Builds the visitor payload for ONE client gallery. Only that gallery's assigned, available photos;
 * no Drive IDs, tokens, client names or other galleries. Used identically for the owner's preview.
 */
export async function buildGallery(
  env: Env,
  c: CollectionRow,
  opts: { preview: boolean; style?: StyleConfig },
): Promise<GalleryResponse> {
  const settings = await getSettings(env);
  let style =
    opts.style ??
    parseStyle(opts.preview ? c.style_draft_json : (c.style_published_json ?? c.style_draft_json));
  const sourceRows = (
    await env.DB.prepare(
      'SELECT * FROM photos WHERE collection_id = ? AND assigned = 1 AND unavailable = 0 ORDER BY sort_order',
    )
      .bind(c.id)
      .all<PhotoRow>()
  ).results;
  const rows = opts.preview ? sourceRows : orderPhotos(sourceRows, style.composition?.order);
  const withNames = opts.preview || style.actions.showFilenames;
  const proposedCover = style.composition?.coverId;
  if (proposedCover && !rows.some((p) => p.id === proposedCover)) {
    // A photo may have been unassigned since this design was saved; do not emit its ID.
    style = { ...style, composition: { ...style.composition!, coverId: undefined } };
  }
  const eligibleCovers = rows.map((p) => ({
    id: p.id,
    w: p.width,
    h: p.height,
    featured: !!p.featured,
    dimsKnown: !!p.dims_known,
  }));
  const cover = selectCover(
    eligibleCovers,
    opts.preview ? undefined : style.composition?.coverId,
    c.cover_photo_id,
  );
  // A folder link opens EVERY file in the Drive folder. Only offer it when the folder belongs to this
  // client alone ('all' mode) and the owner explicitly enabled the button.
  const folderAllowed =
    !style.composition &&
    c.source === 'drive' &&
    c.assignment_mode === 'all' &&
    style.actions.showFolderButton;
  return {
    studio: publicStudio(settings),
    demoMode: isDemo(env),
    preview: opts.preview,
    collection: {
      id: c.id,
      title: opts.preview ? c.title : (style.composition?.title ?? c.title),
      description: opts.preview ? c.description : (style.composition?.description ?? c.description),
      eventDate: c.event_date,
      location: c.location,
      source: c.source,
      coverPhotoId: opts.preview
        ? (eligibleCovers.find((p) => p.id === c.cover_photo_id)?.id ?? null)
        : (cover?.id ?? null),
      cover: cover ? { id: cover.id, w: cover.w, h: cover.h } : null,
      photoCount: rows.length,
      folderUrl: folderAllowed ? driveFolderUrl(c.drive_folder_id, c.drive_resource_key) : null,
      folderAccess: c.folder_access,
      style,
    },
    photos: rows.map((p) => ({
      id: p.id,
      w: p.width,
      h: p.height,
      dimsKnown: !!p.dims_known,
      featured: !!p.featured,
      featuredOrder: p.featured ? p.featured_order : null,
      filename: withNames ? p.filename : null,
      driveUrl: c.source === 'drive' ? safeDriveUrl(p.view_url) : null,
      credit: p.demo_credit ? (JSON.parse(p.demo_credit) as { author: string; url: string }) : null,
    })),
  };
}
