import { containDimensions, viewingVariant } from '../../../shared/image-variants';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Download, GalleryHorizontalEnd, Link2, X, Check } from 'lucide-react';
import type { PublicPhoto } from '../../../shared/api';
import type { StyleConfig, ThemeTokens } from '../../../shared/style';
import { pad3 } from '../../lib/format';
import { DRIVE_HELPER, ExternalArrow, photoActionLabel, photoTarget } from './DriveLink';
import { useImages } from './images';
import { useReducedMotion } from './hooks';

interface Props {
  photos: PublicPhoto[];
  index: number;
  style: StyleConfig;
  theme: ThemeTokens;
  title: string;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Scroll container to lock (editor canvas); defaults to the document. */
  scrollRoot?: RefObject<HTMLElement | null>;
  allowCopyLink: boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Lightbox({
  photos,
  index,
  style,
  theme,
  title,
  onIndex,
  onClose,
  scrollRoot,
  allowCopyLink,
}: Props) {
  const photo = photos[index];
  const { imgUrl, downloadUrl } = useImages();
  const total = photos.length;
  const dialogRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0, dpr: 1 });
  const closeRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const [idle, setIdle] = useState(false);
  const [drag, setDrag] = useState(0);
  const [hiLoaded, setHiLoaded] = useState(false);
  const [loLoaded, setLoLoaded] = useState(false);
  const [loFailed, setLoFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [strip, setStrip] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 900px)').matches,
  );
  const pointer = useRef<{ x: number; y: number; id: number; t: number } | null>(null);
  const hi = photo
    ? imgUrl(
        photo.id,
        viewingVariant(photo.w, photo.h, bounds.width, bounds.height, bounds.dpr, photo.credit ? 'l' : 'xl'),
      )
    : '';

  const go = useCallback(
    (d: number) => {
      const next = index + d;
      if (next >= 0 && next < total) onIndex(next);
    },
    [index, total, onIndex],
  );

  // Reset per-photo state.
  useLayoutEffect(() => {
    setHiLoaded(false);
    setLoLoaded(false);
    setLoFailed(false);
    setFailed(false);
    setDrag(0);
    setCopied(false);
  }, [photo?.id]);

  // A responsive tier is a new request even when the photograph stays the same.
  // Preserve the loaded small layer while an upgraded request loads or fails.
  useLayoutEffect(() => {
    setHiLoaded(false);
    setFailed(false);
  }, [hi]);

  // Measure the actual available theatre after toolbar/footer and safe-area layout.
  useLayoutEffect(() => {
    const el = boundsRef.current;
    if (!el) return;
    const measure = () =>
      setBounds({ width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio || 1 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.visualViewport?.addEventListener('resize', measure);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Lock background scroll; restore on close.
  useEffect(() => {
    const el = scrollRoot?.current ?? document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
    };
  }, [scrollRoot]);

  // Initial focus inside the dialog.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  // Keyboard: arrows, Home/End, Esc, and a Tab focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setIdle(false);
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        onIndex(total - 1);
      } else if (e.key === 'Tab' && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (n) => n.offsetParent !== null,
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        // Focus fell out of the dialog (e.g. the focused arrow became disabled): pull it back in.
        if (!dialogRef.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, onClose, onIndex, total]);

  // Auto-hide decorative chrome (arrows, filmstrip) after pointer inactivity — fine pointers only.
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches) return;
    let t = window.setTimeout(() => setIdle(true), 2800);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), 2800);
    };
    window.addEventListener('mousemove', wake);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousemove', wake);
    };
  }, []);

  // Preload adjacent previews only (never originals).
  useEffect(() => {
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const imgs = [photos[index + 1], photos[index - 1]].filter(Boolean).map((p) => {
      const im = new Image();
      im.decoding = 'async';
      im.src = imgUrl(
        p.id,
        viewingVariant(p.w, p.h, bounds.width, bounds.height, bounds.dpr, p.credit ? 'l' : 'xl'),
      );
      return im;
    });
    return () => imgs.forEach((im) => (im.src = ''));
  }, [index, photos, imgUrl, bounds]);

  // Keep the current filmstrip thumb in view.
  useEffect(() => {
    if (!strip) return;
    dialogRef.current
      ?.querySelector('.g-filmstrip [aria-current="true"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [index, strip, reduced]);

  if (!photo) return null;
  const target = photoTarget(photo);
  const download = downloadUrl(photo.id);
  const dark = style.color.lightbox === 'darkroom' || theme.dark;
  const vars = {
    '--lb-bg': style.color.lightbox === 'darkroom' ? '#0E0E0D' : theme.bg,
    '--lb-fg': style.color.lightbox === 'darkroom' ? '#F5F4F0' : theme.fg,
  } as React.CSSProperties;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId, t: Date.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId || e.pointerType === 'mouse') return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) > Math.abs(dy)) setDrag(dx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const fast = Date.now() - p.t < 280;
    setDrag(0);
    if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 60 || (fast && Math.abs(dx) > 24))) {
      go(dx < 0 ? 1 : -1);
    } else if (e.pointerType !== 'mouse' && dy > 110 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
    } else if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && e.target === e.currentTarget) {
      // Tap on the empty theatre around the photo closes; a tap on the photo itself does not.
      const img = dialogRef.current?.querySelector<HTMLElement>('.g-lb-img[alt]');
      const r = img?.getBoundingClientRect();
      const onPhoto =
        r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!onPhoto) onClose();
    }
  };

  const copyLink = async () => {
    try {
      const u = new URL(location.href);
      u.searchParams.set('photo', photo.id);
      await navigator.clipboard.writeText(u.toString());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const fit = containDimensions(photo.w, photo.h, bounds.width, bounds.height);
  const lo = imgUrl(photo.id, 's');
  const winStart = Math.max(0, index - 6);
  const filmstrip = photos.slice(winStart, Math.min(total, index + 7));

  return (
    <div
      ref={dialogRef}
      className="g-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}: photograph ${index + 1} of ${total}`}
      data-idle={idle}
      style={vars}
      data-testid="lightbox"
    >
      <div className="flex items-center justify-between gap-3 px-3 pt-[max(8px,env(safe-area-inset-top))] sm:px-5">
        <div className="flex min-w-0 tabular-nums items-baseline gap-4 pl-2 text-[13px]" aria-live="polite">
          <span>
            {pad3(index + 1, total)} <span className="opacity-50">/ {pad3(total, total)}</span>
          </span>
          {style.actions.showFilenames && photo.filename && (
            <span className="truncate font-mono text-[12px] opacity-60">{photo.filename}</span>
          )}
        </div>
        <div className="flex items-center gap-1 py-2">
          {download && (
            <a
              className="g-lb-drive"
              href={download}
              download={photo.filename ?? undefined}
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label="Download this photograph"
              title="Download the original photograph"
            >
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">Download</span>
            </a>
          )}
          {style.actions.showLightboxButton &&
            (target ? (
              <a
                className={download ? 'g-lb-drive g-lb-secondary' : 'g-lb-drive'}
                href={target.href}
                target="_blank"
                rel="noopener noreferrer"
                title={
                  target.kind === 'drive' ? DRIVE_HELPER : 'Demo photo: opens the source page on Unsplash'
                }
              >
                <span className="hidden sm:inline">
                  {target.kind === 'drive' ? `${photoActionLabel(style)}` : 'View demo source on Unsplash'}
                </span>
                <span className="sm:hidden">
                  {target.kind === 'drive' ? 'Original in Drive' : 'Demo source'}
                </span>
                <ExternalArrow />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span className="px-3 text-[12px] opacity-60">Original not available online</span>
            ))}
          {allowCopyLink && (
            <button
              type="button"
              className="g-lb-iconbtn"
              onClick={copyLink}
              aria-label={copied ? 'Link copied' : 'Copy link to this photograph'}
            >
              {copied ? <Check size={18} strokeWidth={1.75} /> : <Link2 size={18} strokeWidth={1.75} />}
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            className="g-lb-iconbtn"
            onClick={onClose}
            aria-label="Close viewer (Esc)"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div
        className="g-lb-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointer.current = null;
          setDrag(0);
        }}
      >
        <div
          ref={boundsRef}
          className="g-lb-bounds pointer-events-none"
          style={{
            transform: drag ? `translateX(${drag}px)` : undefined,
            transition: drag ? 'none' : reduced ? 'none' : 'transform 260ms cubic-bezier(.22,1,.36,1)',
          }}
        >
          {failed && loFailed ? (
            <div className="max-w-[34ch] text-center text-[14px] leading-6 opacity-75">
              This preview couldn’t be loaded.
              {target?.kind === 'drive' ? ' The original may still be available in Google Drive.' : ''}
            </div>
          ) : (
            <div
              className="g-lb-picture"
              style={{ width: fit.width, height: fit.height }}
              aria-busy={!hiLoaded && !failed}
            >
              {!hiLoaded && !loLoaded && (
                <span className="g-lb-status" role="status">
                  Loading preview…
                </span>
              )}
              <img
                key={`lo-${photo.id}`}
                className="g-lb-img"
                src={lo}
                alt=""
                aria-hidden="true"
                draggable={false}
                onLoad={() => setLoLoaded(true)}
                onError={() => setLoFailed(true)}
                style={{ width: fit.width, height: fit.height, opacity: hiLoaded ? 0 : loLoaded ? 1 : 0 }}
              />
              <img
                key={`hi-${photo.id}-${hi}`}
                className="g-lb-img"
                src={bounds.width > 0 ? hi : undefined}
                fetchPriority="high"
                alt={`Photograph ${index + 1} of ${total}`}
                draggable={false}
                decoding="async"
                onLoad={() => setHiLoaded(true)}
                onError={() => setFailed(true)}
                style={{
                  width: fit.width,
                  height: fit.height,
                  opacity: hiLoaded ? 1 : 0,
                  transition: reduced ? 'none' : 'opacity 280ms cubic-bezier(.22,1,.36,1)',
                }}
              />
              {failed && loLoaded && (
                <span className="g-lb-status g-lb-status-bottom" role="status">
                  Full preview unavailable. Showing a smaller preview.
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="g-lb-arrow g-lb-chrome left-4"
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Previous photograph"
        >
          <ChevronLeft size={22} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="g-lb-arrow g-lb-chrome right-4"
          onClick={() => go(1)}
          disabled={index === total - 1}
          aria-label="Next photograph"
        >
          <ChevronRight size={22} strokeWidth={1.5} />
        </button>
      </div>

      <div className="pb-[max(10px,env(safe-area-inset-bottom))]">
        {strip && (
          <div className="g-filmstrip g-lb-chrome py-2" aria-label="Filmstrip">
            {filmstrip.map((p, k) => {
              const i = winStart + k;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-current={i === index}
                  aria-label={`Go to photograph ${i + 1}`}
                  onClick={() => onIndex(i)}
                  style={{ aspectRatio: `${p.w} / ${p.h}` }}
                >
                  <img src={imgUrl(p.id, 's')} alt="" loading="lazy" decoding="async" />
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between gap-4 px-5 pt-1 text-[12px]">
          <p className="opacity-60">
            {target?.kind === 'drive'
              ? DRIVE_HELPER
              : target?.kind === 'demo'
                ? 'Demo mode: this sample image is not stored in Google Drive.'
                : 'This original isn’t available on Google Drive right now. Please contact the photographer.'}
          </p>
          <button
            type="button"
            onClick={() => setStrip((s) => !s)}
            className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3 opacity-75 hover:opacity-100 ${dark ? '' : ''}`}
            aria-pressed={strip}
          >
            <GalleryHorizontalEnd size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden sm:inline">{strip ? 'Hide filmstrip' : 'Show filmstrip'}</span>
            <span className="sr-only sm:hidden">{strip ? 'Hide filmstrip' : 'Show filmstrip'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
