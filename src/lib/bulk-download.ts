import { NameAllocator, nameFromDisposition, safeFileName } from '../../shared/download';

/**
 * "Download all" runs in the visitor's browser: it fetches each original through the authorized per-photo endpoint
 * and writes a ZIP (entries are stored, not recompressed: photos are already compressed). The Worker therefore never
 * builds an archive, which would need a CRC-32 over every byte of the gallery.
 *
 *  - Browsers that can write a file directly (File System Access API: Chrome, Edge) stream one ZIP to disk. Memory
 *    use is flat however large the gallery is, and bytes are pulled only as fast as they are written (backpressure).
 *  - Other browsers (Safari, Firefox, iPhone) build the ZIP in memory, so the gallery is split into parts of about
 *    PART_BYTES each and the visitor saves each part with one tap. Only one part is ever held at a time.
 */
export const PART_BYTES = 160 * 1024 * 1024;

export interface DownloadPhoto {
  id: string;
  filename: string | null;
}
export interface PartInfo {
  index: number;
  count: number;
  bytes: number;
  name: string;
  blob: Blob;
  isLast: boolean;
}
export interface BulkProgress {
  /** Photos fully handled so far, out of `total`. Only real counts are reported, never an estimate. */
  done: number;
  total: number;
}
export interface BulkResult {
  saved: number;
  failed: Array<{ name: string; reason: string }>;
}
interface Options {
  photos: DownloadPhoto[];
  zipName: string; // without extension
  urlFor: (photoId: string) => string;
  signal: AbortSignal;
  onProgress: (p: BulkProgress) => void;
  /** Present when the browser offered a destination file (streaming path). */
  target?: FileSystemFileHandle;
  /** Fallback path: called with each finished part; resolves once the visitor has saved it. */
  deliverPart?: (part: PartInfo) => Promise<void>;
  fetchImpl?: typeof fetch;
  /** Fallback part size; defaults to PART_BYTES. Exposed so tests can split small fixtures. */
  partBytes?: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    /* not JSON */
  }
  return res.status === 404 ? 'No longer available.' : `Download failed (${res.status}).`;
}

export const supportsDiskStreaming = () =>
  typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

/** Must be called directly from the click handler (it needs the user's activation). Resolves null if cancelled. */
export async function pickZipTarget(zipName: string): Promise<FileSystemFileHandle | null> {
  const picker = (window as unknown as {
    showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  try {
    return await picker({
      suggestedName: `${zipName}.zip`,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null;
    throw e;
  }
}

export async function downloadAll(o: Options): Promise<BulkResult> {
  const { downloadZip } = await import('client-zip');
  const get = o.fetchImpl ?? fetch;
  // The visitor payload hides original names, so each entry is named from the file's own Content-Disposition.
  const alloc = new NameAllocator();
  const label = (i: number) => o.photos[i].filename ?? `Photograph ${i + 1}`;
  const nameOf = (i: number, res: Response) =>
    alloc.next(nameFromDisposition(res.headers.get('content-disposition')) ?? o.photos[i].filename ?? `photo-${i + 1}.jpg`);
  const total = o.photos.length;
  const failed: BulkResult['failed'] = [];
  let saved = 0;

  /** One authorized original. Transient failures are retried; a permanent failure is recorded, never silent. */
  async function fetchOne(i: number): Promise<Response | null> {
    for (let attempt = 0; ; attempt++) {
      o.signal.throwIfAborted();
      let res: Response;
      try {
        res = await get(o.urlFor(o.photos[i].id), {
          signal: o.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
      } catch (e) {
        if (o.signal.aborted) throw e;
        if (attempt < 2) {
          await sleep(1500 * 2 ** attempt, o.signal);
          continue;
        }
        failed.push({ name: label(i), reason: 'The connection was interrupted.' });
        return null;
      }
      if (res.ok) return res;
      const retryable = [429, 500, 502, 503, 504].includes(res.status);
      if (retryable && attempt < 2) {
        await res.body?.cancel();
        await sleep(1500 * 2 ** attempt, o.signal);
        continue;
      }
      failed.push({ name: label(i), reason: await reasonOf(res) });
      return null;
    }
  }
  const errorsFile = () =>
    failed.length
      ? {
          name: 'DOWNLOAD-ERRORS.txt',
          lastModified: new Date(),
          input: `These photographs could not be added to this archive:\r\n\r\n${failed
            .map((f) => `${safeFileName(f.name)} - ${f.reason}`)
            .join('\r\n')}\r\n\r\nPlease ask your photographer, or open them from the gallery.\r\n`,
        }
      : null;

  if (o.target) {
    // ---- Streaming path: one ZIP written to disk as the photos arrive.
    const writable = await o.target.createWritable();
    async function* entries() {
      for (let i = 0; i < total; i++) {
        o.onProgress({ done: i, total });
        const res = await fetchOne(i);
        if (!res) continue;
        saved++;
        yield { name: nameOf(i, res), lastModified: new Date(), input: res };
      }
      const err = errorsFile();
      if (err) yield err;
    }
    try {
      await downloadZip(entries()).body!.pipeTo(writable, { signal: o.signal });
    } catch (e) {
      await writable.abort().catch(() => undefined);
      throw e;
    }
    o.onProgress({ done: total, total });
    return { saved, failed };
  }

  // ---- Fallback path: bounded parts built in memory, each saved by the visitor.
  if (!o.deliverPart) throw new Error('No way to save the archive.');
  let batch: Array<{ name: string; lastModified: Date; input: Blob }> = [];
  let bytes = 0;
  let partIndex = 0;
  const flush = async (isLast: boolean) => {
    const err = isLast ? errorsFile() : null;
    if (!batch.length && !err) return;
    partIndex++;
    const content = err ? [...batch, { ...err, input: new Blob([err.input]) }] : batch;
    const blob = await downloadZip(content).blob();
    const multi = partIndex > 1 || !isLast;
    await o.deliverPart!({
      index: partIndex,
      count: batch.length,
      bytes: blob.size,
      name: `${o.zipName}${multi ? `-part-${partIndex}` : ''}.zip`,
      blob,
      isLast,
    });
    batch = [];
    bytes = 0;
  };
  for (let i = 0; i < total; i++) {
    o.onProgress({ done: i, total });
    const res = await fetchOne(i);
    if (res) {
      const blob = await res.blob();
      batch.push({ name: nameOf(i, res), lastModified: new Date(), input: blob });
      bytes += blob.size;
      saved++;
    }
    if (bytes >= (o.partBytes ?? PART_BYTES) && i < total - 1) await flush(false);
  }
  await flush(true);
  o.onProgress({ done: total, total });
  return { saved, failed };
}
