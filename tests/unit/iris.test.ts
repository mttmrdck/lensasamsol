import { describe, expect, it } from 'vitest';
import {
  anchorFromRect,
  bladePaths,
  fullRevealApothem,
  hexVertices,
  irisFrame,
  TIMELINE,
} from '../../src/pages/public/intro/iris';

describe('iris geometry', () => {
  it('builds six blades whose inner edges are the hexagon sides', () => {
    const paths = bladePaths(100, 100, 30, 0.3, 1000);
    expect(paths).toHaveLength(6);
    const V = hexVertices(100, 100, 30, 0.3);
    // Every hexagon vertex is shared by two consecutive blades (no gaps, no overlaps at the opening).
    for (const v of V) {
      const key = `${Math.round(v.x * 100) / 100} ${Math.round(v.y * 100) / 100}`;
      expect(paths.filter((p) => p.includes(key)).length).toBe(2);
    }
    // Apothem is exact: every vertex sits at the circumradius a / cos 30°.
    for (const v of V) expect(Math.hypot(v.x - 100, v.y - 100)).toBeCloseTo(30 / Math.cos(Math.PI / 6), 6);
  });

  it('opens continuously and ends with the hexagon covering every viewport corner', () => {
    const lens = 180;
    const full = fullRevealApothem(1440, 900);
    let prev = 0;
    for (let t = 0; t <= TIMELINE.revealEnd; t += 10) {
      const f = irisFrame(t, lens, full);
      expect(f.apothem).toBeGreaterThanOrEqual(prev - 1e-9); // never closes again
      prev = f.apothem;
    }
    const end = irisFrame(TIMELINE.revealEnd, lens, full);
    expect(end.done).toBe(true);
    expect(end.apothem).toBeGreaterThanOrEqual(Math.hypot(720, 450));
  });

  it('reveal radius accounts for an off-centre anchor', () => {
    expect(fullRevealApothem(390, 844, 195, 150)).toBeGreaterThanOrEqual(Math.hypot(195, 694));
  });

  it('anchors on the cover focal point, kept inside photo and viewport', () => {
    const rect = { left: 0, top: 0, width: 390, height: 490 };
    const a = anchorFromRect(rect, { x: 0.55, y: 0.28 }, 390, 844, 100);
    expect(a.x).toBeCloseTo(214.5, 1);
    expect(a.y).toBeGreaterThanOrEqual(100 * 1.08 - 1e-9);
    expect(anchorFromRect(null, null, 390, 844, 100)).toEqual({ x: 195, y: 422 });
    const edge = anchorFromRect(rect, { x: 0, y: 1 }, 390, 844, 100);
    expect(edge.x).toBeGreaterThan(0);
    expect(edge.y).toBeLessThan(490);
  });
});
