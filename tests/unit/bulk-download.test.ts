import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadAll, type PartInfo } from '../../src/lib/bulk-download';
import { attachmentHeader } from '../../shared/download';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'zipcheck-'));
let seq = 0;

interface Entry { name: string; size: number; sha256: string }
/** Independent verification: Python's zipfile checks every CRC-32 and reads every entry back. */
function inspect(bytes: Uint8Array): { bad: string | null; entries: Entry[] } {
  const path = join(dir, `z${seq++}.zip`);
  writeFileSync(path, bytes);
  const py = `
import zipfile, hashlib, json, sys
z = zipfile.ZipFile(sys.argv[1])
bad = z.testzip()
print(json.dumps({"bad": bad, "entries": [{"name": i.filename, "size": i.file_size, "sha256": hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]}))`;
  const r = spawnSync('python3', ['-I', '-c', py, path], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`zip invalid: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function makeFiles(n: number, size = (i: number) => 500 + ((i * 7919) % 4000)) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ph_${String(i).padStart(10, '0')}`,
    filename: i % 10 === 3 ? 'DUPLICATE.JPG' : i % 17 === 5 ? `Café ñ ${i}.jpeg` : `IMG_${String(i).padStart(4, '0')}.jpg`,
    bytes: new Uint8Array(randomBytes(size(i))),
  }));
}
function stubFetch(files: ReturnType<typeof makeFiles>, hook?: (id: string) => Response | undefined) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const id = String(input).split('/').pop()!;
    calls.push(id);
    expect(init?.credentials).toBe('omit');
    expect(init?.referrerPolicy).toBe('no-referrer');
    const forced = hook?.(id);
    if (forced) return forced;
    const f = files.find((x) => x.id === id)!;
    return new Response(f.bytes, { headers: { 'content-length': String(f.bytes.length), 'content-disposition': attachmentHeader(f.filename) } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const run = (files: ReturnType<typeof makeFiles>, extra: Partial<Parameters<typeof downloadAll>[0]> = {}) => {
  const parts: Array<PartInfo> = [];
  const ac = new AbortController();
  const f = stubFetch(files, (extra as { hook?: (id: string) => Response | undefined }).hook);
  const promise = downloadAll({
    photos: files.map((x) => ({ id: x.id, filename: null })),
    zipName: 'Firazanas-Convocation-Day',
    urlFor: (id) => `/dl/t/TOKEN/${id}`,
    signal: ac.signal,
    onProgress: () => undefined,
    fetchImpl: f.impl,
    deliverPart: async (p) => void parts.push(p),
    ...extra,
  });
  return { promise, parts, ac, ...f };
};
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
afterEach(() => vi.useRealTimers());

describe('ZIP integrity (verified with an independent reader)', () => {
  for (const n of [1, 16, 148]) {
    it(`${n} photo(s): one archive, exact names, order and bytes`, async () => {
      const files = makeFiles(n);
      const { promise, parts } = run(files);
      const result = await promise;
      expect(result).toEqual({ saved: n, failed: [] });
      expect(parts).toHaveLength(1);
      expect(parts[0].name).toBe('Firazanas-Convocation-Day.zip');
      const z = inspect(await bytesOf(parts[0].blob));
      expect(z.bad).toBeNull();
      expect(z.entries).toHaveLength(n);
      // duplicates are renamed, nothing is lost, order is the photographer's order
      expect(new Set(z.entries.map((e) => e.name.toLowerCase())).size).toBe(n);
      z.entries.forEach((e, i) => {
        expect(e.sha256).toBe(sha(files[i].bytes));
        expect(e.size).toBe(files[i].bytes.length);
        expect(e.name.replace(/ \(\d+\)(?=\.[^.]+$|$)/, '')).toBe(files[i].filename);
      });
    });
  }

  it('1,250 photos in one archive', async () => {
    const files = makeFiles(1250, () => 300);
    const { promise, parts } = run(files);
    expect((await promise).saved).toBe(1250);
    const z = inspect(await bytesOf(parts[0].blob));
    expect(z.bad).toBeNull();
    expect(z.entries).toHaveLength(1250);
    expect(z.entries.every((e, i) => e.sha256 === sha(files[i].bytes))).toBe(true);
  });

  it('splits into bounded parts, holds one at a time, and loses nothing', async () => {
    const files = makeFiles(60, () => 10_000);
    const parts: PartInfo[] = [];
    const fetchedWhenDelivered: number[] = [];
    const f = stubFetch(files);
    const result = await downloadAll({
      photos: files.map((x) => ({ id: x.id, filename: null })),
      zipName: 'Set',
      urlFor: (id) => `/dl/t/T/${id}`,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      fetchImpl: f.impl,
      partBytes: 100_000, // ten photos per part
      deliverPart: async (p) => {
        parts.push(p);
        fetchedWhenDelivered.push(f.calls.length);
        await new Promise((r) => setTimeout(r, 20)); // the visitor takes a moment to save
        expect(f.calls.length).toBe(fetchedWhenDelivered.at(-1)); // nothing is fetched while a part waits to be saved
      },
    });
    expect(result.saved).toBe(60);
    expect(parts.length).toBeGreaterThanOrEqual(5);
    expect(parts.map((p) => p.name)).toEqual(parts.map((_, i) => `Set-part-${i + 1}.zip`));
    expect(parts.at(-1)!.isLast).toBe(true);
    const all: Entry[] = [];
    for (const p of parts) {
      const z = inspect(await bytesOf(p.blob));
      expect(z.bad).toBeNull();
      all.push(...z.entries);
    }
    expect(all).toHaveLength(60);
    all.forEach((e, i) => expect(e.sha256).toBe(sha(files[i].bytes)));
  });

  it('streaming path writes incrementally to a destination and yields a valid ZIP', async () => {
    const files = makeFiles(40, () => 20_000);
    const chunks: Uint8Array[] = [];
    const writtenWhenFetching: number[] = [];
    const f = stubFetch(files);
    const trackedFetch = vi.fn(async (...a: Parameters<typeof fetch>) => {
      writtenWhenFetching.push(chunks.reduce((n, c) => n + c.length, 0));
      return f.impl(...a);
    }) as unknown as typeof fetch;
    const handle = {
      createWritable: async () =>
        new WritableStream<Uint8Array>({
          write(chunk) {
            chunks.push(chunk);
          },
        }),
    } as unknown as FileSystemFileHandle;
    const result = await downloadAll({
      photos: files.map((x) => ({ id: x.id, filename: null })),
      zipName: 'Stream',
      urlFor: (id) => `/dl/t/T/${id}`,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      fetchImpl: trackedFetch,
      target: handle,
    });
    expect(result.saved).toBe(40);
    // bytes were already being written while later photos had not been requested: it streams, it does not collect
    expect(writtenWhenFetching[30]).toBeGreaterThan(0);
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    const z = inspect(out);
    expect(z.bad).toBeNull();
    z.entries.forEach((e, i) => expect(e.sha256).toBe(sha(files[i].bytes)));
  });
});

describe('interrupted and truncated bodies', () => {
  const broken = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(100));
          c.error(new Error('reset'));
        },
      }),
    );

  it('in-memory path: a body that dies mid-transfer is reported, never added, and the rest is intact', async () => {
    const files = makeFiles(8);
    const { promise, parts } = run(files, { hook: (id: string) => (id === files[2].id ? broken() : undefined) } as never);
    const result = await promise;
    expect(result.saved).toBe(7);
    expect(result.failed).toHaveLength(1);
    const z = inspect(await bytesOf(parts[0].blob));
    expect(z.bad).toBeNull();
    expect(z.entries.at(-1)!.name).toBe('DOWNLOAD-ERRORS.txt');
    expect(z.entries).toHaveLength(8); // 7 photos + the report
    expect(z.entries.slice(0, 7).every((e) => files.some((f) => sha(f.bytes) === e.sha256))).toBe(true);
  });

  it('in-memory path: a body shorter than its declared length is not accepted as complete', async () => {
    const files = makeFiles(4);
    const short = (id: string) =>
      id === files[1].id ? new Response(new Uint8Array(50), { headers: { 'content-length': '5000' } }) : undefined;
    const { promise, parts } = run(files, { hook: short } as never);
    const result = await promise;
    expect(result.saved).toBe(3);
    expect(result.failed).toHaveLength(1);
    expect(inspect(await bytesOf(parts[0].blob)).bad).toBeNull();
  });

  it('streaming path: a body that dies mid-file fails the whole download and aborts the file', async () => {
    const files = makeFiles(6, () => 5000);
    const f = stubFetch(files, (id) => (id === files[3].id ? broken() : undefined));
    let aborted = false;
    const handle = {
      createWritable: async () =>
        new WritableStream<Uint8Array>({
          write() {},
          abort() {
            aborted = true;
          },
        }),
    } as unknown as FileSystemFileHandle;
    await expect(
      downloadAll({
        photos: files.map((x) => ({ id: x.id, filename: null })),
        zipName: 'x',
        urlFor: (id) => `/dl/t/T/${id}`,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: f.impl,
        target: handle,
      }),
    ).rejects.toBeTruthy(); // surfaced as an error, so the UI cannot report success
    expect(aborted).toBe(true);
  });
});

describe('failures, retries and cancellation', () => {
  it('records unavailable photos instead of dropping them silently', async () => {
    const files = makeFiles(20);
    const json = (status: number, message: string) => new Response(JSON.stringify({ message }), { status });
    const { promise, parts } = run(files, {
      hook: (id: string) => (id === files[4].id ? json(404, 'This photograph is no longer available in Google Drive.') : id === files[9].id ? json(413, 'Too large.') : undefined),
    } as never);
    const result = await promise;
    expect(result.saved).toBe(18);
    expect(result.failed.map((x) => x.reason)).toEqual(['This photograph is no longer available in Google Drive.', 'Too large.']);
    const z = inspect(await bytesOf(parts[0].blob));
    expect(z.bad).toBeNull();
    expect(z.entries).toHaveLength(19); // 18 photos + DOWNLOAD-ERRORS.txt
    expect(z.entries.at(-1)!.name).toBe('DOWNLOAD-ERRORS.txt');
  });

  it('retries a transient 503 and then succeeds', async () => {
    vi.useFakeTimers();
    const files = makeFiles(3);
    let hits = 0;
    const { promise, parts } = run(files, {
      hook: (id: string) => (id === files[1].id && hits++ < 2 ? new Response('busy', { status: 503 }) : undefined),
    } as never);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result).toEqual({ saved: 3, failed: [] });
    expect(parts).toHaveLength(1);
    expect(hits).toBe(3);
  });

  it('gives up on a persistent 503 after bounded retries and reports it', async () => {
    vi.useFakeTimers();
    const files = makeFiles(2);
    const { promise } = run(files, { hook: (id: string) => (id === files[0].id ? new Response('busy', { status: 503 }) : undefined) } as never);
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await promise;
    expect(result.saved).toBe(1);
    expect(result.failed).toHaveLength(1);
  });

  it('a client cancel stops the run: no further requests, nothing delivered', async () => {
    const files = makeFiles(50);
    const ac = new AbortController();
    const parts: PartInfo[] = [];
    let count = 0;
    const f = stubFetch(files, () => {
      if (++count === 5) ac.abort();
      return undefined;
    });
    await expect(
      downloadAll({
        photos: files.map((x) => ({ id: x.id, filename: null })),
        zipName: 'x',
        urlFor: (id) => `/dl/t/T/${id}`,
        signal: ac.signal,
        onProgress: () => undefined,
        fetchImpl: f.impl,
        deliverPart: async (p) => void parts.push(p),
      }),
    ).rejects.toBeTruthy();
    expect(f.calls.length).toBeLessThanOrEqual(6);
    expect(parts).toHaveLength(0);
  });
});
