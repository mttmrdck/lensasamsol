/**
 * Download naming rules shared by the Worker (Content-Disposition) and the browser (ZIP entries).
 * Pure functions so both sides, and the tests, agree on exactly one behaviour.
 */

const MAX_NAME = 180;
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be removed from file names
const UNSAFE = /[\x00-\x1f\x7f\\/:*?"<>|]/g;

/** A safe single-segment file name that keeps the original name and extension wherever possible. */
export function safeFileName(name: string | null | undefined, fallback = 'photo'): string {
  let n = (name ?? '').normalize('NFC').replace(UNSAFE, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!n) n = fallback;
  if (n.length > MAX_NAME) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 12 ? n.slice(dot) : '';
    n = n.slice(0, MAX_NAME - ext.length) + ext;
  }
  return n;
}

/** ASCII-only rendering for the plain `filename=` parameter (clients that ignore RFC 5987). */
function asciiFallback(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\%]/g, '_');
  return ascii || 'photo';
}

/** `attachment` header with both the ASCII fallback and the exact UTF-8 name (RFC 6266 / 5987). */
export function attachmentHeader(name: string): string {
  const safe = safeFileName(name);
  const star = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFallback(safe)}"; filename*=UTF-8''${star}`;
}

/** "Firazana's Convocation Day" -> "Firazanas-Convocation-Day" (ASCII, hyphen separated). */
export function zipBaseName(title: string | null | undefined): string {
  const slug = (title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'photos';
}

/**
 * Makes names unique inside one archive, case-insensitively (macOS and Windows are case-insensitive),
 * keeping the extension: photo.jpg, photo (2).jpg, photo (3).jpg. Order is preserved.
 */
export class NameAllocator {
  private used = new Set<string>();
  /** Reserves and returns a unique, safe name for `raw`. */
  next(raw: string | null | undefined): string {
    const name = safeFileName(raw);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; this.used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    this.used.add(candidate.toLowerCase());
    return candidate;
  }
}
export function uniqueNames(names: Array<string | null | undefined>): string[] {
  const alloc = new NameAllocator();
  return names.map((n) => alloc.next(n));
}

/** The file name a download response carries (RFC 5987 UTF-8 name preferred), or null. */
export function nameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain parameter */
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Content types a visitor download may carry: only what the gallery indexes, never upstream-controlled values. */
const TYPES: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
};
export function downloadContentType(mime: string | null | undefined): string {
  return TYPES[(mime ?? '').toLowerCase()] ?? 'application/octet-stream';
}

/** Largest single original the Worker will stream. Anything bigger is refused rather than risking a long hold. */
export const MAX_ORIGINAL_BYTES = 200 * 1024 * 1024;
