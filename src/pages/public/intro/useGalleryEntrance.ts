import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GalleryResponse } from '../../../../shared/api';
import { imgUrl, srcSet } from '../../../lib/format';

/**
 * Entrance state machine for the PUBLIC client gallery route only.
 *
 *   off      — not eligible (deep link, reduced motion, already seen this session, no cover…)
 *   pending  — eligible so far; gallery data still loading (a plain dark surface, no aperture yet)
 *   closed   — gallery valid; lens visible at its closed pose while the cover image decodes (bounded wait)
 *   opening  — the iris is opening over the real gallery
 *   fading   — fallback: cover too slow/failed or visitor skipped; overlay fades out quickly
 *   done     — overlay gone, gallery fully interactive
 */
export type EntranceState = 'off' | 'pending' | 'closed' | 'opening' | 'fading' | 'done';

const COVER_WAIT_MS = 1600;

/** Non-reversible session key: FNV-1a of the token, so the raw link never sits in storage. */
function sessionKey(token: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `lsg-intro:${(h >>> 0).toString(36)}`;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function initiallyEligible(token: string, hasPhotoParam: boolean) {
  if (typeof window === 'undefined' || hasPhotoParam) return false;
  if ((window as unknown as { __LSG_NO_INTRO__?: boolean }).__LSG_NO_INTRO__) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return storage()?.getItem(sessionKey(token)) !== '1';
  } catch {
    return true;
  }
}

export function useGalleryEntrance(
  token: string,
  hasPhotoParam: boolean,
  data: GalleryResponse | undefined,
  failed: boolean,
) {
  // Decided once from the URL the visitor arrived with; later ?photo= changes never re-trigger it.
  const [state, setState] = useState<EntranceState>(() =>
    initiallyEligible(token, hasPhotoParam) ? 'pending' : 'off',
  );
  const [titlesIn, setTitlesIn] = useState(false);
  const started = useRef(false);
  const currentState = useRef(state);
  useEffect(() => {
    currentState.current = state;
  }, [state]);

  const markSeen = useCallback(() => {
    try {
      storage()?.setItem(sessionKey(token), '1');
    } catch {
      /* storage unavailable: the intro may replay, which is harmless */
    }
  }, [token]);

  // Invalid / revoked / unpublished links: drop the intro immediately so Not Found shows promptly.
  useEffect(() => {
    if (failed && state === 'pending') setState('off');
  }, [failed, state]);

  // Data arrived: decide, then wait (bounded) for the cover to be decoded before opening.
  useEffect(() => {
    if (!data || started.current) return;
    if (currentState.current !== 'pending') {
      // A cover/data change during the wait must release the visitor instead of losing its timer.
      if (currentState.current === 'closed') setState('fading');
      return;
    }
    started.current = true;
    const cover = data.collection.cover;
    const style = data.collection.style.cover.style;
    if (!cover || (style === 'typographic' && data.collection.style.layout.mode !== 'folio') || data.photos.length === 0) {
      setState('off');
      return;
    }
    setState('closed');
    // Same src/srcset/sizes as the hero image, so the browser fetches and decodes the cover only once.
    const img = new Image();
    img.decoding = 'async';
    const hero = document.querySelector<HTMLImageElement>('.g-hero-img, [data-testid="photo-grid"] .g-tile img');
    img.sizes = hero?.sizes || '100vw';
    img.srcset =
      hero?.srcset ||
      srcSet(cover.id, cover.w, cover.h, token, data.collection.source === 'demo' ? 'l' : 'xl');
    img.src = hero?.src || imgUrl(cover.id, 'l', token);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setState((s) => (s === 'closed' ? 'fading' : s)); // slow cover: don't hold the visitor behind the lens
    }, COVER_WAIT_MS);
    img
      .decode()
      .then(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        markSeen();
        setState((s) => (s === 'closed' ? 'opening' : s));
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setState((s) => (s === 'closed' ? 'fading' : s)); // broken cover: fall back to the gallery's own placeholder state
      });
    return () => {
      // Cancel only on data/route change or unmount, not on our own pending → closed transition.
      settled = true;
      window.clearTimeout(timer);
      started.current = false;
    };
  }, [data, token, markSeen]);

  // Includes stalled gallery metadata, not just the cover-image deadline.
  useEffect(() => {
    if (state !== 'pending') return;
    const timer = window.setTimeout(() => { markSeen(); setState('off'); }, 4500);
    return () => clearTimeout(timer);
  }, [state, markSeen]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (media.matches) { setState('off'); setTitlesIn(true); } };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // While the overlay is up: lock page scroll; restore on any exit path.
  const active = state === 'pending' || state === 'closed' || state === 'opening' || state === 'fading';
  useLayoutEffect(() => {
    if (!active) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    const backgrounds = [el.style.background, document.body.style.background];
    const overscroll = el.style.overscrollBehavior;
    el.style.background = document.body.style.background = '#161715';
    el.style.overscrollBehavior = 'none';
    document.body.style.overflow = 'hidden';
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
      document.body.style.overflow = bodyOverflow;
      [el.style.background, document.body.style.background] = backgrounds;
      el.style.overscrollBehavior = overscroll;
    };
  }, [active]);

  const skip = useCallback(() => {
    markSeen();
    setTitlesIn(true);
    setState((s) => (s === 'done' || s === 'off' ? s : 'fading'));
  }, [markSeen]);

  // Escape skips, like any modal moment.
  useEffect(() => {
    if (state !== 'closed' && state !== 'opening') return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && skip();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [state, skip]);

  return {
    state,
    /** True while the hero title should wait for the reveal. */
    holdTitles: (state === 'closed' || state === 'opening' || state === 'pending') && !titlesIn,
    overlayVisible: active,
    onReveal: () => setTitlesIn(true),
    onOpened: () => setState('done'),
    onFaded: () => { markSeen(); setState('done'); },
    skip,
  };
}
