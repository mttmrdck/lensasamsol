import { orderPhotos, selectCover } from '../../../shared/composition';
import type { LayoutResult } from '../../../shared/layout';
import { ImageScope } from './images';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { PublicCollection, PublicPhoto, PublicStudio } from '../../../shared/api';
import { PAIRINGS, resolveTheme, type StyleConfig } from '../../../shared/style';
import { useGoogleFonts } from '../../lib/fonts';
import { CoverHero } from './CoverHero';
import { PhotoGrid } from './PhotoGrid';
import { Lightbox } from './Lightbox';
import { ExternalArrow, folderActionLabel } from './DriveLink';

export interface GalleryRendererProps {
  studio: PublicStudio;
  collection: PublicCollection;
  photos: PublicPhoto[];
  /** Style to render — the published style publicly, the live draft in the editor. */
  styleConfig: StyleConfig;
  mode: 'public' | 'preview';
  demoMode: boolean;
  /** Scroll container (editor canvas). Omit to use the window. */
  scrollRoot?: RefObject<HTMLElement | null>;
  /** CSS length for 1vh inside the renderer. Public: 1svh. Editor: canvas height / 100. */
  vh?: string;
  /** Share token of this client gallery; null in the owner preview (images then use the admin route). */
  shareToken?: string | null;
  /**
   * Public client route entrance state marker. Text remains static behind the iris;
   * undefined in editor and owner previews.
   */
  holdTitles?: boolean;
  /** Controlled viewer state (public route syncs it with ?photo=). Uncontrolled in preview. */
  activePhotoId?: string | null;
  onActivePhotoChange?: (id: string | null, how: 'open' | 'step' | 'close') => void;
}

/**
 * The single gallery renderer used by BOTH the public /g/:slug route and the editor's live preview.
 * All responsive behaviour is container-query based, so preview width == real device behaviour.
 */
export function GalleryRenderer(props: GalleryRendererProps) {
  const {
    studio,
    collection: originalCollection,
    photos: sourcePhotos,
    styleConfig: style,
    mode,
    scrollRoot,
    demoMode,
  } = props;
  const photos = useMemo(
    () => (mode === 'preview' ? orderPhotos(sourcePhotos, style.composition?.order) : sourcePhotos),
    [sourcePhotos, mode, style.composition?.order],
  );
  const collection = {
    ...originalCollection,
    title: style.composition?.title ?? originalCollection.title,
    description: style.composition?.description ?? originalCollection.description,
  };
  const theme = resolveTheme(style.color);
  const pairing = PAIRINGS[style.type.pairing];
  useGoogleFonts([style.type.pairing]);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridLayoutRef = useRef<LayoutResult | null>(null);

  const [localActive, setLocalActive] = useState<string | null>(null);
  const controlled = props.onActivePhotoChange !== undefined;
  const activeId = controlled ? (props.activePhotoId ?? null) : localActive;
  const indexById = useMemo(() => new Map(photos.map((p, i) => [p.id, i])), [photos]);
  const activeIndex = activeId != null ? (indexById.get(activeId) ?? -1) : -1;
  const lastOpened = useRef<string | null>(null);

  const setActive = useCallback(
    (id: string | null, how: 'open' | 'step' | 'close') => {
      if (controlled) props.onActivePhotoChange!(id, how);
      else setLocalActive(id);
    },
    [controlled, props.onActivePhotoChange],
  );

  const cover: PublicPhoto | null = selectCover(photos, style.composition?.coverId, collection.coverPhotoId);
  const hrefFor = useCallback(
    (p: PublicPhoto) => (mode === 'public' ? `?photo=${encodeURIComponent(p.id)}` : '#'),
    [mode],
  );

  const open = useCallback(
    (index: number) => {
      lastOpened.current = photos[index]?.id ?? null;
      setActive(photos[index]?.id ?? null, 'open');
    },
    [photos, setActive],
  );

  const close = useCallback(() => {
    const id = activeId;
    setActive(null, 'close');
    // Return the visitor to the thumbnail of the photo they were viewing (it may have scrolled out of the
    // virtualised window while stepping through), then restore keyboard focus to it.
    requestAnimationFrame(() => {
      const root = scrollRoot?.current ?? null;
      const container = gridRef.current;
      if (!id || !container) return;
      const findTile = () =>
        container.querySelector<HTMLElement>(`[data-photo-id="${CSS.escape(id)}"] .g-tile-link`);
      let tile = findTile();
      if (!tile || !isInView(tile, root)) {
        const idx = indexById.get(id);
        if (idx != null) {
          const tileEl = tile?.parentElement;
          if (tileEl) tileEl.scrollIntoView({ block: 'center' });
          else {
            const box = gridLayoutRef.current?.boxes[idx];
            const grid = container.querySelector<HTMLElement>('[data-testid="photo-grid"]');
            if (box && grid) {
              const center = grid.getBoundingClientRect().top + box.y + box.h / 2;
              if (root) root.scrollTop += center - root.getBoundingClientRect().top - root.clientHeight / 2;
              else window.scrollBy(0, center - window.innerHeight / 2);
            }
          }
        }
      }
      setTimeout(() => {
        tile = findTile();
        if (tile?.parentElement && !isInView(tile, root))
          tile.parentElement.scrollIntoView({ block: 'center' });
        tile?.focus({ preventScroll: true });
      }, 60);
    });
  }, [activeId, setActive, scrollRoot, indexById]);

  const vars = {
    '--g-bg': theme.bg,
    '--g-surface': theme.surface,
    '--g-fg': theme.fg,
    '--g-fg2': theme.fg2,
    '--g-muted': theme.muted,
    '--g-line': theme.line,
    '--g-placeholder': theme.placeholder,
    '--g-display': pairing.display,
    '--g-display-weight': pairing.displayWeight,
    '--g-display-tracking': pairing.displayTracking,
    '--g-body': pairing.body,
    '--g-max': `${style.layout.maxWidth}px`,
    '--g-vh': props.vh ?? '1svh',
    '--g-title-scale': style.cover.titleScale,
    colorScheme: theme.dark ? 'dark' : 'light',
  } as React.CSSProperties;

  // A client gallery is standalone: no links to the studio site, a directory or any other gallery.
  const homeHref: string | null = null;
  const count = photos.length;
  const folderLink = !style.composition && style.actions.showFolderButton && collection.folderUrl;

  return (
    <ImageScope.Provider value={props.shareToken ?? null}>
      <div
        className="g-root"
        data-presentation="static-exhibition"
        style={vars}
        data-theme={theme.id}
        data-mode={mode}
        data-entrance={props.holdTitles === undefined ? undefined : props.holdTitles ? 'hold' : 'reveal'}
      >
        {/* Everything behind the viewer is inert while it is open (focus + screen readers stay in the dialog). */}
        <div inert={activeIndex >= 0 || undefined}>
          <CoverHero collection={collection} cover={cover} studio={studio} style={style} count={count} />

          <section ref={gridRef} className="g-wrap g-exhibition-gallery pb-16" aria-label="All photographs">
            {count === 0 ? (
              <div className="mx-auto flex max-w-[460px] flex-col items-center gap-4 py-24 text-center">
                <h2 className="g-display text-[34px]">Photographs are on their way</h2>
                <p className="g-secondary text-[15px] leading-6">
                  This collection is still being prepared. Please check back shortly.
                </p>
                {homeHref && (
                  <a href={homeHref} className="g-btn g-btn-line mt-2">
                    Back to {studio.name}
                  </a>
                )}
              </div>
            ) : (
              <>
                <PhotoGrid
                  layoutRef={gridLayoutRef}
                  photos={photos}
                  style={style}
                  scrollRoot={scrollRoot}
                  hrefFor={hrefFor}
                  onOpen={open}
                />
              </>
            )}
          </section>

          <footer className="border-t border-[var(--g-line)]">
            <div className="g-wrap flex flex-col gap-6 py-12 text-[13px] sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-col gap-1.5">
                <span className="text-[14px] font-medium">Photographed by {studio.name}</span>
                <span className="g-muted max-w-[56ch] leading-5">
                  Prepared privately for you. Anyone who has this link can view the gallery, so please share
                  it only with people you trust.
                </span>
                {collection.source === 'demo' && demoMode && (
                  <span className="g-muted max-w-[52ch] leading-5">
                    Demo collection. Sample images by Unsplash photographers, served via Lorem Picsum; each
                    photo’s source link credits its author.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {folderLink && (
                  <a
                    className="inline-flex min-h-11 items-center gap-1.5 hover:opacity-70"
                    href={collection.folderUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {folderActionLabel(style)}
                    <ExternalArrow size={14} />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
                {studio.contactUrl && (
                  <a
                    className="inline-flex min-h-11 items-center hover:opacity-70"
                    href={studio.contactUrl}
                    rel="noopener noreferrer"
                  >
                    {studio.contactLabel || 'Contact'}
                  </a>
                )}
              </div>
            </div>
          </footer>
        </div>

        {activeIndex >= 0 && (
          <Lightbox
            photos={photos}
            index={activeIndex}
            style={style}
            theme={theme}
            title={collection.title}
            onIndex={(i) => setActive(photos[i].id, 'step')}
            onClose={close}
            scrollRoot={scrollRoot}
            allowCopyLink={mode === 'public'}
          />
        )}
      </div>
    </ImageScope.Provider>
  );
}

function isInView(el: HTMLElement, root: HTMLElement | null): boolean {
  const r = el.getBoundingClientRect();
  const top = root ? root.getBoundingClientRect().top : 0;
  const bottom = root ? top + root.clientHeight : window.innerHeight;
  return r.bottom > top && r.top < bottom;
}
