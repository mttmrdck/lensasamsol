import type { Env } from './env';
import { decryptSecret, encryptSecret } from './crypto';
import type { OAuthFailureCode } from '../shared/oauth';
import { boundedImageBody, MAX_IMAGE_SOURCE_BYTES } from './image-delivery';

/**
 * Google OAuth + Drive v3 client.
 *
 * Scope decision (see ARCHITECTURE.md): `drive.readonly`. `drive.file` + Picker only grants access to items the
 * user explicitly picks; Google's documentation does not state that picking a folder grants access to its
 * children or to files added later, which is exactly what sync needs. drive.readonly is a *restricted* scope:
 * fine for a single-owner personal app (unverified-app warning, Testing-mode token expiry caveats documented),
 * but it must never be presented to the public.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const OAUTH_SCOPES = ['openid', 'email', DRIVE_SCOPE];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE = 'https://www.googleapis.com/drive/v3';

export function googleConfigMissing(env: Env): string[] {
  const need: Array<keyof Env> = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY'];
  if (env.APP_ENV && env.APP_ENV !== 'development') need.push('GOOGLE_ALLOWED_EMAIL');
  return need.filter((k) => !env[k]);
}

export class DriveError extends Error {
  constructor(
    public kind:
      'not_connected' | 'auth' | 'not_found' | 'forbidden' | 'rate_limited' | 'upstream' | 'config',
    message: string,
    public status = 0,
    public callbackCode?: OAuthFailureCode,
    public redirectLocationPresent?: boolean,
  ) {
    super(message);
  }
}

/** Workers rejects redirect:error before sending a request. Keep the no-redirect policy explicitly. */
async function googleFetch(url: string | URL, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    // Read presence only; never follow, log, return, or retain a potentially sensitive destination.
    const hasLocation = res.headers.has('location');
    await res.body?.cancel();
    throw new DriveError(
      'upstream',
      'Google returned an unexpected redirect.',
      res.status,
      'token_exchange_redirect',
      hasLocation,
    );
  }
  return res;
}

export function redirectUri(env: Env, requestUrl: string): string {
  const origin = env.PUBLIC_ORIGIN || new URL(requestUrl).origin;
  return `${origin}/api/admin/drive/callback`;
}

export function authUrl(env: Env, requestUrl: string, state: string, challenge: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  u.searchParams.set('redirect_uri', redirectUri(env, requestUrl));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', OAUTH_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCode(env: Env, requestUrl: string, code: string, verifier: string) {
  const res = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(env, requestUrl),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token)
    throw new DriveError('auth', 'Google could not complete authorization. Start a new connection attempt.', res.status, 'token_exchange_failed');
  if (!Number.isFinite(data.expires_in) || data.expires_in <= 60 || typeof data.scope !== 'string') throw new DriveError('auth','Google returned an invalid token response.', res.status, 'token_exchange_failed');
  let email: string | null = null;
  if (data.id_token) {
    // id_token came straight from Google's token endpoint over TLS (OIDC §3.1.3.7), so we only decode it.
    try {
      const payload = JSON.parse(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      email = typeof payload.email === 'string' && payload.email_verified === true && payload.aud === env.GOOGLE_CLIENT_ID && ['https://accounts.google.com','accounts.google.com'].includes(payload.iss) && Number(payload.exp) * 1000 > Date.now() ? payload.email : null;
    } catch {
      email = null;
    }
  }
  if (env.GOOGLE_ALLOWED_EMAIL && email?.toLowerCase() !== env.GOOGLE_ALLOWED_EMAIL.trim().toLowerCase()) throw new DriveError('forbidden','Connect the Google Drive account configured for this studio.', 0, 'google_identity_failed');
  return { ...data, email };
}

export async function storeConnection(env: Env, t: Awaited<ReturnType<typeof exchangeCode>>) {
  if (!t.refresh_token) {
    throw new DriveError(
      'auth',
      'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.',
      0,
      'refresh_token_missing',
    );
  }
  const key = env.TOKEN_ENCRYPTION_KEY!;
  const now = new Date().toISOString();
  let refreshEncrypted: string, accessEncrypted: string;
  try {
    refreshEncrypted = await encryptSecret(t.refresh_token, key);
    accessEncrypted = await encryptSecret(t.access_token, key);
  } catch {
    throw new DriveError(
      'config',
      'Could not encrypt the Google connection.',
      0,
      'token_encryption_failed',
    );
  }
  try {
    await env.DB.prepare(
      `INSERT INTO google_connections (id, email, scopes, refresh_token_enc, access_token_enc, access_expires_at, connected_at, last_checked_at, last_error)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, scopes=excluded.scopes, refresh_token_enc=excluded.refresh_token_enc,
       access_token_enc=excluded.access_token_enc, access_expires_at=excluded.access_expires_at, connected_at=excluded.connected_at,
       last_checked_at=excluded.last_checked_at, last_error=NULL`,
    )
      .bind(
        t.email,
        t.scope,
        refreshEncrypted,
        accessEncrypted,
        Date.now() + (t.expires_in - 60) * 1000,
        now,
        now,
      )
      .run();
  } catch {
    throw new DriveError(
      'upstream',
      'Could not save the Google connection.',
      0,
      'connection_save_failed',
    );
  }
  memo = null;
}

interface ConnRow {
  email: string | null;
  scopes: string;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: number | null;
  connected_at: string;
  last_checked_at: string | null;
  last_error: string | null;
}

export async function getConnection(env: Env): Promise<ConnRow | null> {
  return env.DB.prepare('SELECT * FROM google_connections WHERE id = 1').first<ConnRow>();
}

let memo: { token: string; exp: number; conn: string } | null = null;

/** Returns a valid access token, refreshing with the encrypted refresh token when needed. Server-side only. */
export async function getAccessToken(env: Env): Promise<string> {
  if (googleConfigMissing(env).length)
    throw new DriveError('config', 'Google credentials are not configured.');
  const row = await getConnection(env);
  if (!row) {
    memo = null;
    throw new DriveError('not_connected', 'Google Drive is not connected.');
  }
  // The in-isolate cache is only valid for the connection it was issued for (reconnect/disconnect in another isolate).
  if (memo && memo.conn === row.connected_at + row.refresh_token_enc && memo.exp > Date.now()) return memo.token;
  const key = env.TOKEN_ENCRYPTION_KEY!;
  if (row.access_token_enc && row.access_expires_at && row.access_expires_at > Date.now()) {
    memo = {
      token: await decryptSecret(row.access_token_enc, key),
      exp: row.access_expires_at,
      conn: row.connected_at + row.refresh_token_enc,
    };
    return memo.token;
  }
  const refresh = await decryptSecret(row.refresh_token_enc, key);
  const res = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    const msg =
      data.error === 'invalid_grant'
        ? 'Google access was revoked or expired. Reconnect Google Drive.'
        : `Token refresh failed (${data.error ?? res.status}).`;
    await env.DB.prepare('UPDATE google_connections SET last_error = ?, last_checked_at = ? WHERE id = 1')
      .bind(msg, new Date().toISOString())
      .run();
    throw new DriveError('auth', msg, res.status);
  }
  if (!Number.isFinite(data.expires_in) || data.expires_in <= 60) throw new DriveError('auth','Google returned an invalid token lifetime.');
  const exp = Date.now() + (data.expires_in - 60) * 1000;
  const updated = await env.DB.prepare(
    'UPDATE google_connections SET access_token_enc = ?, access_expires_at = ?, last_error = NULL WHERE id = 1 AND connected_at = ? AND refresh_token_enc = ?',
  )
    .bind(await encryptSecret(data.access_token, key), exp, row.connected_at, row.refresh_token_enc)
    .run();
  if (!updated.meta.changes) throw new DriveError('auth','The Drive connection changed. Try again.');
  memo = { token: data.access_token, exp, conn: row.connected_at + row.refresh_token_enc };
  return data.access_token;
}

export async function disconnect(env: Env): Promise<void> {
  const row = await getConnection(env);
  // Invalidate local authority before waiting for Google's best-effort revocation.
  await env.DB.prepare('DELETE FROM google_connections WHERE id = 1').run();
  memo = null;
  if (row && env.TOKEN_ENCRYPTION_KEY) {
    try {
      const refresh = await decryptSecret(row.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY);
      await googleFetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh }),
        signal:AbortSignal.timeout(10000),
      });
    } catch {
      // Revocation is best-effort; the local credential is deleted regardless.
    }
  }

}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authenticated Drive GET with exponential backoff on 429/5xx/rate-limit 403s. */
export async function driveGet<T>(
  env: Env,
  path: string,
  params: Record<string, string>,
  resourceKeys?: string,
): Promise<T> {
  const url = new URL(`${DRIVE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(env);
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (resourceKeys) headers['x-goog-drive-resource-keys'] = resourceKeys;
    const res = await googleFetch(url, { headers, signal:AbortSignal.timeout(15000) });
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimit|RateLimit/.test(reason));
    if ((rateLimited || res.status >= 500) && attempt < 4) {
      await sleep(2 ** attempt * 500 + Math.random() * 400);
      continue;
    }
    if (res.status === 401) {
      memo = null;
      throw new DriveError('auth', 'Google rejected the stored credentials. Reconnect Google Drive.', 401);
    }
    if (rateLimited)
      throw new DriveError(
        'rate_limited',
        'Google Drive rate limit reached. Try again in a minute.',
        res.status,
      );
    if (res.status === 404)
      throw new DriveError('not_found', 'Not found, or not shared with the connected Google account.', 404);
    if (res.status === 403)
      throw new DriveError('forbidden', body.error?.message ?? 'Access denied by Google Drive.', 403);
    throw new DriveError('upstream', `Google Drive error ${res.status}.`, res.status);
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  version?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
  resourceKey?: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number };
}

export async function getFolder(env: Env, folderId: string, resourceKey: string | null) {
  const rk = resourceKey ? `${folderId}/${resourceKey}` : undefined;
  const f = await driveGet<DriveFile & { trashed?: boolean }>(
    env,
    `/files/${encodeURIComponent(folderId)}`,
    { fields: 'id,name,mimeType,resourceKey,webViewLink,trashed', supportsAllDrives: 'true' },
    rk,
  );
  if (f.mimeType !== 'application/vnd.google-apps.folder') {
    throw new DriveError('not_found', 'That link is not a folder.');
  }
  if (f.trashed) throw new DriveError('not_found', 'That folder is in the Drive trash.');
  return f;
}

/** Determines whether an anonymous visitor could open the folder (an "anyone with the link" permission). */
export async function folderAccess(env: Env, folderId: string, resourceKey: string | null) {
  try {
    const rk = resourceKey ? `${folderId}/${resourceKey}` : undefined;
    const r = await driveGet<{ permissions?: Array<{ type: string; role: string }> }>(
      env,
      `/files/${encodeURIComponent(folderId)}/permissions`,
      { fields: 'permissions(type,role)', supportsAllDrives: 'true' },
      rk,
    );
    return (r.permissions ?? []).some((p) => p.type === 'anyone') ? 'anyone_with_link' : 'restricted';
  } catch {
    // Only users who can share may list permissions; otherwise the state is genuinely unknown.
    return 'unknown';
  }
}

/** Lists direct children (non-recursive). Folder ID is regex-validated before reaching this query string. */
export async function listFolder(env: Env, folderId: string, resourceKey: string | null, maxPages = 20) {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let incomplete = false;
  const rk = resourceKey ? `${folderId}/${resourceKey}` : undefined;
  do {
    const params: Record<string, string> = {
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        'nextPageToken,incompleteSearch,files(id,name,mimeType,version,md5Checksum,modifiedTime,webViewLink,resourceKey,imageMediaMetadata(width,height,rotation))',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      orderBy: 'name_natural',
    };
    if (pageToken) params.pageToken = pageToken;
    const r = await driveGet<{ files: DriveFile[]; nextPageToken?: string; incompleteSearch?: boolean }>(env, '/files', params, rk);
    files.push(...r.files);
    incomplete ||= r.incompleteSearch === true;
    pageToken = r.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);
  return { files, truncated: !!pageToken || incomplete };
}

/** Drive reports raw sensor dimensions; rotation 1/3 (90°/270°) means the displayed image is transposed. */
export function orientedDims(f: DriveFile): { w: number; h: number; known: boolean } {
  const w = f.imageMediaMetadata?.width;
  const h = f.imageMediaMetadata?.height;
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return { w: 3, h: 2, known: false };
  const rot = f.imageMediaMetadata?.rotation ?? 0;
  return rot % 2 === 1 ? { w: h, h: w, known: true } : { w, h, known: true };
}

/** Fetch an authorized, bounded derivative. Originals never form the browser response. */
export async function fetchDrivePreview(
  env: Env,
  fileId: string,
  resourceKey: string | null,
  longEdge: number,
) {
  const rk = resourceKey ? `${fileId}/${resourceKey}` : undefined;
  const f = await driveGet<DriveFile & { size?: string; capabilities?: { canDownload?: boolean } }>(
    env,
    `/files/${encodeURIComponent(fileId)}`,
    { fields: 'thumbnailLink,version,mimeType,size,capabilities(canDownload)', supportsAllDrives: 'true' },
    rk,
  );
  const token = await getAccessToken(env);
  if (env.IMAGES && f.capabilities?.canDownload === true &&
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimeType) &&
      Number(f.size) > 0 && Number(f.size) <= MAX_IMAGE_SOURCE_BYTES) {
    const abort = new AbortController();
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (rk) headers['x-goog-drive-resource-keys'] = rk;
      const mediaUrl = new URL(`${DRIVE}/files/${encodeURIComponent(fileId)}`);
      mediaUrl.searchParams.set('alt', 'media');
      mediaUrl.searchParams.set('supportsAllDrives', 'true');
      const media = await googleFetch(mediaUrl, { headers,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]) });
      const source = boundedImageBody(media, MAX_IMAGE_SOURCE_BYTES);
      const size = Math.min(2560, Math.max(1, longEdge));
      const output = await env.IMAGES.input(source).transform({ width: size, height: size, fit: 'scale-down' })
        .output({ format: 'image/webp', quality: size > 1600 ? 88 : 84, anim: false });
      const transformed = output.response();
      if (transformed.headers.get('content-type')?.split(';')[0] !== 'image/webp') {
        void transformed.body?.cancel().catch(() => {});
        throw new Error('Unexpected derivative format');
      }
      // A generated derivative is the only media response exposed to the client.
      const body = boundedImageBody(transformed);
      return { res: new Response(body, { headers: { 'content-type': 'image/webp' } }),
        version: f.version ?? '0', quality: 'transformed' as const };
    } catch {
      abort.abort();
      // Controlled degradation: a documented thumbnail, never an unbounded original or arbitrary URL.
    }
  }
  if (!f.thumbnailLink) throw new DriveError('not_found', 'Google Drive has no preview for this file yet.');
  // Thumbnail URLs are short-lived and their resolution is not a supported resizing interface.
  const u = new URL(f.thumbnailLink);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !/\.googleusercontent\.com$|\.google\.com$/.test(u.hostname)) {
    throw new DriveError('upstream', 'Unexpected thumbnail host.');
  }
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` }, redirect:'manual', signal:AbortSignal.timeout(15000) });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new DriveError(
      res.status === 404 ? 'not_found' : 'upstream',
      `Preview fetch failed (${res.status}).`,
      res.status,
    );
  }
  return { res, version: f.version ?? '0', quality: 'thumbnail-fallback' as const };
}
