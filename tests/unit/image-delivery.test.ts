import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedImageBody, MAX_IMAGE_SOURCE_BYTES } from '../../worker/image-delivery';
import { fetchDrivePreview } from '../../worker/google';
import { encryptSecret } from '../../worker/crypto';
import type { Env } from '../../worker/env';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bounded streaming images', () => {
  it('allows the exact limit without collecting the input first', async () => {
    const stream = boundedImageBody(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
      3,
    );
    expect((await new Response(stream).arrayBuffer()).byteLength).toBe(3);
  });
  it.each([undefined, '1'])(
    'counts actual bytes even with missing/lying Content-Length (%s)',
    async (length) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(4));
        },
        cancel,
      });
      const headers: Record<string, string> = { 'content-type': 'image/jpeg' };
      if (length) headers['content-length'] = length;
      await expect(
        new Response(boundedImageBody(new Response(body, { headers }), 3)).arrayBuffer(),
      ).rejects.toThrow();
      expect(cancel).toHaveBeenCalled();
    },
  );
  it.each(['image/svg+xml', 'text/html', 'application/octet-stream'])('rejects and cancels %s', (type) => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    expect(() => boundedImageBody(new Response(body, { headers: { 'content-type': type } }))).toThrow(
      'Invalid image response',
    );
    expect(cancel).toHaveBeenCalled();
  });
  it('cancels an input declared above the 20MB boundary', () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    expect(() =>
      boundedImageBody(
        new Response(body, {
          headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_IMAGE_SOURCE_BYTES + 1) },
        }),
        MAX_IMAGE_SOURCE_BYTES,
      ),
    ).toThrow();
    expect(cancel).toHaveBeenCalled();
  });
  it('sanitizes source stream errors', async () => {
    const body = new ReadableStream({
      pull(c) {
        c.error(new Error('synthetic-private-upstream-detail'));
      },
    });
    await expect(
      new Response(
        boundedImageBody(new Response(body, { headers: { 'content-type': 'image/png' } })),
      ).arrayBuffer(),
    ).rejects.toThrow('Image stream failed');
  });
});

async function fixture() {
  const key = Buffer.alloc(32, 7).toString('base64');
  const connection = {
    connected_at: crypto.randomUUID(),
    refresh_token_enc: 'fixture-refresh-encrypted',
    access_token_enc: await encryptSecret('synthetic-access', key),
    access_expires_at: Date.now() + 60000,
  };
  const transform = vi.fn(() => ({ output }));
  const output = vi.fn(async () => ({
    response: () => new Response(new Uint8Array([7, 8]), { headers: { 'content-type': 'image/webp' } }),
  }));
  const input = vi.fn((_stream: ReadableStream<Uint8Array>) => ({ transform }));
  const env = {
    TOKEN_ENCRYPTION_KEY: key,
    GOOGLE_CLIENT_ID: 'fixture',
    GOOGLE_CLIENT_SECRET: 'fixture',
    GOOGLE_ALLOWED_EMAIL: 'owner@example.test',
    APP_ENV: 'staging',
    DB: { prepare: () => ({ first: async () => connection }) },
    IMAGES: { input },
  } as unknown as Env;
  const metadata = {
    mimeType: 'image/jpeg',
    size: '100',
    version: 'v1',
    capabilities: { canDownload: true },
    thumbnailLink: 'https://lh3.googleusercontent.com/synthetic-thumbnail',
  };
  const fetcher = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const u = new URL(url);
    if (u.searchParams.get('alt') === 'media')
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    if (u.hostname === 'lh3.googleusercontent.com')
      return new Response(new Uint8Array([4]), { headers: { 'content-type': 'image/jpeg' } });
    return Response.json(metadata);
  });
  vi.stubGlobal('fetch', fetcher);
  return { env, metadata, input, transform, output, fetcher };
}

describe('authorized media to bounded derivatives', () => {
  it('passes a stream to Images, requests a scale-down WebP, and exposes only its derivative', async () => {
    const f = await fixture();
    const result = await fetchDrivePreview(f.env, 'synthetic-file', 'resource-key-fixture', 2560);
    expect(result.quality).toBe('transformed');
    expect(f.input).toHaveBeenCalledWith(expect.any(ReadableStream));
    expect(f.transform).toHaveBeenCalledWith({ width: 2560, height: 2560, fit: 'scale-down' });
    expect(f.output).toHaveBeenCalledWith({ format: 'image/webp', quality: 88, anim: false });
    expect([...new Uint8Array(await result.res.arrayBuffer())]).toEqual([7, 8]);
    const mediaCall = f.fetcher.mock.calls.find(([url]) => new URL(url).searchParams.get('alt') === 'media')!;
    expect(mediaCall[1]).toMatchObject({
      redirect: 'manual',
      headers: {
        authorization: 'Bearer synthetic-access',
        'x-goog-drive-resource-keys': 'synthetic-file/resource-key-fixture',
      },
    });
    expect(result.res.headers.has('authorization')).toBe(false);
    expect(result.res.headers.has('location')).toBe(false);
  });

  it.each(['missing-binding', 'cannot-download', 'too-large', 'unsupported-type'])(
    'uses a documented thumbnail without fetching media for %s',
    async (mode) => {
      const f = await fixture();
      if (mode === 'missing-binding') f.env.IMAGES = undefined;
      if (mode === 'cannot-download') f.metadata.capabilities.canDownload = false;
      if (mode === 'too-large') f.metadata.size = String(MAX_IMAGE_SOURCE_BYTES + 1);
      if (mode === 'unsupported-type') f.metadata.mimeType = 'image/svg+xml';
      const result = await fetchDrivePreview(f.env, 'synthetic-file', null, 1600);
      expect(result.quality).toBe('thumbnail-fallback');
      expect(f.fetcher.mock.calls.some(([url]) => new URL(url).searchParams.get('alt') === 'media')).toBe(
        false,
      );
      expect(f.input).not.toHaveBeenCalled();
    },
  );

  it('never falls back to original bytes when transformation fails', async () => {
    const f = await fixture();
    f.output.mockRejectedValue(new Error('synthetic-private-detail'));
    const result = await fetchDrivePreview(f.env, 'synthetic-file', null, 1600);
    expect(result.quality).toBe('thumbnail-fallback');
    expect([...new Uint8Array(await result.res.arrayBuffer())]).toEqual([4]);
  });

  it.each([
    'http://lh3.googleusercontent.com/x',
    'https://lh3.googleusercontent.com.evil.invalid/x',
    'https://secret@lh3.googleusercontent.com/x',
  ])('refuses unsafe thumbnail destination %s', async (url) => {
    const f = await fixture();
    f.env.IMAGES = undefined;
    f.metadata.thumbnailLink = url;
    await expect(fetchDrivePreview(f.env, 'synthetic-file', null, 1600)).rejects.toThrow(
      'Unexpected thumbnail host',
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});
