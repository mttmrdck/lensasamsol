import { z } from 'zod';
import { styleConfigSchema } from './style';

/** Public API response schemas — validated on the client so a malformed payload fails loudly, not silently. */

export const publicStudioSchema = z.object({
  name: z.string(),
  intro: z.string().nullable(),
  contactUrl: z.string().nullable(),
  contactLabel: z.string().nullable(),
});

export const publicPhotoSchema = z.object({
  id: z.string(),
  w: z.number(),
  h: z.number(),
  dimsKnown: z.boolean().optional(),
  featured: z.boolean(),
  featuredOrder: z.number().nullable(),
  filename: z.string().nullable(),
  /** Google Drive viewer link for this one file, or null when not available. */
  driveUrl: z.string().nullable(),
  /** Demo fixtures only: attribution + source page. Never present for Drive photos. */
  credit: z.object({ author: z.string(), url: z.string() }).nullable(),
});

export const publicCollectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  eventDate: z.string().nullable(),
  location: z.string().nullable(),
  source: z.enum(['drive', 'demo']),
  coverPhotoId: z.string().nullable(),
  cover: z.object({ id: z.string(), w: z.number(), h: z.number() }).nullable(),
  photoCount: z.number(),
  /** Only present when the folder belongs to this client alone AND the owner enabled the folder button. */
  folderUrl: z.string().nullable(),
  folderAccess: z.enum(['anyone_with_link', 'restricted', 'unknown']),
  style: styleConfigSchema,
});

export const galleryResponseSchema = z.object({
  studio: publicStudioSchema,
  demoMode: z.boolean(),
  preview: z.boolean(),
  collection: publicCollectionSchema,
  photos: z.array(publicPhotoSchema),
});

/** The public landing page knows only the studio — never any client gallery. */
export const studioResponseSchema = z.object({
  studio: publicStudioSchema,
  demoMode: z.boolean(),
});

export type PublicStudio = z.infer<typeof publicStudioSchema>;
export type PublicPhoto = z.infer<typeof publicPhotoSchema>;
export type PublicCollection = z.infer<typeof publicCollectionSchema>;
export type GalleryResponse = z.infer<typeof galleryResponseSchema>;

/** Share tokens: 24 base64url chars from the Worker (144 bits) or 32 hex chars from the migration backfill. */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

// ---------------------------------------------------------------- Admin input schemas

export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

export const assignmentModeSchema = z.enum(['all', 'selected']);
export type AssignmentMode = z.infer<typeof assignmentModeSchema>;

export const createCollectionSchema = z.object({
  title: z.string().trim().min(1).max(140),
  clientName: z.string().trim().max(120).nullable(),
  eventDate: dateSchema,
  slug: slugSchema.optional(),
  folderInput: z.string().trim().min(1).max(2048),
  assignmentMode: assignmentModeSchema,
  presetId: z.enum([
    'minimal-archival',
    'editorial-warm',
    'darkroom-noir',
    'exhibition-white',
    'classic-portrait',
  ]),
  coverFileId: z.string().max(160).nullable(),
  publish: z.boolean(),
});

export const updateCollectionSchema = z
  .object({
    title: z.string().trim().min(1).max(140),
    clientName: z.string().trim().max(120).nullable(),
    description: z.string().max(2000).nullable(),
    eventDate: dateSchema,
    location: z.string().max(140).nullable(),
    slug: slugSchema,
    assignmentMode: assignmentModeSchema,
    coverPhotoId: z.string().max(64).nullable(),
  })
  .partial();

export const photoPatchSchema = z.object({
  assigned: z.boolean().optional(),
  featured: z.boolean().optional(),
});
export const bulkPhotoSchema = z.object({
  ids: z.array(z.string().max(64)).min(1).max(2000),
  assigned: z.boolean(),
});

export const settingsSchema = z.object({
  studioName: z.string().trim().min(1).max(80),
  intro: z.string().max(280).nullable(),
  contactUrl: z
    .string()
    .max(300)
    .refine((v) => /^(https:\/\/|mailto:)/.test(v), 'Use an https:// or mailto: link.')
    .nullable(),
  contactLabel: z.string().max(60).nullable(),
});

export const styleSaveSchema = z.object({ style: styleConfigSchema });

export const loginSchema = z.object({ username: z.string().trim().min(1).max(80).optional(), password: z.string().min(1).max(512) });

export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;

// ---------------------------------------------------------------- Admin response types (server-trusted)

export type SyncStatus = 'never' | 'syncing' | 'synced' | 'partial' | 'error';

export interface AdminCollectionSummary {
  id: string;
  slug: string;
  title: string;
  clientName: string | null;
  eventDate: string | null;
  location: string | null;
  source: 'drive' | 'demo';
  status: 'draft' | 'published';
  assignmentMode: AssignmentMode;
  /** Current share token (null = link revoked). The client URL is /g/<shareToken>. */
  shareToken: string | null;
  photoCount: number;
  unassignedCount: number;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  createdAt: string;
  cover: { id: string; w: number; h: number } | null;
  hasUnpublishedStyle: boolean;
  folderAccess: 'anyone_with_link' | 'restricted' | 'unknown';
}

export interface AdminPhoto {
  id: string;
  driveFileId: string;
  filename: string;
  mimeType: string;
  w: number;
  h: number;
  dimsKnown: boolean;
  /** Member of this client gallery (visible to the client). */
  assigned: boolean;
  featured: boolean;
  featuredOrder: number | null;
  sortOrder: number;
  viewUrl: string | null;
  unavailable: boolean;
}

export interface SyncRun {
  id: string;
  collectionId: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'partial' | 'error';
  added: number;
  removed: number;
  updated: number;
  renamed: number;
  unchanged: number;
  skippedUnsupported: number;
  error: string | null;
}

export interface AdminCollectionDetail extends AdminCollectionSummary {
  description: string | null;
  driveFolderId: string;
  driveFolderName: string | null;
  folderUrl: string | null;
  shareTokenCreatedAt: string | null;
  styleDraft: z.infer<typeof styleConfigSchema>;
  stylePublished: z.infer<typeof styleConfigSchema> | null;
  styleDraftUpdatedAt: string | null;
  stylePublishedAt: string | null;
  publishedAt: string | null;
  photos: AdminPhoto[];
  recentSyncs: SyncRun[];
}

export interface DriveStatus {
  configured: boolean;
  missing: string[];
  connected: boolean;
  email: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  pickerAvailable: boolean;
  demoMode: boolean;
}

export interface FolderValidation {
  folderId: string;
  resourceKey: string | null;
  name: string;
  source: 'drive' | 'demo';
  imageCount: number;
  unsupportedCount: number;
  unsupportedKinds: string[];
  access: 'anyone_with_link' | 'restricted' | 'unknown';
  truncated: boolean;
  candidates: Array<{ fileId: string; name: string; w: number; h: number; thumb: string }>;
}
