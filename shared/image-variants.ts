/** All preview sizes are bounded long edges; originals never form a candidate. */
export const IMAGE_VARIANTS = { s: 480, m: 960, l: 1600, xl: 2560 } as const;
export type ImageVariant = keyof typeof IMAGE_VARIANTS;

export function previewDimensions(w: number, h: number, variant: ImageVariant) {
  const known = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const scale = known ? Math.min(1, IMAGE_VARIANTS[variant] / Math.max(w, h)) : 1;
  return known
    ? { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
    : { width: IMAGE_VARIANTS[variant], height: IMAGE_VARIANTS[variant] };
}

export function containDimensions(w: number, h: number, width: number, height: number) {
  const aspect = w > 0 && h > 0 ? w / h : 1.5;
  const fitWidth = Math.max(0, Math.min(width, height * aspect));
  return { width: fitWidth, height: fitWidth / aspect };
}

/** Smallest derivative that covers the displayed image at the current pixel density. */
export function viewingVariant(
  w: number,
  h: number,
  width: number,
  height: number,
  dpr = 1,
  max: ImageVariant = 'xl',
): ImageVariant {
  const fit = containDimensions(w, h, width, height);
  const needed = Math.max(fit.width, fit.height) * Math.max(1, dpr);
  const candidates = (Object.keys(IMAGE_VARIANTS) as ImageVariant[]).filter(
    (v) => IMAGE_VARIANTS[v] <= IMAGE_VARIANTS[max],
  );
  return candidates.find((v) => IMAGE_VARIANTS[v] >= Math.min(needed, Math.max(w, h) || needed)) ?? max;
}
