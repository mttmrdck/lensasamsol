import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadRoutes } from '../../worker/downloads';
import { DriveError, fetchDriveOriginal } from '../../worker/google';
import type { Env } from '../../worker/env';
import { createD1, insertCollection } from './d1-sqlite';

vi.mock('../../worker/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../worker/google')>();
  return { ...actual, fetchDriveOriginal: vi.fn() };
});

const TOKEN_A = 'tokenAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = 'tokenBBBBBBBBBBBBBBBBBBBB';
let d1: ReturnType<typeof createD1>;
let env: Env;
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function photo(id: string, collection: string, over: Record<string, unknown> = {}) {
  const row = { filename: 'IMG_0001.JPG', mime: 'image/jpeg', assigned: 1, unavailable: 0, resource_key: null, demo_asset: null, ...over };
  d1.sqlite
    .prepare(
      `INSERT INTO photos (id, collection_id, drive_file_id, filename, mime_type, width, height, sort_order, source_version, created_at, updated_at, assigned, unavailable, resource_key, demo_asset)
       VALUES (?,?,?,?,?,3000,2000,0,'1','2026-01-01','2026-01-01',?,?,?,?)`,
    )
    .run(id, collection, `drive-${id}`, row.filename as string, row.mime as string, row.assigned as number, row.unavailable as number, row.resource_key as string | null, row.demo_asset as string | null);
}
const get = (token: string, id: string, init?: RequestInit) =>
  downloadRoutes.fetch(new Request(`https://g.example.test/t/${token}/${id}`, init), env);

beforeEach(() => {
  vi.clearAllMocks();
  d1 = createD1();
  env = { DB: d1.db, APP_ENV: 'production', DEMO_MODE: 'false' } as unknown as Env;
  insertCollection(d1.sqlite, 'col_a', { status: 'published' });
  insertCollection(d1.sqlite, 'col_b', { status: 'published' });
  d1.sqlite.prepare('UPDATE collections SET share_token=? WHERE id=?').run(TOKEN_A, 'col_a');
  d1.sqlite.prepare('UPDATE collections SET share_token=? WHERE id=?').run(TOKEN_B, 'col_b');
  photo('ph_AAAAAAAAAAAA', 'col_a');
  photo('ph_BBBBBBBBBBBB', 'col_b', { filename: 'B.jpg' });
  vi.mocked(fetchDriveOriginal).mockImplementation(async () =>
    new Response(bytes, { headers: { 'content-length': String(bytes.length), 'content-type': 'text/html', 'set-cookie': 'x=1' } }),
  );
});

describe('authorized original download', () => {
  it('streams an assigned photo of a published gallery with safe, private headers', async () => {
    const res = await get(TOKEN_A, 'ph_AAAAAAAAAAAA');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="IMG_0001.JPG"; filename*=UTF-8''IMG_0001.JPG`);
    expect(res.headers.get('content-type')).toBe('image/jpeg'); // from the index, never the upstream's value
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    // nothing from the upstream's headers (cookies, auth) reaches the visitor
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('authorization')).toBeNull();
  });

  it('rejects drafts, revoked links, wrong tokens, unassigned and unavailable photos', async () => {
    d1.sqlite.prepare("UPDATE collections SET status='draft' WHERE id='col_b'").run();
    expect((await get(TOKEN_B, 'ph_BBBBBBBBBBBB')).status).toBe(404); // draft
    d1.sqlite.prepare("UPDATE collections SET share_token=NULL WHERE id='col_a'").run();
    expect((await get(TOKEN_A, 'ph_AAAAAAAAAAAA')).status).toBe(404); // revoked
    expect((await get('tokenZZZZZZZZZZZZZZZZZZZZ', 'ph_BBBBBBBBBBBB')).status).toBe(404); // unknown token
    d1.sqlite.prepare("UPDATE collections SET status='published', share_token=? WHERE id='col_b'").run(TOKEN_B);
    photo('ph_CCCCCCCCCCCC', 'col_b', { assigned: 0 });
    photo('ph_DDDDDDDDDDDD', 'col_b', { unavailable: 1 });
    expect((await get(TOKEN_B, 'ph_CCCCCCCCCCCC')).status).toBe(404); // unassigned
    expect((await get(TOKEN_B, 'ph_DDDDDDDDDDDD')).status).toBe(404); // unavailable
    expect(fetchDriveOriginal).not.toHaveBeenCalled(); // nothing was ever requested from Drive
  });

  it("never serves another gallery's photo, whatever ID is guessed", async () => {
    expect((await get(TOKEN_A, 'ph_BBBBBBBBBBBB')).status).toBe(404);
    expect((await get(TOKEN_B, 'ph_AAAAAAAAAAAA')).status).toBe(404);
    expect(fetchDriveOriginal).not.toHaveBeenCalled();
  });

  it('refuses malformed tokens and IDs before touching the database', async () => {
    expect((await get('short', 'ph_AAAAAAAAAAAA')).status).toBe(404);
    expect((await get(TOKEN_A, 'drive-file-id-raw')).status).toBe(404); // a bare Drive file ID is not accepted
    expect((await get(TOKEN_A, "ph_AAAAAAAAAAAA'--")).status).toBe(404);
    expect(fetchDriveOriginal).not.toHaveBeenCalled();
  });

  it('keeps unicode names exact and header-safe', async () => {
    photo('ph_EEEEEEEEEEEE', 'col_a', { filename: 'Café "Ñandú"\r\nX: y.jpg' });
    const res = await get(TOKEN_A, 'ph_EEEEEEEEEEEE');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).toContain("filename*=UTF-8''Caf%C3%A9");
  });

  it('passes the visitor abort signal and the resource key to Drive', async () => {
    d1.sqlite.prepare("UPDATE photos SET resource_key='rk123' WHERE id='ph_AAAAAAAAAAAA'").run();
    const ac = new AbortController();
    await get(TOKEN_A, 'ph_AAAAAAAAAAAA', { signal: ac.signal });
    const [, fileId, rk, signal] = vi.mocked(fetchDriveOriginal).mock.calls[0];
    expect(fileId).toBe('drive-ph_AAAAAAAAAAAA');
    expect(rk).toBe('rk123');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('maps Drive failures to sanitized, non-401 responses', async () => {
    const cases: Array<[DriveError['kind'], number]> = [['not_found', 404], ['forbidden', 503], ['upstream', 502], ['auth', 502], ['not_connected', 502]];
    for (const [kind, status] of cases) {
      vi.mocked(fetchDriveOriginal).mockRejectedValueOnce(new DriveError(kind, 'Readable problem.', 500));
      const res = await get(TOKEN_A, 'ph_AAAAAAAAAAAA');
      expect(res.status, kind).toBe(status);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe('Readable problem.');
      expect(JSON.stringify(body)).not.toMatch(/token|bearer|authorization/i);
      if (status === 503) expect(res.headers.get('retry-after')).toBe('30');
    }
    vi.mocked(fetchDriveOriginal).mockRejectedValueOnce(new Error('boom: Bearer ya29.secret'));
    const res = await get(TOKEN_A, 'ph_AAAAAAAAAAAA');
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('ya29');
  });

  it('refuses a file larger than the cap and cancels the upstream body', async () => {
    const cancel = vi.fn();
    vi.mocked(fetchDriveOriginal).mockResolvedValueOnce(
      new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(500 * 1024 * 1024) } }),
    );
    const res = await get(TOKEN_A, 'ph_AAAAAAAAAAAA');
    expect(res.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
  });

  it('streams: the response is available before the upstream finishes (nothing is buffered)', async () => {
    let push!: (chunk: Uint8Array, close?: boolean) => void;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk, close) => {
          controller.enqueue(chunk);
          if (close) controller.close();
        };
      },
    });
    vi.mocked(fetchDriveOriginal).mockResolvedValueOnce(new Response(upstream));
    const res = await get(TOKEN_A, 'ph_AAAAAAAAAAAA'); // resolves while the upstream has produced nothing
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = reader.read();
    push(new Uint8Array([1, 2, 3]));
    expect((await first).value).toEqual(new Uint8Array([1, 2, 3]));
    push(new Uint8Array([4]), true);
    expect((await reader.read()).value).toEqual(new Uint8Array([4]));
    expect((await reader.read()).done).toBe(true);
  });

  it('a visitor cancel reaches the upstream', async () => {
    const cancel = vi.fn();
    vi.mocked(fetchDriveOriginal).mockResolvedValueOnce(new Response(new ReadableStream({ pull() {}, cancel })));
    const res = await get(TOKEN_A, 'ph_AAAAAAAAAAAA');
    await res.body!.cancel();
    expect(cancel).toHaveBeenCalled();
  });

  it('demo galleries are unreachable unless demo mode is on', async () => {
    d1.sqlite.prepare("UPDATE collections SET source='demo' WHERE id='col_a'").run();
    expect((await get(TOKEN_A, 'ph_AAAAAAAAAAAA')).status).toBe(404);
  });
});
