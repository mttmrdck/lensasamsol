import { describe, expect, it } from 'vitest';
import {
  analyzeCollection,
  recommendTemplate,
  rankCovers,
  arrangeStyle,
  TEMPLATES,
  clusterLayout,
  compositionLayout,
  selectCover,
  orderPhotos,
} from '../../shared/composition';
import { DEFAULT_STYLE, sameStyle } from '../../shared/style';
const photos = (ratios: number[]) =>
  ratios.map((ar, i) => ({ id: `p${i}`, w: ar * 3000, h: 3000, featured: false }));

describe('collection composition', () => {
  it('only changes order on an explicit filename preference, with numeric and stable ordering', () => {
    const p = photos([1.5, 0.66, 1.5]).map((p, i) => ({
      ...p,
      filename: ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_2.jpg'][i],
    }));
    expect(orderPhotos(p, 'source').map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);
    expect(orderPhotos(p, 'filename').map((p) => p.id)).toEqual(['p1', 'p2', 'p0']);
    expect(p.map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);
  });
  it('classifies valid dimensions and excludes unknown dimensions from proportions', () => {
    const stats = analyzeCollection([
      ...photos([2 / 3, 1.5, 1]),
      ...photos([NaN, Infinity, 0]).map((p) => ({ ...p, id: `bad${p.id}` })),
    ]);
    expect(stats).toMatchObject({ count: 6, portraits: 1, landscapes: 1, squares: 1, unknown: 3 });
  });
  it('recommends all five templates with factual reasons', () => {
    expect(recommendTemplate(photos(Array(640).fill(1.5))).id).toBe('compact-exhibition');
    expect(recommendTemplate(photos([0.66, 0.66, 0.66, 1.5])).id).toBe('portrait-story');
    expect(recommendTemplate(photos([1.5, 1.8, 1.6, 0.66])).id).toBe('cinematic-archive');
    expect(recommendTemplate(photos(Array(35).fill(1))).id).toBe('modern-contact-sheet');
    expect(recommendTemplate(photos([0.66, 1.5, 0.7, 1.7])).id).toBe('editorial-signature');
    expect(recommendTemplate([]).reason).toMatch(/no photographs/i);
  });
  it('ranks featured metadata, keeps a manual cover and retains manual templates until explicitly arranged', () => {
    const p = photos([1.5, 0.66, 1.5]);
    p[2].featured = true;
    expect(rankCovers(p)[0].id).toBe('p2');
    const s = { ...DEFAULT_STYLE, composition: { template: 'portrait-story' as const, coverId: 'p1' } };
    expect(s.composition.template).toBe('portrait-story');
    expect(arrangeStyle(s, p, 'p0').composition?.coverId).toBe('p1');
    expect(arrangeStyle(DEFAULT_STYLE, p, 'p0').composition?.coverId).toBe('p0');
  });
  it('distinguishes automatic covers from legacy manual covers and filters invalid references', () => {
    const p = photos([1.5, 0.66, 1.5]);
    p[2].featured = true;
    expect(selectCover(p, undefined, 'p0')?.id).toBe('p0');
    expect(selectCover(p, null, 'p0')?.id).toBe('p2');
    expect(selectCover(p, 'foreign', 'p0')?.id).toBe('p0');
    expect(selectCover(p, undefined, null)?.id).toBe('p2');
    expect(selectCover([], null, null)).toBeNull();
    expect(
      arrangeStyle({ ...DEFAULT_STYLE, composition: { template: 'portrait-story', coverId: null } }, p, 'p0')
        .composition?.coverId,
    ).toBe('p2');
  });
  it('compares styles structurally after schema parsing rather than by insertion order', () => {
    const s = {
      ...DEFAULT_STYLE,
      composition: {
        template: 'editorial-signature' as const,
        coverId: 'p0',
        title: 'Title',
        clusters: true,
      },
    };
    const reordered = {
      ...s,
      composition: {
        clusters: true,
        title: 'Title',
        coverId: 'p0',
        template: 'editorial-signature' as const,
      },
    };
    expect(sameStyle(s, reordered)).toBe(true);
  });
  it('keeps portrait contact strips dense on a phone without stretching the final single', () => {
    const p = photos(Array(7).fill(2 / 3));
    const style = arrangeStyle(DEFAULT_STYLE, p, null, 'modern-contact-sheet');
    const res = compositionLayout(p, 358, style);
    expect(res.boxes[1].x + res.boxes[1].w).toBeCloseTo(358, 5);
    expect(res.boxes.at(-1)!.h).toBeLessThanOrEqual(260 * 0.5625);
  });
  it('justifies internal row segments before editorial clusters instead of leaving a false final row', () => {
    const p = photos([...Array(10).fill(1.5), 2 / 3, 1.5, 1.8]);
    const style = arrangeStyle(DEFAULT_STYLE, p, null, 'editorial-signature');
    const res = compositionLayout(p, 1344, style);
    const ys = [...new Set(res.boxes.slice(0, 8).map((b) => b.y))];
    for (const y of ys)
      expect(
        Math.max(
          ...res.boxes
            .slice(0, 8)
            .filter((b) => b.y === y)
            .map((b) => b.x + b.w),
        ),
      ).toBe(1344);
  });
  it('actually emits an editorial cluster at desktop width for ordinary photographic ratios', () => {
    const p = photos([2 / 3, 1.5, 1.8]);
    const res = compositionLayout(p, 1344, arrangeStyle(DEFAULT_STYLE, p, null, 'editorial-signature'));
    expect(res.boxes[0].h).toBeGreaterThan(res.boxes[1].h * 1.5);
    expect(res.boxes[2].y).toBeGreaterThan(0);
  });
  it('solves a portrait beside unequal stacked landscapes exactly without cropping', () => {
    const ratios = [2 / 3, 1.4, 1.9];
    const res = clusterLayout(ratios, 1200, 12)!;
    expect(res).not.toBeNull();
    const [p, a, b] = res.boxes;
    expect(a.x).toBeCloseTo(p.w + 12, 8);
    expect(b.y).toBeCloseTo(a.h + 12, 8);
    expect(b.y + b.h).toBeCloseTo(p.h, 8);
    expect(a.x + a.w).toBeCloseTo(1200, 8);
    res.boxes.forEach((box) => expect(box.w / box.h).toBeCloseTo(ratios[box.i], 8));
    expect(clusterLayout([1.5, 0.66, 1.5], 1200, 12)).toBeNull();
  });
  for (const width of [336, 358, 720, 976, 1344]) {
    for (const template of TEMPLATES) {
      it(`${template.id} fits at ${width}px, preserves order and every photo`, () => {
        const p = photos(Array.from({ length: 121 }, (_, i) => [0.66, 1.5, 1.8, 0.8, 1, 3.4][i % 6]));
        const res = compositionLayout(p, width, arrangeStyle(DEFAULT_STYLE, p, null, template.id));
        expect(res.boxes.map((b) => b.i)).toEqual(p.map((_, i) => i));
        for (const b of res.boxes) {
          expect(b.x).toBeGreaterThanOrEqual(-0.0001);
          expect(b.x + b.w).toBeLessThanOrEqual(width + 0.0001);
          expect(b.w).toBeGreaterThan(0);
          expect(b.h).toBeGreaterThan(0);
          expect(Math.abs(b.w - (p[b.i].w / p[b.i].h) * b.h)).toBeLessThan(6);
        }
        for (let i = 0; i < res.boxes.length; i++)
          for (let j = i + 1; j < res.boxes.length; j++) {
            const a = res.boxes[i],
              b = res.boxes[j];
            expect(
              a.x + a.w <= b.x + 0.001 ||
                b.x + b.w <= a.x + 0.001 ||
                a.y + a.h <= b.y + 0.001 ||
                b.y + b.h <= a.y + 0.001,
            ).toBe(true);
          }
      });
    }
  }
  it('handles empty, single, unknown, extreme and nonfinite inputs', () => {
    for (const ratios of [[], [0.66], [0, NaN, Infinity], [20, 0.05, 1.5]]) {
      const p = photos(ratios);
      const res = compositionLayout(p, 336, DEFAULT_STYLE);
      expect(res.boxes).toHaveLength(p.length);
      res.boxes.forEach((b) => {
        expect(Number.isFinite(b.w + b.h + b.x + b.y)).toBe(true);
        expect(b.x + b.w).toBeLessThanOrEqual(336.001);
      });
    }
  });
});
