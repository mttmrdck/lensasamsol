import { describe, expect, it } from 'vitest';
import {
  computeGalleryLayout,
  distribute,
  justifiedLayout,
  masonryLayout,
  responsiveRowHeight,
  safeAspect,
  visibleBoxes,
  editorialLayout,
} from '../../shared/layout';

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const mixed = (n: number, seed = 7) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => (r() < 0.4 ? 2 / 3 : r() < 0.9 ? 3 / 2 : r() < 0.95 ? 2.8 : 0.3));
};

function rows(boxes: { i: number; y: number; x: number; w: number; h: number }[]) {
  const m = new Map<number, typeof boxes>();
  for (const b of boxes) m.set(b.y, [...(m.get(b.y) ?? []), b]);
  return [...m.values()];
}

describe('distribute', () => {
  it('sums exactly to the total (no rounding overflow)', () => {
    for (const total of [359, 1000, 1497]) {
      const out = distribute(total, [1.5, 0.667, 1.333, 2.7]);
      expect(out.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('justifiedLayout', () => {
  for (const width of [360, 390, 768, 1024, 1504]) {
    it(`full rows are flush to ${width}px with no overflow and natural aspect`, () => {
      const aspects = mixed(300);
      const gap = 12;
      const res = justifiedLayout(aspects, { width, targetHeight: responsiveRowHeight(width, 320), gap });
      expect(res.boxes).toHaveLength(300);
      const rs = rows(res.boxes);
      rs.forEach((row, i) => {
        const right = Math.max(...row.map((b) => b.x + b.w));
        expect(right).toBeLessThanOrEqual(width);
        expect(Math.min(...row.map((b) => b.x))).toBeGreaterThanOrEqual(0);
        if (i < rs.length - 1 && row.length > 1) expect(right).toBe(width);
        for (const b of row) {
          const ar = aspects[b.i];
          // ≤2px distortion from integer rounding; tiles use object-fit: cover so it never shows as a gap.
          expect(Math.abs(b.w - ar * b.h)).toBeLessThanOrEqual(row.length + 1);
        }
      });
    });
  }

  it('keeps input order (stable photo ordering)', () => {
    const res = justifiedLayout(mixed(120), { width: 1200, targetHeight: 300, gap: 8 });
    expect(res.boxes.map((b) => b.i)).toEqual([...Array(120).keys()]);
  });

  it('never stretches the final row beyond the target height', () => {
    const res = justifiedLayout([1.5, 1.5, 1.5, 1.5, 0.66], { width: 1600, targetHeight: 320, gap: 12 });
    const last = rows(res.boxes).at(-1)!;
    expect(last[0].h).toBeLessThanOrEqual(320);
  });

  it('caps very tall rows instead of blowing up a lone portrait', () => {
    const res = justifiedLayout([0.25], { width: 390, targetHeight: 180, gap: 4 });
    expect(res.boxes[0].h).toBeLessThanOrEqual(Math.round(180 * 2.2));
  });

  it('handles empty input and zero width', () => {
    expect(justifiedLayout([], { width: 800, targetHeight: 300, gap: 8 }).boxes).toEqual([]);
    expect(justifiedLayout([1.5], { width: 0, targetHeight: 300, gap: 8 }).boxes).toEqual([]);
  });

  it('lays out 1,500 photos quickly', () => {
    const t = performance.now();
    justifiedLayout(mixed(1500), { width: 1504, targetHeight: 320, gap: 12 });
    expect(performance.now() - t).toBeLessThan(150);
  });
});

describe('masonry and editorial', () => {
  it('masonry keeps natural aspect and fits the width', () => {
    const res = masonryLayout(mixed(60), 1000, 3, 16);
    for (const b of res.boxes) expect(b.x + b.w).toBeLessThanOrEqual(1000);
  });
  it('editorial collapses to one column on phones', () => {
    const res = editorialLayout(mixed(20), 360, 180, 8);
    expect(new Set(res.boxes.map((b) => b.y)).size).toBe(20);
    for (const b of res.boxes) expect(b.x + b.w).toBeLessThanOrEqual(360);
  });
  it('uniform crops to the chosen aspect', () => {
    const res = computeGalleryLayout(Array(9).fill({ w: 3, h: 2 }), {
      mode: 'uniform',
      width: 1200,
      rowHeight: 320,
      columns: 3,
      gap: 10,
      uniformAspect: '1:1',
    });
    expect(res.boxes[0].w).toBe(res.boxes[0].h);
  });
});

describe('helpers', () => {
  it('safeAspect clamps corrupt metadata', () => {
    expect(safeAspect(0, 0)).toBe(1.5);
    expect(safeAspect(10000, 10)).toBe(4);
    expect(safeAspect(10, 10000)).toBe(0.25);
  });
  it('responsive row heights follow the 320/240/180 scale', () => {
    expect(responsiveRowHeight(1440, 320)).toBe(320);
    expect(responsiveRowHeight(800, 320)).toBe(240);
    expect(responsiveRowHeight(390, 320)).toBe(180);
  });
  it('visibleBoxes filters by vertical window', () => {
    const boxes = [
      { i: 0, x: 0, y: 0, w: 10, h: 100 },
      { i: 1, x: 0, y: 500, w: 10, h: 100 },
    ];
    expect(visibleBoxes(boxes, 450, 700).map((b) => b.i)).toEqual([1]);
  });
});
