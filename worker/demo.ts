import manifest from '../shared/demo-manifest.json';

/**
 * DEMO MODE fixture "folders". These are NOT Google Drive folders: they are licensed sample images bundled
 * in public/__fixtures (Unsplash License via picsum.photos). Demo sync reads this manifest, never Drive.
 */

export interface DemoFile {
  fileId: string;
  name: string;
  asset: string;
  w: number;
  h: number;
  credit: { author: string; url: string };
}

interface ManifestImage {
  id: string;
  sets: string[];
  author: string;
  sourceUrl: string;
  width: number;
  height: number;
}

const images = (manifest as { images: ManifestImage[] }).images;
const byId = new Map(images.map((i) => [i.id, i]));

export const DEMO_FOLDERS: Record<string, { name: string; ids: string[] | 'stress' }> = {
  coast: {
    name: 'Coastline — Late Summer',
    ids: (manifest as { sets: Record<string, number[]> }).sets.coast.map(String),
  },
  city: {
    name: 'Cities in Passing',
    ids: (manifest as { sets: Record<string, number[]> }).sets.city.map(String),
  },
  portraits: {
    name: 'Portraits in Autumn Light',
    ids: (manifest as { sets: Record<string, number[]> }).sets.portraits.map(String),
  },
  highlands: {
    name: 'Highlands & Night Skies',
    ids: (manifest as { sets: Record<string, number[]> }).sets.highlands.map(String),
  },
  lights: {
    name: 'Evening Lights',
    ids: (manifest as { sets: Record<string, number[]> }).sets.lights.map(String),
  },
  archive: { name: 'Synthetic Archive — 1,200 frames', ids: 'stress' },
  empty: { name: 'Empty Folder', ids: [] },
};

export function parseDemoFolder(input: string): string | null {
  const m = input.trim().match(/^demo:([a-z]+)$/);
  return m && DEMO_FOLDERS[m[1]] ? m[1] : null;
}

/** Deterministic file list for a demo folder. The stress set cycles all fixtures to 1,200 entries. */
export function listDemoFolder(key: string): DemoFile[] {
  const def = DEMO_FOLDERS[key];
  if (!def) return [];
  const mk = (img: ManifestImage, k: number, suffix = ''): DemoFile => ({
    fileId: `demo-${img.id}${suffix}`,
    name: `DSC_${String(k + 1).padStart(4, '0')}.jpg`,
    asset: img.id,
    w: img.width,
    h: img.height,
    credit: { author: img.author, url: img.sourceUrl },
  });
  if (def.ids === 'stress') {
    return Array.from({ length: 1200 }, (_, k) => mk(images[(k * 7) % images.length], k, `-${k}`));
  }
  return def.ids.map((id, k) => mk(byId.get(id)!, k)).filter(Boolean);
}
