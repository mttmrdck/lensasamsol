import { IMAGE_VARIANTS, previewDimensions, type ImageVariant } from '../../shared/image-variants';
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-08-23" -> "23 August 2026" (no timezone shifting: dates are calendar dates). */
export function formatDate(iso: string | null | undefined, style: 'long' | 'short' = 'long'): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return style === 'long'
    ? `${Number(m[3])} ${month} ${m[1]}`
    : `${Number(m[3])} ${month.slice(0, 3)} ${m[1]}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return '';
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return formatDate(iso.slice(0, 10), 'short');
}

export const pad3 = (n: number, total: number) => String(n).padStart(Math.max(2, String(total).length), '0');

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/**
 * Preview image URL. With a share token → the visitor route (/img/t/<token>/…), which only serves photos
 * assigned to that token's published gallery. Without → the owner route (/img/a/…), which needs a session.
 */
export function imgUrl(id: string, v: ImageVariant, token?: string | null) {
  return token ? `/img/t/${encodeURIComponent(token)}/${id}/${v}` : `/img/a/${id}/${v}`;
}

/** srcset from known dimensions: variants are defined by long edge, so width depends on orientation. */
export function srcSet(
  id: string,
  w: number,
  h: number,
  token?: string | null,
  maxVariant: ImageVariant = 'l',
): string {
  const seen = new Set<number>();
  return (Object.keys(IMAGE_VARIANTS) as ImageVariant[])
    .filter((v) => IMAGE_VARIANTS[v] <= IMAGE_VARIANTS[maxVariant])
    .flatMap((v) => {
      const width = previewDimensions(w, h, v).width;
      if (seen.has(width)) return [];
      seen.add(width);
      return [`${imgUrl(id, v, token)} ${width}w`];
    })
    .join(', ');
}
