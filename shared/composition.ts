/** Metadata-only art direction. The caller supplies eligible photos in their narrative order. */
import { justifiedLayout, responsiveGap, responsiveRowHeight, type Box, type LayoutResult } from './layout';
import type { StyleConfig, TemplateId } from './style';

export interface CompositionPhoto {
  id: string;
  w: number;
  h: number;
  featured?: boolean;
  dimsKnown?: boolean;
}
export const TEMPLATES: Array<{
  id: TemplateId;
  name: string;
  note: string;
  rowHeight: number;
  gap: number;
  maxWidth: number;
}> = [
  {
    id: 'editorial-signature',
    name: 'Editorial Signature',
    note: 'Natural spreads and balanced rows',
    rowHeight: 330,
    gap: 12,
    maxWidth: 1440,
  },
  {
    id: 'compact-exhibition',
    name: 'Compact Exhibition',
    note: 'Dense rows for larger collections',
    rowHeight: 280,
    gap: 8,
    maxWidth: 1600,
  },
  {
    id: 'portrait-story',
    name: 'Portrait Story',
    note: 'Vertical bands and portrait pairings',
    rowHeight: 360,
    gap: 12,
    maxWidth: 1440,
  },
  {
    id: 'cinematic-archive',
    name: 'Cinematic Archive',
    note: 'Wide frames and immersive mobile views',
    rowHeight: 380,
    gap: 12,
    maxWidth: 1520,
  },
  {
    id: 'modern-contact-sheet',
    name: 'Modern Contact Sheet',
    note: 'Steady-height uncropped proofing strips',
    rowHeight: 260,
    gap: 10,
    maxWidth: 1520,
  },
];

export function validDimensions(p: Pick<CompositionPhoto, 'w' | 'h' | 'dimsKnown'>): boolean {
  return (
    p.dimsKnown !== false &&
    Number.isFinite(p.w) &&
    Number.isFinite(p.h) &&
    p.w > 0 &&
    p.h > 0 &&
    p.w / p.h >= 0.02 &&
    p.w / p.h <= 50
  );
}
export function naturalAspect(p: Pick<CompositionPhoto, 'w' | 'h' | 'dimsKnown'>): number {
  return validDimensions(p) ? p.w / p.h : 1.5;
}
export function orientation(p: CompositionPhoto): 'portrait' | 'landscape' | 'square' | 'unknown' {
  if (!validDimensions(p)) return 'unknown';
  const ar = p.w / p.h;
  return ar < 0.92 ? 'portrait' : ar > 1.08 ? 'landscape' : 'square';
}
export function analyzeCollection(photos: CompositionPhoto[]) {
  let portraits = 0,
    landscapes = 0,
    squares = 0,
    unknown = 0,
    sum = 0,
    sumSq = 0;
  for (const p of photos) {
    const o = orientation(p);
    if (o === 'unknown') {
      unknown++;
      continue;
    }
    if (o === 'portrait') portraits++;
    else if (o === 'landscape') landscapes++;
    else squares++;
    const ar = p.w / p.h;
    sum += ar;
    sumSq += ar * ar;
  }
  const known = photos.length - unknown;
  return {
    count: photos.length,
    portraits,
    landscapes,
    squares,
    unknown,
    portraitRatio: known ? portraits / known : 0,
    landscapeRatio: known ? landscapes / known : 0,
    aspectStdDev: known ? Math.sqrt(Math.max(0, sumSq / known - (sum / known) ** 2)) : 0,
  };
}
export function recommendTemplate(photos: CompositionPhoto[]): { id: TemplateId; reason: string } {
  const s = analyzeCollection(photos);
  if (!s.count)
    return {
      id: 'editorial-signature',
      reason: 'No photographs assigned yet; add photos to receive a recommendation.',
    };
  if (s.count > 220)
    return {
      id: 'compact-exhibition',
      reason: `${s.count} photographs detected — compact rows keep a large collection easy to browse.`,
    };
  if (s.portraitRatio >= 0.6)
    return {
      id: 'portrait-story',
      reason: `${Math.round(s.portraitRatio * 100)}% of photographs with known dimensions are portrait-oriented.`,
    };
  if (s.count >= 30 && s.unknown === 0 && s.aspectStdDev < 0.08)
    return {
      id: 'modern-contact-sheet',
      reason: 'Consistent frame proportions suit steady-height proofing strips.',
    };
  if (s.landscapeRatio >= 0.65)
    return {
      id: 'cinematic-archive',
      reason: `${Math.round(s.landscapeRatio * 100)}% of photographs with known dimensions are landscape-oriented.`,
    };
  return {
    id: 'editorial-signature',
    reason: `${s.count} photographs with ${s.portraits} portraits and ${s.landscapes} landscapes — adaptive spreads preserve the sequence.${s.unknown ? ` ${s.unknown} have unknown dimensions.` : ''}`,
  };
}
export function rankCovers<T extends CompositionPhoto>(photos: T[]): Array<T & { score: number }> {
  return photos
    .map((p, i) => {
      const ar = naturalAspect(p);
      const score =
        (p.featured ? 100 : 0) +
        (validDimensions(p) ? 20 * Math.min(1, (p.w * p.h) / 12000000) : -40) +
        (ar >= 0.6 && ar <= 1.85 ? 25 : ar > 2.4 || ar < 0.45 ? -50 : 0) +
        (i >= photos.length * 0.05 && i <= photos.length * 0.35 ? 10 : 0);
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score);
}
/** undefined preserves the collection cover; null explicitly asks for an automatic recommendation. */
export function selectCover<T extends CompositionPhoto>(
  photos: T[],
  overrideId: string | null | undefined,
  collectionCoverId: string | null,
): T | null {
  if (overrideId === null) return rankCovers(photos)[0] ?? null;
  return (
    photos.find((p) => p.id === overrideId) ??
    photos.find((p) => p.id === collectionCoverId) ??
    rankCovers(photos)[0] ??
    null
  );
}
export function arrangeStyle(
  style: StyleConfig,
  photos: CompositionPhoto[],
  currentCoverId: string | null,
  template?: TemplateId,
): StyleConfig {
  const id = template ?? recommendTemplate(photos).id;
  const t = TEMPLATES.find((t) => t.id === id)!;
  const selected = selectCover(photos, style.composition?.coverId, currentCoverId);
  return {
    ...style,
    composition: {
      ...style.composition,
      template: id,
      useTemplate: true,
      clusters: style.composition?.clusters ?? true,
      emphasizeFeatured: style.composition?.emphasizeFeatured ?? true,
      coverId: selected?.id ?? null,
    },
    layout: { ...style.layout, mode: 'justified', rowHeight: t.rowHeight, gap: t.gap, maxWidth: t.maxWidth },
    // Leaving the folio sheet for a template layout brings back a photographic opening.
    cover:
      style.layout.mode === 'folio' && style.cover.style === 'typographic'
        ? { ...style.cover, style: 'featured-below' }
        : style.cover,
  };
}

/** Exact P|LL or LL|P rectangle. Fractional geometry avoids rounding-induced crops. */
export function clusterLayout(aspects: number[], width: number, gap: number): LayoutResult | null {
  if (aspects.length !== 3 || width < 700 || aspects.some((a) => !Number.isFinite(a) || a <= 0)) return null;
  const reverse = aspects[2] < 0.92 && aspects[0] > 1.08 && aspects[1] > 1.08;
  if (!reverse && !(aspects[0] < 0.92 && aspects[1] > 1.08 && aspects[2] > 1.08)) return null;
  const pi = reverse ? 2 : 0,
    ai = reverse ? 0 : 1,
    bi = reverse ? 1 : 2;
  const p = aspects[pi],
    a = aspects[ai],
    b = aspects[bi];
  const reciprocal = 1 / a + 1 / b;
  const rw = (width - gap - p * gap) / (1 + p * reciprocal);
  const height = rw * reciprocal + gap,
    pw = p * height;
  if (rw <= 0 || pw < 120 || rw < 160 || height > width * 0.85) return null;
  const boxes: Box[] = [
    { i: pi, x: reverse ? rw + gap : 0, y: 0, w: pw, h: height },
    { i: ai, x: reverse ? 0 : pw + gap, y: 0, w: rw, h: rw / a },
    { i: bi, x: reverse ? 0 : pw + gap, y: rw / a + gap, w: rw, h: rw / b },
  ];
  return { boxes: boxes.sort((a, b) => a.i - b.i), height };
}

/** Five real geometries; legacy modes remain in layout.ts. Every input index appears exactly once. */
export function compositionLayout(
  photos: CompositionPhoto[],
  width: number,
  style: StyleConfig,
): LayoutResult {
  if (!Number.isFinite(width) || width <= 0 || !photos.length) return { boxes: [], height: 0 };
  width = Math.floor(width);
  const id = style.composition?.template ?? 'editorial-signature';
  const aspects = photos.map(naturalAspect);
  const gap = Math.min(responsiveGap(width, style.layout.gap), width / 4);
  const target = responsiveRowHeight(width, style.layout.rowHeight);
  const rows = (start: number, end: number) =>
    justifiedLayout(aspects.slice(start, end), {
      width,
      targetHeight: target,
      gap,
      maxScale: 1.6,
      lastRow: end < photos.length ? 'justify' : 'bounded',
      maxPerRow: width < 640 ? 2 : id === 'portrait-story' ? 4 : 12,
    });
  if (id === 'compact-exhibition' || id === 'portrait-story') return rows(0, photos.length);
  if (id === 'modern-contact-sheet') {
    // Steady-height natural strips, with bounded fitting to avoid sparse portrait bands.
    const boxes: Box[] = [];
    let y = 0,
      i = 0;
    while (i < aspects.length) {
      let end = i + 1,
        sum = aspects[i];
      while (
        end < aspects.length &&
        (width >= 640 || end - i < 2) &&
        (sum + aspects[end]) * target + gap * (end - i) <= width
      )
        sum += aspects[end++];
      // Include the next frame when a short strip would otherwise leave an accidental void.
      if (
        end < aspects.length &&
        (width < 640 ? end - i < 2 : sum * target + gap * (end - i - 1) < width * 0.85)
      ) {
        sum += aspects[end++];
      }
      const fit = (width - gap * (end - i - 1)) / sum;
      const lastSingle = end === aspects.length && end - i === 1;
      const h = Math.min(target * (lastSingle ? 1 : width < 640 ? 1.85 : 1.2), fit);
      const used = sum * h + gap * (end - i - 1);
      let x = lastSingle ? (width - used) / 2 : 0;
      for (let j = i; j < end; j++) {
        const w = aspects[j] * h;
        boxes.push({ i: j, x, y, w, h });
        x += w + gap;
      }
      y += h + gap;
      i = end;
    }
    return { boxes, height: y - gap };
  }
  if (id === 'cinematic-archive' && width < 640) {
    let y = 0;
    const boxes = aspects.map((ar, i) => {
      const h = Math.min(width / ar, target * 2.5),
        w = h * ar;
      const b = { i, x: (width - w) / 2, y, w, h };
      y += h + gap;
      return b;
    });
    return { boxes, height: y - gap };
  }
  const boxes: Box[] = [];
  let y = 0,
    cursor = 0,
    pending = 0,
    lastAccent = -12;
  const append = (result: LayoutResult, offset: number) => {
    for (const b of result.boxes) boxes.push({ ...b, i: b.i + offset, y: b.y + y });
    y += result.height + gap;
  };
  while (cursor < photos.length) {
    const canAccent = cursor - lastAccent >= 12 && (cursor === pending || cursor - pending >= 6);
    const cluster =
      canAccent && id === 'editorial-signature' && style.composition?.clusters !== false
        ? clusterLayout(aspects.slice(cursor, cursor + 3), width, gap)
        : null;
    const anchor =
      canAccent &&
      style.composition?.emphasizeFeatured !== false &&
      photos[cursor].featured &&
      aspects[cursor] >= 1.3 &&
      width / aspects[cursor] <= target * 1.8;
    if ((cluster && cluster.height <= target * 2.9) || anchor) {
      if (cursor > pending) append(rows(pending, cursor), pending);
      if (cluster && cluster.height <= target * 2.9) {
        append(cluster, cursor);
        lastAccent = cursor;
        cursor += 3;
      } else {
        const h = width / aspects[cursor];
        append({ boxes: [{ i: 0, x: 0, y: 0, w: width, h }], height: h }, cursor);
        lastAccent = cursor;
        cursor++;
      }
      pending = cursor;
    } else cursor++;
  }
  if (cursor > pending) append(rows(pending, cursor), pending);
  return { boxes, height: Math.max(0, y - gap) };
}

/** Diagnostics, not visual pass/fail laws. */
export function qualityMetrics(result: LayoutResult, width: number) {
  const area = result.boxes.reduce((sum, b) => sum + b.w * b.h, 0);
  const heights = [...new Map(result.boxes.map((b) => [b.y, b.h])).values()];
  const mean = heights.reduce((s, h) => s + h, 0) / (heights.length || 1);
  return {
    density: width * result.height ? area / (width * result.height) : 0,
    rowHeightCV: mean
      ? Math.sqrt(heights.reduce((s, h) => s + (h - mean) ** 2, 0) / (heights.length || 1)) / mean
      : 0,
    minTileWidth: result.boxes.length ? Math.min(...result.boxes.map((b) => b.w)) : 0,
  };
}

/** Filename sorting is opt-in; source order is never mutated. */
export function orderPhotos<T extends { filename?: string | null }>(
  photos: T[],
  order: 'source' | 'filename' = 'source',
): T[] {
  if (order === 'source') return photos;
  const compare = new Intl.Collator('en', { numeric: true }).compare;
  return [...photos].sort((a, b) => compare(a.filename ?? '', b.filename ?? ''));
}
