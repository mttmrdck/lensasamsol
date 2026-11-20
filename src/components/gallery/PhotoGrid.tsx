import { compositionLayout } from '../../../shared/composition';
import { useImages } from './images';
import { memo, useMemo, useRef, useState, useLayoutEffect, type RefObject } from 'react';
import { ImageOff, Maximize2 } from 'lucide-react';
import type { PublicPhoto } from '../../../shared/api';
import type { StyleConfig } from '../../../shared/style';
import { computeGalleryLayout, visibleBoxes, type Box, type LayoutResult } from '../../../shared/layout';

import { useElementWidth, useVisibleWindow } from './hooks';
import { ExternalArrow, photoTarget } from './DriveLink';

interface Props {
  photos: PublicPhoto[];
  style: StyleConfig;
  scrollRoot?: RefObject<HTMLElement | null>;
  hrefFor: (photo: PublicPhoto) => string;
  onOpen: (index: number) => void;
  /** Index of the tile to flag for focus restoration after the viewer closes. */
  focusIndex?: number | null;
  layoutRef?: RefObject<LayoutResult | null>;
  selection?: boolean;
}

/**
 * Virtualised gallery grid. Layout is computed once per (width, settings) as absolute integer boxes;
 * only tiles within ~1.5 viewports are mounted, so a 1,200-frame album keeps ~40–80 <img> nodes alive.
 */
export function PhotoGrid({
  photos,
  style,
  scrollRoot,
  hrefFor,
  onOpen,
  layoutRef,
  selection = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const layoutSettings = style.layout;
  const { mode, rowHeight, columns, gap, uniformAspect } = layoutSettings;
  const { template, clusters, emphasizeFeatured, useTemplate } = style.composition ?? {};
  const layout = useMemo(
    () =>
      template && useTemplate !== false
        ? compositionLayout(photos, width, {
            layout: layoutSettings,
            composition: { template, clusters, emphasizeFeatured },
          } as StyleConfig)
        : computeGalleryLayout(photos, { mode, width, rowHeight, columns, gap, uniformAspect }),
    [
      photos,
      mode,
      width,
      rowHeight,
      columns,
      gap,
      uniformAspect,
      template,
      clusters,
      emphasizeFeatured,
      useTemplate,
      layoutSettings,
    ],
  );
  useLayoutEffect(() => {
    if (layoutRef) layoutRef.current = layout;
  }, [layout, layoutRef]);
  const win = useVisibleWindow(ref, scrollRoot);
  const span = win.bottom - win.top;
  const visible = useMemo(
    () => visibleBoxes(layout.boxes, win.top - span * 0.75, win.bottom + span * 0.75),
    [layout.boxes, win.top, win.bottom, span],
  );

  return (
    <div
      ref={ref}
      className="relative w-full"
      data-natural={(!!template && useTemplate !== false) || undefined}
      style={{ height: layout.height || undefined }}
      data-testid={selection ? 'selected-grid' : 'photo-grid'}
    >
      {width > 0 &&
        visible.map((box) => (
          <Tile
            key={photos[box.i].id}
            photo={photos[box.i]}
            box={box}
            index={box.i}
            total={photos.length}
            selection={selection}
            href={hrefFor(photos[box.i])}
            onOpen={onOpen}
            showButton={style.actions.showPhotoButton}
            showName={style.actions.showFilenames}
            label={style.actions.label}
          />
        ))}
    </div>
  );
}

interface TileProps {
  photo: PublicPhoto;
  box: Box;
  index: number;
  total: number;
  href: string;
  onOpen: (index: number) => void;
  showButton: boolean;
  showName: boolean;
  label: 'open' | 'download';
  selection: boolean;
}

const Tile = memo(function Tile({
  photo,
  box,
  index,
  total,
  href,
  onOpen,
  showButton,
  showName,
  label,
  selection,
}: TileProps) {
  const { imgUrl, srcSet } = useImages();
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const target = showButton ? photoTarget(photo) : null;
  return (
    <div
      className="g-tile"
      style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.w, height: box.h }}
      data-photo-id={photo.id}
    >
      {state === 'error' ? (
        <div className="g-muted absolute inset-0 grid place-items-center p-3 text-center text-[12px] leading-4">
          <span className="flex flex-col items-center gap-2">
            <ImageOff size={18} strokeWidth={1.5} aria-hidden="true" />
            Preview unavailable
          </span>
        </div>
      ) : (
        <img
          src={imgUrl(photo.id, box.w > 700 ? 'l' : 'm')}
          srcSet={srcSet(photo.id, photo.w, photo.h)}
          sizes={`${box.w}px`}
          width={box.w}
          height={box.h}
          alt=""
          loading="lazy"
          decoding="async"
          data-loaded={state === 'loaded'}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
      <a
        className="g-tile-link"
        href={href}
        aria-label={`View photograph ${index + 1} of ${total}${photo.filename ? `, ${photo.filename}` : ''}`}
        data-tile-index={selection ? undefined : index}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(index);
        }}
      />
      <div className="g-tile-shade" aria-hidden="true" />
      {showName && photo.filename && <span className="g-tile-name">{photo.filename}</span>}
      <div className="g-tile-actions">
        <button
          type="button"
          className="g-chip g-chip-icon g-tile-view"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => onOpen(index)}
        >
          <Maximize2 size={14} strokeWidth={1.75} />
        </button>
        {target && (
          <a
            className="g-chip"
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            title={
              target.kind === 'drive'
                ? 'Opens Google Drive in a new tab'
                : 'Demo photo: opens the source page on Unsplash'
            }
            aria-label={
              target.kind === 'drive'
                ? `${label === 'download' ? 'Download' : 'Open'} original of photograph ${index + 1} in Google Drive (opens in a new tab)`
                : `Demo photo ${index + 1}: view source on Unsplash (opens in a new tab)`
            }
          >
            <span className="g-chip-label">{target.kind === 'drive' ? 'Drive' : 'Source'}</span>
            <ExternalArrow size={14} />
          </a>
        )}
      </div>
    </div>
  );
});
