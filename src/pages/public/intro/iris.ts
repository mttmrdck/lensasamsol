/**
 * Six-blade iris diaphragm geometry (pure, unit-tested).
 *
 * Model: the aperture opening is a regular hexagon centred on (cx, cy) with apothem `a`, rotated by `theta`.
 * Blade k is the region outside the hexagon between two rays: the extension of hexagon edge (k-1 → k) past
 * vertex k, and the extension of edge (k → k+1) past vertex k+1. The six blades tile everything outside the
 * opening with no gaps or overlaps, and each blade's inner edge is exactly one side of the hexagon — the same
 * pinwheel construction as the brand's aperture mark. Growing `a` while turning `theta` reproduces how a real
 * diaphragm opens: blades swing outward and the polygonal opening twists slightly as it widens.
 */

export interface Pt {
  x: number;
  y: number;
}

export const BLADES = 6;
const COS30 = Math.cos(Math.PI / 6);

export function hexVertices(cx: number, cy: number, apothem: number, theta: number): Pt[] {
  const R = apothem / COS30; // circumradius
  return Array.from({ length: BLADES }, (_, k) => {
    const ang = theta + (k * Math.PI * 2) / BLADES - Math.PI / 2;
    return { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) };
  });
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG path data for each blade. `reach` must exceed the distance to the farthest visible point. */
export function bladePaths(cx: number, cy: number, apothem: number, theta: number, reach: number): string[] {
  const V = hexVertices(cx, cy, apothem, theta);
  const dir = (k: number): Pt => {
    const a = V[(k + BLADES - 1) % BLADES];
    const b = V[k];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  return V.map((vk, k) => {
    const k1 = (k + 1) % BLADES;
    const dk = dir(k);
    const dk1 = dir(k1);
    const farK = { x: vk.x + dk.x * reach, y: vk.y + dk.y * reach };
    const farK1 = { x: V[k1].x + dk1.x * reach, y: V[k1].y + dk1.y * reach };
    return `M${f(vk.x)} ${f(vk.y)}L${f(farK.x)} ${f(farK.y)}L${f(farK1.x)} ${f(farK1.y)}L${f(V[k1].x)} ${f(V[k1].y)}Z`;
  });
}

/** Full-viewport rectangle with the hexagonal opening cut out (use fill-rule="evenodd"). */
export function surfaceWithHole(
  w: number,
  h: number,
  cx: number,
  cy: number,
  apothem: number,
  theta: number,
): string {
  const V = hexVertices(cx, cy, apothem, theta);
  return `M0 0H${f(w)}V${f(h)}H0Z` + `M${V.map((p) => `${f(p.x)} ${f(p.y)}`).join('L')}Z`;
}

/** The apothem at which the opening's inscribed circle (centred at cx, cy) covers every viewport corner. */
export function fullRevealApothem(w: number, h: number, cx = w / 2, cy = h / 2): number {
  return (
    Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)) *
    1.02
  );
}

/**
 * Where the iris should open: the cover photograph's focal point (object-position places the image's
 * focal point at exactly that percentage of its box), kept far enough inside the photo and the viewport
 * for the closed lens to sit on the picture. Falls back to the viewport centre.
 */
export function anchorFromRect(
  rect: { left: number; top: number; width: number; height: number } | null,
  focal: { x: number; y: number } | null,
  w: number,
  h: number,
  lens: number,
): { x: number; y: number } {
  if (!rect || rect.width < 40 || rect.height < 40) return { x: w / 2, y: h / 2 };
  const fx = focal?.x ?? 0.5;
  const fy = focal?.y ?? 0.5;
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(w, rect.left + rect.width);
  const bottom = Math.min(h, rect.top + rect.height);
  const pad = Math.min(lens * 1.08, (right - left) / 2, (bottom - top) / 2);
  const x = Math.min(right - pad, Math.max(left + pad, rect.left + fx * rect.width));
  const y = Math.min(bottom - pad, Math.max(top + pad, rect.top + fy * rect.height));
  return { x, y };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * The choreography as a pure function of elapsed time (ms). Returns everything the renderer needs.
 *  A   0–180    lens fades in at its closed pose
 *  B   180–950  mechanical opening (ease-in-out): apothem 7% → 88% of the lens, blades turn 34°
 *  C   760–1420 photographic reveal: lens and opening grow until the hexagon covers the viewport
 */
export const TIMELINE = {
  appearEnd: 180,
  openStart: 180,
  openEnd: 950,
  revealStart: 760,
  revealEnd: 1420,
} as const;

export function irisFrame(t: number, lens: number, full: number) {
  const pA = clamp01(t / TIMELINE.appearEnd);
  const pB = easeInOutCubic(clamp01((t - TIMELINE.openStart) / (TIMELINE.openEnd - TIMELINE.openStart)));
  const pC = easeInCubic(clamp01((t - TIMELINE.revealStart) / (TIMELINE.revealEnd - TIMELINE.revealStart)));
  const openA = lens * (0.07 + 0.81 * pB);
  const apothem = openA + (full - openA) * pC;
  const lensR = lens + (full * 1.35 - lens) * pC;
  const theta = ((34 * pB + 10 * pC) * Math.PI) / 180;
  return {
    appear: easeOutQuint(pA),
    apothem,
    lensR,
    theta,
    done: t >= TIMELINE.revealEnd,
    revealProgress: pC,
  };
}
