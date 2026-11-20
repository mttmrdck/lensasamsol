/**
 * Gallery layout geometry. Pure functions: (aspect ratios, container width, settings) -> absolute boxes.
 * Every mode returns integer pixel boxes so the renderer can absolutely position tiles and virtualize by y.
 */

export interface Box {
  /** Index into the input item list. */
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  boxes: Box[];
  height: number;
}

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function breakpointFor(width: number): Breakpoint {
  if (width < 640) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/** Desktop row height scales down for smaller containers (320 -> 240 -> 180 at the defaults). */
export function responsiveRowHeight(width: number, base: number): number {
  const bp = breakpointFor(width);
  if (bp === 'mobile') return Math.round(base * 0.5625);
  if (bp === 'tablet') return Math.round(base * 0.75);
  return base;
}

export function responsiveGap(width: number, gap: number): number {
  const bp = breakpointFor(width);
  if (bp === 'mobile') return Math.min(gap, Math.max(2, Math.round(gap * 0.5)));
  if (bp === 'tablet') return Math.round(gap * 0.75);
  return gap;
}

export function responsiveColumns(width: number, cols: number): number {
  const bp = breakpointFor(width);
  if (bp === 'mobile') return Math.min(cols, 2);
  if (bp === 'tablet') return Math.min(cols, 3);
  return cols;
}

/** Clamp pathological aspect ratios (corrupt metadata, 10:1 panoramas, 1:8 strips). */
export function safeAspect(w: number, h: number): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || !(w > 0) || !(h > 0)) return 1.5;
  return Math.min(4, Math.max(0.25, w / h));
}

/**
 * Distributes `total` pixels across items proportionally to `weights`, as integers that sum exactly to total.
 * Largest-remainder rounding — prevents the 1px overflow / gap that plain Math.round produces.
 */
export function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k][1]]++;
  return out;
}

export interface JustifiedOptions {
  width: number;
  targetHeight: number;
  gap: number;
  maxPerRow?: number;
  /** Rows taller than targetHeight * maxScale are not stretched to full width; they are centred instead. */
  maxScale?: number;
  /** Internal segments before an editorial spread must close flush, unlike the final album row. */
  lastRow?: 'bounded' | 'justify';
}

/**
 * Justified rows with a Knuth–Plass style dynamic programme: chooses row breaks minimising the squared
 * deviation from the target height across the whole album, instead of greedy breaking (which leaves
 * erratic rows and orphaned last rows). The final row is never stretched: it renders at target height,
 * left-aligned, and is lightly penalised if it is very sparse so the DP rebalances the rows above it.
 */
export function justifiedLayout(aspects: number[], opts: JustifiedOptions): LayoutResult {
  const { width: W, targetHeight: T, gap } = opts;
  const maxPerRow = opts.maxPerRow ?? 12;
  const maxScale = opts.maxScale ?? 1.6;
  const n = aspects.length;
  if (n === 0 || W <= 0) return { boxes: [], height: 0 };

  const best = new Float64Array(n + 1).fill(Infinity);
  const prev = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 1; i <= n; i++) {
    let sum = 0;
    for (let j = i - 1; j >= 0 && i - j <= maxPerRow; j--) {
      sum += aspects[j];
      const count = i - j;
      const h = (W - gap * (count - 1)) / sum;
      if (W - gap * (count - 1) <= 0) break;
      let cost: number;
      if (i === n && h >= T && opts.lastRow !== 'justify') {
        const fill = (sum * T + gap * (count - 1)) / W;
        cost = (1 - Math.min(1, fill)) ** 2 * 0.8;
        if (count === 1 && n > 1) cost += 0.4;
      } else {
        const dev = Math.log(h / T);
        cost = dev * dev;
        if (h > T * maxScale) cost += 4;
        if (h < T * 0.5) cost += 4;
      }
      // Discourage postage-stamp portraits while retaining exact natural proportions.
      const minWidth = Math.min(...aspects.slice(j, i)) * Math.min(h, T * maxScale);
      if (minWidth < Math.min(120, W * 0.2)) cost += 0.3;
      const total = best[j] + cost;
      if (total < best[i]) {
        best[i] = total;
        prev[i] = j;
      }
      if (h < T * 0.35) break; // row is already far too short — adding more images only worsens it
    }
  }

  const breaks: Array<[number, number]> = [];
  for (let i = n; i > 0; i = prev[i]) breaks.push([prev[i], i]);
  breaks.reverse();

  const boxes: Box[] = [];
  let y = 0;
  breaks.forEach(([a, b], rowIndex) => {
    const row = aspects.slice(a, b);
    const sum = row.reduce((s, v) => s + v, 0);
    const avail = W - gap * (row.length - 1);
    const fitH = avail / sum;
    const isLast = rowIndex === breaks.length - 1 && opts.lastRow !== 'justify';
    let h: number;
    let widths: number[];
    let x0 = 0;
    if (isLast && fitH > T) {
      h = Math.round(T);
      widths = distribute(Math.min(avail, Math.round(sum * h)), row);
    } else if (fitH > T * maxScale) {
      h = Math.round(T * maxScale);
      widths = distribute(Math.min(avail, Math.round(sum * h)), row);
      const used = widths.reduce((s, v) => s + v, 0) + gap * (row.length - 1);
      x0 = Math.max(0, Math.floor((W - used) / 2));
    } else {
      h = Math.max(1, Math.round(fitH));
      widths = distribute(avail, row);
    }
    let x = x0;
    row.forEach((_, k) => {
      boxes.push({ i: a + k, x, y, w: widths[k], h });
      x += widths[k] + gap;
    });
    y += h + gap;
  });
  return { boxes, height: Math.max(0, y - gap) };
}

export function masonryLayout(aspects: number[], width: number, columns: number, gap: number): LayoutResult {
  if (aspects.length === 0 || width <= 0) return { boxes: [], height: 0 };
  const cols = Math.max(1, columns);
  const colWidths = distribute(width - gap * (cols - 1), new Array(cols).fill(1));
  const colX: number[] = [];
  colWidths.reduce((x, w, k) => ((colX[k] = x), x + w + gap), 0);
  const heights = new Array(cols).fill(0);
  const boxes = aspects.map((ar, i) => {
    let c = 0;
    for (let k = 1; k < cols; k++) if (heights[k] < heights[c] - 1) c = k;
    const h = Math.max(1, Math.round(colWidths[c] / ar));
    const box = { i, x: colX[c], y: heights[c], w: colWidths[c], h };
    heights[c] += h + gap;
    return box;
  });
  return { boxes, height: Math.max(0, Math.max(...heights) - gap) };
}

export function uniformLayout(
  count: number,
  width: number,
  columns: number,
  gap: number,
  aspect: number,
): LayoutResult {
  if (count === 0 || width <= 0) return { boxes: [], height: 0 };
  const cols = Math.max(1, columns);
  const colWidths = distribute(width - gap * (cols - 1), new Array(cols).fill(1));
  const colX: number[] = [];
  colWidths.reduce((x, w, k) => ((colX[k] = x), x + w + gap), 0);
  const h = Math.round(colWidths[0] / aspect);
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    boxes.push({ i, x: colX[c], y: r * (h + gap), w: colWidths[c], h });
  }
  const rows = Math.ceil(count / cols);
  return { boxes, height: rows * h + (rows - 1) * gap };
}

/**
 * Editorial rhythm: a repeating sequence of a single featured frame (alternately centred and offset),
 * justified pairs and trios, with wider vertical breathing room. Collapses to a single-column stream on mobile.
 */
export function editorialLayout(aspects: number[], width: number, target: number, gap: number): LayoutResult {
  const n = aspects.length;
  if (n === 0 || width <= 0) return { boxes: [], height: 0 };
  const boxes: Box[] = [];
  const vGap = Math.round(gap * 2.5) + 8;
  let y = 0;
  if (breakpointFor(width) === 'mobile') {
    aspects.forEach((ar, i) => {
      const h = Math.min(Math.round(width / ar), Math.round(width * 1.35));
      const w = Math.min(width, Math.round(h * ar));
      boxes.push({ i, x: Math.round((width - w) / 2), y, w, h });
      y += h + vGap;
    });
    return { boxes, height: y - vGap };
  }
  const pattern = [1, 2, 3, 1, 2, 2, 3];
  let i = 0;
  let p = 0;
  let singleCount = 0;
  while (i < n) {
    const want = Math.min(pattern[p % pattern.length], n - i);
    p++;
    if (want === 1) {
      const ar = aspects[i];
      const landscape = ar >= 1.05;
      let w = landscape ? Math.round(width * 0.78) : 0;
      let h = landscape ? Math.round(w / ar) : Math.round(target * 2);
      if (h > target * 2.2) h = Math.round(target * 2.2);
      w = Math.min(width, Math.round(h * ar));
      const offset = singleCount % 2 === 0 ? 'center' : singleCount % 4 === 1 ? 'left' : 'right';
      const x =
        offset === 'center'
          ? Math.round((width - w) / 2)
          : offset === 'left'
            ? Math.round(width * 0.06)
            : width - w - Math.round(width * 0.06);
      boxes.push({ i, x: Math.max(0, x), y, w, h });
      y += h + vGap;
      singleCount++;
      i++;
      continue;
    }
    const row = aspects.slice(i, i + want);
    const g = gap * 2;
    const sum = row.reduce((s, v) => s + v, 0);
    const avail = width - g * (row.length - 1);
    let h = Math.round(avail / sum);
    const cap = target * 1.6;
    let widths: number[];
    let x0 = 0;
    if (h > cap) {
      h = Math.round(cap);
      widths = row.map((ar) => Math.round(ar * h));
      x0 = Math.round((width - widths.reduce((s, v) => s + v, 0) - g * (row.length - 1)) / 2);
    } else {
      widths = distribute(avail, row);
    }
    let x = x0;
    row.forEach((_, k) => {
      boxes.push({ i: i + k, x, y, w: widths[k], h });
      x += widths[k] + g;
    });
    y += h + vGap;
    i += want;
  }
  return { boxes, height: Math.max(0, y - vGap) };
}

export interface GalleryLayoutInput {
  mode: 'justified' | 'masonry' | 'editorial' | 'uniform';
  width: number;
  rowHeight: number;
  columns: number;
  gap: number;
  uniformAspect: '1:1' | '4:3' | '3:2' | '4:5';
}

export function computeGalleryLayout(
  dims: Array<{ w: number; h: number }>,
  input: GalleryLayoutInput,
): LayoutResult {
  const aspects = dims.map((d) => safeAspect(d.w, d.h));
  const width = Math.floor(input.width);
  const gap = responsiveGap(width, input.gap);
  const target = responsiveRowHeight(width, input.rowHeight);
  switch (input.mode) {
    case 'masonry':
      return masonryLayout(aspects, width, responsiveColumns(width, input.columns), gap);
    case 'uniform': {
      const [a, b] = input.uniformAspect.split(':').map(Number);
      return uniformLayout(aspects.length, width, responsiveColumns(width, input.columns), gap, a / b);
    }
    case 'editorial':
      return editorialLayout(aspects, width, target, gap);
    default:
      return justifiedLayout(aspects, { width, targetHeight: target, gap });
  }
}

/** Indices of boxes that intersect [top, bottom] (inclusive overscan applied by the caller). */
export function visibleBoxes(boxes: Box[], top: number, bottom: number): Box[] {
  const out: Box[] = [];
  for (const b of boxes) if (b.y + b.h >= top && b.y <= bottom) out.push(b);
  return out;
}
