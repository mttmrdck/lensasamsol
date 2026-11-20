/**
 * Google Drive identifier handling. The server never fetches user-supplied URLs: input is reduced to a
 * validated folder/file ID (+ optional resource key) and only fixed googleapis.com endpoints are called.
 */

const ID_RE = /^[A-Za-z0-9_-]{10,128}$/;
const RESOURCE_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ALLOWED_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export const isDriveId = (s: string): boolean => ID_RE.test(s);

export type FolderParse =
  | { ok: true; folderId: string; resourceKey: string | null }
  | { ok: false; reason: 'empty' | 'not-drive' | 'not-folder' | 'bad-id' };

export function parseDriveFolderInput(raw: string): FolderParse {
  const input = raw.trim();
  if (!input) return { ok: false, reason: 'empty' };
  if (ID_RE.test(input)) return { ok: true, folderId: input, resourceKey: null };
  let url: URL;
  try {
    url = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return { ok: false, reason: 'not-drive' };
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname))
    return { ok: false, reason: 'not-drive' };
  const rk = url.searchParams.get('resourcekey');
  const resourceKey = rk && RESOURCE_KEY_RE.test(rk) ? rk : null;
  const m = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([^/]+)\/?$/);
  if (m)
    return ID_RE.test(m[1]) ? { ok: true, folderId: m[1], resourceKey } : { ok: false, reason: 'bad-id' };
  if (url.pathname === '/open' && url.searchParams.get('id')) {
    const id = url.searchParams.get('id')!;
    return ID_RE.test(id) ? { ok: true, folderId: id, resourceKey } : { ok: false, reason: 'bad-id' };
  }
  if (/^\/file\/d\//.test(url.pathname) || /^\/(document|spreadsheets|presentation)\//.test(url.pathname)) {
    return { ok: false, reason: 'not-folder' };
  }
  return { ok: false, reason: 'not-drive' };
}

export const FOLDER_PARSE_MESSAGES: Record<Exclude<FolderParse, { ok: true }>['reason'], string> = {
  empty: 'Paste a Google Drive folder link.',
  'not-drive':
    'That doesn’t look like a Google Drive link. It should start with https://drive.google.com/drive/folders/…',
  'not-folder': 'That link points to a single file. Paste the link of the folder that holds the photographs.',
  'bad-id': 'The folder ID in that link looks incomplete. Copy the link again from Drive’s Share dialog.',
};

export function driveFolderUrl(folderId: string, resourceKey?: string | null): string {
  const u = new URL(`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`);
  if (resourceKey) u.searchParams.set('resourcekey', resourceKey);
  return u.toString();
}

export function driveFileUrl(fileId: string, resourceKey?: string | null): string {
  const u = new URL(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`);
  if (resourceKey) u.searchParams.set('resourcekey', resourceKey);
  return u.toString();
}

/** Accepts only https links on Google Drive hosts (used for webViewLink values from the API). */
export function safeDriveUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

export const SUPPORTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const KNOWN_UNSUPPORTED_IMAGE = /^image\/(heic|heif|x-.*|tiff|gif|avif|bmp|svg\+xml)|^video\//;
