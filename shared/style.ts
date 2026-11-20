import { z } from 'zod';

/** Gallery style configuration — the single typed contract shared by editor, API and public renderer. */

const focal = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const layoutModes = ['justified', 'masonry', 'editorial', 'uniform'] as const;
export const coverStyles = ['featured-below', 'cinematic', 'split', 'typographic'] as const;
export const themeIds = ['archival', 'exhibition', 'linen', 'stone', 'darkroom'] as const;
export const pairingIds = ['archival', 'fine-art', 'literary', 'swiss', 'monograph', 'instrument'] as const;
export const presetIds = [
  'minimal-archival',
  'editorial-warm',
  'darkroom-noir',
  'exhibition-white',
  'classic-portrait',
] as const;
export const uniformAspects = ['1:1', '4:3', '3:2', '4:5'] as const;

export const templateIds = [
  'editorial-signature',
  'compact-exhibition',
  'portrait-story',
  'cinematic-archive',
  'modern-contact-sheet',
] as const;
export type TemplateId = (typeof templateIds)[number];

export const styleConfigSchema = z.object({
  version: z.literal(1),
  // Optional for legacy designs. All overrides travel with draft/published style snapshots.
  composition: z
    .object({
      template: z.enum(templateIds),
      useTemplate: z.boolean().optional(),
      order: z.enum(['source', 'filename']).optional(),
      coverId: z.string().max(64).nullable().optional(),
      title: z.string().trim().min(1).max(140).optional(),
      subtitle: z.string().max(240).optional(),
      description: z.string().max(2000).optional(),
      clusters: z.boolean().optional(),
      emphasizeFeatured: z.boolean().optional(),
    })
    .optional(),
  presetId: z.enum(presetIds),
  layout: z.object({
    mode: z.enum(layoutModes),
    rowHeight: z.number().int().min(180).max(480),
    columns: z.number().int().min(2).max(6),
    gap: z.number().int().min(0).max(48),
    uniformAspect: z.enum(uniformAspects),
    maxWidth: z.number().int().min(960).max(2400),
  }),
  cover: z.object({
    style: z.enum(coverStyles),
    focal,
    focalMobile: focal,
    height: z.number().int().min(60).max(95),
    titleAlign: z.enum(['left', 'center']),
    titleScale: z.number().min(0.7).max(1.4),
    showDescription: z.boolean(),
    showDate: z.boolean(),
    showCount: z.boolean(),
  }),
  type: z.object({ pairing: z.enum(pairingIds) }),
  color: z.object({
    theme: z.enum(themeIds),
    customBg: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
    lightbox: z.enum(['darkroom', 'match']),
  }),
  actions: z.object({
    showFolderButton: z.boolean(),
    showPhotoButton: z.boolean(),
    showLightboxButton: z.boolean(),
    label: z.enum(['open', 'download']),
    showFilenames: z.boolean(),
  }),
  sequence: z.object({
    enabled: z.boolean(),
    heading: z.string().max(60),
  }),
});

export type StyleConfig = z.infer<typeof styleConfigSchema>;
export type LayoutMode = StyleConfig['layout']['mode'];
export type ThemeId = (typeof themeIds)[number];
export type PairingId = (typeof pairingIds)[number];
export type PresetId = (typeof presetIds)[number];

export const DEFAULT_STYLE: StyleConfig = {
  version: 1,
  presetId: 'minimal-archival',
  composition: { template: 'editorial-signature', clusters: true, emphasizeFeatured: true },
  layout: { mode: 'justified', rowHeight: 320, columns: 3, gap: 12, uniformAspect: '3:2', maxWidth: 1600 },
  cover: {
    style: 'featured-below',
    focal: { x: 0.5, y: 0.5 },
    focalMobile: { x: 0.5, y: 0.5 },
    height: 82,
    titleAlign: 'left',
    titleScale: 1,
    showDescription: true,
    showDate: true,
    showCount: true,
  },
  type: { pairing: 'instrument' },
  color: { theme: 'archival', customBg: null, lightbox: 'darkroom' },
  actions: {
    // Off by default: a folder link can expose files outside this client gallery.
    showFolderButton: false,
    showPhotoButton: true,
    showLightboxButton: true,
    label: 'open',
    showFilenames: false,
  },
  sequence: { enabled: true, heading: 'Selected moments' },
};

/** Fields each preset controls. Anything not listed is left alone when a preset is applied. */
export interface PresetDef {
  id: PresetId;
  name: string;
  note: string;
  patch: {
    layout: Pick<StyleConfig['layout'], 'mode' | 'gap' | 'rowHeight'>;
    cover: Pick<StyleConfig['cover'], 'style' | 'titleAlign'>;
    type: StyleConfig['type'];
    color: Pick<StyleConfig['color'], 'theme' | 'lightbox'>;
  };
}

export const PRESETS: PresetDef[] = [
  {
    id: 'minimal-archival',
    name: 'Minimal Archival',
    note: 'Warm paper, natural featured cover, balanced rows.',
    patch: {
      layout: { mode: 'justified', gap: 12, rowHeight: 320 },
      cover: { style: 'featured-below', titleAlign: 'left' },
      type: { pairing: 'instrument' },
      color: { theme: 'archival', lightbox: 'darkroom' },
    },
  },
  {
    id: 'editorial-warm',
    name: 'Editorial Warm',
    note: 'Linen ground, split cover, literary serif.',
    patch: {
      layout: { mode: 'editorial', gap: 24, rowHeight: 340 },
      cover: { style: 'split', titleAlign: 'left' },
      type: { pairing: 'literary' },
      color: { theme: 'linen', lightbox: 'darkroom' },
    },
  },
  {
    id: 'darkroom-noir',
    name: 'Darkroom Noir',
    note: 'Near-black room for night and concert work.',
    patch: {
      layout: { mode: 'justified', gap: 6, rowHeight: 300 },
      cover: { style: 'cinematic', titleAlign: 'center' },
      type: { pairing: 'swiss' },
      color: { theme: 'darkroom', lightbox: 'darkroom' },
    },
  },
  {
    id: 'exhibition-white',
    name: 'Exhibition White',
    note: 'Gallery white, typographic opening, generous air.',
    patch: {
      layout: { mode: 'masonry', gap: 32, rowHeight: 320 },
      cover: { style: 'typographic', titleAlign: 'center' },
      type: { pairing: 'monograph' },
      color: { theme: 'exhibition', lightbox: 'match' },
    },
  },
  {
    id: 'classic-portrait',
    name: 'Classic Portrait',
    note: 'Stone grey, fine-art serif, tall rows for portraits.',
    patch: {
      layout: { mode: 'justified', gap: 16, rowHeight: 400 },
      cover: { style: 'split', titleAlign: 'left' },
      type: { pairing: 'fine-art' },
      color: { theme: 'stone', lightbox: 'darkroom' },
    },
  },
];

/** Returns the list of preset-controlled fields that differ between a style and a preset. */
export function presetOverrides(style: StyleConfig, preset: PresetDef): string[] {
  const diffs: string[] = [];
  const p = preset.patch;
  if (style.layout.mode !== p.layout.mode) diffs.push('layout');
  if (style.layout.gap !== p.layout.gap) diffs.push('spacing');
  if (style.layout.rowHeight !== p.layout.rowHeight) diffs.push('row height');
  if (style.cover.style !== p.cover.style) diffs.push('cover style');
  if (style.cover.titleAlign !== p.cover.titleAlign) diffs.push('title alignment');
  if (style.type.pairing !== p.type.pairing) diffs.push('typography');
  if (style.color.theme !== p.color.theme || style.color.customBg) diffs.push('colour');
  if (style.color.lightbox !== p.color.lightbox) diffs.push('viewer');
  return diffs;
}

export function applyPreset(style: StyleConfig, preset: PresetDef): StyleConfig {
  const p = preset.patch;
  return {
    ...style,
    presetId: preset.id,
    composition: style.composition
      ? {
          ...style.composition,
          template:
            preset.id === 'minimal-archival'
              ? 'editorial-signature'
              : preset.id === 'editorial-warm'
                ? 'editorial-signature'
                : preset.id === 'classic-portrait'
                  ? 'portrait-story'
                  : preset.id === 'darkroom-noir'
                    ? 'cinematic-archive'
                    : 'modern-contact-sheet',
        }
      : undefined,
    layout: { ...style.layout, ...p.layout },
    cover: { ...style.cover, ...p.cover },
    type: { ...p.type },
    color: { ...style.color, ...p.color, customBg: null },
  };
}

/** Parses stored JSON defensively. Invalid/legacy data falls back to defaults merged field by field. */
export function parseStyle(
  json: string | null | undefined,
  fallback: StyleConfig = DEFAULT_STYLE,
): StyleConfig {
  if (!json) return fallback;
  try {
    const raw = JSON.parse(json);
    const ok = styleConfigSchema.safeParse(raw);
    if (ok.success) return ok.data;
    const merged = {
      ...fallback,
      ...raw,
      layout: { ...fallback.layout, ...raw?.layout },
      cover: { ...fallback.cover, ...raw?.cover },
      type: { ...fallback.type, ...raw?.type },
      color: { ...fallback.color, ...raw?.color },
      actions: { ...fallback.actions, ...raw?.actions },
      sequence: { ...fallback.sequence, ...raw?.sequence },
      version: 1,
    };
    const second = styleConfigSchema.safeParse(merged);
    return second.success ? second.data : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- Themes

export interface ThemeTokens {
  id: ThemeId;
  name: string;
  dark: boolean;
  bg: string;
  surface: string;
  fg: string;
  fg2: string;
  muted: string;
  line: string;
  placeholder: string;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  archival: {
    id: 'archival',
    name: 'Archival',
    dark: false,
    bg: '#FAF9F6',
    surface: '#FFFFFF',
    fg: '#141413',
    fg2: '#5F5E59',
    muted: '#8A8882',
    line: '#E6E4DD',
    placeholder: '#ECEAE3',
  },
  exhibition: {
    id: 'exhibition',
    name: 'Exhibition White',
    dark: false,
    bg: '#FFFFFF',
    surface: '#F7F7F5',
    fg: '#111111',
    fg2: '#5C5C5A',
    muted: '#8C8C89',
    line: '#E8E8E5',
    placeholder: '#F0F0EE',
  },
  linen: {
    id: 'linen',
    name: 'Warm Linen',
    dark: false,
    bg: '#F3EFE6',
    surface: '#FBF8F1',
    fg: '#1C1917',
    fg2: '#625A53',
    muted: '#8C847C',
    line: '#E0D9CB',
    placeholder: '#E7E1D4',
  },
  stone: {
    id: 'stone',
    name: 'Gallery Stone',
    dark: false,
    bg: '#ECEBE7',
    surface: '#F5F4F1',
    fg: '#161615',
    fg2: '#555450',
    muted: '#7F7E79',
    line: '#D9D7D1',
    placeholder: '#DFDDD7',
  },
  darkroom: {
    id: 'darkroom',
    name: 'Darkroom',
    dark: true,
    bg: '#0E0E0D',
    surface: '#161614',
    fg: '#F5F4F0',
    fg2: '#A9A79F',
    muted: '#7A7871',
    line: '#292925',
    placeholder: '#1C1C1A',
  },
};

// ---------------------------------------------------------------- Colour maths (WCAG 2.x)

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return (
    '#' +
    ca
      .map((v, i) => Math.round(v + (cb[i] - v) * t))
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Resolves final tokens. A custom background derives every other token so text always passes 4.5:1. */
export function resolveTheme(color: StyleConfig['color']): ThemeTokens & { contrast: number } {
  const base = THEMES[color.theme];
  if (!color.customBg) return { ...base, contrast: contrastRatio(base.fg, base.bg) };
  const bg = color.customBg.toUpperCase();
  // Pick whichever ink gives the higher contrast on this ground.
  const dark = contrastRatio('#F5F4F0', bg) > contrastRatio('#141413', bg);
  const fg = dark ? '#F5F4F0' : '#141413';
  let fg2 = mix(bg, fg, 0.72);
  // Lift secondary text until it clears 4.5:1 against the custom ground (worst case: equals the primary ink).
  for (let t = 0.76; contrastRatio(fg2, bg) < 4.5 && t <= 1.0001; t += 0.04)
    fg2 = mix(bg, fg, Math.min(1, t));
  return {
    id: base.id,
    name: 'Custom',
    dark,
    bg,
    surface: mix(bg, dark ? '#FFFFFF' : '#FFFFFF', dark ? 0.04 : 0.5),
    fg,
    fg2,
    muted: mix(bg, fg, 0.55),
    line: mix(bg, fg, 0.12),
    placeholder: mix(bg, fg, 0.07),
    contrast: contrastRatio(fg, bg),
  };
}

// ---------------------------------------------------------------- Type pairings

export interface PairingDef {
  id: PairingId;
  name: string;
  display: string;
  body: string;
  displayWeight: number;
  displayTracking: string;
  /** Google Fonts css2 family query (without the leading family=). */
  families: string[];
}

export const PAIRINGS: Record<PairingId, PairingDef> = {
  instrument: {
    id: 'instrument',
    name: 'Editorial Monograph',
    display: "'Instrument Serif', Georgia, serif",
    body: "'Inter', system-ui, sans-serif",
    displayWeight: 400,
    displayTracking: '-0.02em',
    families: ['Instrument+Serif:ital@0;1', 'Inter:wght@400;500;600'],
  },
  archival: {
    id: 'archival',
    name: 'Archival',
    display: "'Young Serif', Georgia, serif",
    body: "'Schibsted Grotesk', system-ui, sans-serif",
    displayWeight: 400,
    displayTracking: '-0.025em',
    families: ['Young+Serif', 'Schibsted+Grotesk:ital,wght@0,400..700;1,400'],
  },
  'fine-art': {
    id: 'fine-art',
    name: 'Fine Art',
    display: "'Cormorant Garamond', Georgia, serif",
    body: "'Schibsted Grotesk', system-ui, sans-serif",
    displayWeight: 500,
    displayTracking: '-0.01em',
    families: ['Cormorant+Garamond:ital,wght@0,500;1,500', 'Schibsted+Grotesk:ital,wght@0,400..700;1,400'],
  },
  literary: {
    id: 'literary',
    name: 'Literary',
    display: "'Newsreader', Georgia, serif",
    body: "'Schibsted Grotesk', system-ui, sans-serif",
    displayWeight: 400,
    displayTracking: '-0.02em',
    families: [
      'Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400',
      'Schibsted+Grotesk:ital,wght@0,400..700;1,400',
    ],
  },
  swiss: {
    id: 'swiss',
    name: 'Swiss',
    display: "'Schibsted Grotesk', system-ui, sans-serif",
    body: "'Schibsted Grotesk', system-ui, sans-serif",
    displayWeight: 600,
    displayTracking: '-0.04em',
    families: ['Schibsted+Grotesk:ital,wght@0,400..700;1,400'],
  },
  monograph: {
    id: 'monograph',
    name: 'Monograph',
    display: "'Bodoni Moda', Georgia, serif",
    body: "'Schibsted Grotesk', system-ui, sans-serif",
    displayWeight: 400,
    displayTracking: '-0.02em',
    families: [
      'Bodoni+Moda:ital,opsz,wght@0,6..96,400;1,6..96,400',
      'Schibsted+Grotesk:ital,wght@0,400..700;1,400',
    ],
  },
};

export function fontHref(ids: PairingId[]): string {
  const fams = [...new Set(ids.flatMap((id) => PAIRINGS[id].families))];
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join('&')}&display=swap`;
}

/** Compare canonical validated shapes; JSON key insertion order must not keep a saved editor dirty. */
export function sameStyle(a: StyleConfig | null | undefined, b: StyleConfig | null | undefined): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(styleConfigSchema.parse(a)) === JSON.stringify(styleConfigSchema.parse(b));
}
