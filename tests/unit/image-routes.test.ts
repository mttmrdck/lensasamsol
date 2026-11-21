import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageRoutes } from '../../worker/images';
import { fetchDrivePreview, getConnection } from '../../worker/google';
import type { Env } from '../../worker/env';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

vi.mock('../../worker/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../worker/google')>();
  return { ...actual, fetchDrivePreview: vi.fn(), getConnection: vi.fn() };
});
const token = 'syntheticGalleryToken000001';
const photoId = 'ph_synthetic0001';
const privatePolicy = 'private, no-store';

beforeEach(() => {
  vi.mocked(getConnection).mockResolvedValue({
    email: 'owner@example.test',
    connected_at: 'epoch-1',
    refresh_token_enc: 'encrypted-fixture',
    scopes: '',
    access_token_enc: null,
    access_expires_at: null,
    last_checked_at: null,
    last_error: null,
  });
  vi.mocked(fetchDrivePreview).mockImplementation(async () => ({
    res: new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }),
    version: 'v1',
    quality: 'transformed',
  }));
});
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(`CREATE TABLE collections(id TEXT,share_token TEXT,status TEXT,source TEXT);
    CREATE TABLE photos(id TEXT,collection_id TEXT,drive_file_id TEXT,resource_key TEXT,source_version TEXT,demo_asset TEXT,assigned INTEGER,unavailable INTEGER);`);
  db.prepare('INSERT INTO collections VALUES (?,?,?,?)').run('fixture-gallery', token, 'published', 'drive');
  db.prepare('INSERT INTO photos VALUES (?,?,?,?,?,?,?,?)').run(
    photoId,
    'fixture-gallery',
    'drive-file-a',
    null,
    'v1',
    null,
    1,
    0,
  );
  const stored = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => stored.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      const bytes = await response.arrayBuffer(); // Cache API stores only complete, successful bodies.
      stored.set(request.url, new Response(bytes, { headers: response.headers }));
    }),
  };
  vi.stubGlobal('caches', { default: cache });
  const prepare = vi.fn((sql: string) => {
    if (
      !sql.includes("c.status = 'published'") ||
      !sql.includes('p.assigned = 1') ||
      !sql.includes('p.unavailable = 0')
    ) {
      throw new Error('Visitor image query must enforce publication, assignment and availability');
    }
    let bound: unknown[] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        bound = args;
        return statement;
      },
      first: async () => db.prepare(sql.replace(/\?\d+/g, '?')).get(...(bound as SQLInputValue[])) ?? null,
    };
    return statement;
  });
  const env = {
    APP_ENV: 'staging',
    DEMO_MODE: 'false',
    GOOGLE_ALLOWED_EMAIL: 'owner@example.test',
    TOKEN_ENCRYPTION_KEY: 'fixture-key',
    GOOGLE_CLIENT_ID: 'fixture-client',
    DB: { prepare },
    IMAGES: {
      input: () => ({
        transform: () => ({
          output: async () => ({
            response: () =>
              new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }),
          }),
        }),
      }),
    },
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const context = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException() {},
    props: {},
  };
  const request = async (variant = 'm', gallery = token, headers: Record<string, string> = {}) => {
    const response = await imageRoutes.fetch(
      new Request(`https://gallery.example.test/t/${gallery}/${photoId}/${variant}`, { headers }),
      env,
      context as Parameters<typeof imageRoutes.fetch>[2],
    );
    await response.clone().arrayBuffer();
    await Promise.all(pending);
    return response;
  };
  return {
    env,
    cache,
    prepare,
    request,
    cacheEntries: () => stored.size,
    flush: () => Promise.all(pending),
    revoke: (reason = 'revoked') => {
      const changes: Record<string, string> = {
        revoked: 'UPDATE collections SET share_token=NULL',
        unpublished: "UPDATE collections SET status='draft'",
        unassigned: 'UPDATE photos SET assigned=0',
        unavailable: 'UPDATE photos SET unavailable=1',
      };
      db.exec(changes[reason]);
    },
    changeVersion: () => {
      db.exec("UPDATE photos SET source_version='v2'");
    },
    changeFile: () => {
      db.exec("UPDATE photos SET drive_file_id='drive-file-b'");
    },
  };
}

describe('private derivative authorization and cache isolation', () => {
  it('delivers no-store images and rechecks authorization before a warm internal cache', async () => {
    const f = fixture();
    const first = await f.request();
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe(privatePolicy);
    expect(f.cache.put).toHaveBeenCalledTimes(2); // bounded xl master plus the requested smaller derivative
    const second = await f.request();
    expect(second.status).toBe(200);
    expect(fetchDrivePreview).toHaveBeenCalledTimes(1);
    expect(f.prepare).toHaveBeenCalledTimes(2);
  });

  it('reuses one bounded master preview for grid, hero and lightbox instead of repeatedly downloading media', async () => {
    const f = fixture();
    await f.request('m');
    await f.request('l');
    await f.request('xl');
    expect(fetchDrivePreview).toHaveBeenCalledTimes(1);
    expect(fetchDrivePreview).toHaveBeenCalledWith(expect.anything(), expect.anything(), null, 2560);
  });

  it.each(['revoked', 'unpublished', 'unassigned', 'unavailable'])(
    'denies %s access before cache or conditional response',
    async (reason) => {
      const f = fixture();
      const first = await f.request();
      f.revoke(reason);
      f.cache.match.mockClear();
      const response = await f.request('m', token, { 'if-none-match': first.headers.get('etag')! });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe(privatePolicy);
      expect(f.cache.match).not.toHaveBeenCalled();
    },
  );

  it('does not let gallery B fetch gallery A images even after a cache hit', async () => {
    const f = fixture();
    await f.request();
    f.cache.match.mockClear();
    expect((await f.request('m', 'syntheticGalleryToken000002')).status).toBe(404);
    expect(f.cache.match).not.toHaveBeenCalled();
    expect(fetchDrivePreview).toHaveBeenCalledTimes(1);
  });

  it.each(['toString', 'constructor', '__proto__', 'original'])(
    'rejects non-variant %s without querying D1',
    async (variant) => {
      const f = fixture();
      expect((await f.request(variant)).status).toBe(404);
      expect(f.prepare).not.toHaveBeenCalled();
    },
  );

  it('supports the bounded xl tier', async () => {
    const f = fixture();
    expect((await f.request('xl')).status).toBe(200);
    expect(fetchDrivePreview).toHaveBeenCalledWith(expect.anything(), expect.anything(), null, 2560);
  });

  it('invalidates both the cache and ETag when the source version or file changes', async () => {
    const f = fixture();
    const first = await f.request();
    const etag = first.headers.get('etag')!;
    f.changeVersion();
    const second = await f.request('m', token, { 'if-none-match': etag });
    expect(second.status).toBe(200);
    expect(second.headers.get('etag')).not.toBe(etag);
    f.changeFile();
    const third = await f.request();
    expect(third.headers.get('etag')).not.toBe(second.headers.get('etag'));
    expect(fetchDrivePreview).toHaveBeenCalledTimes(3);
  });

  it('requires an active matching Drive connection before using cached media', async () => {
    const f = fixture();
    const first = await f.request();
    f.cache.match.mockClear();
    vi.mocked(getConnection).mockResolvedValue(null);
    expect((await f.request('m', token, { 'if-none-match': first.headers.get('etag')! })).status).toBe(404);
    expect(f.cache.match).not.toHaveBeenCalled();
  });

  it('namespaces derivatives and ETags across reconnects', async () => {
    const f = fixture();
    const first = await f.request();
    vi.mocked(getConnection).mockResolvedValue({ ...(await getConnection(f.env))!, connected_at: 'epoch-2' });
    const second = await f.request('m', token, { 'if-none-match': first.headers.get('etag')! });
    expect(second.status).toBe(200);
    expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'));
    expect(fetchDrivePreview).toHaveBeenCalledTimes(2);
  });

  it('does not commit a broken streaming master to the internal cache', async () => {
    const f = fixture();
    vi.mocked(fetchDrivePreview).mockImplementation(async () => ({
      res: new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error('synthetic-private-upstream-failure'));
          },
        }),
        { headers: { 'content-type': 'image/webp' } },
      ),
      version: 'v1',
      quality: 'transformed',
    }));
    await expect(f.request('xl')).rejects.toThrow('Image stream failed');
    await f.flush();
    expect(f.cacheEntries()).toBe(0);
  });
});
