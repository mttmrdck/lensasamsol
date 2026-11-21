/** A thumbnail may never turn into an unbounded original or executable content response. */
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_SOURCE_BYTES = 20_000_000;

/** The subset of Images used here; no uploads or persistent original storage. */
export interface PreviewImagesBinding {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; height: number; fit: 'scale-down' }): {
      output(options: {
        format: 'image/webp';
        quality: number;
        anim: false;
      }): Promise<{ response(): Response }>;
    };
  };
}

/** Enforce MIME/length and count chunks without collecting an original in Worker memory. */
export function boundedImageBody(res: Response, limit = MAX_PREVIEW_BYTES): ReadableStream<Uint8Array> {
  if (
    res.status !== 200 ||
    !res.body ||
    !imageContentType(res.headers.get('content-type')) ||
    Number(res.headers.get('content-length') ?? 0) > limit
  ) {
    void res.body?.cancel().catch(() => {});
    throw new Error('Invalid image response');
  }
  const reader = res.body.getReader();
  let size = 0;
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          controller.error(new Error('Image byte limit exceeded'));
          return;
        }
        controller.enqueue(value);
      } catch {
        await reader.cancel().catch(() => {});
        controller.error(new Error('Image stream failed'));
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
export function imageContentType(value: string | null): string | null {
  const type = (value ?? '').split(';')[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/webp'].includes(type) ? type : null;
}
export async function boundedPreview(
  res: Response,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const type = imageContentType(res.headers.get('content-type'));
  if (!type || !res.body || Number(res.headers.get('content-length') ?? 0) > MAX_PREVIEW_BYTES) {
    await res.body?.cancel();
    throw new Error('Invalid preview response');
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PREVIEW_BYTES) {
      await reader.cancel();
      throw new Error('Preview exceeds size limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, type };
}
