import { ArrangeControls, CoverContentControls, OrderingControls } from './CompositionControls';
import { useRef, useState } from 'react';
import { Tabs } from 'radix-ui';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import type { PublicPhoto } from '../../../shared/api';
import {
  PAIRINGS,
  PRESETS,
  THEMES,
  applyPreset,
  contrastRatio,
  presetOverrides,
  resolveTheme,
  type PairingId,
  type StyleConfig,
  type ThemeId,
} from '../../../shared/style';
import { useGoogleFonts } from '../../lib/fonts';
import { imgUrl } from '../../lib/format';
import { Button, Input, Segmented, Slider, Switch, cx } from '../ui';

interface Props {
  style: StyleConfig;
  onChange: (s: StyleConfig, key?: string) => void;
  cover: PublicPhoto | null;
  coverId?: string | null;
  photos?: PublicPhoto[];
  featuredCount: number;
  target: 'collection' | 'defaults';
  onSaveAsDefault?: () => void;
  onRestorePublished?: () => void;
  /** False for shared-folder galleries: a folder link would expose other clients' files. */
  folderButtonAllowed?: boolean;
}

type InspectorTab = 'presets' | 'layout' | 'cover' | 'colour';

const TAB =
  'flex-1 h-10 text-[12px] font-medium text-slate border-b-2 border-transparent data-[state=active]:border-ink data-[state=active]:text-ink hover:text-ink';

export function Inspector({
  style,
  onChange,
  cover,
  coverId = null,
  photos = [],
  featuredCount,
  target,
  onSaveAsDefault,
  onRestorePublished,
  folderButtonAllowed = true,
}: Props) {
  useGoogleFonts(Object.keys(PAIRINGS) as PairingId[]);
  const [tab, setTab] = useState<InspectorTab>('presets');
  const scroller = useRef<HTMLDivElement>(null);
  const allowContent = target === 'collection';
  const set = <K extends keyof StyleConfig>(section: K, patch: Partial<StyleConfig[K]>, key?: string) =>
    onChange(
      { ...style, [section]: { ...(style[section] as object), ...patch } } as StyleConfig,
      key ?? `${String(section)}.${Object.keys(patch).join(',')}`,
    );

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(next) => {
        // Only the visible panel is rendered; edits live in the editor, so switching never loses or saves anything.
        setTab(next as InspectorTab);
        scroller.current?.scrollTo({ top: 0 });
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <Tabs.List className="flex shrink-0 border-b border-line px-2" aria-label="Inspector sections">
        <Tabs.Trigger value="presets" className={TAB}>
          Presets
        </Tabs.Trigger>
        <Tabs.Trigger value="layout" className={TAB}>
          Layout
        </Tabs.Trigger>
        <Tabs.Trigger value="cover" className={TAB}>
          Cover
        </Tabs.Trigger>
        <Tabs.Trigger value="colour" className={TAB}>
          Colour
        </Tabs.Trigger>
      </Tabs.List>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {/* ---------------- Presets */}
        <Tabs.Content value="presets" className="flex flex-col gap-5 p-4">
          <Group title="Auto arrange">
            <ArrangeControls style={style} photos={photos} coverId={coverId} onChange={onChange} />
          </Group>
          <Group title="Style presets">
            <p className="text-[12px] leading-4 text-slate">
              A style preset sets layout, cover style, typography and colour together. Auto Arrange and the
              templates above change only how photographs are arranged. Drive buttons and the opening sequence
              are kept.
            </p>
            {PRESETS.map((p) => {
              const t = THEMES[p.patch.color.theme];
              const f = PAIRINGS[p.patch.type.pairing];
              const active = style.presetId === p.id && presetOverrides(style, p).length === 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    const replaced = presetOverrides(
                      style,
                      PRESETS.find((x) => x.id === style.presetId) ?? p,
                    );
                    const before = style;
                    onChange(applyPreset(style, p), 'preset');
                    if (replaced.length && style.presetId !== p.id) {
                      toast(`Applied ${p.name}`, {
                        description: `Replaced your custom ${replaced.join(', ')}.`,
                        action: { label: 'Undo', onClick: () => onChange(before, 'preset-undo') },
                      });
                    } else if (replaced.length) {
                      toast(`Reset to ${p.name}`, {
                        description: `Cleared custom ${replaced.join(', ')}.`,
                        action: { label: 'Undo', onClick: () => onChange(before, 'preset-undo') },
                      });
                    }
                  }}
                  className={cx(
                    'group flex overflow-hidden rounded-ui border text-left transition-colors',
                    active ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span
                    className="flex w-[84px] shrink-0 flex-col justify-between p-2.5"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    <span
                      style={{
                        fontFamily: f.display,
                        fontWeight: f.displayWeight,
                        letterSpacing: f.displayTracking,
                      }}
                      className="text-[26px] leading-none"
                    >
                      Aa
                    </span>
                    <span className="flex gap-[3px]" aria-hidden="true">
                      {[0.9, 0.6, 1.3].map((w, i) => (
                        <span
                          key={i}
                          className="h-3"
                          style={{ flex: w, background: t.dark ? '#3a3a36' : '#c9c5bb' }}
                        />
                      ))}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      {p.name} {active && <Check size={13} aria-label="active" />}
                    </span>
                    <span className="text-[11px] leading-4 text-slate">{p.note}</span>
                  </span>
                </button>
              );
            })}
            {style.presetId &&
              presetOverrides(
                style,
                PRESETS.find((x) => x.id === style.presetId)!,
              ).length > 0 && (
                <p className="text-[12px] text-slate">
                  Based on {PRESETS.find((x) => x.id === style.presetId)?.name}, with your own changes.
                </p>
              )}
            {onRestorePublished && (
              <Button size="sm" variant="ghost" onClick={onRestorePublished}>
                Restore the live design
              </Button>
            )}
            {onSaveAsDefault && target === 'collection' && (
              <Button size="sm" onClick={onSaveAsDefault}>
                Use as default for new collections
              </Button>
            )}
          </Group>
        </Tabs.Content>

        {/* ---------------- Layout */}
        <Tabs.Content value="layout" className="flex flex-col gap-5 p-4">
          <Group title="Arrangement">
            <Segmented
              label="Layout"
              value={style.layout.mode}
              onChange={(mode) =>
                onChange(
                  {
                    ...style,
                    composition: style.composition ? { ...style.composition, useTemplate: false } : undefined,
                    layout: { ...style.layout, mode },
                  },
                  'layout.mode',
                )
              }
              options={[
                { value: 'folio', label: 'Folio', title: 'Contact sheet beside an information column' },
                { value: 'justified', label: 'Rows', title: 'Justified rows, uncropped' },
                { value: 'masonry', label: 'Columns', title: 'Masonry columns, uncropped' },
                { value: 'editorial', label: 'Editorial', title: 'Editorial rhythm' },
                { value: 'uniform', label: 'Grid', title: 'Uniform grid, cropped' },
              ]}
            />
            <p className="text-[12px] leading-4 text-slate">
              {style.layout.mode === 'folio' &&
                'Tight columns of uncropped photos beside a slim information column. The cover photograph leads the sheet.'}
              {style.layout.mode === 'justified' &&
                'Even rows, every photo uncropped. Best for mixed portrait and landscape sets.'}
              {style.layout.mode === 'masonry' &&
                'Columns at natural height. Uncropped, with staggered bottoms.'}
              {style.layout.mode === 'editorial' &&
                'Alternates single frames, pairs and trios with generous space. Best for smaller sets.'}
              {style.layout.mode === 'uniform' && 'Equal cells. Photos are cropped to fit the chosen shape.'}
            </p>
          </Group>
          {(style.layout.mode === 'justified' || style.layout.mode === 'editorial') && (
            <Slider
              label="Row height (desktop)"
              value={style.layout.rowHeight}
              min={180}
              max={480}
              step={10}
              onChange={(rowHeight) => set('layout', { rowHeight })}
            />
          )}
          {(style.layout.mode === 'masonry' || style.layout.mode === 'uniform') && (
            <Slider
              label="Columns (desktop)"
              value={style.layout.columns}
              min={2}
              max={6}
              unit=""
              onChange={(columns) => set('layout', { columns })}
            />
          )}
          {style.layout.mode === 'uniform' && (
            <Group title="Cell shape">
              <Segmented
                label="Cell shape"
                value={style.layout.uniformAspect}
                onChange={(uniformAspect) => set('layout', { uniformAspect })}
                options={(['1:1', '4:5', '4:3', '3:2'] as const).map((v) => ({ value: v, label: v }))}
              />
            </Group>
          )}
          <OrderingControls style={style} onChange={onChange} />
          <Slider
            label="Spacing"
            value={style.layout.gap}
            min={0}
            max={48}
            onChange={(gap) => set('layout', { gap })}
          />
          <Slider
            label="Maximum width"
            value={style.layout.maxWidth}
            min={960}
            max={2400}
            step={40}
            onChange={(maxWidth) => set('layout', { maxWidth })}
          />
          <Group title="Photo buttons">
            <div className="flex flex-col gap-3">
              <Switch
                label="Whole-folder button"
                description={
                  folderButtonAllowed
                    ? 'Off by default. Opens the entire Drive folder, so only use it when the folder holds this client’s photos alone.'
                    : 'Unavailable: this gallery uses a shared folder, and a folder link would expose other clients’ files.'
                }
                disabled={!folderButtonAllowed}
                checked={folderButtonAllowed && style.actions.showFolderButton}
                onChange={(showFolderButton) => set('actions', { showFolderButton })}
              />
              <Switch
                label="Button on each photo"
                description="Shown on hover; always visible on touch screens."
                checked={style.actions.showPhotoButton}
                onChange={(showPhotoButton) => set('actions', { showPhotoButton })}
              />
              <Switch
                label="Button in the photo viewer"
                checked={style.actions.showLightboxButton}
                onChange={(showLightboxButton) => set('actions', { showLightboxButton })}
              />
            </div>
            <Segmented
              label="Button wording"
              value={style.actions.label}
              onChange={(label) => set('actions', { label })}
              options={[
                { value: 'open', label: 'Open in Drive' },
                { value: 'download', label: 'Download via Drive' },
              ]}
            />
            <p className="text-[12px] leading-4 text-slate">
              Either way, buttons open Google Drive in a new tab, where visitors can download the original.
            </p>
          </Group>
          <Switch
            label="Show filenames"
            description="On thumbnails and in the viewer."
            checked={style.actions.showFilenames}
            onChange={(showFilenames) => set('actions', { showFilenames })}
          />
          <p className="rounded-ui bg-subtle px-3 py-2 text-[12px] leading-4 text-slate">
            On tablets rows are 75% of this height and spacing 75%; on phones 56% and half. Columns cap at 3
            on tablets and 2 on phones.
          </p>
        </Tabs.Content>

        {/* ---------------- Cover & Type */}
        <Tabs.Content value="cover" className="flex flex-col gap-5 p-4">
          {allowContent && (
            <Group title="Introduction">
              <CoverContentControls style={style} photos={photos} coverId={coverId} onChange={onChange} />
            </Group>
          )}
          {style.layout.mode === 'folio' ? (
            <p className="rounded-ui bg-subtle px-3 py-2 text-[12px] leading-4 text-slate">
              The Folio layout opens with a compact information column and leads with the highlighted
              photograph, so cover style, height, focal point and title size do not apply to it.
            </p>
          ) : (
            <>
              <Group title="Cover">
                <Segmented
                  label="Cover style"
                  value={style.cover.style}
                  onChange={(s) => set('cover', { style: s })}
                  options={[
                    { value: 'featured-below', label: 'Featured' },
                    { value: 'cinematic', label: 'Full-bleed' },
                    { value: 'split', label: 'Split' },
                    { value: 'typographic', label: 'Type only' },
                  ]}
                />
              </Group>
              {(style.cover.style === 'cinematic' || style.cover.style === 'split') && cover && (
                <FocalPicker
                  cover={cover}
                  focal={style.cover.focal}
                  focalMobile={style.cover.focalMobile}
                  onChange={(which, v) =>
                    set('cover', which === 'desktop' ? { focal: v } : { focalMobile: v }, `focal.${which}`)
                  }
                />
              )}
              {(style.cover.style === 'cinematic' || style.cover.style === 'split') && (
                <Slider
                  label="Cover height"
                  value={style.cover.height}
                  min={60}
                  max={95}
                  unit="% of screen"
                  onChange={(height) => set('cover', { height })}
                />
              )}
              <Group title="Title style">
                <Segmented
                  label="Title alignment"
                  value={style.cover.titleAlign}
                  onChange={(titleAlign) => set('cover', { titleAlign })}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Centre' },
                  ]}
                />
              </Group>
              <Slider
                label="Title size"
                value={Math.round(style.cover.titleScale * 100)}
                min={70}
                max={140}
                step={5}
                unit="%"
                onChange={(v) => set('cover', { titleScale: v / 100 })}
              />
            </>
          )}
          <div className="flex flex-col gap-3">
            <Switch
              label="Show description"
              checked={style.cover.showDescription}
              onChange={(showDescription) => set('cover', { showDescription })}
            />
            <Switch
              label="Show event date"
              checked={style.cover.showDate}
              onChange={(showDate) => set('cover', { showDate })}
            />
            <Switch
              label="Show photo count"
              checked={style.cover.showCount}
              onChange={(showCount) => set('cover', { showCount })}
            />
          </div>

          <Group title="Opening sequence">
            <Switch
              label="Open with selected moments"
              description={
                featuredCount
                  ? `${featuredCount} featured photo${featuredCount === 1 ? '' : 's'} shown between cover and gallery.`
                  : 'Feature photos on the collection page to use this. Skipped when none are featured.'
              }
              checked={style.sequence.enabled}
              onChange={(enabled) => set('sequence', { enabled })}
            />
            {style.sequence.enabled && (
              <Input
                aria-label="Sequence heading"
                value={style.sequence.heading}
                maxLength={60}
                onChange={(e) => set('sequence', { heading: e.target.value }, 'seq.heading')}
                placeholder="Selected moments"
              />
            )}
          </Group>
        </Tabs.Content>

        {/* ---------------- Colour & actions */}
        <Tabs.Content value="colour" className="flex flex-col gap-5 p-4">
          <Group title="Gallery colour">
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Colour theme">
              {(Object.keys(THEMES) as ThemeId[]).map((id) => {
                const t = THEMES[id];
                const active = style.color.theme === id && !style.color.customBg;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t.name}
                    title={t.name}
                    onClick={() => set('color', { theme: id, customBg: null })}
                    className={cx(
                      'flex aspect-square flex-col items-center justify-center rounded-ui border text-[13px]',
                      active ? 'ring-2 ring-ink ring-offset-2' : 'border-line',
                    )}
                    style={{ background: t.bg, color: t.fg, fontFamily: 'var(--font-display)' }}
                  >
                    Aa
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-slate">
              {style.color.customBg ? 'Custom background' : THEMES[style.color.theme].name}
            </p>
          </Group>
          <CustomBg style={style} onChange={(customBg) => set('color', { customBg }, 'customBg')} />
          <Group title="Typography">
            <div className="grid grid-cols-1 gap-2">
              {Object.values(PAIRINGS).map((f) => {
                const active = style.type.pairing === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => set('type', { pairing: f.id })}
                    className={cx(
                      'flex items-center gap-3 rounded-ui border px-3 py-2.5 text-left',
                      active ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span
                      style={{
                        fontFamily: f.display,
                        fontWeight: f.displayWeight,
                        letterSpacing: f.displayTracking,
                      }}
                      className="w-10 text-[30px] leading-none"
                    >
                      Aa
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-[13px] font-medium">{f.name}</span>
                      <span className="truncate text-[11px] text-slate" style={{ fontFamily: f.body }}>
                        {f.display.split(',')[0].replace(/'/g, '')} with{' '}
                        {f.body.split(',')[0].replace(/'/g, '')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Group>

          <Group title="Photo viewer">
            <Segmented
              label="Viewer background"
              value={style.color.lightbox}
              onChange={(lightbox) => set('color', { lightbox })}
              options={[
                { value: 'darkroom', label: 'Darkroom' },
                { value: 'match', label: 'Match gallery' },
              ]}
            />
          </Group>
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[12px] font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function CustomBg({ style, onChange }: { style: StyleConfig; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(style.color.customBg ?? '');
  const t = resolveTheme(style.color);
  const fg2 = style.color.customBg ? contrastRatio(t.fg2, t.bg) : null;
  return (
    <Group title="Custom background">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label="Pick a background colour"
          value={style.color.customBg ?? THEMES[style.color.theme].bg}
          onChange={(e) => {
            setText(e.target.value.toUpperCase());
            onChange(e.target.value.toUpperCase());
          }}
          className="h-[38px] w-11 shrink-0 cursor-pointer rounded-ui border border-line bg-surface p-1"
        />
        <Input
          aria-label="Background hex"
          value={text}
          placeholder="#F1EEE8"
          maxLength={7}
          className="font-mono text-[13px]"
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toUpperCase());
          }}
        />
        {style.color.customBg && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText('');
              onChange(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {style.color.customBg && (
        <p className="tnum text-[12px] text-slate">
          Text contrast {t.contrast.toFixed(1)}:1, secondary {fg2!.toFixed(1)}:1.{' '}
          {t.contrast >= 7 ? 'Passes AAA.' : t.contrast >= 4.5 ? 'Passes AA.' : 'Below AA.'} Text colours
          adjust automatically.
        </p>
      )}
    </Group>
  );
}

function FocalPicker({
  cover,
  focal,
  focalMobile,
  onChange,
}: {
  cover: PublicPhoto;
  focal: { x: number; y: number };
  focalMobile: { x: number; y: number };
  onChange: (which: 'desktop' | 'mobile', v: { x: number; y: number }) => void;
}) {
  const [which, setWhich] = useState<'desktop' | 'mobile'>('desktop');
  const ref = useRef<HTMLDivElement>(null);
  const cur = which === 'desktop' ? focal : focalMobile;
  const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(which, { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) });
  };
  return (
    <Group title="Focal point">
      <Segmented
        label="Focal point for"
        value={which}
        onChange={setWhich}
        options={[
          { value: 'desktop', label: 'Wide screens' },
          { value: 'mobile', label: 'Phones' },
        ]}
      />
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={`Cover focal point for ${which === 'desktop' ? 'wide screens' : 'phones'}`}
        aria-valuetext={`${Math.round(cur.x * 100)}% across, ${Math.round(cur.y * 100)}% down`}
        className="relative w-full cursor-crosshair touch-none select-none overflow-hidden bg-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        style={{ aspectRatio: `${cover.w} / ${cover.h}` }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          fromEvent(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && fromEvent(e)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const d = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[e.key];
          if (d) {
            e.preventDefault();
            onChange(which, { x: clamp(cur.x + d[0]), y: clamp(cur.y + d[1]) });
          }
        }}
      >
        <img
          src={imgUrl(cover.id, 's')}
          alt=""
          className="pointer-events-none h-full w-full object-cover"
          draggable={false}
        />
        <span
          className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${cur.x * 100}%`, top: `${cur.y * 100}%` }}
        >
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
        </span>
      </div>
      <p className="text-[12px] leading-4 text-slate">
        Click or drag to keep faces and subjects in frame. Arrow keys nudge it.
      </p>
    </Group>
  );
}
