import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { PublicPhoto } from '../../../shared/api';
import type { StyleConfig, TemplateId } from '../../../shared/style';
import {
  TEMPLATES,
  arrangeStyle,
  compositionLayout,
  rankCovers,
  recommendTemplate,
} from '../../../shared/composition';
import { imgUrl } from '../../lib/format';
import { Button, Input, Segmented, Switch } from '../ui';

// Structural thumbnails use the production engine and representative natural proportions.
const samples = [2 / 3, 1.5, 1.8, 0.7, 0.75, 0.66, 1.6, 1.4, 0.8, 1.5, 1.9, 0.66].map((ar, i) => ({
  id: `sample${i}`,
  w: ar * 3000,
  h: 3000,
  featured: i === 6,
}));
function TemplateThumbnail({ id, style }: { id: TemplateId; style: StyleConfig }) {
  const demo = arrangeStyle(style, samples, null, id);
  const layout = compositionLayout(samples, 1000, demo);
  return (
    <svg viewBox="0 0 1000 700" className="h-[76px] w-full bg-subtle" aria-hidden="true">
      {layout.boxes.map((b) => (
        <rect
          key={b.i}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill={b.i % 3 === 0 ? '#777970' : b.i % 3 === 1 ? '#A6A89E' : '#CECEC4'}
        />
      ))}
    </svg>
  );
}
type Composition = NonNullable<StyleConfig['composition']>;
interface ControlProps {
  style: StyleConfig;
  onChange: (s: StyleConfig, key?: string) => void;
}

/** Shared by the three panels below: merges a composition patch into the style. */
function useCompositionPatch({ style, onChange }: ControlProps) {
  return (value: Partial<Composition>, key = 'composition') =>
    onChange(
      {
        ...style,
        composition: {
          template: style.composition?.template ?? 'editorial-signature',
          useTemplate: style.composition?.useTemplate ?? !!style.composition,
          ...style.composition,
          ...value,
        },
      },
      key,
    );
}

/** Presets tab: Auto Arrange and the gallery layout templates. */
export function ArrangeControls({
  style,
  photos,
  coverId,
  onChange,
}: ControlProps & { photos: PublicPhoto[]; coverId: string | null }) {
  const recommendation = useMemo(() => recommendTemplate(photos), [photos]);
  const [applied, setApplied] = useState(false);
  const choose = (id: TemplateId) => {
    onChange(arrangeStyle(style, photos, coverId, id), 'template');
    setApplied(false);
  };
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="primary"
        disabled={!photos.length}
        onClick={() => {
          onChange(arrangeStyle(style, photos, coverId), 'auto-arrange');
          setApplied(true);
        }}
      >
        <Sparkles size={15} aria-hidden="true" />
        Auto Arrange
      </Button>
      <p className="text-[12px] leading-4 text-slate" role="status">
        {applied ? 'Applied' : 'Recommended'}: {TEMPLATES.find((t) => t.id === recommendation.id)?.name}.{' '}
        {recommendation.reason}
        {applied && ' Review the preview, then save or publish when ready.'}
      </p>
      <div className="grid grid-cols-2 gap-2" aria-label="Composition templates">
        {TEMPLATES.map((t) => {
          const active = style.composition?.useTemplate !== false && style.composition?.template === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => choose(t.id)}
              className={`overflow-hidden rounded-ui border text-left ${active ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink'}`}
              title={t.note}
            >
              <TemplateThumbnail id={t.id} style={style} />
              <span className="block px-2 py-2 text-[13px] leading-4">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Layout tab: density, photo order and the template-specific switches. */
export function OrderingControls({ style, onChange }: ControlProps) {
  const patch = useCompositionPatch({ style, onChange });
  return (
    <>
      <div className="flex flex-col gap-2">
        <h3 className="text-[12px] font-semibold text-ink">Density</h3>
        <Segmented
          label="Layout density"
          value={style.layout.gap <= 8 ? 'compact' : style.layout.gap >= 18 ? 'spacious' : 'balanced'}
          onChange={(v) =>
            onChange(
              {
                ...style,
                layout: { ...style.layout, gap: v === 'compact' ? 8 : v === 'spacious' ? 22 : 12 },
              },
              'density',
            )
          }
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'spacious', label: 'Spacious' },
          ]}
        />
      </div>
      {style.composition &&
        style.composition.useTemplate !== false &&
        (style.composition.template === 'editorial-signature' ||
          style.composition.template === 'cinematic-archive') && (
          <div className="flex flex-col gap-3">
            {style.composition.template === 'editorial-signature' && (
              <Switch
                label="Editorial clusters"
                description="Group compatible consecutive portraits and landscapes in Editorial Signature."
                checked={style.composition.clusters !== false}
                onChange={(clusters) => patch({ clusters })}
              />
            )}
            <Switch
              label="Emphasize featured photos"
              description="Allow occasional larger wide frames without changing photo order."
              checked={style.composition.emphasizeFeatured !== false}
              onChange={(emphasizeFeatured) => patch({ emphasizeFeatured })}
            />
          </div>
        )}
      <div className="flex flex-col gap-1">
        <label className="text-[13px] font-medium">
          Photo order
          <select
            aria-label="Photo order"
            value={style.composition?.order ?? 'source'}
            onChange={(e) => patch({ order: e.target.value as 'source' | 'filename' }, 'composition.order')}
            className="mt-1 h-10 w-full rounded-ui border border-line bg-surface px-2 text-[14px] font-normal"
          >
            <option value="source">Existing sequence (default)</option>
            <option value="filename">Filename, natural order</option>
          </select>
        </label>
        <p className="text-[12px] leading-4 text-slate">
          Assignments and featured photos are changed in Manage Photos.
        </p>
      </div>
    </>
  );
}

/** Cover tab: the gallery introduction and the highlighted photograph (per-gallery content only). */
export function CoverContentControls({
  style,
  photos,
  coverId,
  onChange,
}: ControlProps & { photos: PublicPhoto[]; coverId: string | null }) {
  const patch = useCompositionPatch({ style, onChange });
  const covers = useMemo(() => rankCovers(photos).slice(0, 6), [photos]);
  return (
    <div className="flex flex-col gap-3">
      <label className="text-[13px] font-medium">
        Gallery title
        <Input
          aria-label="Gallery title override"
          value={style.composition?.title ?? ''}
          maxLength={140}
          placeholder="Use the existing public title"
          onChange={(e) =>
            patch({ title: e.target.value.trim() ? e.target.value : undefined }, 'composition.title')
          }
        />
      </label>
      <label className="text-[13px] font-medium">
        Subtitle
        <Input
          aria-label="Gallery subtitle"
          value={style.composition?.subtitle ?? ''}
          maxLength={240}
          placeholder="A place, a season, a story"
          onChange={(e) => patch({ subtitle: e.target.value }, 'composition.subtitle')}
        />
      </label>
      <label className="text-[13px] font-medium">
        Description
        <textarea
          aria-label="Gallery description override"
          className="mt-1 min-h-20 w-full rounded-ui border border-line bg-surface px-3 py-2 text-[14px] font-normal"
          maxLength={2000}
          value={style.composition?.description ?? ''}
          placeholder="Use the existing public description"
          onChange={(e) => patch({ description: e.target.value || undefined }, 'composition.description')}
        />
      </label>
      <label className="text-[13px] font-medium">
        Highlighted photograph
        <select
          aria-label="Highlighted photograph"
          className="mt-1 h-10 w-full rounded-ui border border-line bg-surface px-2 text-[14px] font-normal"
          value={style.composition?.coverId === null ? '' : (style.composition?.coverId ?? coverId ?? '')}
          onChange={(e) => patch({ coverId: e.target.value || null }, 'composition.cover')}
        >
          <option value="">Automatic metadata recommendation</option>
          {photos.map((p, i) => (
            <option key={p.id} value={p.id}>
              {p.filename ?? `Photograph ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {!!covers.length && (
        <div>
          <p className="mb-2 text-[12px] text-slate">
            Suggested covers · featured status, dimensions and order
          </p>
          <div className="grid grid-cols-3 gap-2">
            {covers.map((p, i) => (
              <button
                type="button"
                key={p.id}
                aria-label={`Use suggested cover ${i + 1}`}
                aria-pressed={(style.composition?.coverId ?? coverId) === p.id}
                onClick={() => patch({ coverId: p.id }, 'composition.cover')}
                className="overflow-hidden border border-line aria-pressed:ring-2 aria-pressed:ring-ink"
              >
                <img
                  src={imgUrl(p.id, 's')}
                  alt=""
                  loading="lazy"
                  className="aspect-[4/3] w-full object-contain bg-subtle"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
